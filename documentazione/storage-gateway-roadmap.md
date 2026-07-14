# Repository Storage Gateway — roadmap e contratto (SGW)

> **Stato: SGW-01 implementato nel codice (deploy DEV e smoke Brave ancora da
> eseguire); SGW-02 ancora pendente.**
> Il codice del gateway esiste ora nel repo: la Cloud Function
> `repositoryGateway` (`functions/src/repositoryGateway.ts` +
> `repositoryGatewayCore.ts`), il client adapter
> (`apps/web/src/features/repository/gateway/repositoryGatewayClient.ts`), il
> rewrite `/api/repository/**` in `firebase.json` e la migrazione delle
> operazioni **singolo-file** (editing lezioni/UDA, pool, fallback lezione).
> **Non è ancora stato fatto alcun deploy né alcuno smoke Brave**: finché non
> avvengono davvero, il comportamento su Brave mobile resta **non verificato in
> produzione**. Le operazioni **batch/prefix** (import/export/eliminazioni di
> prefisso/backfill/domande verifiche) restano **accesso diretto a Storage**
> fino a **SGW-02**.

## 0. Perché (contesto verificato su DEV)

- **Safari mobile**: le richieste dirette a Firebase Storage funzionano.
- **Brave mobile**: le richieste dirette a Storage falliscono con
  `storage/retry-limit-exceeded`, **HTTP status 0**, dopo ~120 s, con
  connessione **online** — cioè la richiesta non completa il round-trip verso
  `firebasestorage.googleapis.com` e si esaurisce solo dopo i retry automatici
  dell'SDK.
- **MOB-01C** ha risolto **solo** la *consultazione* delle lezioni docente,
  spostandola su `publicLessons.content` (Firestore, un `getDoc`), con Storage
  come fallback legacy.
- **Restano dipendenti diretti da Firebase Storage** (anche in **scrittura**,
  quindi bloccabili su Brave): pool (lettura/salvataggio/eliminazione),
  modifica contenuto/metadata Markdown di lezioni e UDA, import, export,
  eliminazioni (lezione/UDA/programma), backfill `publicLessons.content`, e il
  caricamento delle domande in preparazione/attivazione verifica e per il PDF
  soluzioni.

L'obiettivo SGW è instradare **tutti** questi accessi attraverso un endpoint
**same-origin** (`https://<hosting-domain>/api/repository/*`), servito da
Hosting → Cloud Function → Admin SDK → Cloud Storage, così il browser non
contatta più direttamente `firebasestorage.googleapis.com`. SchoolForge resta
**Markdown-first, minimale, sicuro e a costi molto bassi**.

---

## Task 1 — Inventario Storage attuale (`firebase/storage` sotto `apps/web/src`)

Inventario completo delle chiamate **dirette** a Firebase Storage nel codice
applicativo (esclusi i file `*.test.ts(x)` e `src/rules/**`, che sono test).
Verificato con `rg "from 'firebase/storage'"` e
`rg "getBytes\(|uploadBytes\(|deleteObject\(|listAll\("`.

| # | File · funzione | Op | Contenuto | Chiamata Firebase | Owner/Studente | Frequenza | Batch? | Criticità Brave | Pacchetto |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `teacher/lessonContent.ts` · `fetchLessonContent` | read | Markdown lezione | `getBytes` | owner | bassa (**solo fallback legacy** post MOB-01C) | no | alta (fallback) | **SGW-01** |
| 2 | `repository/pools/poolEditorService.ts` · `loadPool` (:155) | read | pool `.pool.md` | `getBytes` | owner | media (tab Domande) | no | alta | **SGW-01** |
| 3 | `repository/pools/poolEditorService.ts` · `savePool` (:211) | write | pool `.pool.md` | `uploadBytes` | owner | media | no | **alta (scrittura)** | **SGW-01** |
| 4 | `repository/pools/poolEditorService.ts` · `deletePool` (:330) | delete | pool `.pool.md` | `deleteObject` | owner | bassa | no | alta | **SGW-01** |
| 5 | `repository/editor/repositoryEditorService.ts` · `fetchStorageText` (:43) | read | Markdown lezione/UDA | `getBytes` | owner | media (edit) | no | alta | **SGW-01** |
| 6 | `repository/editor/repositoryEditorService.ts` · `writeStorageText` (:52) | write | Markdown lezione/UDA | `uploadBytes` | owner | media (create/edit/reorder metadata) | no | **alta (scrittura)** | **SGW-01** |
| 7 | `repository/editor/repositoryEditorService.ts` · delete lezione/UDA (:830) | delete | file lezione/UDA | `deleteObject` | owner | bassa | no | alta | **SGW-01** |
| 8 | `teacher/exportZip.ts` · `fetchContent`/`buildExportZip` (:15) | read | Markdown UDA+lezioni | `getBytes` (concorrente) | owner | bassa (export) | **sì** | alta | **SGW-02** |
| 9 | `repository/import/importRepository.ts` (:74) | write | tutti i file Markdown+pool | `uploadBytes` (loop) | owner | bassa (import) | **sì** | **alta (scrittura, molti file)** | **SGW-02** |
| 10 | `repository/programs/programsService.ts` · `deleteStoragePrefix` (:246–247) | list+delete | intero prefisso import | `listAll` + `deleteObject` | owner | rara (elimina programma/import) | **sì (prefix)** | alta | **SGW-02** |
| 11 | `repository/programs/publicLessonsBackfillService.ts` (:116) | read | Markdown lezione | `getBytes` (per lezione) | owner | rara (migrazione one-shot) | **sì** | alta | **SGW-02** |
| 12 | `repository/verifications/loadSelectedQuestions.ts` (:54) | read | pool files (raggruppati) | `getBytes` (concorrenza 4) | owner | media (prep/attivazione verifica, PDF studenti) | **sì** | alta | **SGW-02** |
| 13 | `repository/verifications/loadSelectedQuestionsWithSolutions.ts` (:72) | read | pool files (raggruppati) | `getBytes` (concorrenza 4) | owner | media (PDF soluzioni docente) | **sì** | alta | **SGW-02** |

**Configurazione (non una chiamata dati, resta l'unico punto SDK autorizzato):**
`apps/web/src/lib/firebase.ts` — `getStorage(app)` + `connectStorageEmulator`.
Dopo SGW, l'SDK Storage lato browser va **rimosso o confinato** all'adapter del
gateway (gate `rg` in SGW-02).

**Note di caratterizzazione:**

- Nessuna operazione è **student-facing**: lo studente legge già solo
  `publicLessons.content` (Firestore) e non tocca mai Storage (ADR-16 / M3F-08).
  Il gateway **conferma e rafforza** questo: nessun endpoint studente, neppure
  in lettura ai pool.
- Le operazioni 8–13 sono naturalmente **batch** (più file per una singola
  operazione logica: un export, un import, una cancellazione di prefisso, un
  backfill, una preparazione verifica). Il gateway le serve con **una sola
  invocazione** ciascuna (vedi Task 3), non una Function per file.
- Le operazioni 1–7 sono **singolo file** e mappano 1:1 sugli endpoint singoli.

---

## Task 2 — Contratto target (gateway HTTPS same-origin)

```
Web app (browser)
  → fetch same-origin  /api/repository/*
  → Firebase Hosting rewrite
  → Cloud Function HTTPS (2ª generazione)
  → Firebase Admin SDK
  → Cloud Storage (bucket del progetto)
```

Decisioni fissate:

- **Cloud Function HTTP di 2ª generazione** (una sola Function `repositoryGateway`
  che instrada internamente i sotto-percorsi `/api/repository/*`; **non** una
  Function per file).
- **`minInstances: 0`** (nessun costo a riposo; cold start accettabile per un
  singolo docente).
- **`maxInstances` basso e documentato**: valore iniziale **3** (app a docente
  singolo, concorrenza reale minima); alzabile solo con evidenza di throttling.
- **Regione `us-central1`, verificata**: la Function gira nella stessa region
  del bucket Storage per evitare egress cross-region. Location confermata dal
  docente con `gcloud storage buckets describe
  gs://schoolforge-dev.firebasestorage.app` → `location: US-CENTRAL1`,
  `location_type: region`.
- **Autenticazione** tramite **Firebase ID token** (header `Authorization:
  Bearer <idToken>`), verificato server-side con l'Admin SDK.
- Accesso **esclusivamente al docente owner** del portale.
- **Nessun accesso studente**, neppure in lettura ai pool.
- **Solo Markdown/pool UTF-8**: nessun endpoint generico per file arbitrari;
  allowlist estensioni `.md` (+ `.pool.md`).
- **Nessun path scelto liberamente** senza validazione (vedi Task 4).
- **Nessun proxy pubblico**: l'endpoint richiede sempre un ID token valido del
  proprietario; non serve contenuti a utenti non autenticati o non-owner.

---

## Task 3 — API minimale

**Una sola Function 2ª gen** dietro il rewrite `/api/repository/**`. Tutti gli
endpoint sono **`POST`** con body JSON (i path non finiscono mai nella query
string né nei log). `Content-Type: application/json`; contenuti file sempre
**stringhe UTF-8** nel JSON (nessun base64, nessun binario). Ogni risposta di
errore usa `{ "error": { "code": "...", "message": "..." } }`.

### Limiti globali (documentati)

| Limite | Valore iniziale | Note |
|---|---|---|
| Byte per file | **700.000** | = `MAX_LESSON_CONTENT_BYTES` esistente (coerenza con la proiezione) |
| File per batch-read | **300** | copre export/verifica di corsi grandi |
| File per batch-write (import) | **500** | copre import di corsi grandi |
| Byte totali per richiesta | **20 MB** | sotto il limite ~32 MB della 2ª gen, con margine per l'overhead JSON |
| Estensioni ammesse | `.md`, `.pool.md` | allowlist; qualsiasi altra → `415` |

### 3.1 Leggere un singolo file — `POST /api/repository/read`

- **Request**: `{ "path": "repository/{ownerUid}/imports/…/lezione-001-x.md" }`
- **Response 200**: `{ "path": "…", "content": "…", "encoding": "utf-8" }`
- **Errori**: `400 invalid_path`, `401 unauthenticated`, `403 not_owner`,
  `404 file_not_found`, `415 unsupported_extension`, `500 storage_error`.
- **File assente**: `404 file_not_found`.
- **Atomicità**: N/A (singolo oggetto).
- **Retry**: sì (idempotente). **Idempotenza**: sì.
- **Costo**: 1 invocazione + 1 operazione Storage classe B + egress = dimensione file.

### 3.2 Scrivere un singolo file — `POST /api/repository/write`

- **Request**: `{ "path": "…", "content": "…" }`
- **Response 200**: `{ "path": "…", "bytes": 1234 }`
- **Errori**: `400 invalid_path`, `401`, `403 not_owner`,
  `413 file_too_large`, `415 unsupported_extension`, `500 storage_error`.
- **File assente**: crea (upsert). **Sovrascrive** se esiste.
- **Atomicità**: singolo oggetto (scrittura atomica lato Storage).
- **Retry**: sì (idempotente: stesso path+contenuto → stesso stato).
  **Idempotenza**: sì.
- **Costo**: 1 invocazione + 1 operazione classe A + ingress = dimensione file.

### 3.3 Eliminare un singolo file — `POST /api/repository/delete`

- **Request**: `{ "path": "…" }`
- **Response 200**: `{ "path": "…", "deleted": true }`
- **File assente**: **no-op idempotente** → `200 { "deleted": false }` (non 404,
  per rendere il retry sicuro).
- **Errori**: `400`, `401`, `403 not_owner`, `500 storage_error`.
- **Atomicità**: singolo oggetto. **Retry/Idempotenza**: sì.
- **Costo**: 1 invocazione + 1 operazione classe A.

### 3.4 Leggere più file in batch — `POST /api/repository/batch-read`

Per **export** e **preparazione/attivazione verifica** e **PDF soluzioni**.

- **Request**: `{ "paths": ["…", "…"] }` (≤ 300).
- **Response 200**: `{ "files": [ { "path": "…", "content": "…" } | { "path": "…", "error": { "code": "file_not_found" } } ] }`
  (un risultato per path, **stesso ordine** dell'input).
- **Errori a livello richiesta**: `400 too_many_files`, `401`, `403 not_owner`,
  `413 total_too_large`, `415`.
- **File assente**: riportato **per-file** in `files[i].error`, non fa fallire
  l'intera richiesta.
- **Atomicità**: **non garantita** tra file (lettura → nessuna mutazione).
- **Retry/Idempotenza**: sì.
- **Costo**: 1 invocazione + N operazioni classe B + egress = somma dimensioni.

### 3.5 Scrivere più file in batch — `POST /api/repository/batch-write`

Per **import** di un corso.

- **Request**: `{ "files": [ { "path": "…", "content": "…" } ] }` (≤ 500,
  ≤ 20 MB totali).
- **Response 200**: `{ "written": N, "results": [ { "path": "…", "ok": true } | { "path": "…", "error": {…} } ] }`.
- **Errori a livello richiesta**: `400 too_many_files`, `401`, `403 not_owner`,
  `413 total_too_large`, `415`.
- **Atomicità**: **NON atomica** tra i file, e **non** copre la scrittura
  Firestore. Il client **conserva l'attuale orchestrazione a due fasi**
  (Storage prima, poi commit Firestore transazionale): il gateway garantisce
  solo la **durabilità per-file**, non l'atomicità multi-file o cross-service.
  Su fallimento parziale il client ripulisce/ritenta come oggi.
- **Retry/Idempotenza**: sì per-path (upsert). Un retry ripete solo i path non
  riusciti.
- **Costo**: 1 invocazione + N operazioni classe A + ingress = somma dimensioni.

### 3.6 Eliminare un prefisso repository — `POST /api/repository/delete-prefix`

Per **eliminazione programma/import** (sostituisce `deleteStoragePrefix`).

- **Request**: `{ "prefix": "repository/{ownerUid}/imports/{importId}" }`
- **Response 200**: `{ "deleted": N }`.
- **Vincolo**: il prefisso **deve** stare sotto `repository/{ownerUid}/` con
  `ownerUid` = utente autenticato; qualsiasi prefisso più corto/ambiguo →
  `400 invalid_prefix`.
- **Errori**: `400 invalid_prefix`, `401`, `403 not_owner`, `500 storage_error`.
- **Atomicità**: **best-effort**, **non atomica** (elimina oggetto per oggetto).
- **Retry/Idempotenza**: sì (ri-eseguire su un prefisso già vuoto → `deleted: 0`).
- **Costo**: 1 invocazione + 1+ `list` (classe A, paginata) + N `delete`
  (classe A). Nessun egress di contenuti.

> **Principio**: **una chiamata per operazione logica**. Un import = 1
> `batch-write`; un export = 1 `batch-read`; una cancellazione programma = 1
> `delete-prefix` (più eventuali `delete-prefix` per import orfani). Mai una
> Function per singolo file quando l'operazione logica è batch.

---

## Task 4 — Sicurezza (controlli server-side obbligatori)

L'Admin SDK **bypassa le Storage Rules**: il gateway deve applicare
**autonomamente** vincoli **almeno equivalenti o più stretti** di
`storage.rules` attuale (`repository/{ownerUid}/**` leggibile/scrivibile solo
da `request.auth.uid == ownerUid`).

Controlli obbligatori per **ogni** richiesta:

1. **Verifica ID token** con Admin SDK (`verifyIdToken`); assente/scaduto/invalido → `401`.
2. **Verifica owner reale del portale**: l'uid del token deve essere il docente
   proprietario (stessa nozione di owner usata da Firestore Rules), non un
   qualsiasi utente autenticato → altrimenti `403`.
3. **Path obbligatoriamente sotto** `repository/{ownerUid}/imports/…`.
4. **`ownerUid` del path == uid autenticato** (nessun accesso ai file di un altro owner).
5. **Normalizzazione path** e **rifiuto** di: `..`, slash multiple/ambigue,
   URL (`http://`, `gs://`), path assoluti, byte NUL, encoding anomalo
   (percent-encoding, unicode di controllo). Il path si valida su una
   allowlist di caratteri e una regex esplicita del formato repository.
6. **Allowlist estensioni**: `.md` / `.pool.md`; qualsiasi altro suffisso → `415`.
7. **Limiti dimensione** (per file, per batch, totali) — vedi Task 3.
8. **Content-type**: request `application/json`; contenuti **solo UTF-8**;
   rifiuto di byte non decodificabili UTF-8.
9. **Metodi ammessi**: solo `POST` sugli endpoint definiti; qualsiasi altro
   metodo/percorso → `404`/`405`.
10. **Nessuna fiducia nei controlli frontend**: ogni vincolo è ri-verificato
    server-side, a prescindere da cosa manda il client.
11. **Log senza dati sensibili**: mai contenuti didattici, token, pool,
    soluzioni o dati personali nei log; loggare solo metadati non sensibili
    (uid troncato/hash, operazione, esito, dimensioni, durata, codice errore).
12. **Nessun endpoint student-facing**: il gateway non espone alcuna rotta a
    studenti; lo studente continua a leggere solo `publicLessons.content`.

**App Check** — valutato come **hardening futuro, non bloccante iniziale**: il
gateway può in seguito richiedere un token App Check (attestazione
dell'app/dispositivo) in aggiunta all'ID token, per ridurre abuso da client non
ufficiali. Da introdurre solo dopo che SGW è stabile su DEV, per non aggiungere
un punto di rottura durante la migrazione (in particolare su Brave). Documentato
qui come opzione, non come requisito SGW-01.

---

## Task 5 — Costi e prestazioni

- **Niente polling**: nessun endpoint interrogato ciclicamente.
- **Niente retry infiniti**: il gateway non ritenta all'infinito; il client usa
  **retry manuale** (pulsante "Riprova", pattern MOB-01B) o un retry
  **strettamente limitato** (≤ 1) sulle operazioni idempotenti.
- **Import/export in batch**: una sola invocazione per operazione logica.
- **Consultazione lezione normale resta Firestore-first** (`publicLessons.content`,
  MOB-01C): il gateway **non** viene usato per la lettura ordinaria della
  lezione, solo per editing/pool/import/export/verifica/backfill.
- **Caching solo locale/in memoria** dove già sensato (es. pool tenuto montato
  per lezione, tree caricato una volta); **nessuna** nuova cache server-side
  persistente.
- **`minInstances: 0`**, **`maxInstances: 3`**.
- **Budget alert**: impostare un **Cloud Billing budget alert** sul progetto
  (es. soglie 50%/90%/100% di un budget mensile basso) — da configurare in
  SGW-01 lato progetto, **non** in questa PR.
- **Metriche minime da osservare**: invocazioni/giorno, errori per codice
  (4xx/5xx), latenza p50/p95, cold start count, operazioni Storage classe A/B,
  egress GB, istanze attive.
- **Soglie che farebbero rivalutare l'architettura**: invocazioni molto oltre
  l'atteso per un docente singolo, egress in crescita non spiegata, p95 elevata
  cronica, o costi mensili oltre il budget alert.

**Onestà sui costi (nessuna promessa di costo zero):**

- **Quota gratuita**: le free tier di Functions 2ª gen, Storage e Firestore
  coprono verosimilmente l'uso di un docente singolo, ma **non è garantito
  costo zero**.
- **Deploy/container**: la 2ª gen usa Cloud Run/Artifact Registry — possibili
  **costi di build/storage immagine** e minimi di infrastruttura.
- **Compute**: fatturato per invocazione + tempo/CPU/memoria (mitigato da
  `minInstances: 0`).
- **Storage**: costo per GB archiviati + operazioni classe A/B.
- **Egress**: traffico in uscita dalla Function verso il browser (Markdown/pool
  sono piccoli, ma non nulli).

---

## Task 6 — Emulatori e deploy

- **Locale**: `firebase emulators:start` con **Hosting + Functions + Auth +
  Firestore + Storage**. La web app chiama `/api/repository/*` **same-origin**
  sull'Hosting emulator, che applica il rewrite verso la Functions emulator; la
  Function usa l'Admin SDK contro gli emulator Firestore/Storage. Così il flusso
  gateway è testabile **senza** toccare Storage reale.
- **Ordine delle rewrite in `firebase.json`** (applicato in SGW-01): la rotta
  specifica **prima** della SPA, in forma esplicita con `functionId` + `region`:

  ```jsonc
  "rewrites": [
    {
      "source": "/api/repository/**",
      "function": { "functionId": "repositoryGateway", "region": "us-central1" }
    },
    { "source": "**", "destination": "/index.html" }
  ]
  ```
- **Configurazione DEV**: progetto `schoolforge-dev` (già su piano **Blaze**,
  requisito della 2ª gen). Region della Function pinnata a quella del bucket.
- **Deploy**: SGW-01 fa il **primo deploy solo su DEV**
  (`firebase deploy --only functions,hosting --project dev`), seguito da smoke
  Brave.
- **Rollback**: la migrazione mantiene per una fase l'accesso Storage diretto
  come fallback dietro flag/adapter; il rollback consiste nel ripuntare
  l'adapter sul percorso diretto e/o ripristinare la rewrite SPA-only e
  ridistribuire l'Hosting. Nessuno stato dati va perso (il gateway non cambia il
  layout dei file su Storage).
- **Nessun deploy in SGW-00.**

---

## Task 7 — Roadmap implementativa

### SGW-01 — Fondamenta + operazioni singole — **codice implementato; deploy/smoke da fare**
- ✅ Cloud Function `repositoryGateway` (2ª gen) + **client adapter** (unico
  punto che parla col gateway).
- ✅ Endpoint **read / write / delete singolo** (§3.1–3.3).
- ✅ Migrazione di: **contenuto/metadata lezioni e UDA**
  (`repositoryEditorService` `fetchStorageText`/`writeStorageText`/delete) e
  **lettura/salvataggio/eliminazione pool** (`poolEditorService`
  `loadPool`/`savePool`/`deletePool`); **fallback lettura lezione**
  (`lessonContent.fetchLessonContent`).
- ✅ **Test di sicurezza** del gateway (owner, path traversal, estensioni,
  dimensioni, metodi, token) — `functions/src/repositoryGatewayCore.test.ts` +
  adapter test.
- ⏳ **Deploy DEV** + **smoke Brave** su editing/pool — **da eseguire** (vedi
  §Task 6 per i comandi; region `us-central1` già confermata).
- Copre le righe **1–7** dell'inventario.

### SGW-02 — Batch + prefissi + accessi residui
- Endpoint **batch-read / batch-write / delete-prefix** (§3.4–3.6).
- Migrazione di: **import** (`importRepository`), **export** (`exportZip`),
  **eliminazioni/prefix delete** (`programsService.deleteStoragePrefix`),
  **backfill** (`publicLessonsBackfillService`), **`loadSelectedQuestions`** e
  **`loadSelectedQuestionsWithSolutions`**, e **ogni altro accesso Storage
  residuo**.
- **Gate `rg`**: nessuna operazione Storage diretta nel frontend fuori
  dall'adapter/configurazione autorizzata
  (`rg "getBytes\(|uploadBytes\(|deleteObject\(|listAll\(" apps/web/src`
  deve restare vuoto fuori da `lib/firebase.ts` e dall'adapter).
- Copre le righe **8–13** dell'inventario.

### SGW-03 / Gate
- **Smoke completo** Brave / Safari / desktop su tutti i flussi.
- **Sicurezza** (rivalutazione, eventuale App Check), **prestazioni**, **costi**,
  **rollback** verificato.
- Aggiornamento della documentazione da **"target"** a **"implementato"** (questo
  file e i documenti collegati).

---

## Task 8 — Backlog DUX-09 (registrato, NON implementato in SGW-00)

Acceptance criteria da implementare in una PR UX separata (**DUX-09**):

**Didattica**
- Campo ricerca con **font coerente** e placeholder **`Cerca…`**.
- **"Nuovo corso"** crea un corso **realmente inizializzato** e lo **apre subito**.
- Il corso nuovo **non deve sparire** a causa del filtro anno.
- **Più spazio** ai titoli UDA/lezioni; colonne metriche **più compatte**.
- **Spunta verde** accanto al titolo principale della lezione **quando svolta**.

**Verifiche**
- Filtri anno/classe/ricerca in una **toolbar compatta uguale a Didattica**.
- Placeholder corso nella riga nuova verifica: **`Corso`**.
- Placeholder classe: **`Nessuna`**.
- Colonna **Classe** abbastanza larga da non spezzare `Nessuna`.
- Colonna **Anno** abbastanza larga da mostrare **`2025/2026`** su una riga.
- Pulsante visibile **`Crea`**, con **aria-label `Crea verifica`**.
- Il pulsante Crea **non deve allargare** la colonna Azioni.
- Sotto il titolo, su **righe separate**:
  - `Attivata: data ora`
  - `Chiusa: data ora`
- **Non renderizzare** una riga data se il valore non esiste.

---

## Decisioni ancora aperte

1. **Region**: ~~da confermare~~ **confermata `us-central1`** (location del
   bucket `schoolforge-dev`, `location_type: region`).
2. **Prefisso rotta**: `/api/repository/*` confermato; eventuale versione
   (`/api/repository/v1/*`) da decidere in SGW-01.
3. **`maxInstances`** iniziale a 3: rivedere solo con evidenza di throttling.
4. **App Check**: se/quando introdurlo (post-stabilizzazione SGW).
5. **Fallback diretto durante la migrazione**: mantenere l'accesso Storage
   diretto dietro flag per il rollback fino al Gate SGW-03, poi rimuoverlo.
