# HARD-02B-00 — Progettazione del chunking resiliente dell'import ZIP (finding HARD-F06)

**Data:** 15 luglio 2026 · **Ambito:** HARD-F06 (import ZIP e swap `publicLessons` non gestiscono il limite di 500 mutazioni per batch/transazione).
**Natura:** **fase di contratto e progettazione**, evidence-based. **Nessuna implementazione**, nessuna modifica a codice TS/TSX, Rules o indici; nessuna migrazione; nessun deploy. Client-only, nessuna nuova Cloud Function, nessuna nuova dipendenza.
**Codice analizzato:** `import/importRepository.ts`, `import/buildImportPayload.ts`, `import/types.ts`, `programs/studentLessonsService.ts`, `programs/programsService.ts`, `programs/publicLessonsBackfillService.ts`, `editor/repositoryEditorService.ts`, `pools/poolEditorService.ts`, `types/firestore.ts`, `firestore.rules`, `firestore.indexes.json`.

---

## 1. Conteggio esatto delle mutazioni dell'import attuale

Simboli: **U** = numero UDA, **L** = numero lezioni (totale), **Q** = numero domande (somma su tutti i pool validi), **L₀** = lezioni del **precedente** import dello stesso programma (proiezioni `publicLessons` già presenti).

L'import avviene in **due scritture Firestore separate** (`importRepository.ts`):

| Fase | Operazione | Mutazioni | Riferimento |
|---|---|---|---|
| **A — `writeBatch` (step 5)** | import metadata | 1 | `importRepository.ts:84` |
| | UDA (`imports/{id}/udas`) | **U** | `:89-91` |
| | lezioni (`imports/{id}/lessons`) | **L** | `:93-95` |
| | questionIndex | **Q** | `:97-99` |
| | **Subtotale batch A** | **1 + U + L + Q** | `:101 commit` |
| **B — `runTransaction` (step 6)** | `programs/{id}` set/update (`activeImportId`) | 1 | `:114-129` |
| | `publicLessons` **stale** delete | **L₀** | `:131-133` |
| | `publicLessons` **nuove** set | **L** | `:134-139` |
| | `auditEvents` | 1 | `:141-149` |
| | **Subtotale transazione B** | **2 + L₀ + L** | `:150` |

- `publicLessons` sono **1 per lezione**; l'**ID** è `lessonId = ${udaId}_${toDocId(filename)}` (`buildImportPayload.ts:67,143`) — **NON** import-scoped (indipendente dall'import). Questo è il fatto centrale (§2, §4).
- Gli upload Storage (step 4) sono `Promise.all` di `uploadBytes`, **non** mutazioni Firestore (non contano nel limite 500).

**Esempio realistico (un anno scolastico completo):** U=8, L=40, Q=460 → **Batch A = 1+8+40+460 = 509 > 500 → FALLISCE**. Re-import di un programma grande: L₀=250, L=250 → **Transazione B = 2+250+250 = 502 > 500 → FALLISCE**.

---

## 2. Punto di overflow, fallimenti, orfani, perché il chunking ingenuo rompe l'atomicità

### 2.1 Dove si supera il limite
- **Batch A** supera 500 quando `1 + U + L + Q > 500`. **Q (domande) è il termine dominante**: è la prima soglia a saltare in import ricchi di pool. Batch Firestore: fallimento **atomico** (nessuna scrittura applicata) → import interrotto, nessun dato tecnico scritto.
- **Transazione B** supera 500 quando `2 + L₀ + L > 500`: si attiva su **re-import** di programmi grandi (molte lezioni vecchie + nuove). Transazione Firestore: fallimento atomico → `activeImportId` e `publicLessons` invariati.

### 2.2 Cosa accade a ogni fase se fallisce (stato attuale)
| Fase che fallisce | Effetto |
|---|---|
| Validazione (step 1) | Nessuna scrittura. Sicuro. |
| Upload Storage (step 4) | File parziali sotto `imports/{newId}/…`; **orfani in Storage** (rimovibili dal docente, non referenziati da `activeImportId`). Firestore intatto. |
| Batch A (step 5) | Atomico: nessun doc tecnico scritto. Restano gli **upload Storage orfani**. `activeImportId` invariato → studente vede ancora il vecchio import. |
| Transazione B (step 6) | Atomica: `activeImportId`/`publicLessons` invariati. Restano **doc tecnici del nuovo import** (`imports/{newId}/**`) e **upload Storage** come orfani non attivi. Nessuna incoerenza lato studente. |

### 2.3 Dati orfani possibili (oggi)
- **Storage**: file di un import mai attivato.
- **Firestore tecnico**: `imports/{newId}/{udas,lessons,questionIndex}` di un batch A riuscito ma transazione B fallita.
- Entrambi sono **innocui per lo studente** (mai referenziati da `activeImportId`, mai in `publicLessons`), ma pesano come storage residuo. Nessuna procedura automatica di cleanup li rimuove oggi (rimozione manuale del docente).

### 2.4 Perché il chunking ingenuo (Alternativa C) romperebbe l'atomicità percepita
La transazione B fa, **insieme**: `delete stale publicLessons` + `set new publicLessons` + `update activeImportId`. Le `publicLessons` **condividono lo stesso ID** (`lessonId`) tra vecchio e nuovo import (§1). Se si spezza B in più batch:
1. **Collisione di ID**: scrivere le nuove `publicLessons` sovrascrive in-place le vecchie chunk per chunk → tra un chunk e l'altro lo studente legge un **insieme misto** (alcune lezioni nuove, alcune vecchie, alcune cancellate). La query studente è `where('programId','==',X)` **senza filtro import** (`studentLessonsService.ts`), quindi legge **tutto** ciò che c'è in quel momento.
2. **Finestra di proiezione parziale**: durante i delete-stale chunked, alcune lezioni spariscono temporaneamente; durante i set chunked, appaiono a metà. Violazione diretta del requisito "lo studente non vede mai una proiezione parziale".

Conclusione: **con ID non import-scoped non esiste un chunking sicuro della fase B**. O si rende ogni proiezione import-scoped (coesistenza old/new senza collisione, §4.A), o si stagia altrove (§4.B).

---

## 3. Protocollo minimale raccomandato (panoramica)

Obiettivo: scritture tecniche in chunk ≤ **400** mutazioni, nuove proiezioni preparate **invisibili**, **switch atomico piccolo**, vecchio import **immediatamente invisibile** dopo lo switch, cleanup stale **successivo e chunked**, consultazione studente sempre coerente.

1. **STAGING (chunked, invisibile).** Genera `newImportId`. Carica Storage. Scrivi in chunk ≤400: import metadata (`status:'staging'`), UDA, lezioni, questionIndex, **e** le nuove `publicLessons` con **ID import-scoped** `${newImportId}_${lessonId}` e campo `importId=newImportId`. Sono invisibili perché la query studente filtra `importId == program.activeImportId` (ancora il vecchio).
2. **SWITCH (atomico, piccolo).** Una `runTransaction`/batch di **≤3 mutazioni**: `programs/{id}.activeImportId = newImportId` (+ `updatedAt`), `imports/{newId}.status='active'`, `auditEvents` (import.committed). Da questo istante lo studente vede **solo** il nuovo import; il vecchio diventa **immediatamente invisibile** (filtro `importId`), senza cancellare nulla.
3. **CLEANUP (successivo, chunked, best-effort).** Marca il vecchio import `status:'superseded'`, poi elimina in chunk ≤400 le sue `publicLessons` (`programId==X && importId==oldId`) e — se si vuole liberare storage — i suoi doc tecnici e file Storage. Un errore qui **non** invalida l'import già attivo (le stale sono già invisibili): stato `cleanup_pending`, ritentabile.

Proprietà chiave: **solo lo switch è atomico**; staging e cleanup sono **chunked ed eventual-consistent** ma non producono mai visibilità parziale, perché la visibilità dipende **esclusivamente** da `activeImportId` + filtro `importId`.

---

## 4. Alternative valutate

### A — `publicLessons` con ID import-scoped + query vincolata ad `activeImportId` **(RACCOMANDATA)**
- **Sicurezza:** invariata. La regola resta il gate classe via `get(program).classIds`; il filtro `importId` **restringe** i risultati (non allarga). Nessun dato in più esposto.
- **Atomicità logica:** ottima. Old/new coesistono con **ID distinti** → nessuna collisione; lo switch è 1 sola scrittura decisiva (`activeImportId`). Nessuna finestra parziale.
- **Compatibilità legacy:** buona con accorgimento. Le `publicLessons` legacy hanno `id=lessonId` ma **hanno già il campo `importId`** (`PublicLessonDoc.importId`, `types/firestore.ts`); la query `importId==activeImportId` le seleziona per campo, indipendentemente dall'ID. Il primo re-import normalizza allo schema import-scoped e il cleanup rimuove le legacy.
- **Rules/query/indici:** query studente aggiunge `where('importId','==', activeImportId)` → serve **1 indice composito** `publicLessons(programId ASC, importId ASC)` (oggi assente). **Nessuna modifica Rules necessaria** per la lettura (l'`importId` non è gated; il filtro è ammesso). Hardening opzionale: aggiungere alla regola `resource.data.importId == get(program).activeImportId` per negare query dirette su import non attivi (difesa in profondità).
- **Costo R/W:** lettura studente **+1 read** del program doc già effettuata in discovery (nessun costo extra). Scritture: come oggi (1 publicLessons per lezione) ma **chunked**; il cleanup aggiunge L₀ delete differiti (già presenti oggi come delete in transazione).
- **Complessità:** media. Richiede: cambio convenzione ID `publicLessons`, aggiornare l'**addressing per-id nell'editor/backfill** (vedi §7 legacy: `repositoryEditorService.ts` indirizza `doc(db,'publicLessons', lessonId)` in ~8 punti; dovrà usare `${activeImportId}_${lessonId}` con **fallback legacy** a `lessonId`), nuovo indice.
- **Rischio orfani:** basso e **innocuo**. Le stale post-switch sono invisibili (filtro) e ripulibili in chunk; un cleanup fallito lascia solo storage residuo, mai incoerenza.

### B — Staging collection separata (`publicLessonsStaging`)
- **Sicurezza:** richiede **regole duplicate** per la staging (o owner-only + copia allo switch). Superficie in più.
- **Atomicità logica:** buona in staging, ma lo **switch** deve *spostare* N doc da staging a `publicLessons` (N delete + N set) → **ripropone il problema dei 500** allo switch, o richiede a sua volta chunking non atomico. Peggiora, non risolve.
- **Compatibilità legacy:** neutra ma introduce una collezione nuova.
- **Rules/query/indici:** +collezione, +regole, +eventuali indici. Più modifiche di A.
- **Costo:** scrive i dati **due volte** (staging + finale) → ~2× scritture publicLessons.
- **Complessità:** alta. **Rischio orfani:** doc di staging abbandonati.

### C — Chunking ingenuo degli ID attuali
- **Sicurezza:** invariata, ma **atomicità logica rotta** (§2.4): finestra di proiezione mista/parziale visibile allo studente. **Inaccettabile** per requisito esplicito.
- Compatibilità/indici invariati; costo basso; complessità bassa — ma **scartata** perché viola l'invariante studente.

### D — Rifiuto esplicito degli import oltre soglia
- **Sicurezza/atomicità/legacy:** nessun impatto. **Costo/complessità:** minimi. **Rischio orfani:** nessuno.
- **Limite:** non risolve il problema, lo **evita**: un import legittimamente grande (anno intero con molti pool) verrebbe rifiutato. Utile solo come **guardia interinale** (fail-fast con messaggio chiaro) finché A non è implementata — **non** come soluzione.

---

## 5. Soluzione raccomandata

> **Alternativa A — `publicLessons` con ID import-scoped + query studente vincolata ad `activeImportId`.**

**Motivazione:** è l'unica che (1) consente scritture chunked ≤400 mantenendo old/new **coesistenti senza collisione**, (2) riduce l'atto atomico a **una singola decisione** (`activeImportId`), (3) rende il vecchio import invisibile **all'istante** dello switch senza cancellare nulla, (4) resta **client-only, senza nuove Cloud Function né collezioni/dipendenze**, (5) è **retro-compatibile** con le `publicLessons` legacy grazie al campo `importId` già presente. B raddoppia le scritture e ripropone il limite allo switch; C viola l'atomicità studente; D non risolve. **Guardia interinale opzionale:** finché A non è implementata, adottare D come fail-fast (`> ~450` mutazioni stimate → messaggio "import troppo grande, suddividilo") per evitare fallimenti opachi a metà.

---

## 6. Macchina a stati dell'import (minimale)

Campo `imports/{importId}.status` (oggi solo `'committed'`). Nuovo dominio minimo:

```
staging ──(switch atomico)──▶ active ──(nuovo import attivato)──▶ superseded ──(cleanup)──▶ [doc rimosso]
   │
   └─(fallimento pre-switch)─▶ resta 'staging' (orfano invisibile, ripulibile)
```

- **staging** — dati tecnici + `publicLessons` scritti (chunked), **invisibili** (`activeImportId` ancora il precedente).
- **active** — è l'import puntato da `program.activeImportId`. Esattamente uno per programma.
- **superseded** — ex-active dopo uno switch successivo; le sue `publicLessons` sono invisibili e in attesa di cleanup (`cleanup_pending` implicito = esiste un import `superseded` con proiezioni residue).

Non servono altri stati: `cleanup_pending` è rappresentato dalla presenza di un import `superseded` con `publicLessons` residue, ripulibili idempotentemente. `activeImportId` resta l'**unica fonte di verità** per la visibilità.

---

## 7. Contratto di dettaglio

- **Schema documenti.**
  - `programs/{programId}` — invariato (`activeImportId` è già lo switch).
  - `imports/{importId}.status` — dominio esteso a `'staging' | 'active' | 'superseded'` (era `'committed'`; `'committed'`/assente = legacy trattato come `active` se è l'`activeImportId`, altrimenti `superseded`).
  - `publicLessons/{docId}` — **campi invariati** (`importId` già presente). Cambia **solo la convenzione ID** per le nuove scritture.
- **Convenzione ID `publicLessons`:** nuovo = **`${importId}_${lessonId}`** (con `lessonId = ${udaId}_${toDocId(filename)}`). Legacy = `lessonId`. La distinzione è trasparente alla query (che filtra per campo `importId`, non per prefisso ID).
- **Query studente:** `where('programId','==',X)` **AND** `where('importId','==', program.activeImportId)`. Il program doc è già letto in discovery (`loadStudentLessons`), quindi `activeImportId` è disponibile senza read aggiuntive.
- **Modifiche Rules:** **nessuna richiesta** per la correttezza (l'`importId` non è gated; aggiungere un filtro di uguaglianza è ammesso dalla regola esistente su `publicLessons`). **Opzionale (hardening):** nella regola `publicLessons` aggiungere `&& resource.data.importId == get(.../programs/$(resource.data.programId)).data.activeImportId` per impedire la lettura diretta di proiezioni non attive. Da valutare in implementazione; non necessaria per il protocollo.
- **Indici:** **nuovo indice composito** `publicLessons (programId ASC, importId ASC)` in `firestore.indexes.json`. L'override `publicLessons.content` (escluso dall'indicizzazione) resta invariato.
- **Compatibilità/fallback legacy:** (a) query per-campo `importId` funziona sulle legacy senza modifiche; (b) `repositoryEditorService.ts` indirizza `publicLessons` per **ID diretto = lessonId** in ~8 punti (`:288,370,426,549,757-758,951,1019`) e `publicLessonsBackfillService.ts` per `docSnap.id` — l'implementazione dovrà calcolare `${activeImportId}_${lessonId}` **con fallback a `lessonId`** se il doc import-scoped non esiste (lezione importata prima di HARD-02B). Il primo re-import normalizza e il cleanup elimina le legacy.
- **Retry:** idempotente. Un import ritentato genera un nuovo `newImportId` (staging pulito) — non riusa uno staging fallito. Il cleanup è idempotente (delete per `programId+importId`).
- **Dopo refresh/crash:** `activeImportId` è la verità. Crash in **staging** → orfano invisibile (nessun effetto studente), ripulibile. Crash **dopo lo switch, in cleanup** → import attivo e corretto; stale invisibili; cleanup ripetibile. Nessuno stato intermedio espone dati parziali.
- **Messaggi UI minimi:** durante staging "Preparazione import…"; allo switch "Attivazione…"; su fallimento pre-switch "Import non applicato: il corso precedente è intatto."; su cleanup fallito nessun errore bloccante (log/avviso soft "pulizia rinviata"). Con la guardia D: "Import troppo grande: suddividilo in più import."
- **Chunk massimo:** **400 mutazioni** per `writeBatch` (riuso di `BATCH_CHUNK_SIZE=400` e `commitOpsInChunks` già presenti in `poolEditorService.ts` — margine prudente sotto 500).
- **Ordine dei commit:** (1) Storage upload; (2) chunk tecnici (importMeta `staging`, UDA, lessons, questionIndex); (3) chunk `publicLessons` nuove (import-scoped, invisibili); (4) **switch atomico** (`activeImportId` + `status:'active'` + audit); (5) cleanup chunked (superseded).
- **Atomico vs eventual-consistent:** **atomico solo lo switch** (passo 4, ≤3 mutazioni). Staging (2–3) e cleanup (5) sono **chunked/eventual-consistent** e non producono mai visibilità parziale.

---

## 8. Matrice dei test (per l'implementazione HARD-02B)

| # | Caso | Atteso |
|---|---|---|
| 1 | Import < 400 mutazioni | Un chunk tecnico + switch; risultato identico all'attuale. |
| 2 | Import > 500 mutazioni | Nessun fallimento da limite; più chunk. |
| 3 | ≥ 2 chunk tecnici | Tutti i doc scritti, nessuno perso/duplicato. |
| 4 | Errore durante staging | `activeImportId` invariato; vecchio import ancora visibile; staging orfano invisibile. |
| 5 | Errore **prima** dello switch | Import precedente **intatto e leggibile**; nessuna proiezione nuova visibile. |
| 6 | Errore **dopo** lo switch (in cleanup) | Import **attivo e corretto**; stale invisibili; import non dichiarato fallito; cleanup ritentabile. |
| 7 | Retry | Nuovo `importId`, nessuna duplicazione; cleanup idempotente. |
| 8 | Nessuna proiezione parziale leggibile dallo studente | In ogni istante la query `programId+importId==active` restituisce un insieme coerente. |
| 9 | Vecchio import leggibile **prima** dello switch | Query studente = vecchio import completo. |
| 10 | Nuovo import leggibile **dopo** lo switch | Query studente = nuovo import completo; vecchio invisibile all'istante. |
| 11 | Documenti legacy (`id=lessonId`, `status` assente) | Query per campo `importId` li seleziona; editor/backfill con fallback a `lessonId`; re-import normalizza. |
| 12 | Nessuna mutazione persa o duplicata | Conteggio doc scritti == payload; chunk senza sovrapposizioni. |

Test da riusare/estendere: `import.rules.test.ts`, i test service dell'import e `poolEditorService.test.ts` (chunking già coperto). **Nessun** E2E fragile o duplicato.

---

## 9. Nota — esito manuale HARD-02A (accessibilità)

Registrato per completezza (vedi anche `evidenze/hard-02a-a11y-audit.md`): lo **smoke a11y manuale su DEV è stato dichiarato PASS dal docente**. Verificati **Escape** (chiude i dialog Didattica), **Tab/Shift+Tab** (focus trap ciclico), **ripristino del focus** sul trigger alla chiusura e **blocco durante `busy`** (nessuna chiusura mentre un'operazione è in corso). **P2-01 = RESOLVED**. I finding **P3** (`aria-invalid`/`aria-describedby`, `scope="col"`) restano **polish non bloccante** e **non** vengono implementati in questa PR (né in HARD-02B).

---

## 10. Sintesi

- **Conteggio attuale:** Batch A = `1+U+L+Q`; Transazione B = `2+L₀+L`. Overflow: Q (batch A) su import ricchi di pool; L₀+L (transazione B) sui re-import grandi.
- **Rischio preciso:** fallimento atomico a soglia (import bloccato) + orfani Storage/Firestore innocui; il chunking ingenuo esporrebbe proiezioni parziali allo studente per collisione di ID.
- **Raccomandazione netta:** Alternativa **A** (ID `publicLessons` import-scoped + query su `activeImportId`), con guardia interinale D opzionale.
- **Impatto:** query studente +filtro `importId`; **1 nuovo indice** `publicLessons(programId,importId)`; **nessuna modifica Rules** obbligatoria (hardening opzionale); editor/backfill da rendere import-scoped con fallback legacy; nessuna nuova collezione/Function/dipendenza.
- **Stato HARD-F06:** **progettazione completata (design-ready)**; implementazione = HARD-02B (fase successiva), fuori da questa PR.
