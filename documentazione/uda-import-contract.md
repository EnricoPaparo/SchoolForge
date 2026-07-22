# TWU-04A — Contratto tecnico “Importa UDA”

> Stato: **implementato in TWU-04B** (codice + test, branch `twu-04b-importa-uda`). Progettazione evidence-based: 21 luglio 2026. Restano **pendenti**: smoke DEV desktop/mobile/Brave e il **Gate GTWU** (APERTO). Questo documento non autorizza deploy, migrazioni o modifiche ai dati esistenti; nessuna conferma manuale è data qui.
>
> **Mappa implementazione → contratto** (branch `twu-04b-importa-uda`):
> - Helper puri: `apps/web/src/features/repository/importUda/{limits,readUdaZip,validateUdaArchive,buildUdaImportPayload,manifestHash}.ts` (§6, §7).
> - Service orchestratore a porte iniettate: `importUda/importUdaRepository.ts`; implementazione Firestore+SGW: `importUda/udaImportDeps.ts` (§8–§10).
> - Reader coherence: `programs/committedUdas.ts` (libreria/workspace/export ignorano lo staged senza `UdaDoc`) (§5.1).
> - Mutual exclusion editor: `importUda/udaImportLease.ts` + guardie in `editor/repositoryEditorService.ts` (create/reorder/delete UDA) (§7.3).
> - Export round-trip pool: `teacher/exportZip.ts` (§3.4).
> - UI: `teacher/workspaceDialogs.tsx` (`ImportUdaDialog`) + azione in `teacher/CourseWorkspace.tsx` (§12).
> - Test: `importUda/__tests__/*`, `programs/__tests__/committedUdas.test.ts`, `teacher/__tests__/{ImportUdaDialog,exportZip}.test.ts`, `repository/__tests__/securityReview.test.ts`.
> - **Non** modificati (come da §11): Cloud Functions, Firestore/Storage Rules, indici, dipendenze, schema verifiche/VEX/IA/appunti, import programma.

## 1. Stato e obiettivo

SchoolForge importa oggi un programma ZIP intero e consente poi di creare, modificare, riordinare ed eliminare UDA e lezioni nell'import attivo. TWU-04B aggiungerà il comando:

`Didattica → corso → Panoramica → Azioni → Importa UDA`

Lo ZIP deve aggiungere **esattamente una UDA** al corso aperto, senza sostituire il programma, cambiare `activeImportId` o duplicare le UDA già presenti. L'operazione deve riusare il modello e le primitive correnti; non introduce un secondo repository didattico.

## 2. Decisioni di prodotto congelate

- L'archivio rappresenta una e una sola UDA.
- L'UDA viene aggiunta all'import attivo del corso e accodata all'ordine corrente.
- Non sono ammessi merge, overwrite o rinomina automatica.
- Qualunque conflitto reale blocca l'operazione prima delle scritture applicative.
- La validazione locale e il preflight autorevole terminano prima della prenotazione/staging.
- La pubblicazione studente avviene in un solo commit Firestore; non esistono proiezioni pubbliche parziali.
- Pool, soluzioni, `questionIndex` e documenti tecnici restano owner-only.
- Ogni cleanup riguarda soltanto risorse dichiarate nel manifest del tentativo.
- Nessun listener, polling, scansione globale, migrazione o nuovo costo a ogni apertura del corso.
- Gli errori successivi al commit non trasformano un successo in “Importazione fallita”.

## 3. Inventario del sistema corrente

### 3.1 Importazione programma

| Superficie | Evidenza corrente | Conseguenza per TWU-04B |
|---|---|---|
| Entry point libreria | `DidatticaView.handleImport` crea il programma, legge lo ZIP e invoca `importRepository`; `busy` impedisce il doppio click. | Non riusare la creazione programma. Riutilizzare dialog/guardie e aggiornamento locale delle card. |
| Entry point corso | `CourseWorkspace.handleImportCourse`, azione “Importa ZIP”, reimporta l'intero corso; `withBusy` e `mountedRef` proteggono doppio click/unmount. | Aggiungere un'azione distinta “Importa UDA”; non cambiare il significato del reimport completo. |
| Lettura ZIP | `import/readZipFile.ts` usa JSZip, preserva l'ordine centrale, rimuove un wrapper reale e filtra `__MACOSX`, `.DS_Store` e path nascosti. | Estrarre un lettore/validatore UDA più rigoroso; non alterare il parser del programma senza necessità. |
| Validazione | `validation/validateImport.ts` raggruppa per cartella; `validateUda.ts` e `validateLesson.ts` validano UDA, lezioni e pool. | Riutilizzare i parser, ma per Importa UDA ogni errore pool/domanda deve essere bloccante. Oggi l'import programma tollera pool invalidi. |
| Payload | `import/buildImportPayload.ts` costruisce UDA, lezioni, `questionIndex` e `publicLessons`, con ID deterministici e proiezione pubblica priva di pool. | Estrarre un builder puro per una UDA nell'`activeImportId`, senza creare `ImportDoc` né cambiare programma. |
| Protocollo | `import/importRepository.ts`: upload Storage → documenti tecnici `staging` in chunk → `publicLessons` invisibili → transazione che cambia `activeImportId` → cleanup differita delle vecchie proiezioni. | Conservare i principi “validate first”, staging, commit piccolo e risultato committed; non riusare lo switch di import. |
| Chunk | `repository/firestoreChunks.ts` espone `BATCH_CHUNK_SIZE = 400` e `commitOpsInChunks`, sequenziale e atomico solo per singolo batch. | Riutilizzare il limite 400; non dichiarare atomici più chunk. |
| Esito post-commit | `CourseWorkspace` aggiorna subito la card; la rilettura metadata è best-effort. `cleanupPending` produce avviso. | Stessa semantica: commit riuscito = successo; refresh/cleanup successivi sono warning. |

L'import programma corrente carica ancora i file con `uploadBytes` diretto. Non va copiato in TWU-04B: per affidabilità Brave mobile il nuovo flusso deve usare il gateway same-origin già presente.

### 3.2 Modello repository e identità correnti

| Entità | Path/identità | Campi e relazione rilevanti |
|---|---|---|
| Programma | `programs/{programId}` | `ownerUid`, `title`, `classIds`, `activeImportId`. |
| Import | `programs/{programId}/imports/{importId}` | Stato, metadata e conteggi tecnici. L'import attivo è quello puntato dal programma. |
| UDA | `.../imports/{importId}/udas/{udaId}` | `udaId = toDocId(uda.dir)`; `dir`, `filename`, `order`, `storageBasePath`, metadata, `lessonCount`. |
| Lezione | `.../lessons/{lessonId}` | `lessonId = ${udaId}_${toDocId(nome senza .md)}`; quindi scoped dall'UDA. Contiene `udaDir`, `order`, riferimenti Storage e `publicLessonId`. |
| Indice domanda | `.../questionIndex/{entryId}` | `entryId = ${lessonId}_${toDocId(question.id)}`; contiene anteprima, tipo, difficoltà e punti, mai soluzione. |
| Proiezione studente | `publicLessons/{publicLessonId}` | `publicLessonId = ${importId}_${lessonId}`; corpo e metadata didattici, mai pool, soluzione o dettagli dell'indice. |
| Storage | `repository/{ownerUid}/imports/{importId}/{udaDir}/{file}` | Markdown UDA/lezione e pool V2 owner-only. |

`listUdas` e `listLessons` leggono le collezioni dell'import e ordinano prima per `order`, con fallback legacy dal nome e tie-break deterministico. `courseLibrary.ts` esegue già, per corso attivo, `listUdas + listLessons + getImportMeta` in parallelo: TWU-04B non aggiungerà una lettura all'apertura ordinaria.

### 3.3 Primitive editor riusabili

| Operazione | Implementazione corrente | Riuso deciso |
|---|---|---|
| Scrivere UDA/lezione | `repositoryEditorService.createUda/createLesson`; Storage via `writeText`, poi batch Firestore e audit. | Riutilizzare validatori, path, normalizzazione metadata e `writeText`; non concatenare questi service in un batch, perché produrrebbero letture, audit e stati parziali per elemento. |
| Pool | `poolEditorService.loadPool/savePool/deletePool`; serializer V2, SGW e `questionIndex` chunked. | Riutilizzare parser/serializer e builder delle entry; non chiamare `savePool` N volte. |
| Riordino | `reorderUda/reorderLesson` scambiano gli `order` espliciti. | Calcolare un solo nuovo ordine UDA e preservare gli ordini delle lezioni; nessun indice array. |
| Eliminazione | `deleteLesson/deleteUda` verificano blocchi da verifiche, eliminano file SGW e documenti tecnici/pubblici in chunk. | La UDA importata usa lo stesso schema, quindi questi service sono la base. TWU-04B deve includere i nuovi campi tecnici nel preflight/cleanup e mantenere il blocco verifiche. |
| Programma | `programsService.deleteProgram` elimina import e Storage tramite `deleteImportPrefix`. | Nessun adattamento concettuale: l'UDA è parte dell'import attivo. |

### 3.4 Export, template e contratto pool

- Il kit `templateKit.ts` usa un wrapper opzionale, cartelle `uda-NN-slug`, un file UDA, lezioni `lezione-NNN-slug.md` e pool companion `.pool.md`.
- Il contratto pool canonico è solo `schoolforge-pool/v2`: `difficolta` intera 1–5, `maxPoints === difficolta`, `maxCharacters` solo sulle aperte (default effettivo 2000, range 1–10000), nessun `peso`.
- `teacher/exportZip.ts` legge UDA/lezioni con `readTexts` e preserva l'ordine, ma **esclude oggi i pool**. Perciò l'export corrente non è un round-trip completo dei pool: TWU-04B deve estenderlo ai `poolStorageRef` validi prima di dichiarare esportabile integralmente una UDA importata.
- `programma.md` appartiene al pacchetto programma e non è ammesso nello ZIP UDA.

### 3.5 Storage Gateway reale

Il codice implementato comprende:

- client same-origin `gateway/repositoryGatewayClient.ts`: `readText`, `readTexts`, `writeText`, `deleteFile`, `deleteImportPrefix`, timeout 30 s, nessun retry implicito o fallback diretto;
- Function HTTPS v2 `repositoryGateway`, autenticazione ID token + owner reale, Admin SDK, log senza contenuti;
- route singolo file e batch-read; **non** esiste batch-write né delete-prefix limitato a una UDA;
- massimo 700.000 byte UTF-8 per file, batch-read massimo 300 file e 20 MB, concorrenza server 8;
- allowlist path ASCII e sole estensioni `.md`/`.pool.md`;
- rewrite Hosting `/api/repository/**`.

`architettura.md` registra SGW-01 come deployato e verificato su Brave mobile per operazioni singolo file; batch/prefix completi erano demandati a SGW-02. Le API effettivamente presenti sono l'autorità: TWU-04B userà `writeText`/`deleteFile` con concorrenza client limitata, senza inventare un endpoint ZIP. Lo smoke Brave del nuovo flusso resta obbligatorio perché l'upload multi-file UDA non è ancora provato dal repository.

### 3.6 Sicurezza corrente

- `firestore.rules`: programma e tutte le sottocollezioni tecniche sono owner-only; `publicLessons` è scrivibile dall'owner e leggibile dallo studente soltanto con classe/portale/modalità verifica validi e `importId == program.activeImportId`.
- `storage.rules`: repository owner-only; studenti e anonimi non leggono Markdown o pool.
- SGW usa Admin SDK e quindi replica esplicitamente owner, path, estensione, UTF-8 e limiti.
- Le proiezioni pubbliche sono costruite da `buildImportPayload`/editor e non contengono pool, domande o soluzioni.
- Gli audit esistenti sono owner action metadata; non devono contenere contenuti didattici.

## 4. Alternative valutate

| Criterio | A. Append diretto all'import attivo | B. Nuova revisione completa | C. Entità separata import UDA |
|---|---|---|---|
| Modello import-scoped | Nativo: usa lo stesso `importId`. | Nativo, ma cambia `activeImportId`. | Richiede overlay fra import programma e import UDA. |
| Letture/scritture | Solo nuova UDA e preflight puntuale. | Copia o riscrive tutte le UDA esistenti. | Ogni lettore deve interrogare/unire più sorgenti. |
| Duplicazione | Nessuna del corso. | Alta. | Nessuna copia iniziale, ma duplica il modello. |
| Atomicità studente | Ottenibile pubblicando UDA + `publicLessons` in una transazione finale limitata. | Ottenibile con lo switch esistente. | Richiede un nuovo meccanismo di composizione/versione. |
| Cleanup | Manifest limitato al tentativo. | Cleanup di un intero import. | Cleanup semplice per entità, ma riferimenti incrociati complessi. |
| Editor/export/delete | Schema corrente invariato. | Funzionano, a costo della copia totale. | Tutti devono diventare multi-sorgente. |
| Rischi | Staging orfano circoscritto, gestibile. | Corsi fantasma, costi e dati duplicati. | Dati appesi e divergenza fra sorgenti. |
| Rules/indici/Function | Nessuna modifica necessaria. | Nessuna nuova Rule, ma molto traffico. | Probabili nuove Rules/query e forse indici. |
| Brave mobile | SGW singolo-file esistente. | Molti più upload. | Nuovo flusso/gateway probabile. |
| Reversibilità | Cleanup del solo manifest. | Rollback via vecchio import, ma grandi residui. | Difficile dopo che i lettori dipendono dall'overlay. |

## 5. Architettura scelta

**Scelta definitiva: A — append diretto nell'`activeImportId`, con staging owner-only, lease dell'import e commit marker costituito dal documento UDA.**

Motivi:

1. non riscrive né duplica il corso;
2. conserva path, editor, cancellazione ed export import-scoped;
3. limita upload e mutazioni ai soli nuovi file/documenti;
4. rende invisibili agli studenti tutti i dati fino al commit;
5. non richiede nuove Rules, indici o Cloud Function;
6. usa SGW same-origin, adatto a Brave mobile;
7. consente cleanup deterministica del tentativo.

### 5.1 Staging tecnico e commit marker

TWU-04B introdurrà un record owner-only effimero:

`programs/{programId}/imports/{activeImportId}/udaImportAttempts/{requestId}`

Contiene soltanto stato operativo, `requestId`, `manifestHash`, `udaId`, ID/path creati, ordine riservato, lease/scadenza e timestamp; non duplica i testi. Il documento Import attivo contiene una lease singola `udaAppendLease` per impedire due append concorrenti. Gli altri mutatori strutturali UDA (crea/elimina/riordina) devono rifiutare l'operazione mentre la lease è valida; ciò aggiunge una lettura solo quando si tenta una mutazione, non all'apertura del corso.

Le lezioni e il `questionIndex` possono essere scritti in chunk prima del commit, ma restano **staged logicamente** perché il relativo `UdaDoc` non esiste ancora. I reader modificati in TWU-04B devono considerare committati soltanto lesson/index il cui `udaId/udaDir` appartiene a una UDA esistente nell'import:

- libreria/workspace/export riusano il set UDA già letto insieme alle lezioni, senza query aggiuntiva all'apertura;
- question picker riceve il set UDA già caricato dal workspace; se invocato isolatamente esegue una sola query UDA puntuale al caricamento del picker, mai una scansione globale;
- documenti orfani senza UDA root sono sempre ignorati.

Il commit finale crea in **una transazione**: `UdaDoc`, tutte le `publicLessons`, aggiornamento metadata Import/Program, audit e rimozione della lease/tentativo. Il limite massimo di 40 lezioni rende questa transazione ampiamente inferiore a 400 mutazioni; il limite cumulativo dei contenuti protegge anche il tetto dimensionale Firestore.

## 6. Contratto ZIP

### 6.1 Limiti vincolanti

| Voce | Limite TWU-04B |
|---|---:|
| Estensione | `.zip` (case-insensitive), con firma ZIP valida; MIME browser non autorevole |
| ZIP compresso | 10 MB |
| Contenuto UTF-8 decompresso totale | 8.000.000 byte |
| Singolo file | 700.000 byte UTF-8 |
| UDA | esattamente 1 |
| Lezioni | 1–40 |
| Pool | 0–40, massimo uno companion per lezione |
| Domande per pool | 100 |
| Domande totali | 500 |
| File logici | massimo 81 (`1 + 40 + 40`) |
| Profondità | 2 segmenti logici; massimo 3 prima della rimozione dell'unico wrapper |

Questi limiti non derivano da una tariffa: garantiscono uso browser ragionevole, file compatibili con SGW/`publicLessons`, una pubblicazione finale sotto 400 mutazioni e un caso grande che esercita più di un chunk tecnico (`40 + 500 > 400`).

### 6.2 Struttura e file

Dopo la rimozione facoltativa di **un solo wrapper comune**, la radice logica deve contenere una sola cartella UDA:

- cartella: `uda-NN-slug`;
- file UDA obbligatorio omonimo: `uda-NN-slug.md`;
- lezioni: `lezione-NNN-slug.md`;
- pool opzionale companion: stesso basename + `.pool.md`;
- nessun file alla root (`programma.md` incluso);
- nessuna sottocartella dentro l'UDA.

I segmenti path devono essere ASCII minuscoli, numeri e trattini, secondo:

- UDA: `^uda-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$`;
- lezione: `^lezione-\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$`.

I contenuti sono UTF-8; Unicode è pienamente ammesso nei titoli, metadata e Markdown. BOM UTF-8 iniziale può essere rimosso. Surrogati invalidi, encoding diverso da UTF-8 ed entry cifrate sono bloccanti.

Sono ignorati prima del conteggio soltanto `__MACOSX/**`, `.DS_Store` e directory entry vuote. Altri file nascosti, file non riconosciuti, archivi annidati, eseguibili e metadata inattesi sono bloccanti. Symlink/link rilevati dai flag ZIP sono rifiutati. Ogni path viene normalizzato con `/`; path assoluti, backslash, drive letter, NUL, percent-encoding, segmenti vuoti, `.`/`..` o traversal sono rifiutati prima dell'estrazione. Non si estrae mai lo ZIP sul filesystem.

### 6.3 Metadata

Il file UDA riusa il front matter corrente:

- obbligatori: `titolo` stringa non vuota, `competenze` e `obiettivi` liste non vuote di stringhe non vuote;
- opzionale: `descrizione` stringa; in assenza resta valido il fallback dal primo paragrafo del body;
- body Markdown ammesso.

La lezione riusa il front matter opzionale corrente (`titolo`, `sottotitolo`, `difficolta` didattica testuale, `concetti_chiave`, `obiettivi`). Se il blocco YAML è presente deve essere sintatticamente valido e i campi noti devono avere il tipo atteso: per questo nuovo import non è ammesso degradare silenziosamente YAML malformato a metadata vuoti.

Ogni pool presente deve essere valido `schoolforge-pool/v2`. Pool V1, `peso`, difficoltà fuori 1–5, `maxPoints` scritto, `maxCharacters` invalido/su chiusa o qualunque errore domanda bloccano l'intero import. Una lezione senza pool è valida. Un pool senza lezione companion è bloccante. UDA senza lezioni è bloccante.

### 6.4 Alberi validi

Minimo:

```text
reti.zip
└── uda-03-reti/
    ├── uda-03-reti.md
    └── lezione-001-client-server.md
```

Con wrapper, più lezioni e pool:

```text
pacchetto-reti.zip
└── pacchetto-reti/
    └── uda-03-reti/
        ├── uda-03-reti.md
        ├── lezione-001-client-server.md
        ├── lezione-001-client-server.pool.md
        ├── lezione-002-http.md
        ├── lezione-002-http.pool.md
        └── lezione-003-ripasso.md
```

Errori bloccanti sintetici: due cartelle `uda-*`; `programma.md`; `../../x.md`; duplicato case-insensitive; `lezione-001-x.pool.md` senza lezione; pool V1; `peso`; YAML invalido; file >700.000 byte; archivio oltre i limiti.

## 7. Identità, conflitti e ordine

### 7.1 Derivazione ID

- `udaId = toDocId(udaDir)`; con la nuova allowlist ASCII il risultato è uguale al nome cartella.
- `lessonId = ${udaId}_${toDocId(lesson basename)}`.
- `questionIndexId = ${lessonId}_${toDocId(question.id)}`.
- `publicLessonId = newPublicLessonId(activeImportId, lessonId)`.
- Storage resta sotto `repository/{ownerUid}/imports/{activeImportId}/{udaDir}/...`.

UDA, lesson e question ID sono scoped dall'import e, per i discendenti, dall'UDA; `publicLessonId` include anche l'import. Gli ID domanda duplicati nello stesso pool sono già invalidi nel contratto V2. Collisioni da normalizzazione vengono rilevate localmente sull'intero manifest.

### 7.2 Preflight collisioni

Prima di qualsiasi write:

1. leggere puntualmente Program e Import attivo, verificando owner e `activeImportId` invariato;
2. leggere le UDA correnti per calcolare `max(order)` e rilevare `udaId/dir` già esistente;
3. verificare tutti gli ID target UDA/lesson/questionIndex/publicLesson con letture puntuali e bounded, così anche orfani preesistenti bloccano;
4. usare `readTexts` sui path Storage target: ogni file già esistente è conflitto; `file_not_found` è l'unico esito libero;
5. verificare assenza di lease incompatibile e attempt attivo;
6. confrontare manifest hash e duplicati locali prima della prenotazione.

Esito per ogni conflitto: blocco, zero write, zero upload, nessuna sovrascrittura/merge/rinomina. Lo stesso `requestId + manifestHash` può riprendere il proprio tentativo; stesso requestId con hash diverso è `invalid_request`.

### 7.3 Ordine

- `newUdaOrder = max(order effettivo delle UDA correnti) + 1`; con insieme vuoto vale 0.
- Ordini non contigui non vengono compattati.
- Le lezioni ricevono `order` 0…N−1 secondo l'ordine centrale ZIP validato, non secondo completamento async né indice numerico del nome.
- Nomi lezione duplicati o numeri duplicati sono bloccanti anche se gli slug differiscono, per evitare ordine ambiguo.
- La lease dell'import congela l'append; una modifica concorrente rilevata al commit invalida il tentativo e avvia cleanup pre-commit.

## 8. Protocollo e state machine

```text
idle
  → local_validating
  → ready
  → authoritative_preflight
  → reserved
  → storage_uploading
  → firestore_staging
  → committing
  → committed
  → refreshing
  → success | success_with_warning

Ogni errore prima di committed:
  → cleanup_required → cleaning → not_applied | cleanup_pending
```

Sequenza vincolante:

1. **Selezione**: acquisire il `File`; nessuna rete.
2. **Validazione locale**: firma/limiti/path/UTF-8/struttura/YAML/pool V2; nessuna write.
3. **Payload puro**: ID, manifest ordinato, hash, conteggi, proiezioni; nessuna write.
4. **Preflight autorevole**: owner, Program/Import, collisioni Firestore/Storage, ordine e lease; nessuna write.
5. **Prenotazione**: transazione che rilegge Program, Import, UDA target e attempt; crea attempt e lease con scadenza. Primo punto di scrittura.
6. **Upload Storage**: `writeText` sui path finali esclusivi, concorrenza massima 3; ogni successo viene già descritto dal manifest attempt.
7. **Staging Firestore**: lesson e questionIndex finali in chunk sequenziali da 400. Nessun UdaDoc, nessuna publicLesson.
8. **Commit**: transazione finale che verifica lease/request/hash, `activeImportId`, collisioni e fingerprint ordine; crea UdaDoc + tutte le publicLessons, aggiorna Import/Program, scrive audit, rimuove lease/attempt.
9. **UI**: patch locale atomica di sidebar, panoramica e conteggi; nessuna rilettura obbligatoria.
10. **Riallineamento**: un eventuale refresh mirato fallito produce successo con warning; il caricamento successivo usa i dati committati.

Il punto di commit è il successo della transazione al punto 8. Firestore e Storage non possono partecipare alla stessa transazione: prima del commit i file e documenti staged sono owner-only e non raggiungibili dai normali reader; dopo il commit non vengono rimossi in caso di errore UI.

## 9. Atomicità e idempotenza

- `requestId` UUID è creato una volta all'apertura dell'operazione e mantenuto nei retry.
- `manifestHash` copre active import, UDA/lesson/pool path normalizzati, ordine e hash dei contenuti; non contiene dati nei log.
- Doppio click: guardia UI sincrona + lease Firestore.
- Vecchi callback/unmount: `AbortController` per richieste in corso dove supportato e token di esecuzione confrontato prima di aggiornare stato; non si tenta di annullare un commit già iniziato.
- Retry dello stesso request/hash riprende dallo stato noto o restituisce `committed` leggendo `sourceRequestId/manifestHash` nel nuovo UdaDoc.
- Request uguale con manifest diverso e request diversa sullo stesso UDA sono conflitti.
- La lease ha scadenza, ma un takeover non cancella automaticamente: prima ricostruisce il manifest, verifica che l'UDA non sia committed e completa la cleanup del tentativo precedente.
- Nessun retry automatico di un errore non classificato; retry di rete SGW limitato a un solo tentativo esplicito per file già idempotente, con stessa identità.

Crash:

| Punto | Stato osservabile | Recupero |
|---|---|---|
| Prima prenotazione | Nessuna risorsa | Nuovo tentativo sicuro. |
| Dopo lease, prima upload | Solo attempt/lease | Cleanup o ripresa. |
| Durante upload | File esatti del manifest | Delete idempotente dei soli file riusciti. |
| Fra chunk tecnici | Lesson/QI senza UdaDoc, quindi non committati | Delete dei ref deterministici + file. |
| Durante commit | Transazione intera riuscita o fallita | Se fallita cleanup pre-commit; se riuscita committed. |
| Dopo commit, prima refresh | UDA completa e pubblica | Mostrare successo al retry/reload; niente cleanup. |
| Refresh fallito | Dati committed | `success_with_warning`; riallineamento al prossimo caricamento. |

## 10. Cleanup e retry

Il manifest del tentativo elenca esclusivamente:

- lease/attempt;
- path Storage UDA, lezioni e pool del pacchetto;
- lesson ID e questionIndex ID staged;
- nessuna UDA/publicLesson prima del commit.

Cleanup pre-commit, idempotente:

1. verificare request/hash e assenza di UdaDoc committed;
2. eliminare in chunk da 400 solo lesson/QI elencati;
3. eliminare con `deleteFile`, concorrenza massima 3, solo i path elencati;
4. rimuovere attempt/lease in transazione se appartengono ancora all'esecuzione;
5. se incompleta, mantenere `cleanup_pending` e offrire “Riprova pulizia”.

Non usa `deleteImportPrefix`, perché cancellerebbe anche dati preesistenti. Non tocca altre UDA/publicLessons, verifiche, submission, correzioni, appunti studente o Storage esterno al manifest. Dopo il commit non esiste rollback automatico: il docente usa la normale eliminazione UDA, soggetta ai blocchi da verifiche.

Comportamenti futuri:

- **elimina lezione/UDA**: i service correnti sono riusabili; TWU-04B deve testarli sulla nuova provenienza e rimuovere anche eventuali metadata `sourceRequestId`;
- **elimina programma**: `deleteProgram` copre l'intero import e il relativo prefisso Storage;
- **export**: deve includere pool validi per un round-trip completo;
- **reimport programma completo**: crea un nuovo import come oggi; l'UDA aggiunta compare solo se inclusa nell'export ZIP reimportato;
- verifiche già create non vengono mutate né cancellate.

Limite residuo onesto: più batch Firestore non sono atomici. La sicurezza deriva dall'assenza del documento UDA-commit marker e dalla cleanup manifest-based, non da un rollback globale. Un numero eccezionale di risorse oltre i limiti contrattuali è rifiutato.

## 11. Proiezioni studente e sicurezza

Prima del commit non esiste alcuna `publicLesson` della nuova UDA e nessun UdaDoc committato. La transazione finale pubblica simultaneamente tutte le proiezioni. Le Rules esistenti richiedono comunque:

- utente autenticato e approvato;
- classe associata al programma;
- portale e modalità verifica compatibili;
- `publicLesson.importId == program.activeImportId`.

La nuova UDA usa l'import già attivo, ma diventa scopribile soltanto quando la transazione crea UdaDoc e publicLessons. I reader studente continuano a interrogare esclusivamente `programs`/`publicLessons`; nessun pool, soluzione, `questionIndex`, path Storage tecnico o attempt viene proiettato.

Impatto TWU-04B deciso:

| Superficie | Necessità |
|---|---|
| Firestore Rules | **Nessuna modifica**: le sottocollezioni import sono già owner-only e publicLessons conserva il contratto. |
| Storage Rules | **Nessuna modifica**: SGW owner-only usa Admin SDK con controlli più stretti. |
| Cloud Function | **Nessuna nuova Function**: riuso di `repositoryGateway`. |
| Function esistente | Nessuna modifica necessaria al contratto; si usano write/delete/read già disponibili. |
| Indice | **Nessun nuovo indice**: letture puntuali e query esistenti per import/UDA. |

Se l'implementazione dimostrasse necessaria una Rule, un indice o un endpoint batch-write, TWU-04B deve fermarsi e separarli in un pacchetto motivato: non è autorizzato implicitamente da questo contratto.

## 12. UX desktop/mobile

Punto di ingresso unico nelle azioni del corso, solo con corso/import attivo. Dialog responsive:

- titolo `Importa UDA`;
- testo: `Aggiungi al corso una sola UDA da un file ZIP. I contenuti esistenti non verranno modificati.`;
- file picker `.zip`;
- stato validazione accessibile (`role="status"`, `aria-live="polite"`);
- riepilogo titolo, ID, lezioni, pool e domande;
- warning non bloccanti separati dagli errori;
- pulsanti `Annulla` e `Importa UDA`, ben spaziati;
- durante import: `Importazione UDA in corso…` e azioni incompatibili disabilitate;
- nessuna percentuale simulata; si può mostrare soltanto la fase reale;
- su errore pre-commit il dialog conserva file/riepilogo quando sicuro;
- successo chiude il dialog e patcha stato locale senza reload;
- doppio click produce una sola prenotazione;
- unmount non genera setState tardivi, ma non interrompe cleanup/commit già avviati.

Su mobile il dialog occupa la larghezza disponibile, mantiene footer raggiungibile e non produce overflow orizzontale. Il flusso SGW same-origin va provato su Brave mobile nello smoke TWU-04B.

## 13. Letture, scritture e costi

Assunzioni: `U` = UDA già presenti; `L` lezioni; `P` pool; `Q` domande. Il preflight fail-closed legge tutti i target tecnici/pubblici, oltre a Program/Import/attempt e lista UDA. Le cifre sono conteggi operativi prudenziali, non tariffe.

| Scenario | Parametri | Letture Firestore preflight/reservation | Scritture Firestore riuscite | Upload SGW/Storage | Chunk tecnici | Riletture post-commit |
|---|---:|---:|---:|---:|---:|---:|
| Piccola | L=3, P=3, Q=10 | circa `U + 24` | circa 23 | 7 | 1 | 0 obbligatorie |
| Media | L=10, P=10, Q=100 | circa `U + 128` | circa 127 | 21 | 1 | 0 obbligatorie |
| Grande ammessa | L=40, P=40, Q=500 | circa `U + 588` | circa 587 | 81 | 2 | 0 obbligatorie |

La stima scritture include lesson/QI, lease+attempt, UDA, publicLessons, aggiornamento Import/Program, audit e rimozione attempt; un'implementazione può ridurre metadata write ma non deve nascondere quelle effettive. Ogni upload `writeText` è una chiamata gateway; il preflight Storage usa un solo batch-read entro 81 file. La transazione di pubblicazione è una ulteriore operazione Firestore, non un nuovo endpoint.

Cleanup pre-commit può eliminare fino a `L + Q` documenti e `1 + L + P` file, più lease/attempt; cancella soltanto ciò che era stato creato. Se nulla è stato scritto, costo cleanup zero.

Costo sistematico successivo:

- nessuna query nuova a ogni apertura del corso; si riusano UDA/lesson/import già caricati;
- nessun listener o polling;
- studenti eseguono le stesse query e leggono semplicemente `L` publicLessons in più quando consultano il corso;
- corsi che non usano Importa UDA non sostengono alcun costo;
- nessuna lettura docente dei pool salvo apertura/editor/export/verifica, come oggi.

## 14. Errori e copy

| Caso | Copy definitivo |
|---|---|
| ZIP non valido | `Il file non è uno ZIP UDA valido. Controlla struttura, nomi e contenuti.` |
| Più UDA | `Lo ZIP deve contenere esattamente una UDA. Sono state trovate più cartelle UDA.` |
| Nessuna UDA/lezione | `Lo ZIP deve contenere una UDA con almeno una lezione.` |
| Conflitto ID/path | `Esiste già un contenuto con ID o percorso “{id}”. L’import non ha modificato il corso.` |
| Pool invalido | `Il pool “{file}” non rispetta schoolforge-pool/v2: {errore}.` |
| In corso | `Importazione UDA in corso… Non chiudere questa finestra.` |
| Completato | `UDA importata. Sidebar, panoramica e conteggi sono stati aggiornati.` |
| Cleanup pending | `Import non applicato. Alcuni dati tecnici del tentativo devono ancora essere rimossi. Riprova la pulizia.` |
| Errore pre-commit | `Import non applicato: il corso esistente è rimasto invariato.` |
| Refresh post-commit | `UDA importata. La vista non si è aggiornata completamente; verrà riallineata al prossimo caricamento.` |

I dettagli tecnici restano nei codici diagnostici, non nel messaggio utente. Nessun path completo, stack, token, UID o contenuto viene loggato.

## 15. Test strategy

### Unitari

- ZIP valido minimo/multiplo, wrapper unico, ordine centrale;
- esattamente una UDA; UDA vuota e lezione senza pool;
- limiti compressi/decompressi/file/lezioni/pool/domande;
- ZIP slip, path assoluti/backslash, symlink, duplicati e case collision;
- UTF-8/Unicode contenuto e path ASCII;
- pool V2 valido; V1/`peso`/YAML/Markdown/pool malformati bloccanti;
- ID, manifest hash, payload pubblico privo di pool/soluzioni;
- append dopo `max(order)`, gap conservati, ordine lezioni stabile;
- collisioni UDA/lesson/QI/publicLesson/Storage;
- idempotenza request/hash e lease/takeover;
- cleanup manifesta soltanto risorse del tentativo.

### Service/integration

- import piccolo e import oltre un chunk;
- nessuna write prima di validazione+preflight;
- errore Storage iniziale/intermedio/finale;
- errore primo/intermedio/ultimo chunk;
- crash prima/dopo prenotazione, upload, chunk e commit;
- transazione commit atomica per UDA + tutte le publicLessons;
- owner reader ignora lesson/QI senza UdaDoc;
- cleanupPending e retry idempotente;
- refresh post-commit fallito restituisce successo con warning;
- dati preesistenti, verifiche, note e altre publicLessons invariati;
- export include UDA, lezioni e pool importati;
- deleteLesson/deleteUda/deleteProgram coprono le risorse importate.

### UI

- entry point solo nel corso attivo;
- selezione/validazione/riepilogo/errori;
- conferma/annulla, doppio click, unmount;
- fasi reali senza percentuale falsa;
- successo aggiorna sidebar/card/conteggi senza reload;
- errore mantiene dialog; warning post-commit non appare come fallimento;
- responsive desktop/mobile e focus/accessibilità.

Rules Emulator è necessario solo se l'implementazione cambia Rules, cosa non prevista. I test di sicurezza esistenti devono comunque restare verdi. Smoke DEV: import UDA reale, vista docente, vista studente autorizzato, assenza pool/soluzioni, export completo, modifica/eliminazione, collisione e Brave mobile.

## 16. Roadmap TWU-04B

Ordine implementativo vincolante:

1. **Helper puri**: limiti, normalizzazione ZIP, manifest/hash, validatore UDA completo, ID/collision map, payload e cost model.
2. **Service** `importUdaRepository.ts`: preflight, lease/attempt, SGW bounded, chunk staging, commit, cleanup/recovery; porte iniettate per test.
3. **Reader coherence**: helper “committed UDA set” per tree, libreria, question picker ed export, senza query a ogni apertura.
4. **Mutual exclusion**: create/delete/reorder UDA verificano la lease soltanto durante mutazioni; full reimport è protetto dal controllo finale di `activeImportId`.
5. **Export**: includere pool validi nel ZIP programma e testare round-trip.
6. **UI**: dialog minimale e azione in `CourseWorkspace`, guardie `withBusy`/`mountedRef`, patch locale card/tree.
7. **Test**: unit/service/UI e regressioni import programma/editor/export/student projection.
8. **Rollout**: merge con CI verde → deploy DEV web/Function SGW solo se realmente modificata → smoke owner/student/Brave → gate docente.

File probabili da creare:

- `repository/importUda/readUdaZip.ts`;
- `repository/importUda/validateUdaArchive.ts`;
- `repository/importUda/buildUdaImportPayload.ts`;
- `repository/importUda/importUdaRepository.ts`;
- relativi test.

File probabili da modificare:

- `CourseWorkspace.tsx` e dialog/CSS/test;
- `courseLibrary.ts`, `programsService.ts`, `questionIndexService.ts` per ignorare staging senza nuove letture ordinarie;
- `repositoryEditorService.ts` per lease nelle mutazioni strutturali;
- `exportZip.ts` per i pool;
- tipi Firestore/import locali.

Non sono previsti nuovi gateway, Function, Rules o indici. Rollback prima del commit = cleanup manifest; dopo il commit = normale eliminazione UDA, mai cancellazione automatica. Rollback del software = ripristino commit precedente; i dati committati restano nel formato canonico e continuano a essere leggibili dall'editor corrente.

## 17. Acceptance criteria

TWU-04B è accettabile soltanto se:

- importa una sola UDA valida nell'import attivo senza cambiare `activeImportId`;
- blocca ogni legacy, conflitto o path ambiguo prima delle write;
- preserva dati e ordine esistenti e accoda la nuova UDA;
- usa SGW same-origin, chunk 400 e concorrenza limitata;
- non espone stati parziali allo studente né pool/soluzioni;
- commit e replay sono idempotenti;
- errori pre-commit lasciano il corso invariato e cleanup limitata al manifest;
- errori post-commit sono successi con warning;
- UI si aggiorna senza reload/listener/polling;
- export round-trip include i pool;
- modifica, cancellazione e reimport successivi funzionano;
- Rules/indici restano invariati o un eventuale bisogno viene separato e approvato;
- smoke DEV, inclusa Brave mobile, è confermata dal docente.

## 18. Rischi residui

- Firestore e Storage non offrono transazione comune: il protocollo usa invisibilità logica + cleanup, non rollback distribuito.
- I chunk tecnici possono lasciare orfani owner-only dopo crash; il manifest/lease deve essere recuperabile e non va eliminato finché la cleanup non termina.
- Un secondo tab docente è un rischio reale: lease server-side e reader che ignorano discendenti senza UdaDoc sono obbligatori; la sola guardia UI non basta.
- `writeText` genera una chiamata Function per file; entro 81 file è accettato, ma va misurato su Brave mobile. Nessun batch-write viene anticipato.
- L'export corrente omette i pool: il fix round-trip è parte necessaria di TWU-04B, non un optional.
- La documentazione SGW contiene sezioni storiche stale (“target non implementato”); l'audit usa codice, rewrite e stato più recente di `architettura.md`, senza modificarle in questa PR.
- La compatibilità pratica di ZIP creati da strumenti diversi (flag symlink/encoding nome entry) va coperta con fixture reali in TWU-04B, senza allentare traversal e allowlist.

## 19. Fuori scope

- import programma completo e relativo switch;
- merge/rinomina/overwrite di UDA;
- migrazioni e cleanup globale di orfani storici;
- editor di un nuovo formato UDA;
- VEX, IA, verifiche, submission, correzioni e appunti;
- realtime, polling, scheduler o progress percentuale simulata;
- nuovo endpoint ZIP/batch-write, nuove Function, Rules o indici;
- deploy DEV/PROD e qualunque modifica dati in TWU-04A.
