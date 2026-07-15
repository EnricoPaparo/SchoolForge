# HARD-02B-00 — Progettazione del chunking resiliente dell'import ZIP (finding HARD-F06)

**Data:** 15 luglio 2026 · **Ambito:** HARD-F06 (import ZIP e swap `publicLessons` non gestiscono il limite di 500 mutazioni per batch/transazione).

> **STATO IMPLEMENTAZIONE — HARD-F06 RESOLVED (15/07/2026).** Questo documento è la progettazione (fase 02B-00). La fondazione è **HARD-02B-1** (ID import-scoped, query, Rules, indice) e il chunking/staging/switch/cleanup è **HARD-02B-2**. Riepilogo implementazione in fondo (§11). Codice: `repository/firestoreChunks.ts` (helper condiviso), `import/importRepository.ts` (protocollo staging→switch→cleanup), `import/stalePublicLessonsCleanup.ts` (cleanup idempotente + retry).
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
3. **CLEANUP (successivo, chunked, best-effort).** Elimina in chunk ≤400 **soltanto** le `publicLessons` del vecchio import (`programId==X && importId==oldId`) e marca **best-effort** il vecchio import `status:'superseded'` **se il documento esiste**. **NON** elimina UDA, lezioni, questionIndex né file Storage del vecchio import (vedi §7 «Cleanup»). Un errore qui **non** invalida l'import già attivo (le stale sono già invisibili grazie al gate `activeImportId` lato Rules): l'import resta `committed` con un `cleanupPending` non bloccante, ritentabile e idempotente.

Proprietà chiave: **solo lo switch è atomico**; staging e cleanup sono **chunked ed eventual-consistent** ma non producono mai visibilità parziale, perché la visibilità dipende **esclusivamente** da `activeImportId` (imposto sia dalla query sia dalle **Security Rules**, §7).

---

## 4. Alternative valutate

### A — `publicLessons` con ID import-scoped + query vincolata ad `activeImportId` **(RACCOMANDATA)**
- **Sicurezza:** il gate classe (`get(program).classIds`) resta, **e** la regola di lettura non-owner di `publicLessons` viene **rafforzata obbligatoriamente** (non opzionale) con `resource.data.importId == get(program).activeImportId`: staging e import stale/superseded sono negati anche a `get` diretto con ID noto o a query manomessa. La query UI `programId+importId` **non è** un confine di sicurezza: il confine è la Rule server-side. L'owner mantiene la lettura completa (attivo/staging/stale).
- **Atomicità logica:** ottima. Old/new coesistono con **ID distinti** → nessuna collisione; lo switch è 1 sola scrittura decisiva (`activeImportId`), che ridefinisce simultaneamente sia la visibilità della query sia quella imposta dalle Rules. Nessuna finestra parziale.
- **Compatibilità legacy:** buona. Le `publicLessons` legacy hanno `id=lessonId` ma **hanno già il campo `importId`** (`PublicLessonDoc.importId`); query e Rules ragionano per campo `importId`, non per prefisso ID. Il primo re-import normalizza allo schema import-scoped; le legacy dell'import precedente vengono ripulite dal cleanup (solo `publicLessons`).
- **Rules/query/indici:** query studente aggiunge `where('importId','==', activeImportId)` → serve **1 indice composito** `publicLessons(programId ASC, importId ASC)` (oggi assente). **Modifica Rules obbligatoria** (vedi §7): la lettura non-owner richiede `importId == program.activeImportId`.
- **Costo R/W:** la Rule aggiunge **1 `get(program)` server-side per documento valutato** in lettura (cross-doc get, come già fa il gate `classIds` odierno — che legge lo stesso program doc; le due `get` sullo stesso path sono memoizzate entro la stessa valutazione). Lato client, `activeImportId` è già disponibile dal program doc letto in discovery: nessuna read extra. Scritture: come oggi (1 publicLessons per lezione) ma **chunked**.
- **Complessità:** media. Richiede: campo `LessonDoc.publicLessonId`, un **helper puro** di risoluzione riferimento (§7), il nuovo indice e la Rule rafforzata.
- **Rischio orfani:** basso e **innocuo**. Le stale post-switch sono invisibili (query **e** Rules) e ripulibili in chunk; un cleanup fallito lascia solo `publicLessons` residue invisibili, mai incoerenza — e **mai** tocca dati tecnici/Storage.

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

**Motivazione:** è l'unica che (1) consente scritture chunked ≤400 mantenendo old/new **coesistenti senza collisione**, (2) riduce l'atto atomico a **una singola decisione** (`activeImportId`), (3) rende il vecchio import invisibile **all'istante** dello switch senza cancellare nulla, (4) resta **client-only, senza nuove Cloud Function né collezioni/dipendenze**, (5) è **retro-compatibile** con le `publicLessons` legacy grazie al campo `importId` già presente. B raddoppia le scritture e ripropone il limite allo switch; C viola l'atomicità studente; D non risolve.

**Requisito di sicurezza vincolante:** la soluzione include una **modifica Rules obbligatoria** — la lettura non-owner di `publicLessons` deve richiedere `resource.data.importId == get(program).activeImportId` (§7). Senza di essa la sola query UI non impedirebbe a uno studente di leggere, via `get` diretto o query manomessa, una proiezione di un import staging o stale. **Guardia interinale opzionale:** finché A non è implementata, adottare D come fail-fast (`> ~450` mutazioni stimate → messaggio "import troppo grande, suddividilo") per evitare fallimenti opachi a metà.

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
- **superseded** — ex-active dopo uno switch successivo; le sue `publicLessons` sono invisibili (Rules + query) e in attesa di cleanup. Il marcamento `superseded` è **best-effort e solo se il documento import esiste**.

Non servono altri stati: la condizione «cleanup non completato» è rappresentata da un flag di risultato **`cleanupPending`** non bloccante (l'import resta `committed`) e/o dalla presenza di `publicLessons` residue di un import non più attivo, ripulibili idempotentemente. `activeImportId` resta l'**unica fonte di verità** per la visibilità, imposta sia dalla query sia dalle Rules.

---

## 7. Contratto di dettaglio

- **Schema documenti.**
  - `programs/{programId}` — invariato (`activeImportId` è già lo switch).
  - `imports/{importId}.status` — dominio esteso a `'staging' | 'active' | 'superseded'` (era `'committed'`; `'committed'`/assente = legacy trattato come `active` se è l'`activeImportId`, altrimenti `superseded`).
  - `publicLessons/{docId}` — **campi invariati** (`importId` già presente). Cambia **solo la convenzione ID** per le nuove scritture.
- **Convenzione ID `publicLessons`:** nuovo = **`${importId}_${lessonId}`** (con `lessonId = ${udaId}_${toDocId(filename)}`). Legacy = `lessonId`. La distinzione è trasparente a query e Rules (ragionano per campo `importId`, non per prefisso ID).
- **Query studente:** `where('programId','==',X)` **AND** `where('importId','==', program.activeImportId)`. Il program doc è già letto in discovery (`loadStudentLessons`), quindi `activeImportId` è disponibile senza read aggiuntive.

- **Modifiche Rules (OBBLIGATORIE).** Nella regola di lettura **non-owner** di `publicLessons`, oltre al gate classe/modalità-verifica esistente, aggiungere il vincolo:
  ```
  resource.data.importId ==
    get(/databases/$(database)/documents/programs/$(resource.data.programId)).data.activeImportId
  ```
  L'**owner** mantiene la lettura completa (attivo, staging e stale) tramite il ramo `isOwner()` invariato. Motivazione: la query UI `programId+importId` **non è un confine di sicurezza**; senza il controllo server-side uno studente che conosce l'ID potrebbe leggere via `get` diretto — o via query manomessa senza filtro `importId` — una `publicLesson` di un import **staging** o **stale/superseded**. Con questo vincolo, staging e vecchi import sono inaccessibili al non-owner **sia** per `get` diretto **sia** per `list`. Il gate classe (`isClassmateOf` su `program.classIds`) e la **modalità verifica** restano applicati come oggi.

- **Indici:** **nuovo indice composito** `publicLessons (programId ASC, importId ASC)` in `firestore.indexes.json`. L'override `publicLessons.content` (escluso dall'indicizzazione) resta invariato.

- **Addressing `publicLessons` e legacy (contratto preciso).**
  - Aggiungere a `LessonDoc` un campo **opzionale** `publicLessonId?: string`. Nuovi import e nuove lezioni lo salvano = **`${importId}_${lessonId}`**. Una lezione creata dentro un import **legacy** può già ricevere un `publicLessonId` import-scoped.
  - Un **unico helper puro** risolve il riferimento: `resolvePublicLessonId(lesson) = lesson.publicLessonId ?? lessonId`. **Nessuna** doppia `get` sistematica «prova nuovo ID, poi vecchio ID»: il fallback è deciso dal campo, non da un tentativo su Firestore.
  - Punti che devono usare l'helper (tutti **ricevono/leggono già il `LessonDoc`** prima di toccare `publicLessons`, quindi hanno `publicLessonId` senza read extra):
    | Funzione (`repositoryEditorService.ts`) | Come ottiene il `LessonDoc` | Uso `publicLessons` |
    |---|---|---|
    | lesson-completion / «segna svolta» (`:288`) | `getDoc(lessonRef)` a monte | `update` |
    | `updateLessonMetadata` (`:359`, ref `:370`) | `getDoc(lessonRef)` (`:371`) | `update` |
    | `updateLessonMarkdownBody` (`:415`, ref `:426`) | `getDoc(lessonRef)` (`:427`) | `update` |
    | `createLesson` (`:484`, set `:549`) | crea il `LessonDoc` → genera `publicLessonId` | `set` (scrive anche `publicLessonId` sul `LessonDoc`) |
    | `reorderLesson` (`:720`, ref `:757-758`) | `LessonDoc` della lezione e del vicino | `update order` (self + neighbor) |
    | `deleteLesson` (`:906`, del `:951`) | `LessonDoc` in scope | `delete` |
    | `deleteUda` (`:974`, del `:1019`) | mappa sui `LessonDoc` dell'UDA | `delete` (per ogni lezione) |
  - `publicLessonsBackfillService.ts` **continua a lavorare sui doc trovati dalla query** (`docSnap.ref`/`docSnap.id`): non calcola ID, quindi resta invariato e compatibile con entrambe le convenzioni.
  - `programsService.ts` (`deleteProgram`) trova le `publicLessons` per **query** `where('programId','==',X)` e le cancella per `ref`: nessun addressing per-ID, invariato.
  - Nessuna **migrazione obbligatoria** delle lezioni vecchie: il primo re-import normalizza le nuove; le vecchie restano leggibili via helper (fallback a `lessonId`).

- **Cleanup (contratto).** Il cleanup automatico post-switch **DEVE**: (a) eliminare in chunk ≤400 **solo** le `publicLessons` del vecchio import (`programId==X && importId==oldId`); (b) marcare **best-effort** il vecchio `imports/{oldId}.status='superseded'` **se il documento esiste**. **NON DEVE** eliminare UDA, lezioni, questionIndex o file Storage del vecchio import. Motivazione: verifiche attive, riferimenti legacy o manutenzione possono dipendere dall'import tecnico precedente; la loro eliminazione richiede i controlli applicativi già presenti nei **flussi di cancellazione espliciti e guardati** (`deleteProgram`/`deleteUda`/`deleteLesson`, con guard verifiche). **HARD-02B non cambia retention né semantica delle cancellazioni**; qualunque eliminazione futura dei dati tecnici resta un'azione esplicita e guardata, **fuori scope**.

- **Stato e risultato (formalizzati).**
  - **Errore pre-switch** (staging/upload) → import **non applicato**: `activeImportId` invariato, corso precedente **intatto**; risultato = errore, nessun rollback finto (lo staging orfano è invisibile e ripulibile).
  - **Switch riuscito** → risultato **sempre `committed`**.
  - **Errore cleanup post-switch** → **non** trasformare il risultato in errore: resta `committed`, con un **`cleanupPending: true`** (warning non bloccante), senza fingere un rollback.
  - **Retry cleanup** idempotente (delete per `programId+importId`, ripetibile senza effetti collaterali).

- **Retry (import):** un import ritentato genera un nuovo `newImportId` (staging pulito) — non riusa uno staging fallito.
- **Dopo refresh/crash:** `activeImportId` è la verità (query **e** Rules). Crash in **staging** → orfano invisibile, ripulibile. Crash **dopo lo switch, in cleanup** → import attivo e corretto (`committed`), stale invisibili, cleanup ripetibile. Nessuno stato intermedio espone dati parziali.
- **Messaggi UI minimi:** staging "Preparazione import…"; switch "Attivazione…"; fallimento pre-switch "Import non applicato: il corso precedente è intatto."; cleanup fallito → nessun errore bloccante, avviso soft "pulizia rinviata" (coerente con `cleanupPending`). Con la guardia D: "Import troppo grande: suddividilo in più import."
- **Chunk massimo:** **400 mutazioni** per `writeBatch` (riuso di `BATCH_CHUNK_SIZE=400` e `commitOpsInChunks` già presenti in `poolEditorService.ts`).
- **Ordine dei commit:** (1) Storage upload; (2) chunk tecnici (importMeta `staging`, UDA, lessons **con `publicLessonId`**, questionIndex); (3) chunk `publicLessons` nuove (import-scoped, invisibili); (4) **switch atomico** (`activeImportId` + `imports/{newId}.status='active'` + audit); (5) cleanup chunked (solo `publicLessons` stale + best-effort `superseded`).
- **Atomico vs eventual-consistent:** **atomico solo lo switch** (passo 4, ≤3 mutazioni). Staging (2–3) e cleanup (5) sono **chunked/eventual-consistent** e non producono mai visibilità parziale.

- **Ordine di rollout futuro (HARD-02B, nessun deploy in questa PR).**
  1. deploy dell'**indice composito** `publicLessons(programId, importId)`;
  2. **attendere** che l'indice sia *Ready*;
  3. deploy delle **Rules** compatibili (vincolo `importId == activeImportId` per il non-owner);
  4. deploy **Hosting** con la nuova query/protocollo (`publicLessonId`, staging→switch→cleanup);
  5. **smoke DEV**.
  L'ordine evita finestre in cui il client interroga con un filtro non ancora indicizzato o Rules non ancora allineate.

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
| 11 | Documenti legacy (`id=lessonId`, senza `publicLessonId`) | Query per campo `importId` li seleziona; helper risolve a `lessonId`; re-import normalizza. |
| 12 | Nessuna mutazione persa o duplicata | Conteggio doc scritti == payload; chunk senza sovrapposizioni. |

**Addressing `publicLessonId` (service):**
| 13 | Editor su lezione **nuova** (con `publicLessonId`) | create/modifica metadati/modifica body/riordino/eliminazione risolvono `${importId}_${lessonId}` **senza doppie letture** (nessun tentativo "prova nuovo poi vecchio"). |
| 14 | Stessi flussi su lezione **legacy** (senza `publicLessonId`) | Helper cade su `lessonId`; operazioni corrette; nessuna get superflua. |
| 15 | `createLesson` dentro import legacy | La nuova lezione riceve un `publicLessonId` import-scoped; `publicLessons` scritta con quell'ID. |

**Cleanup (retention):**
| 16 | Cleanup post-switch | Elimina **solo** le `publicLessons` del vecchio import; **non** cancella UDA/lezioni/questionIndex né file Storage; marca `superseded` best-effort se il doc esiste. |
| 17 | Cleanup fallito | Risultato resta **`committed`** con `cleanupPending: true` (nessun errore, nessun rollback finto); retry idempotente. |

**Security Rules (matrice dedicata, con `@firebase/rules-unit-testing`):**
| 18 | Studente legge `publicLesson` dell'import **attivo** | Consentito. |
| 19 | Studente legge `publicLesson` **staging** | **Negato**. |
| 20 | Studente legge `publicLesson` **superseded/stale** | **Negato**. |
| 21 | `get` diretto con ID noto (import non attivo) | **Negato**. |
| 22 | Query senza filtro `importId` | **Negata** (la Rule richiede `importId == activeImportId`). |
| 23 | Query `programId + activeImportId` | **Consentita**. |
| 24 | Owner legge attivo, staging **e** stale | Consentito (ramo `isOwner`). |
| 25 | Class gate e modalità verifica | Restano applicati (studente di altra classe / classe in modalità verifica → negato, come oggi). |

**Rollout:**
| 26 | Ordine di rilascio documentato | indice → indice Ready → Rules → Hosting → smoke DEV (§7). |

Test da riusare/estendere: `import.rules.test.ts` (nuovi casi 18–25 con `@firebase/rules-unit-testing`), i test service dell'import/editor e `poolEditorService.test.ts` (chunking già coperto). **Nessun** E2E fragile o duplicato.

---

## 9. Nota — esito manuale HARD-02A (accessibilità)

Registrato per completezza (vedi anche `evidenze/hard-02a-a11y-audit.md`): lo **smoke a11y manuale su DEV è stato dichiarato PASS dal docente**. Verificati **Escape** (chiude i dialog Didattica), **Tab/Shift+Tab** (focus trap ciclico), **ripristino del focus** sul trigger alla chiusura e **blocco durante `busy`** (nessuna chiusura mentre un'operazione è in corso). **P2-01 = RESOLVED**. I finding **P3** (`aria-invalid`/`aria-describedby`, `scope="col"`) restano **polish non bloccante** e **non** vengono implementati in questa PR (né in HARD-02B).

---

## 10. Sintesi

- **Conteggio attuale:** Batch A = `1+U+L+Q`; Transazione B = `2+L₀+L`. Overflow: Q (batch A) su import ricchi di pool; L₀+L (transazione B) sui re-import grandi.
- **Rischio preciso:** fallimento atomico a soglia (import bloccato) + orfani Storage/Firestore innocui; il chunking ingenuo esporrebbe proiezioni parziali allo studente per collisione di ID.
- **Raccomandazione netta:** Alternativa **A** (ID `publicLessons` import-scoped + query su `activeImportId`), con guardia interinale D opzionale.
- **Impatto:** query studente +filtro `importId`; **1 nuovo indice** `publicLessons(programId,importId)`; **modifica Rules OBBLIGATORIA** — lettura non-owner richiede `resource.data.importId == get(program).activeImportId` (staging/stale negati anche a `get` diretto), owner invariato; campo `LessonDoc.publicLessonId` + **helper puro** di risoluzione (fallback a `lessonId`, nessuna doppia get); **cleanup solo delle `publicLessons`** (mai UDA/lezioni/questionIndex/Storage); risultato `committed` con `cleanupPending` non bloccante su cleanup fallito; **ordine di rollout** indice→Ready→Rules→Hosting→smoke; nessuna nuova collezione/Function/dipendenza.
- **Stato HARD-F06:** ✅ **RESOLVED (15/07/2026)** — vedi §11.

---

## 11. Riepilogo implementazione (HARD-02B-2) e costo/perf

### 11.1 Cosa è stato implementato
- **Helper condiviso** `apps/web/src/features/repository/firestoreChunks.ts`: `BATCH_CHUNK_SIZE = 400`, `commitOpsInChunks` (chunk sequenziali, un `writeBatch` per chunk), `deleteDocRefsInBatches`. **Unica** implementazione: `poolEditorService.ts` è stato migrato a importarla (rimozione della copia locale, meccanica e coperta dai test esistenti di `poolEditorService`).
- **`importRepository.ts`** riscritto nel protocollo vincolante: (A) genera `newImportId`; (B) valida l'intero ZIP prima di toccare `activeImportId`; (C) upload Storage; (D) chunk-write ≤400 dei doc tecnici (`importMeta` con `status:'staging'`, UDA, lezioni con `publicLessonId`, questionIndex); (E) chunk-write ≤400 delle nuove `publicLessons` (invisibili, `importId == newImportId`); (F) **switch atomico** — una `runTransaction` con **solo** `program.activeImportId = newImportId`, `imports/{newId}.status = 'active'`, audit; (G) **cleanup differito** delle sole `publicLessons` del vecchio import. Durante C–E `activeImportId` non è mai toccato.
- **`stalePublicLessonsCleanup.ts`**: `cleanupStalePublicLessons` (delete chunked di `publicLessons` con `programId+oldImportId`; `superseded` best-effort solo se il doc import esiste; mai UDA/lezioni/questionIndex/Storage) e `retryStalePublicLessonsCleanup` (retry esplicito, idempotente, **nessun** polling/listener/scheduler/Function).
- **Macchina a stati** `ImportDoc.status: 'staging' | 'active' | 'superseded'` (+ `'committed'` legacy accettato). `createInitializedProgram` scrive `active`; `verificationsService` accetta `active`/`committed`. Nessuna migrazione automatica.
- **Risultato tipizzato** (`ImportRepositoryResult`): `committed` + `cleanupPending: boolean`; `not_applied` (errore pre-switch, messaggio «Import non applicato: il corso precedente è rimasto intatto.»); `validation_failed`. UI (`DidatticaView`/`CourseWorkspace`): messaggi distinti pre/post-switch, avviso soft «Import completato. Pulizia delle vecchie proiezioni rinviata.» su `cleanupPending`, **guardia doppio-click** (`busy`/`wsBusy`) e guardia unmount (`mountedRef`).

### 11.2 Costo / performance (indicativo)
Sia **U** UDA, **L** lezioni, **Q** domande, **L₀** lezioni dell'import precedente.

| Scenario | Mutazioni tecniche (D) | `publicLessons` (E) | Switch (F) | Cleanup (G) | # `writeBatch` totali |
|---|---|---|---|---|---|
| Import piccolo (U=2,L=3,Q=4) | 10 | 3 | 1 tx | L₀ delete | 2 batch + 1 tx + ⌈L₀/400⌉ |
| Import a soglia (~400 mut. tecniche) | 400 | L | 1 tx | L₀ | 1 batch (D) + ⌈L/400⌉ (E) + 1 tx + ⌈L₀/400⌉ |
| Import 401 mut. tecniche | 401 | L | 1 tx | L₀ | 2 batch (D) + … |
| Import grande (L=600) | 601 | 600 | 1 tx | L₀ | ⌈601/400⌉=2 + ⌈600/400⌉=2 + 1 tx + ⌈L₀/400⌉ |

- Il chunking **non riduce il numero economico di scritture** (una scrittura per documento resta una scrittura): riduce il **rischio di fallimento a soglia** (nessun batch > 500) e i **round-trip di rete** (una commit per chunk invece di N `setDoc`).
- **Nessuna lettura continua / listener / polling** introdotti. Il cleanup **legge ed elimina solo** le `publicLessons` del vecchio import (`programId+oldImportId`, 1 query + ⌈L₀/400⌉ delete-batch) e legge 1 volta il doc import per il marcamento best-effort.
- Lo **switch** è l'unico atto atomico: ≤3 mutazioni in una transazione, indipendente da U/L/Q — mai a rischio di soglia.

### 11.3 Ordine di rollout (invariato, nessun deploy in questa PR)
indice `publicLessons(programId,importId)` → indice *Ready* → Rules (`importId == activeImportId`) → Hosting (query/protocollo) → smoke DEV.
