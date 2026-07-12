# SchoolForge — Sicurezza e protezione dei dati

**Versione:** 3.0
**Stato:** in vigore — controlli implementati da F-04 in avanti (M1, M2, M3-lite, RE, M3-full); M3-full completato con Gate G5 superato (vedi `documentazione/evidenze/g5-m3-full-checklist-finale.md`); M4-00 definisce il contratto dati della correzione (nessuna Security Rule ancora, vedi §2 sotto) — il resto di M4 e M5 restano non implementati/rinviati

---

## 1. Obiettivo

Proteggere Markdown, asset, dati di correzione, audit e segreti, e garantire che uno studente autenticato non sia mai trattato come docente. Da **M3-lite**, sia il Docente sia lo Studente si autenticano con Firebase Authentication (rispettivamente un provider dedicato e Google, personale o Workspace for Education); il ruolo è risolto confrontando `uid` con `ownerUid`. Il Portale studente è a sola lettura: non introduce Cloud Functions, non richiede dati autodichiarati e non certifica altro oltre all'identità Google già verificata da Firebase.

**Un utente Google non-owner non è automaticamente uno studente autorizzato.** L'autenticazione Google identifica solo un *richiedente/studente potenziale*: distingue "questo utente è il docente proprietario" da "questo utente è qualcun altro", ma non basta da sola a concedere lettura di contenuti. Uno studente diventa uno studente autorizzato solo quando il docente lo approva esplicitamente in `students/{uid}` (`status: "approved"`) e il portale studente è globalmente attivo (`settings/studentAccess.studentPortalEnabled == true`). Uno studente `pending` (in attesa di approvazione) o `blocked` (bloccato dal docente) non legge alcun contenuto, esattamente come un utente non autenticato. Questo modello — introdotto in M3L-A2, dopo la prima versione di M3L-A che trattava "autenticato Google" come sufficiente — è descritto in dettaglio in §3.1.

Il modello precedente (studente non autenticato, nome+cognome autodichiarati, lock di partecipazione, audit nome+IP) descritto in questo documento (§4, §9) come specifica di un eventuale gateway Cloud Functions **non è mai stato implementato**: M3-full, completato con Gate G5 superato, usa invece autenticazione Google approvata e scritture client dirette validate da Security Rules, sullo stesso modello di M3-lite (§3.1). §4 e §9 restano solo come nota storica dell'alternativa scartata.

---

## 2. Confini e minacce principali

| Asset | Minaccia | Controllo richiesto |
|---|---|---|
| Sezione docente | Accesso di soggetto non owner | Firebase Auth + `ownerUid` nelle Security Rules. |
| Firestore/Storage | Lettura o scrittura diretta non autorizzata | Security Rules default-deny; percorsi sensibili protetti per ruolo. |
| Portale studente (M3-lite) | Uno studente autenticato ottiene privilegi da docente, o legge dati tecnici del docente | Security Rules che negano sempre allo studente `lessons`, `questionIndex`, `publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents`, `settings/owner`; lo studente legge solo proiezioni pubbliche dedicate (`publicLessons`, `publishedProjection` quando `attiva`+`public`). Da M4 (M4-01, non ancora implementato) lo studente leggerà anche, e solo, la propria `correctionReturns/{submissionId}` quando esiste **e** `visibleToStudent == true` — mai `corrections`. |
| Portale studente (M3-lite) | Accesso anonimo o non Google | Nessuna sezione applicativa è raggiungibile senza login Firebase Authentication; solo il provider Google è abilitato per lo studente. |
| Portale studente (M3-lite) | Un utente Google non-owner legge contenuti senza essere stato approvato dal docente, o mentre il portale è disattivato | Security Rules Firestore che concedono ogni lettura di discovery (`programs`, `publicLessons`, `publishedProjection`) solo se `settings/studentAccess.studentPortalEnabled == true` **e** `students/{uid}.status == "approved"`; l'assenza di `settings/studentAccess` o di `students/{uid}` nega di default, così come `status` `pending`/`blocked`. Dal M3F-08 il corpo Markdown vive esclusivamente in `publicLessons.content`: senza superare la discovery Firestore non esiste alcun percorso alternativo (Storage nega la lettura a chiunque non sia l'owner — §3.2a). |
| Portale studente — Lezioni (M3L-C) | Uno studente approvato legge le lezioni di una classe diversa dalla propria | Security Rules (`isClassmateOf()`) e query client filtrano `programs`/`publicLessons` sul `classId` dello studente; un programma senza `classIds`, o con `classIds` non compatibile con lo studente, non è mai leggibile, indipendentemente dall'approvazione. Questo controllo è su Firestore, l'unico gate di discovery (§3.2a); dal M3F-08 Storage nega comunque la lettura del Markdown a chiunque non sia l'owner, indipendentemente dal risultato di questo gate. |
| Portale studente — Verifiche (M3L-D) | Uno studente approvato legge una verifica non ancora pubblicata, già chiusa, di un'altra classe, o mai assegnata a una classe | Lettura di `publishedProjection` concessa solo quando `visibility == "public"` (che vale solo mentre il padre è `active` — la proiezione stessa viene forzata a `"hidden"` alla chiusura) **e** il proprio `classId` è incluso nel `classId` della proiezione (`isClassmateOf()`); una verifica con `classId` assente o `null` non è mai visibile, anche se altrimenti pubblica. Il documento padre `verifications/{id}` (che contiene `config.questionRefs`/`teacherSnapshot`) non è mai letto dallo studente. |
| Import didattico | Pubblicazione parziale tra Storage e Firestore | Upload sotto `importId` isolato, poi commit transazionale del solo `activeImportId`, che aggiorna insieme documento tecnico e proiezione pubblica. |
| Verifica attiva | Modifica retroattiva di fonti/regole | Snapshot pubblicato immutabile all'attivazione; per modificare si duplica la bozza. |
| Markdown | XSS o asset non sicuri | Parser condiviso, sanitizzazione e whitelist rendering, applicati identicamente a docente e studente. |
| AI (V2) | Dati non autorizzati o prompt injection | C-02 risolta, contesto chiuso, nessun web/tool, feature flag, audit. |
| Segreti AI (V2) | Esposizione in Git/client/log | Secret Manager (solo M5/V2), accesso minimo, rotazione. |

Le minacce seguenti si applicano a **M3-full** (specifica in `m3-full-roadmap.md`):

| Asset | Minaccia | Controllo in M3-full |
|---|---|---|
| Submission studente | Scrittura da studente non approvato | Security Rules: `isApprovedStudent()` richiesta per create/update su `submissions`. |
| Submission studente | Doppia submission (stesso studente, stessa verifica) | Security Rules: create consentita solo su path deterministico `submissions/{verificationId}_{uid}`; niente UUID arbitrari e niente query in Rules per cercare duplicati. |
| Submission studente | Modifica post-consegna | Security Rules: update negato se `resource.data.status == 'submitted'`. |
| Submission studente | Consegna su verifica chiusa o non online | Security Rules: create/update negati se `verificationIsOnlineAndActive()` restituisce false (get() cross-doc sulla verifica). |
| Risposte studente | Lettura da altri studenti o soggetti non autorizzati | Security Rules: lettura `submissions/{id}` concessa solo al docente owner; allo studente solo finché `status == 'draft'`. |
| Risposte studente | Lettura delle risposte dopo consegna | Dopo `submitted`, lo studente legge solo `submissionReceipts/{submissionId}` con titolo/classe/timestamp/codice consegna; non legge più la submission completa con `answers`. |
| `publishedProjection` | Esposizione soluzioni nel questionario online | `publishedProjection` non contiene mai `soluzione`, `poolStorageRef`, `questionLocalId`; lo studente online legge lo stesso documento già protetto in M3-lite. |
| Monitor docente | Lettura submission di un altro docente | Security Rules: lettura owner su `submissions` concessa solo se `resource.data.ownerUid == ownerUid()`. |

---

## 3. Security Rules — principi

Le Security Rules Firestore e Storage sono il perimetro di sicurezza principale, per il docente come per lo studente autenticato.

**Regole obbligatorie:**

- Default-deny: qualsiasi percorso non esplicitamente aperto è negato.
- `ownerUid` è verificato come `request.auth.uid == resource.data.ownerUid` o confrontato con `settings/owner.ownerUid`; lo stesso confronto distingue un utente Google autenticato "studente" (`uid != ownerUid`) da "nessuno" (`request.auth == null`, sempre negato).
- Lo studente autenticato non è mai trattato come docente: le Rules negano sempre allo studente la lettura di `lessons` (documento tecnico con `poolPath`/`poolStatus`/`poolErrors`), `questionIndex`, `verifications/*/publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents` e `settings/owner` (eccetto `settings/ownerPublic`, limitato al solo `ownerUid` e usato solo per il routing UI). L'unica eccezione pianificata (M4-01) è `correctionReturns/{submissionId}`, una proiezione minima scritta solo dal docente alla restituzione — mai il documento tecnico `corrections`.
- Lo studente legge solo proiezioni pubbliche dedicate: `publicLessons` (senza riferimenti al pool, corpo Markdown incluso in `content` dal M3F-08) e `verifications`/`verifications/*/publishedProjection` quando `state == "attiva" && visibility == "public"`. Queste proiezioni Firestore sono l'unico gate; dal M3F-08 sono anche l'unica fonte del corpo lezione per lo studente — Storage nega la lettura del Markdown a chiunque non sia l'owner, quindi non esiste più alcun percorso alternativo (§3.2a).
- `corrections`, `correctionEvents` e `auditEvents` sono leggibili solo dall'owner. Gli eventi di audit e gli eventi di correzione (`correctionEvents`, M4-01) sono solo append: il docente può crearli con schema/azione ammessi, ma non aggiornarli o cancellarli. `correctionReturns` (M4-01) è l'unica eccezione: scritta solo dall'owner, letta anche dallo studente proprietario (`studentUid == request.auth.uid`) quando esiste **e** `visibleToStudent == true` — la stessa relazione che `submissionReceipts` già ha con `submissions`, con un controllo di visibilità aggiuntivo che quest'ultima non ha.

Le Security Rules esatte vengono scritte e testate con Emulator Suite obbligatoria, incluso il caso studente di M3-lite. Nessuna regola permissiva temporanea è ammessa con dati reali.

### 3.1 Modello di approvazione studente (M3-lite)

- `settings/studentAccess` (owner-only, letta dalle Rules via `get()`/`firestore.get()`, mai direttamente dal client studente): due interruttori globali, `studentPortalEnabled` (deve essere `true` perché **qualunque** lettura studente sia concessa) e `newStudentRequestsEnabled` (riservato a un futuro flusso di richiesta autonoma; non introdotto da questa milestone — oggi solo il docente crea `students/{uid}`).
- `students/{uid}` (owner-only, `uid` == uid Firebase Auth dello studente): registro di approvazione con `status: "pending" | "approved" | "blocked"`. Un utente Google non-owner senza documento qui è trattato come `pending` ai fini dell'autorizzazione — l'assenza del documento non è un caso speciale, è lo stato di default più restrittivo.
- Ogni lettura studente su Firestore (`publicLessons`, `verifications/*/publishedProjection`) richiede **entrambe** le condizioni: `studentPortalEnabled == true` e `students/{request.auth.uid}.status == "approved"`. Nessuna delle due condizioni da sola è sufficiente; l'assenza di `settings/studentAccess` equivale a portale disattivato. Dal M3F-08 questa è anche l'unica strada per ottenere il corpo Markdown di una lezione: Storage nega la lettura a chiunque non sia l'owner, a prescindere da questo controllo (§3.2a).
- `classId` su `students/{uid}` determina il filtro per classe su lezioni (M3L-C) e verifiche (M3L-D) — vedi §3.2.
- La gestione dell'approvazione (UI docente per creare/approvare/bloccare uno studente, assegnazione della classe) è costruita in `StudentsView` (M3L-A3): il docente non scrive Firestore a mano.

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
- **Storage Rules (M3F-08) — il gap residuo è chiuso: Storage non concede più alcuna lettura Markdown a un non-owner.** Fino a M3F-07 compresa, `storage.rules` concedeva la lettura di un file lezione (`.md`, non `.pool.md`) a qualunque utente autenticato non-owner, senza rileggere Firestore — un compromesso deliberato per evitare i `403` cross-service osservati in produzione (§3.2a, storico sotto). M3F-08 elimina quella concessione invece di stringerla ulteriormente:
  - `storage.rules` ora concede lettura/scrittura sotto `repository/{ownerUid}/**` solo all'owner stesso (`request.auth.uid == ownerUid`). Nessuna altra regola di lettura esiste per quell'albero: Markdown lezione, pool e qualunque altro asset sono tutti owner-only.
  - Il client studente (`StudentLessonsView`/`studentLessonsService`) non chiama mai Firebase Storage: legge il corpo Markdown esclusivamente da `publicLessons/{id}.content`, una proiezione Firestore scritta da ogni percorso che crea/modifica una lezione (import, creazione, modifica del corpo — vedi `api-contract.md`). Un documento legacy privo di `content` (scritto prima di M3F-08) mostra "Contenuto temporaneamente non disponibile" — mai un fallback su Storage, mai un retry.
  - **Il limite residuo descritto fino a M3F-07** — un utente autenticato che conoscesse/indovinasse un `contentPath` esatto poteva leggere quel file direttamente da Storage, bypassando la discovery Firestore — è chiuso: quello stesso tentativo ora riceve `permission-denied` incondizionatamente, indipendentemente da approvazione, classe o Modalità verifica.
  - `importRepository` continua a taggare ogni file con `customMetadata: { kind, programId, ownerUid, importId }` all'upload; questa informazione non è mai stata letta da una Security Rule e resta solo per eventuale diagnostica futura.
  - test Security Rules mirati in `apps/web/src/rules/storage.test.ts` (blocco "student read access — denied unconditionally") e aggiornati in `apps/web/src/rules/import.rules.test.ts`: owner legge/scrive sempre; un utente autenticato non-owner (approvato, classe compatibile, `contentPath` noto o meno) è sempre negato, sia sul Markdown lezione sia sul pool; accesso anonimo negato; scrittura non-owner negata.
- **Modalità verifica (M3F-07) ora è effettiva end-to-end.** `firestore.rules` nega la *discovery* di `programs`/`publicLessons` a uno studente la cui classe è coperta da `settings/studentAccess.examMode` (funzione `examModeAppliesToClass`, § "M3-full" più sotto); con M3F-08, anche un client che avesse già ottenuto (o indovinato) un `contentPath` prima dell'attivazione della Modalità verifica non può più leggerlo da Storage — quel canale è chiuso a prescindere. "Modalità verifica attiva" significa ora anche "il contenuto è tecnicamente irraggiungibile", non solo "le lezioni sono nascoste e non più scopribili dall'app".

### 3.2a Storage Rules — regole esatte (repository/{ownerUid}/**)

```
match /repository/{ownerUid}/{allPaths=**} {
  allow read, write: if request.auth != null && request.auth.uid == ownerUid;
}
match /{allPaths=**} {
  allow read, write: if false;
}
```

- **Storico (fino a M3F-07 inclusa)**: un blocco aggiuntivo a profondità fissa (`repository/{ownerUid}/imports/{importId}/{udaDir}/{fileName}`) concedeva la lettura di un file `.md` (non `.pool.md`) a qualunque utente autenticato non-owner — il compromesso security-vs-reliability descritto sopra. **M3F-08 rimuove quel blocco**: l'unica regola di lettura/scrittura sotto `repository/{ownerUid}/**` è ora quella owner-only.
- `.pool.md`, Markdown lezione e qualunque altro asset sono tutti negati a un non-owner, senza eccezioni.
- Scritture non-owner e accessi anonimi sono negati dal blocco owner-scoped, più il default-deny finale.
- **Il filtro per classe sulla sezione Verifiche è implementato da M3L-D**, con un vincolo tecnico nuovo rispetto a Lezioni: il documento padre `verifications/{id}` non deve mai diventare leggibile dallo studente (contiene `config.questionRefs`/`teacherSnapshot`, con `poolStorageRef`/`questionLocalId`), quindi lo studente non può scoprire le verifiche della propria classe interrogando quella collezione. La scoperta avviene con un'unica query `collectionGroup('publishedProjection')` sulla sotto-collezione, il che introduce due requisiti empirici non presenti nel modello Lezioni:
  - **ogni campo su cui la Security Rule autorizza deve essere anche un campo su cui la query filtra.** Un `get()` verso il documento padre — necessario per leggere `status`, e che funziona perfettamente per una lettura di un singolo documento — non è validabile per una `list`/`collectionGroup`, perché il segmento di percorso del padre (`verificationId`) non è vincolato dalla query allo stesso modo di un campo dato. Per questo `classId` **e** `visibility` sono duplicati sulla proiezione stessa (eccezione deliberata alla regola generale di questo codebase di non duplicare `status`/`visibility` — vedi `PublishedProjectionDoc` in `api-contract.md`), e `visibility` sostituisce anche `status`: `activateVerification` la inizializza a `'hidden'`, `setVerificationVisibility` la mirrora a ogni toggle, `closeVerification` la forza a `'hidden'` alla chiusura — una verifica chiusa non deve mai restare leggibile per una proiezione con visibilità rimasta `'public'` da prima della chiusura. La query dello studente deve quindi filtrare su **entrambi** i campi: `where('classId','==',classId)` **e** `where('visibility','==','public')`;
  - **il blocco Security Rules deve usare un prefisso ricorsivo (`{path=**}/publishedProjection/{docId}`), non uno a profondità fissa (`verifications/{verificationId}/publishedProjection/{docId}`).** Confermato empiricamente in questo progetto: con il pattern a profondità fissa, anche una regola banale come `allow read: if true` veniva rifiutata per una `collectionGroup()` `list` (mentre funzionava normalmente per `get()` su un documento singolo) — Firestore non registra un match a profondità fissa come idoneo per una query di collection group. Passando al prefisso ricorsivo, la stessa regola valida correttamente la `list`.
  - `firestore.indexes.json` definisce l'indice `COLLECTION_GROUP` su `publishedProjection.classId`+`visibility`, necessario per la query.
  - lo stesso principio vale a livello di servizio: `studentVerificationsService.loadStudentVerifications` legge solo `students/{uid}` (per il proprio `classId`) e la `collectionGroup('publishedProjection')` filtrata — mai il documento padre di una verifica.
  - il PDF studente (`downloadStudentPdfFromProjection`) è generato interamente nel browser dai dati già letti dalla proiezione, riusando lo stesso layout di disegno di `downloadStudentPdf` (il flusso di anteprima docente, che invece legge da Storage/pool) — nessun accesso a Storage, nessun salvataggio del PDF.
  - test Security Rules mirati in `apps/web/src/rules/m3l-student-verifications.rules.test.ts`: approvato+portale attivo+classe compatibile legge la proiezione e può fare `list` con `classId`+`visibility`; la stessa `list` senza il filtro `visibility` è negata; pending/blocked/nessun documento negati; approvato senza `classId` negato; classe incompatibile negata; `hidden`/`draft`/`closed` negati; verifica senza `classId` negata; documento padre mai leggibile; una sotto-collezione `publishedSnapshot` ipotetica mai leggibile; scrittura studente sempre negata; owner sempre consentito.
  - **`teacherSnapshot.questions` (fix snapshot immutabile)**: campo interno a `teacherSnapshot`, quindi eredita automaticamente le stesse garanzie — mai letto dallo studente (documento padre non leggibile), e immutabile dopo l'attivazione senza bisogno di alcuna modifica alle Rules: nessuna regola di update su `verifications/{docId}` per gli stati successivi a `draft` include `teacherSnapshot` tra i campi consentiti (`affectedKeys().hasOnly([...])` — vedi le regole di `close`/`visibility`/`onlineEnabled`/`studentPdfEnabled`), quindi l'intero campo, `questions` incluso, resta congelato dal primo `transaction.update` di `activateVerification` in poi. `publishedProjection.questions` (derivata dallo stesso caricamento, mai da `teacherSnapshot.questions` direttamente) continua a non contenere mai `soluzione`, `poolStorageRef`, `questionLocalId` o `questionIndexEntryId` — verificato anche a livello di mapper puro (`toPublicVerificationQuestion`), non solo di Rules.

Le regole seguenti descrivono il modello gateway (link pubblico, tentativi, Cloud Functions) valutato per M3-full e **scartato**: M3-full, completato, non le implementa — vedi §4 e `m3-full-roadmap.md §4` per il modello effettivamente realizzato (Security Rules client-only, submission/receipt):

- `publicVerificationLinks/{SHA-256(token)}` consentirebbe al portale solo `get` del documento esatto: nessun `list`, nessuna configurazione privata e nessun token in chiaro nel database.
- Il client portale non leggerebbe né scriverebbe direttamente `deliveryAttempts`, `answers`, `snapshot`, `participantLocks` o `accessLog`: tutte le operazioni digitali passerebbero dal gateway.
- `deliveryAttempts/*/accessLog` sarebbe scritto solo dalla Cloud Function e leggibile solo dall'owner (Report Accessi).
- Il reset docente sarebbe ammesso solo in una transazione Firestore su un tentativo `in_progress`, con motivazione, invalidazione sessione, rilascio lock e audit append-only.

---

## 4. Gateway M3-full: `startDigitalAttempt` e `continueDigitalAttempt` (modello scartato, non implementato)

> Questa sezione descrive il modello gateway Cloud Functions valutato inizialmente per M3-full e **mai realizzato**. M3-full, completato, usa invece scritture client dirette validate da Security Rules (submission/receipt su path deterministico, immutabilità post-consegna) — vedi `m3-full-roadmap.md §3-4` per il modello effettivo e `documentazione/evidenze/g5-m3-full-checklist-finale.md` per le evidenze del Gate G5. Il resto di questa sezione resta come nota storica dell'alternativa scartata.

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

### 5.2 Repository Editor (RE) — limiti del modello client-side

- Creazione, modifica, riordino ed export sono operazioni Firestore/Storage già coperte dalle regole owner-only esistenti (`programs/{programId}/{sub=**}`, `publicLessons/{lessonId}`): nessuna nuova Security Rule introdotta da RE-01 → RE-06.
- **Il blocco eliminazione (RE-05) è enforced solo lato client**, in `findRepositoryDeleteBlockers`/`repositoryEditorGuards.ts`: prima di eliminare una UDA/lezione, il client legge tutte le `verifications` e verifica che nessuna referenzi quella UDA/lezione (o le sue domande/pool) tramite `config.questionRefs`. Le Security Rules non replicano questo controllo — un client compromesso o una scrittura diretta all'API Firestore potrebbe eliminare una UDA/lezione ancora referenziata da una verifica, lasciando quest'ultima con riferimenti rotti. Accettabile nel modello a singolo docente/proprietario di V1 (nessun'altra identità ha mai scrittura su questi percorsi); da rivalutare se un giorno più identità scrivessero sullo stesso repository. **Nota (fix snapshot immutabile):** per le verifiche `active`/`closed` attivate dopo l'introduzione di `teacherSnapshot.questions`, un'eliminazione di pool/UDA/lezione bypassata non rompe più i PDF docente di quella verifica, perché non dipendono più dai pool correnti — il rischio sopra descritto resta però pienamente valido per le verifiche legacy (attivate prima del fix, senza `teacherSnapshot.questions`) e per qualunque altro uso di `config.questionRefs` al di fuori della generazione PDF.
- Il riordino (RE-04) non tocca mai `dir`/`filename`/percorsi Storage: solo `order` su Firestore, in un `writeBatch` atomico per evitare uno scambio a metà.
- L'export ZIP (RE-06) legge `listUdas`/`listLessons` (già filtrati/ordinati dalle Security Rules e dall'app) e non introduce percorsi di lettura aggiuntivi; l'ordine fisico dell'archivio è responsabilità esclusiva del client (`buildExportZip`), non delle Security Rules.

---

## 6. Dati, privacy ed export

- Da M3-lite, l'identità dello studente è l'account Google usato per il login: SchoolForge non richiede alcun dato autodichiarato per accedere in lettura al Portale. Il modello di approvazione (§3.1) introduce `students/{uid}` con `email` e `displayName`, ma questi non sono autodichiarati dallo studente: sono gli stessi valori già verificati da Firebase Authentication per l'account Google usato per il login, e servono solo al docente per riconoscere chi sta approvando. `classId` popola il filtro per classe (§3.2) tramite l'assegnazione del docente in `StudentsView` (M3L-A3).
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
| GRE (Repository Editor) | Creazione/modifica/riordino/eliminazione di UDA/lezioni non introducono nuove Security Rule (owner-only preesistente); eliminazione bloccata lato client se esiste una verifica collegata (§5.2, limite noto: solo client-side); riordino non rinomina mai file Storage; export ZIP resta Markdown-first, portabile e con `order` coerente al reimport. |
| G4 (gateway Cloud Functions, modello scartato) | Non implementato: M3-full non usa gateway, participant lock nome+cognome, cookie HttpOnly né log nome+IP. Nota storica, vedi §4. |
| G5 — Portale digitale (M3-full) ✅ | Superato. Submission unica e immutabile post-consegna; studente post-consegna legge solo la receipt; verifica chiusa blocca bozze; modalità verifica nega realmente la lettura delle lezioni via Security Rules; nessuna Cloud Function. Evidenze in `documentazione/evidenze/g5-m3-full-checklist-finale.md` e `m3-full-roadmap.md §8`. |
| G6 (M4, contratto M4-00 definito — resto non implementato) | Correzione, audit, eliminazione ed export solo docente; export non persistito; richiede G5 (M3-full, superato). Il contratto dati (`CorrectionDoc`/`CorrectionEventDoc`/`CorrectionReturnDoc`) è definito in `api-contract.md`; Security Rules e service layer sono lo scope di M4-01, non ancora implementato. |
| G6/G7 (V2) | C-02 risolta / C-03; AI senza web; audit completo; opt-in; rollback verificato. |
