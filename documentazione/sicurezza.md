# SchoolForge — Sicurezza e protezione dei dati

**Versione:** 3.0
**Stato:** requisiti da implementare nei pacchetti F-04 e successivi

---

## 1. Obiettivo

Proteggere Markdown, asset, dati di correzione, audit e segreti, e garantire che uno studente autenticato non sia mai trattato come docente. Da **M3-lite**, sia il Docente sia lo Studente si autenticano con Firebase Authentication (rispettivamente un provider dedicato e Google, personale o Workspace for Education); il ruolo è risolto confrontando `uid` con `ownerUid`. Il Portale studente è a sola lettura: non introduce Cloud Functions, non richiede dati autodichiarati e non certifica altro oltre all'identità Google già verificata da Firebase.

**Un utente Google non-owner non è automaticamente uno studente autorizzato.** L'autenticazione Google identifica solo un *richiedente/studente potenziale*: distingue "questo utente è il docente proprietario" da "questo utente è qualcun altro", ma non basta da sola a concedere lettura di contenuti. Uno studente diventa uno studente autorizzato solo quando il docente lo approva esplicitamente in `students/{uid}` (`status: "approved"`) e il portale studente è globalmente attivo (`settings/studentAccess.studentPortalEnabled == true`). Uno studente `pending` (in attesa di approvazione) o `blocked` (bloccato dal docente) non legge alcun contenuto, esattamente come un utente non autenticato. Questo modello — introdotto in M3L-A2, dopo la prima versione di M3L-A che trattava "autenticato Google" come sufficiente — è descritto in dettaglio in §3.1.

Il modello precedente (studente non autenticato, nome+cognome autodichiarati, lock di partecipazione, audit nome+IP) resta descritto in questo documento solo come specifica di un eventuale **M3-full** (§4, §9), non ancora pianificato in dettaglio e non applicabile a M3-lite.

---

## 2. Confini e minacce principali

| Asset | Minaccia | Controllo richiesto |
|---|---|---|
| Sezione docente | Accesso di soggetto non owner | Firebase Auth + `ownerUid` nelle Security Rules. |
| Firestore/Storage | Lettura o scrittura diretta non autorizzata | Security Rules default-deny; percorsi sensibili protetti per ruolo. |
| Portale studente (M3-lite) | Uno studente autenticato ottiene privilegi da docente, o legge dati tecnici del docente | Security Rules che negano sempre allo studente `lessons`, `questionIndex`, `publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents`, `settings/owner`; lo studente legge solo proiezioni pubbliche dedicate (`publicLessons`, `publishedProjection` quando `attiva`+`public`). |
| Portale studente (M3-lite) | Accesso anonimo o non Google | Nessuna sezione applicativa è raggiungibile senza login Firebase Authentication; solo il provider Google è abilitato per lo studente. |
| Portale studente (M3-lite) | Un utente Google non-owner legge contenuti senza essere stato approvato dal docente, o mentre il portale è disattivato | Security Rules che concedono ogni lettura studente (`publicLessons`, `publishedProjection`, file lezione in Storage) solo se `settings/studentAccess.studentPortalEnabled == true` **e** `students/{uid}.status == "approved"`; l'assenza di `settings/studentAccess` o di `students/{uid}` nega di default, così come `status` `pending`/`blocked`. |
| Portale studente — Lezioni (M3L-C) | Uno studente approvato legge le lezioni di una classe diversa dalla propria, su Firestore o su Storage | Security Rules (`isClassmateOf()`) e query client filtrano `programs`/`publicLessons` sul `classId` dello studente; un programma senza `classIds`, o con `classIds` non compatibile con lo studente, non è mai leggibile, indipendentemente dall'approvazione. Lo stesso controllo è applicato indipendentemente alle Storage Rules (`isClassmateOfProgram()`), tramite `customMetadata.programId` scritto da `importRepository` all'upload e la lettura live di `programs/{programId}.classIds`: un file lezione senza questo metadata (upload precedenti a questa milestone) non è leggibile da nessuno studente finché il programma non viene reimportato. |
| Portale studente — Verifiche (M3L-D) | Uno studente approvato legge una verifica non ancora pubblicata, già chiusa, di un'altra classe, o mai assegnata a una classe | Lettura di `publishedProjection` concessa solo quando `visibility == "public"` (che vale solo mentre il padre è `active` — la proiezione stessa viene forzata a `"hidden"` alla chiusura) **e** il proprio `classId` è incluso nel `classId` della proiezione (`isClassmateOf()`); una verifica con `classId` assente o `null` non è mai visibile, anche se altrimenti pubblica. Il documento padre `verifications/{id}` (che contiene `config.questionRefs`/`teacherSnapshot`) non è mai letto dallo studente. |
| Import didattico | Pubblicazione parziale tra Storage e Firestore | Upload sotto `importId` isolato, poi commit transazionale del solo `activeImportId`, che aggiorna insieme documento tecnico e proiezione pubblica. |
| Verifica attiva | Modifica retroattiva di fonti/regole | Snapshot pubblicato immutabile all'attivazione; per modificare si duplica la bozza. |
| Markdown | XSS o asset non sicuri | Parser condiviso, sanitizzazione e whitelist rendering, applicati identicamente a docente e studente. |
| AI (V2) | Dati non autorizzati o prompt injection | C-02 risolta, contesto chiuso, nessun web/tool, feature flag, audit. |
| Segreti AI (V2) | Esposizione in Git/client/log | Secret Manager (solo M5/V2), accesso minimo, rotazione. |

Le minacce seguenti restano specifica di un eventuale **M3-full** (consegna online) e non si applicano a M3-lite, che non ha link pubblici né tentativi:

| Asset | Minaccia | Controllo richiesto (specifica rinviata) |
|---|---|---|
| Verifica pubblica | Enumerazione o accesso a soluzioni | Token casuale non enumerabile; lookup `get` su hash del token, mai `list`; proiezione pubblica senza soluzioni; rate limit. |
| Tentativo digitale | Forgery o riuso del token sessione | Gateway server-side; cookie Secure/HttpOnly/SameSite verificato a ogni lettura, bozza e consegna. |
| Tentativo digitale | Doppio avvio della stessa persona dichiarata | Participant lock per verifica e nome+cognome normalizzati, creato dalla Cloud Function in transazione. |
| Accountability accessi | Abuso del link, accessi non riconosciuti | Log nome dichiarato + IP + user-agent + timestamp; Report Accessi consultabile dal docente. |

---

## 3. Security Rules — principi

Le Security Rules Firestore e Storage sono il perimetro di sicurezza principale, per il docente come per lo studente autenticato.

**Regole obbligatorie:**

- Default-deny: qualsiasi percorso non esplicitamente aperto è negato.
- `ownerUid` è verificato come `request.auth.uid == resource.data.ownerUid` o confrontato con `settings/owner.ownerUid`; lo stesso confronto distingue un utente Google autenticato "studente" (`uid != ownerUid`) da "nessuno" (`request.auth == null`, sempre negato).
- Lo studente autenticato non è mai trattato come docente: le Rules negano sempre allo studente la lettura di `lessons` (documento tecnico con `poolPath`/`poolStatus`/`poolErrors`), `questionIndex`, `verifications/*/publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents` e `settings/owner` (eccetto `settings/ownerPublic`, limitato al solo `ownerUid` e usato solo per il routing UI).
- Lo studente legge solo proiezioni pubbliche dedicate: `publicLessons` (senza riferimenti al pool) e `verifications`/`verifications/*/publishedProjection` quando `state == "attiva" && visibility == "public"`. Le Storage Rules concedono allo studente la lettura dei soli file lezione (`.md` e asset) dell'import attivo, mai dei file `.pool.md`, e solo quando il `programId` taggato in `customMetadata` all'upload appartiene a un programma la cui `classIds` include la classe dello studente (M3L-C, `isClassmateOfProgram()` — mirror della stessa logica applicata a `publicLessons` su Firestore).
- `corrections`, `correctionEvents` e `auditEvents` sono leggibili solo dall'owner. Gli eventi di audit sono solo append: il docente può crearli con schema/azione ammessi, ma non aggiornarli o cancellarli.

Le Security Rules esatte vengono scritte e testate con Emulator Suite obbligatoria, incluso il caso studente di M3-lite. Nessuna regola permissiva temporanea è ammessa con dati reali.

### 3.1 Modello di approvazione studente (M3-lite)

- `settings/studentAccess` (owner-only, letta dalle Rules via `get()`/`firestore.get()`, mai direttamente dal client studente): due interruttori globali, `studentPortalEnabled` (deve essere `true` perché **qualunque** lettura studente sia concessa) e `newStudentRequestsEnabled` (riservato a un futuro flusso di richiesta autonoma; non introdotto da questa milestone — oggi solo il docente crea `students/{uid}`).
- `students/{uid}` (owner-only, `uid` == uid Firebase Auth dello studente): registro di approvazione con `status: "pending" | "approved" | "blocked"`. Un utente Google non-owner senza documento qui è trattato come `pending` ai fini dell'autorizzazione — l'assenza del documento non è un caso speciale, è lo stato di default più restrittivo.
- Ogni lettura studente (`publicLessons`, `verifications/*/publishedProjection`, file lezione in Cloud Storage) richiede **entrambe** le condizioni: `studentPortalEnabled == true` e `students/{request.auth.uid}.status == "approved"`. Nessuna delle due condizioni da sola è sufficiente; l'assenza di `settings/studentAccess` equivale a portale disattivato.
- Le Storage Rules leggono `students/{uid}` e `settings/studentAccess` tramite le funzioni cross-service `firestore.get()`/`firestore.exists()` (supportate nativamente da Cloud Storage Security Rules), non tramite una Cloud Function: il modello resta client-first, coerente con ADR-03.
- `classId` su `students/{uid}` determina il filtro per classe su lezioni (M3L-C) e verifiche (M3L-D) — vedi §3.2.
- La gestione dell'approvazione (UI docente per creare/approvare/bloccare uno studente) non è ancora costruita: questa milestone consegna solo schema, Security Rules e test. Vedi piano-implementazione.md, M3L-A3.

### 3.2 Classi studente e classi programma

- `students/{uid}.classId` identifica la classe dello studente approvato (assegnata dal docente in M3L-A3).
- `programs/{id}.classIds: string[]` (M3L-A4) elenca le classi a cui un programma è assegnato. **Un programma senza classi assegnate (campo assente o array vuoto) non è visibile a nessuno studente**, anche se le sue `publicLessons` esistono e il portale è attivo. UDA e lezioni non hanno un proprio campo classi: ereditano la visibilità dal programma. I programmi creati prima dell'introduzione di questo campo sono letti con `classIds: []` (normalizzazione in lettura, `programsService.listPrograms`; nessuna migrazione distruttiva) — il default è quindi sempre "non visibile", mai "visibile a tutti" per omissione.
- Il `classId` di una verifica determina allo stesso modo quali verifiche uno studente approvato vede (M3L-D): **una verifica senza `classId` non è visibile a nessuno studente**, anche se `status == "active"` e `visibility == "public"`.
- **Il filtro per classe sulla sezione Lezioni è implementato da M3L-C**, sia lato Security Rules sia lato query client:
  - due nuove funzioni Rules, `myStudentClassId()` (legge `students/{request.auth.uid}.classId` con default `null`) e `isClassmateOf(classIds)` (vero solo se lo studente è approvato, con portale attivo, `classId` non nullo, e incluso nell'array `classIds` passato dal chiamante);
  - `programs/{docId}` concede ora anche allo studente una lettura del **solo documento top-level** quando `isClassmateOf(resource.data.get('classIds', []))`; la sotto-collezione `programs/{id}/imports/**` (dati tecnici: `udas`, `lessons`, `questionIndex`) resta owner-only, invariata;
  - `publicLessons` richiedeva finora solo l'approvazione dello studente — un gap reale rispetto alla regola di prodotto, perché un qualunque studente approvato poteva leggere le lezioni di classi diverse dalla propria. M3L-C chiude questo gap: la lettura richiede ora anche `isClassmateOf()` sulle `classIds` del programma padre, letto con `get()`;
  - `.data.get('classIds', [])` garantisce che un programma legacy senza il campo, o con array vuoto, sia sempre negato — mai "visibile a tutti" per omissione;
  - lo stesso principio vale a livello di servizio: `studentLessonsService.loadStudentLessons` legge solo `students/{uid}` (per il proprio `classId`), `programs` (query `array-contains` sulla propria classe) e `publicLessons` per programma trovato — mai la sotto-collezione tecnica di un programma.
  - test Security Rules mirati in `apps/web/src/rules/m3l-student-lessons.rules.test.ts`: approvato+portale attivo+classe compatibile legge; pending/blocked/nessun documento negati; approvato senza `classId` negato; classe incompatibile negata; programma senza `classIds` (assente o vuoto) negato; scrittura studente sempre negata.
- **Il filtro per classe è stato esteso anche alle Storage Rules** (correzione post-review, sempre M3L-C): fino a questa correzione, uno studente approvato con portale attivo poteva leggere qualunque file Storage taggato `customMetadata.kind == "lesson"` di cui conoscesse il percorso, anche se apparteneva a un programma non assegnato alla sua classe — un gap reale rispetto alla regola di prodotto, analogo a quello già chiuso su `publicLessons`.
  - `importRepository` tagga ora ogni file caricato con `customMetadata.programId` (oltre a `kind`, già esistente, e `ownerUid`/`importId` per comodità futura). `classIds` non è mai copiato nei metadata Storage: può cambiare dopo l'upload quando il docente (ri)assegna le classi al programma, quindi la regola legge sempre il programma live da Firestore invece di fidarsi di un valore congelato al momento dell'upload.
  - `storage.rules` aggiunge `myStudentClassId()` e `isClassmateOfProgram(programId)` (mirror esatto di `myStudentClassId()`/`isClassmateOf()` in `firestore.rules`, tramite le funzioni cross-service `firestore.get()`/`firestore.exists()`). La lettura di un file `kind == "lesson"` richiede ora anche `resource.metadata.programId` valorizzato e `isClassmateOfProgram()` vero sul programma corrispondente; `kind == "pool"` resta sempre negato, indipendentemente dalla classe.
  - **I file caricati prima di questa correzione non hanno `customMetadata.programId`** e sono quindi negati di default a ogni studente (mai "visibile a tutti" per l'assenza del metadata) finché il docente non reimporta il programma corrispondente, rigenerando i file con il metadata aggiornato. Non è previsto alcun backfill automatico dei metadata sui file già esistenti.
  - test Security Rules mirati in `apps/web/src/rules/m3l-storage-lesson-class-gate.rules.test.ts` e aggiornati in `apps/web/src/rules/import.rules.test.ts`: approvato+portale attivo+classe compatibile+`kind: "lesson"`+`programId` compatibile legge; classe incompatibile negata; nessun `classId` proprio negato; pending/blocked/nessun documento negati; portale disabilitato negato; `kind: "pool"` sempre negato; `kind: "lesson"` senza `programId` nei metadata (file legacy) negato; programma senza `classIds` negato; scrittura studente sempre negata; owner sempre consentito.
- **Il filtro per classe sulla sezione Verifiche è implementato da M3L-D**, con un vincolo tecnico nuovo rispetto a Lezioni: il documento padre `verifications/{id}` non deve mai diventare leggibile dallo studente (contiene `config.questionRefs`/`teacherSnapshot`, con `poolStorageRef`/`questionLocalId`), quindi lo studente non può scoprire le verifiche della propria classe interrogando quella collezione. La scoperta avviene con un'unica query `collectionGroup('publishedProjection')` sulla sotto-collezione, il che introduce due requisiti empirici non presenti nel modello Lezioni:
  - **ogni campo su cui la Security Rule autorizza deve essere anche un campo su cui la query filtra.** Un `get()` verso il documento padre — necessario per leggere `status`, e che funziona perfettamente per una lettura di un singolo documento — non è validabile per una `list`/`collectionGroup`, perché il segmento di percorso del padre (`verificationId`) non è vincolato dalla query allo stesso modo di un campo dato. Per questo `classId` **e** `visibility` sono duplicati sulla proiezione stessa (eccezione deliberata alla regola generale di questo codebase di non duplicare `status`/`visibility` — vedi `PublishedProjectionDoc` in `api-contract.md`), e `visibility` sostituisce anche `status`: `activateVerification` la inizializza a `'hidden'`, `setVerificationVisibility` la mirrora a ogni toggle, `closeVerification` la forza a `'hidden'` alla chiusura — una verifica chiusa non deve mai restare leggibile per una proiezione con visibilità rimasta `'public'` da prima della chiusura. La query dello studente deve quindi filtrare su **entrambi** i campi: `where('classId','==',classId)` **e** `where('visibility','==','public')`;
  - **il blocco Security Rules deve usare un prefisso ricorsivo (`{path=**}/publishedProjection/{docId}`), non uno a profondità fissa (`verifications/{verificationId}/publishedProjection/{docId}`).** Confermato empiricamente in questo progetto: con il pattern a profondità fissa, anche una regola banale come `allow read: if true` veniva rifiutata per una `collectionGroup()` `list` (mentre funzionava normalmente per `get()` su un documento singolo) — Firestore non registra un match a profondità fissa come idoneo per una query di collection group. Passando al prefisso ricorsivo, la stessa regola valida correttamente la `list`.
  - `firestore.indexes.json` definisce l'indice `COLLECTION_GROUP` su `publishedProjection.classId`+`visibility`, necessario per la query.
  - lo stesso principio vale a livello di servizio: `studentVerificationsService.loadStudentVerifications` legge solo `students/{uid}` (per il proprio `classId`) e la `collectionGroup('publishedProjection')` filtrata — mai il documento padre di una verifica.
  - il PDF studente (`downloadStudentPdfFromProjection`) è generato interamente nel browser dai dati già letti dalla proiezione, riusando lo stesso layout di disegno di `downloadStudentPdf` (il flusso di anteprima docente, che invece legge da Storage/pool) — nessun accesso a Storage, nessun salvataggio del PDF.
  - test Security Rules mirati in `apps/web/src/rules/m3l-student-verifications.rules.test.ts`: approvato+portale attivo+classe compatibile legge la proiezione e può fare `list` con `classId`+`visibility`; la stessa `list` senza il filtro `visibility` è negata; pending/blocked/nessun documento negati; approvato senza `classId` negato; classe incompatibile negata; `hidden`/`draft`/`closed` negati; verifica senza `classId` negata; documento padre mai leggibile; una sotto-collezione `publishedSnapshot` ipotetica mai leggibile; scrittura studente sempre negata; owner sempre consentito.

Le regole seguenti restano specifica di un eventuale **M3-full** (link pubblico, tentativi, gateway) e non si applicano a M3-lite:

- `publicVerificationLinks/{SHA-256(token)}` consentirebbe al portale solo `get` del documento esatto: nessun `list`, nessuna configurazione privata e nessun token in chiaro nel database.
- Il client portale non leggerebbe né scriverebbe direttamente `deliveryAttempts`, `answers`, `snapshot`, `participantLocks` o `accessLog`: tutte le operazioni digitali passerebbero dal gateway.
- `deliveryAttempts/*/accessLog` sarebbe scritto solo dalla Cloud Function e leggibile solo dall'owner (Report Accessi).
- Il reset docente sarebbe ammesso solo in una transazione Firestore su un tentativo `in_progress`, con motivazione, invalidazione sessione, rilascio lock e audit append-only.

---

## 4. Gateway M3-full: `startDigitalAttempt` e `continueDigitalAttempt` (specifica rinviata)

> Questa sezione descrive l'eventuale punto critico di sicurezza di un **M3-full**, fase successiva a M3-lite e non pianificata in dettaglio. M3-lite non introduce alcuna Cloud Function e non ha bisogno di queste garanzie, perché non scrive né autentica tentativi.

**Garanzie richieste (se M3-full verrà realizzato):**

- La transazione Firestore sarebbe atomica: participant lock + tentativo + snapshot + voce `accessLog` in un'unica operazione.
- Il participant lock userebbe `SHA-256(nomeNormalizzato + U+001F + cognomeNormalizzato)` ed sarebbe unico per verifica; una seconda chiamata con la stessa coppia verrebbe rifiutata con `PARTICIPANT_ALREADY_USED`.
- Lo snapshot includerebbe le soluzioni private in Firestore ma non le includerebbe nella risposta HTTP al client.
- Il token di sessione sarebbe generato server-side, consegnato come `Set-Cookie: resumeToken=...; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`.
- Solo l'hash del token di sessione sarebbe salvato in Firestore (`resumeTokenHash`); il token in chiaro non sarebbe mai persistito.
- `continueDigitalAttempt` confronterebbe hash, scadenza e stato del tentativo prima di ogni `get`, `saveDraft` o `submitAttempt`; nessuna Security Rule tenterebbe di autorizzare un cookie.
- `submitAttempt` renderebbe immutabili risposte e snapshot in transazione; il reset docente revocherebbe la sessione impostando lo stato a `cancelled` prima di rimuovere il lock.
- Verrebbero registrati nome dichiarato (`Cognome Nome`), IP, user-agent e timestamp in `accessLog` come audit trail.
- Rate limit applicato per IP e per token verifica.

Questa sezione andrà rivista quando M3-full sarà pianificato in dettaglio, valutando anche se riusare l'identità Google già introdotta da M3-lite invece del modello nome+cognome autodichiarato.

---

## 5. PDF e documenti — nessuna persistenza

- PDF docente, PDF cartaceo studente, PDF studente M3-lite, programma svolto (PDF/Markdown) ed export verifiche (PDF/Markdown/CSV) sono generati nel browser e non scritti su Cloud Storage o Firestore.
- Nessuna Cloud Function produce o salva PDF, in nessun canale.
- I file temporanei del browser (blob URL) sono rilasciati immediatamente dopo il download.

### 5.1 Import e pubblicazione immutabile

- L'import non sostituisce mai l'albero attivo: Storage e indici sono preparati sotto un nuovo `importId`; finché la transazione non cambia `activeImportId`, l'app legge l'import precedente. La stessa transazione scrive insieme il documento tecnico (`lessons`) e la proiezione pubblica (`publicLessons`, M3-lite), così che non esista mai un momento in cui una lezione è visibile allo studente senza il corrispondente controllo docente, o viceversa.
- Gli import incompleti non sono visibili e possono essere rimossi da lifecycle o comando docente; non costituiscono una cronologia utente.
- L'attivazione copia fonti, regole, candidati e soluzioni nel `publishedSnapshot`, con `visibility` iniziale `hidden`. Da `attiva` in poi configurazione e fonti non sono più modificabili; solo `visibility` resta modificabile dal docente.

---

## 6. Dati, privacy ed export

- Da M3-lite, l'identità dello studente è l'account Google usato per il login: SchoolForge non richiede alcun dato autodichiarato per accedere in lettura al Portale. Il modello di approvazione (§3.1) introduce `students/{uid}` con `email` e `displayName`, ma questi non sono autodichiarati dallo studente: sono gli stessi valori già verificati da Firebase Authentication per l'account Google usato per il login, e servono solo al docente per riconoscere chi sta approvando. `classId` è riservato al filtro futuro per classe (§3.2), non ancora popolato da alcun flusso applicativo.
- Log e telemetria non contengono risposte, dati personali completi o punteggi non necessari.
- Il docente può eliminare una consegna digitale (M3-full): dati personali e correzioni sono rimossi; resta audit non identificativo.
- `Esporta verifiche` è disponibile solo al docente e generato on-demand nel browser; dipende da consegne M3-full.
- Firestore/Storage/Functions applicativi usano Milano `europe-west8`; Hosting/Auth non sono dichiarati Italia-only.
- (M3-full, specifica rinviata) il sistema registrerebbe, a fini di audit, nome dichiarato (`Cognome Nome`), IP, user-agent e timestamp per ogni tentativo digitale; dati auto-dichiarati, non verificati. Non applicabile a M3-lite.

---

## 7. Markdown e rendering

- Il Markdown è trattato come input non fidato: nessun script, iframe, event handler o URL pericoloso nel rendering.
- Il pool non è mai esposto nel rendering della lezione o nella proiezione del Portale.
- Il package interno `lesson-contract` (`packages/lesson-contract`, non pubblicato su npm) è l'unico parser autorizzato; qualsiasi estensione non dichiarata viene rifiutata.

---

## 8. AI — Modulo 5 (fuori scope V1 / pianificato per V2)

- Prima di M5 (in V2): C-02 risolta (OpenAI `gpt-4o-mini` oppure Anthropic Claude `claude-haiku-4-5-20251001`, chiave configurata dal docente) e feature flag `aiEnabled = true`.
- Contesto AI: solo lezione sorgente, domanda snapshot, soluzione, risposta studente e nota docente.
- Vietati: browsing web, retrieval, tool esterni, attivazione verifiche, invio email, cancellazione dati.
- La correzione automatica richiede anche C-03, opt-in per verifica, audit e possibilità di rettifica.
- La chiave API AI vive in Secret Manager / Firebase Functions config; non raggiunge mai client, Firestore, Markdown o Git.

---

## 9. Backup, costi e incidenti

- I Markdown e gli asset in Cloud Storage sono intrinsecamente portabili e protetti dalla ridondanza nativa di Storage; non è previsto alcun job di backup dedicato.
- Firestore: il docente può avviare un export manuale on-demand dalla pagina impostazioni; nessuno scheduler, cron o backup automatico programmato.
- RPO V1: best-effort, export manuale dal docente, RTO non garantito in V1.
- Budget e avvisi Firebase configurati prima di `prod`.
- In caso di incidente: fermare il write path interessato, preservare audit, valutare l'ultimo export manuale disponibile, ripristinare e documentare.

---

## 10. Checklist ai gate

| Gate | Controlli minimi |
|---|---|
| G1 | Security Rules default-deny testate in Emulator; `ownerUid` funzionante; budget configurato; export manuale Firestore disponibile dalle impostazioni. |
| G2 | Sanitizzazione Markdown verificata; Storage privato; import isolato e commit di `activeImportId` (fallimento non cambia il contenuto visibile); ZIP portabile. |
| G3 | PDF generato nel browser senza persistenza; canale cartaceo senza record di tentativo né accessLog (al più `downloadCount`); nessun PDF in Storage. |
| G4-lite | Login Google risolve correttamente TeacherShell/StudentShell; nessun accesso anonimo; un utente Google non-owner legge contenuti solo se `students/{uid}.status == "approved"` e `settings/studentAccess.studentPortalEnabled == true` (mai per la sola autenticazione); studente `pending`/`blocked` o senza documento `students/{uid}` non legge nulla; pool, soluzioni, `questionIndex` e documenti tecnici mai raggiungibili dallo studente; PDF studente senza soluzioni; nessuna Cloud Function introdotta. |
| G4 (M3-full, specifica rinviata) | Gateway `startDigitalAttempt`/`continueDigitalAttempt` con participant lock nome+cognome e cookie HttpOnly/Secure; nessun write Firestore dal portale; log nome+IP; soluzioni non nel response; bozza/consegna immutabile; reset controllato e auditato. |
| G5 | Correzione, audit, eliminazione ed export solo docente; export non persistito; richiede G4 (M3-full). |
| G6/G7 (V2) | C-02 risolta / C-03; AI senza web; audit completo; opt-in; rollback verificato. |
