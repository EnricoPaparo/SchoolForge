# SchoolForge — Sicurezza e protezione dei dati

**Versione:** 3.0
**Stato:** in vigore — Gate G5, G6 e **G7 superati**. M5 è completato: OpenAI `gpt-5.6-luna` è operativo su DEV dietro configurazione fail-closed, kill switch, Secret Manager, limiti e ledger; nano resta rollback esplicito. Evidenze: [g7-m5-checklist-finale.md](evidenze/g7-m5-checklist-finale.md).

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
| Portale studente (M3-lite) | Uno studente autenticato ottiene privilegi da docente, o legge dati tecnici del docente | Security Rules che negano sempre allo studente `lessons`, `questionIndex`, `publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents`, `settings/owner`; lo studente legge solo proiezioni pubbliche dedicate (`publicLessons`, `publishedProjection` quando `attiva`+`public`). Da M4-01 lo studente legge anche, e solo, la propria `correctionReturns/{submissionId}` quando esiste **e** `visibleToStudent == true` — mai `corrections`. |
| Portale studente (M3-lite) | Accesso anonimo o non Google | Nessuna sezione applicativa è raggiungibile senza login Firebase Authentication; solo il provider Google è abilitato per lo studente. |
| Portale studente (M3-lite) | Un utente Google non-owner legge contenuti senza essere stato approvato dal docente, o mentre il portale è disattivato | Security Rules Firestore che concedono ogni lettura di discovery (`programs`, `publicLessons`, `publishedProjection`) solo se `settings/studentAccess.studentPortalEnabled == true` **e** `students/{uid}.status == "approved"`; l'assenza di `settings/studentAccess` o di `students/{uid}` nega di default, così come `status` `pending`/`blocked`. Dal M3F-08 il corpo Markdown vive esclusivamente in `publicLessons.content`: senza superare la discovery Firestore non esiste alcun percorso alternativo (Storage nega la lettura a chiunque non sia l'owner — §3.2a). |
| Portale studente — Lezioni (M3L-C) | Uno studente approvato legge le lezioni di una classe diversa dalla propria | Security Rules (`isClassmateOf()`) e query client filtrano `programs`/`publicLessons` sul `classId` dello studente; un programma senza `classIds`, o con `classIds` non compatibile con lo studente, non è mai leggibile, indipendentemente dall'approvazione. Questo controllo è su Firestore, l'unico gate di discovery (§3.2a); dal M3F-08 Storage nega comunque la lettura del Markdown a chiunque non sia l'owner, indipendentemente dal risultato di questo gate. |
| Portale studente — Verifiche (M3L-D) | Uno studente approvato legge una verifica non ancora pubblicata, già chiusa, di un'altra classe, o mai assegnata a una classe | Lettura di `publishedProjection` concessa solo quando `visibility == "public"` (che vale solo mentre il padre è `active` — la proiezione stessa viene forzata a `"hidden"` alla chiusura) **e** il proprio `classId` è incluso nel `classId` della proiezione (`isClassmateOf()`); una verifica con `classId` assente o `null` non è mai visibile, anche se altrimenti pubblica. Il documento padre `verifications/{id}` (che contiene `config.questionRefs`/`teacherSnapshot`) non è mai letto dallo studente. |
| Import didattico | Pubblicazione parziale tra Storage e Firestore | Upload sotto `importId` isolato, staging chunked invisibile (i doc portano il nuovo `importId`, non ancora `activeImportId`), poi **switch atomico** del solo `activeImportId` (HARD-02B-2). La visibilità dipende esclusivamente da `activeImportId` (query + Rules): lo staging non è mai leggibile dallo studente, il cleanup differito tocca solo le `publicLessons` del vecchio import. |
| Import di una singola UDA (TWU-04B) | Contenuti staged di una UDA visibili allo studente prima del commit; append concorrente incoerente | Append nell'`activeImportId` esistente con **`UdaDoc` come commit marker**: lezioni/`questionIndex` staged restano invisibili finché il commit transazionale non crea `UdaDoc` + tutte le `publicLessons` insieme (nessuna proiezione parziale). I reader ignorano lo staged privo di `UdaDoc` (`committedUdas.ts`). Una lease singola sull'import esclude append concorrenti e blocca create/reorder/delete UDA. Validazione ZIP completa **prima di ogni scrittura** (traversal/ZIP-slip/symlink/path assoluti/duplicati/file inattesi/limiti/pool non-v2 bloccati). Upload solo via SGW owner-only same-origin; cleanup pre-commit limitato al manifest del tentativo, mai ai dati preesistenti. **Nessuna nuova Rule, Function o indice**: le sottocollezioni import sono già owner-only e `publicLessons` conserva il contratto. |
| Importazione strutturale metadata-only (STRUCTURE-IMPORT, pianificata) | YAML malformato o sovradimensionato; proprietà tecniche iniettate; collisioni; append parziale; lezioni vuote mostrate allo studente | Schema chiuso e versionato, limiti e validazione integrale prima delle scritture; ID/path/order prodotti solo dal sistema; preflight collisioni; lease dell'import; upload SGW e commit Firestore atomico; cleanup limitato al manifest; nessun overwrite. Le proiezioni a corpo vuoto sono omesse dalla UI studente finché non viene salvato un corpo non vuoto. Il filtro è UX, non embargo di sicurezza sui titoli. Contratto: `structure-metadata-import-roadmap.md`. |
| Verifica attiva | Modifica retroattiva di fonti/regole | Snapshot pubblicato immutabile all'attivazione; per modificare si duplica la bozza. |
| Markdown | XSS o asset non sicuri | Parser condiviso, sanitizzazione e whitelist rendering, applicati identicamente a docente e studente. |
| IA (M5, progettata) | Dati non autorizzati o prompt injection | Autorizzazione **per ID** (rilettura server-side), contesto chiuso, contenuto studente non attendibile, nessun web/tool, feature flag, validazione output, audit senza contenuti (§8). |
| Segreti IA (M5) | Esposizione in Git/client/log | Binding Secret Manager limitato ad `aiCorrectionRun`; chiave mai lato client/Firestore/log. Valore e Console non sono documentati nel repository. |

Le minacce seguenti si applicano a **M3-full** (specifica in `m3-full-roadmap.md`):

| Asset | Minaccia | Controllo in M3-full |
|---|---|---|
| Submission studente | Scrittura da studente non approvato | Security Rules: `isApprovedStudent()` richiesta per create/update su `submissions`. |
| Submission studente | Doppia submission (stesso studente, stessa verifica) | Security Rules: create consentita solo su path deterministico `submissions/{verificationId}_{uid}`; niente UUID arbitrari e niente query in Rules per cercare duplicati. |
| Submission studente | Modifica post-consegna | Security Rules: update negato se `resource.data.status == 'submitted'`. |
| Submission studente | Consegna su verifica chiusa o non online | Security Rules: create/update negati se `verificationIsOnlineAndActive()` restituisce false (get() cross-doc sulla verifica). |
| Risposte studente | Lettura da altri studenti o soggetti non autorizzati | Security Rules: lettura `submissions/{id}` concessa solo al docente owner; allo studente solo finché `status == 'draft'`. |
| Risposte studente | Lettura delle risposte dopo consegna | Dopo `submitted`, lo studente legge solo `submissionReceipts/{submissionId}` con titolo/classe/timestamp/codice consegna; non legge più la submission completa con `answers`. |
| `publishedProjection` — Argomenti (UI-VERIFICHE-06B) | Il perimetro didattico rivela domande, soluzioni o la variante VEX assegnata | `topicOutline` è un contratto **chiuso**: solo `udaTitle` e `lessonTitles`. Nessun id, filename, `order`, `questionLocalId`, `poolStorageRef`, testo, opzione, soluzione, punteggio o difficoltà. È lo stesso identico dato di `teacherSnapshot.topicOutline` — non esiste una versione ridotta per lo studente perché non c'è nulla da ridurre. In `equivalent_variants` è l'**unione** delle lezioni di tutte le domande selezionate (comuni e alternative), quindi identico per ogni studente e muto sulla variante assegnata. Ricostruito e rivalidato autorevolmente all'attivazione dai dati canonici del corso: il valore mantenuto dal client durante la selezione non è mai la fonte di verità. **Confine di enforcement, esplicito:** il «contratto chiuso» del perimetro è **applicativo** — lo garantiscono i parser e i writer canonici (`buildTopicOutline`, `readTopicOutline`, `assertCopyableTopicOutline`), non le Security Rules. Le Rules garantiscono l'**autorizzazione**: `publishedProjection` leggibile solo da un compagno di classe autorizzato con `visibility == "public"` e scrivibile solo dall'owner; su `correctionReturns` il set di chiavi resta chiuso (`hasOnly`) e i due nuovi campi sono verificati per tipo e dimensione massima, ma la struttura interna di `topicOutline` non è validata in CEL — riprodurla lì significherebbe duplicare in modo fragile una validazione che non può iterare su liste annidate. |
| `correctionReturns` — data e argomenti (UI-VERIFICHE-06B) | La correzione restituita perde il perimetro quando la verifica viene chiusa o nascosta, oppure lo studente riesce a scriverlo | `verificationDate` e `topicOutline` sono **copiati dal `teacherSnapshot` congelato** nella stessa scrittura atomica della restituzione (singola e batch): mai dalla `publishedProjection`, mai da valori del client, mai dedotti da titoli o domande. Presenti ma malformati ⇒ errore **prima** di qualunque write. La proiezione resta autosufficiente e leggibile a verifica chiusa o nascosta. `questions` continua a contenere solo la variante assegnata; `topicOutline` è il perimetro generale e non la rivela. Lo studente legge solo la propria proiezione con `visibleToStudent == true` e non può scrivere alcun campo. |
| `publishedProjection` | Esposizione soluzioni nel questionario online | `publishedProjection` non contiene mai `soluzione`, `poolStorageRef`, `questionLocalId`; lo studente online legge lo stesso documento già protetto in M3-lite. |
| Monitor docente | Lettura submission di un altro docente | Security Rules: lettura owner su `submissions` concessa solo se `resource.data.ownerUid == ownerUid()`. |

---

## 3. Security Rules — principi

Le Security Rules Firestore e Storage sono il perimetro di sicurezza principale, per il docente come per lo studente autenticato.

**Regole obbligatorie:**

- Default-deny: qualsiasi percorso non esplicitamente aperto è negato.
- `ownerUid` è verificato come `request.auth.uid == resource.data.ownerUid` o confrontato con `settings/owner.ownerUid`; lo stesso confronto distingue un utente Google autenticato "studente" (`uid != ownerUid`) da "nessuno" (`request.auth == null`, sempre negato).
- Lo studente autenticato non è mai trattato come docente: le Rules negano sempre allo studente la lettura di `lessons` (documento tecnico con `poolPath`/`poolStatus`/`poolErrors`), `questionIndex`, `verifications/*/publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents` e `settings/owner` (eccetto `settings/ownerPublic`, limitato al solo `ownerUid` e usato solo per il routing UI). L'unica eccezione (M4-01) è `correctionReturns/{submissionId}`, una proiezione minima scritta solo dal docente alla restituzione — mai il documento tecnico `corrections`.
- Lo studente legge solo proiezioni pubbliche dedicate: `publicLessons` (senza riferimenti al pool, corpo Markdown incluso in `content` dal M3F-08) e `verifications`/`verifications/*/publishedProjection` quando `state == "attiva" && visibility == "public"`. Queste proiezioni Firestore sono l'unico gate; dal M3F-08 sono anche l'unica fonte del corpo lezione per lo studente — Storage nega la lettura del Markdown a chiunque non sia l'owner, quindi non esiste più alcun percorso alternativo (§3.2a).
- `corrections`, `correctionEvents` e `auditEvents` sono leggibili solo dall'owner. Gli eventi di audit e gli eventi di correzione (`correctionEvents`, M4-01) sono solo append: il docente può crearli con schema/azione ammessi, ma non aggiornarli o cancellarli. `correctionReturns` (M4-01) è l'unica eccezione: scritta solo dall'owner, letta anche dallo studente proprietario (`studentUid == request.auth.uid`) quando esiste **e** `visibleToStudent == true` — la stessa relazione che `submissionReceipts` già ha con `submissions`, con un controllo di visibilità aggiuntivo che quest'ultima non ha.
- **Confine Rules/service per la correzione (M4-01)**: le Security Rules su `corrections`/`correctionEvents`/`correctionReturns` applicano ownership, immutabilità dei campi identità (`submissionId`/`verificationId`/`studentUid`/`ownerUid`/`createdAt`) e la matrice di transizione di stato ammessa — mai una validazione profonda del contenuto di `evaluations`/`questionDeltas` (range dei punteggi per domanda, coerenza dei delta, corrispondenza esatta con lo snapshot). Quella validazione resta responsabilità del service layer owner-only (`correctionContract.ts`/`correctionsService.ts`), sullo stesso principio già in vigore per `teacherSnapshot`/`config` su `verifications`: l'unico principal che potrebbe scrivere dati incoerenti è l'owner stesso, lo stesso principal già fidato per ogni altro percorso di scrittura owner-only in questo codebase.
- **Eliminazione consegna (M4-LIFE-02, ridefinita in M5-06B)**: il docente owner può eliminare una consegna e i dati personali collegati (`submissions`, `submissionReceipts`, `corrections` e i `correctionEvents` con `correctionId == submissionId`) **solo prima della prima restituzione** allo studente. Le Rules mantengono il `delete` **owner-only** verificato dal campo `ownerUid` del documento che si sta eliminando (mai da un fratello che potrebbe sparire nella stessa operazione): lo studente non può mai eliminare nulla e non esiste eliminazione cross-owner. **M5-06B** rafforza il contratto lato Rules: `corrections` non è eliminabile se `status == 'returned'`, e `correctionReturns` **non è eliminabile da nessuno** (`allow delete: if false`) — la sua esistenza è la prova permanente che lo studente ha visto un esito e non deve essere cancellata; il reopen la nasconde (`visibleToStudent:false`) senza eliminarla. `correctionEvents` resta append-only (solo delete aggiunto). Il servizio applica lo stesso vincolo con un preflight autorevole che, in presenza di una qualsiasi evidenza di restituzione (return esistente anche nascosto, `corrections.status == 'returned'`, o mirror pubblico `correctionStatus == 'returned'` su submission/receipt), blocca **prima di ogni scrittura** senza cancellazioni parziali. **Limite cross-document noto**: dopo una cancellazione multi-documento le Rules non possono dimostrare, sul singolo `delete` di `submissions`/`submissionReceipts`, che la correzione non fosse restituita (i mirror pubblici sono campi opzionali e un client potrebbe non popolarli); la difesa più forte verificabile è quella sui documenti che portano lo stato (`corrections` returned negato, `correctionReturns` non eliminabile), e la coerenza dell'intera operazione è garantita dal preflight del servizio. Dopo l'eliminazione resta un solo audit **non identificativo** (`submission.deleted`) con `ownerUid`, `verificationId`, `action` e timestamp — mai `studentUid`, il `submissionId` (che incorpora lo `studentUid`), nome/email o risposte. Il blocco dell'eliminazione di una verifica con consegne resta un **guard applicativo** (modello single-owner): `deleteVerification` esegue una query mirata `where('verificationId','==',id).limit(1)` su `submissions` e si ferma senza scrivere se ne esiste una.
- **Riepilogo punteggio nel monitor docente (M4-MON-01)**: `SubmissionDoc.correctionSummary` (`totalPoints`, `maxPoints`, `percentage`) e il relativo timestamp sono una proiezione **owner-only** usata dal listener già esistente della tabella Consegne online. Lo studente non può leggere la submission dopo la consegna e `submissionReceipts` non contiene mai punteggio o percentuale: la visibilità studente resta governata esclusivamente da `correctionReturns.visibleToStudent`. Le Rules consentono all'owner di aggiornare solo la coppia riepilogo/timestamp, ne verificano struttura, tipi e range e permettono di combinarla con il mirror di stato nello stesso batch; la ricostruzione aritmetica profonda dalle `evaluations` resta responsabilità del service owner-only. Nessuna nuova query, lettura o esposizione studente.
- **Export Registro Correzioni (M4-03A CSV / M4-03B PDF)**: disponibili solo nella `TeacherShell` e costruiti dalle righe owner-only già presenti nel monitor, senza nuove query/listener/letture/scritture. **Nessun modulo di export/PDF è importato dalla `StudentShell`.** Il modello canonico condiviso ammette esclusivamente nome, email, stato, riepilogo punteggio, data e codice consegna; non possiede campi per UID, submissionId, ownerUid, risposte, soluzioni, feedback o eventi. Il CSV neutralizza i prefissi formula (`=`, `+`, `-`, `@`) prima dell'escaping per evitare formula injection in Excel; il PDF (jsPDF via import dinamico, generato e scaricato nel browser) stampa gli stessi campi non sensibili. Nessuna modifica a Security Rules o indici: entrambi i download sono file locali non persistiti.
- **Anti-staleness `correctionReturns` dopo una riapertura (M4-01, fix post-review)**: `reopenCorrection` nasconde `correctionReturns` (`visibleToStudent: false`) senza cancellarlo, quindi la sua sola esistenza non basta mai ad autorizzare una scrittura su di esso. Sia il service (`setReturnVisibleToStudent`/`setSolutionsVisible` verificano `corrections.status == 'returned'` prima di scrivere) sia le Rules (`correctionDataAfter()` via `getAfter()`: create/update ammessi solo se la correction è `'returned'` dopo la stessa scrittura atomica, con un'unica eccezione stretta per l'hide atomico di `reopenCorrection`) negano ogni tentativo di mostrare o far crescere una restituzione stale mentre una rettifica è in corso. `correctionEvents` verifica in aggiunta `timestamp == request.time` e che `type`/`previousStatus`/`nextStatus` formino una combinazione realmente raggiungibile, collegando `nextStatus` allo stato reale della correction dopo la scrittura.
- **Preferenze correzione IA e profilo modello (TWU-02)**: il nuovo documento `teacherAiPreferences/{ownerUid}` è **owner-only** (lettura e scrittura solo dall'owner, `id == ownerUid`, `ownerUid` immutabile e uguale all'utente autenticato) con contratto **chiuso**: solo `modelProfile` (`economy`/`quality`), `gradingMode`, `teacherGuidance?` (≤ 500), `updatedAt == request.time`; enum sconosciuti, chiavi extra, timestamp client e guidance oltre limite sono negati. Nessuno studente vi accede. Il client sceglie **solo** un profilo modello astratto: **non** invia mai un model ID o un listino, che restano risolti server-side; `settings/aiConfig` resta kill switch e fonte autoritativa di limiti/budget, mai leggibile dal client. Il profilo risolto entra nell'identità idempotente della richiesta (stesso `requestId` con profilo diverso ⇒ `invalid_input`), senza fallback silenzioso tra modelli.
- **Azzera correzione (M5-04C)**: `clearCorrection` riporta una correzione `in_progress` allo stato non valutato in **una transazione** (azzera `points`, rimuove feedback per domanda e `generalFeedback`, ricalcola i totali, aggiorna il mirror, resta `in_progress`) e scrive **un solo** evento `correctionCleared`. Le Rules aggiungono `correctionCleared` all'enum ammesso degli eventi con l'unica combinazione valida `previousStatus == nextStatus == 'in_progress'` (append-only, owner-only, `timestamp == request.time`, `nextStatus` legato allo stato reale della correction dopo la scrittura) — nessun contenuto sensibile nell'evento (mai risposte, testi, soluzioni, `evaluations`, feedback cancellati o dati personali). L'operazione **non** cancella `corrections`/`submissions`/`submissionReceipts`/`correctionReturns` e **non** tocca la consegna dello studente né il modello di visibilità; gli zeri già persistiti non vengono migrati automaticamente (`points !== null` resta «valutato»). Il feedback deterministico delle chiuse (M5-04C) è basato **solo su conteggi**: mai ID o testi delle soluzioni, così non trapela nulla nei documenti leggibili dallo studente (la visibilità delle soluzioni resta il toggle M4 `solutionsVisible`).
- **Lista delle correzioni restituite allo studente (M4-02B)**: `studentCorrectionReturnsService.loadStudentCorrectionReturns` legge `correctionReturns` con un'unica query filtrata su `studentUid == uid` **e** `visibleToStudent == true` — mai uno scan client-side, mai un `getDoc` per verifica. La `allow read` di `correctionReturns` introdotta in M4-01 (§ sopra) autorizza già questa esatta combinazione di campi per un `list`/query, sullo stesso principio già usato per `publishedProjection`/`classId`+`visibility` (M3L-D): **nessuna modifica a `firestore.rules`** è stata necessaria per M4-02B, e **nessun indice composito nuovo** in `firestore.indexes.json` — due soli filtri di uguaglianza sono coperti dagli indici a campo singolo automatici di Firestore. La query non usa `orderBy`: l'ordinamento (`returnedAt` decrescente, legacy/malformato sempre in fondo, mai escluso dal risultato) è fatto interamente in JS, altrimenti l'`orderBy` di Firestore escluderebbe silenziosamente ogni documento privo del campo. Verificato con test Emulator dedicati: la query con entrambi i filtri è ammessa; una query a cui manca uno dei due filtri (incluso il caso "solo `studentUid`", che altrimenti esporrebbe anche le restituzioni nascoste dello stesso studente) è negata; una restituzione di un altro studente non compare mai nei risultati, anche se visibile. Il pulsante "Ricarica" del workspace studente (`StudentCorrectionView`) usa la stessa regola su un `getDoc` singolo: risolve a "non più disponibile" solo per documento assente o `permission-denied`; un errore diverso (rete/offline) viene mostrato come tale, senza scartare i dati già caricati e senza essere confuso con una restituzione nascosta.

Le Security Rules esatte vengono scritte e testate con Emulator Suite obbligatoria, incluso il caso studente di M3-lite. Nessuna regola permissiva temporanea è ammessa con dati reali.

### M4-LIFE-03 — cancellazione dopo riapertura

La consegna è protetta soltanto mentre la correzione è attualmente `returned` o la restituzione è visibile. La cancellazione di una precedente restituzione è ammessa esclusivamente per l'owner, quando la projection è nascosta, la correction esistente è davvero `in_progress` e lo stesso batch elimina correction, submission e receipt. Il preflight del service verifica inoltre ownership e mirror: una hide manuale, un mirror `returned`, una correction mancante o incoerente bloccano senza scritture. Per il grafo ordinario la cancellazione è atomica; soltanto una quantità eccezionale di `correctionEvents` richiede chunk preliminari idempotenti.

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
  - Il client studente (`StudentDidatticaView`/`studentLessonsService`) non chiama mai Firebase Storage: legge il corpo Markdown esclusivamente da `publicLessons/{id}.content`, una proiezione Firestore scritta da ogni percorso che crea/modifica una lezione (import, creazione, modifica del corpo — vedi `api-contract.md`). Un documento legacy privo di `content` (scritto prima di M3F-08) mostra "Contenuto temporaneamente non disponibile" — mai un fallback su Storage, mai un retry.
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

### 3.2b Repository Storage Gateway (SGW) — modello di sicurezza TARGET, non ancora implementato

Il gateway same-origin descritto in [storage-gateway-roadmap.md](storage-gateway-roadmap.md) sposterà **tutti** gli accessi Storage del docente (pool, editing Markdown, import/export, eliminazioni, backfill, caricamento domande verifiche) dietro una Cloud Function con Admin SDK. Punto di attenzione critico: **l'Admin SDK bypassa le Storage Rules**. Il gateway deve quindi applicare **autonomamente** vincoli **almeno equivalenti o più stretti** di `storage.rules`:

- verifica **ID token** (Admin SDK) e che l'uid sia **il docente owner reale** del portale (non un qualsiasi utente autenticato);
- path obbligatoriamente sotto `repository/{ownerUid}/imports/…` con `ownerUid` == uid autenticato; **normalizzazione** e rifiuto di `..`, slash ambigue, URL, path assoluti, encoding anomalo;
- **allowlist estensioni** (`.md`/`.pool.md`), solo **UTF-8**, limiti dimensione/numero file, solo metodi `POST` previsti;
- **nessun endpoint student-facing** (lo studente continua a leggere solo `publicLessons.content`); **nessuna fiducia** nei controlli frontend; **log** privi di contenuti didattici, token, pool, soluzioni o dati personali.

**App Check** è previsto come **hardening futuro** (attestazione app in aggiunta all'ID token), non come requisito iniziale. **Stato: nessuna Function/gateway esiste ancora**; oggi il perimetro resta interamente `storage.rules` (owner-only) con accesso diretto dal client.
- **Il filtro per classe sulla sezione Verifiche è implementato da M3L-D**, con un vincolo tecnico nuovo rispetto a Lezioni: il documento padre `verifications/{id}` non deve mai diventare leggibile dallo studente (contiene `config.questionRefs`/`teacherSnapshot`, con `poolStorageRef`/`questionLocalId`), quindi lo studente non può scoprire le verifiche della propria classe interrogando quella collezione. La scoperta avviene con un'unica query `collectionGroup('publishedProjection')` sulla sotto-collezione, il che introduce due requisiti empirici non presenti nel modello Lezioni:
  - **ogni campo su cui la Security Rule autorizza deve essere anche un campo su cui la query filtra.** La discovery continua quindi a filtrare `classId` e `visibility` sulla proiezione. M4-LIFE-01 duplica inoltre `status` solo per la semantica UI (`active`/`closed`, legacy assente = `active`), non come filtro di autorizzazione. `closeVerification` imposta il mirror `closed` preservando `visibility`: una `closed+public` resta leggibile/PDF, mentre `verificationOnlineAndActive()` sul parent continua a negare avvio, autosave e consegna online;
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

### 3.3 Appunti personali e indice (ANNOT-01/03B)

Gli appunti personali vivono a `students/{studentUid}/lessonNotes/{publicLessonId}` e
sono governati da un `match` **dedicato** in `firestore.rules`: le regole del documento
padre `students/{uid}` (che concede la lettura owner al docente) **non si propagano** a
questa sottocollezione — Firestore non eredita mai le regole del padre — quindi il
docente non può leggere né scrivere gli appunti, nemmeno in quanto owner.

Ogni operazione (lettura puntuale get/create/update/delete) richiede
`request.auth.uid == studentUid` **e** il gate `canAccessLessonForNotes(publicLessonId)`,
che riusa gli helper esistenti
(`isApprovedStudent`, `myStudentClassId`, `isClassmateOf`, `programActiveImportId`,
`examModeAppliesToClass`, `isOwner`) senza duplicarne la logica. Il gate è fail-closed e
in cortocircuito: nega studente non approvato/pending/blocked, portale disattivato,
studente senza classe, classe non assegnata al programma della lezione, lezione di un
import non attivo, programma o `publicLessons` mancanti, e **qualsiasi** operazione
quando la Modalità verifica si applica (globale o alla classe). Il docente è negato
esplicitamente (`!isOwner()`) e di nuovo dal confronto `uid == studentUid`.

Validazione dei dati (rivalidata server-side, mai delegata al client):

- **lettura nota**: `get` puntuale; `list` è ammesso soltanto sulla sottocollezione
  personale e resta soggetto al gate di ogni documento, per il bootstrap una tantum che
  il client vincola a `programId` + `importId` correnti;
- **create**: set di chiavi chiuso ed esatto (`studentUid`, `publicLessonId`,
  `programId`, `importId`, `content`, `createdAt`, `updatedAt`); `studentUid`/
  `publicLessonId` coerenti con il path e `request.auth.uid`; `programId`/`importId`
  coerenti con la `publicLessons/{publicLessonId}` associata; `content is string` e
  `≤ 20000`; `createdAt == updatedAt == request.time`;
- **update**: solo `content` + `updatedAt` mutabili (`affectedKeys().hasOnly`), identity
  fields e `createdAt` immutabili; `content is string` e `≤ 20000`;
  `updatedAt == request.time`;
- **delete**: solo lo studente proprietario e solo entro il gate completo — una nota di
  una lezione non più accessibile o durante Modalità verifica non è cancellabile dal
  client (fail-closed dichiarato nel contratto).

L'indice `students/{studentUid}/lessonNoteIndexes/{programId}` è ugualmente personale:
owner/docente, altri studenti, pending/blocked, portale disabilitato e Modalità verifica
sono negati. Create/update richiedono chiavi chiuse, identità path immutabile,
`importId` uguale all'import attivo, lista di massimo 500 elementi e
`updatedAt == request.time`; delete è sempre negato. L'indice conserva solo ID lezione,
mai contenuti o dati anagrafici.

**Costo di autorizzazione.** Il gate esegue accessi cross-document (memoizzati per
valutazione): `settings/owner`, `settings/studentAccess`, `students/{uid}`,
`publicLessons/{publicLessonId}`, `programs/{programId}` — accessi puramente
autorizzativi su path noti, entro i limiti di access-call delle Rules, verificati
dall'Emulator. Nessuna proiezione didattica (testo lezione, titolo, classe, nome/email,
pool, domande, soluzioni) è memorizzata o esposta dagli appunti.

**Pulizia alla cancellazione del corso (ANNOT-CLEANUP-01).** Il delete diretto
degli appunti e degli indici resta **negato** dalle Rules anche al docente: la
pulizia avviene tramite la Cloud Function `onCall` owner-only
`cleanupProgramLessonNotes`, che gira con Admin SDK (bypassa le Rules) senza
concedere al docente alcun accesso Rules alle note né ai loro contenuti. La
Function verifica l'owner server-side (`settings/owner.ownerUid`, fail-closed),
esegue **una** collection-group query su `lessonNoteIndexes` per `programId` e
costruisce i path delle note **solo** da `studentUid` + `lessonIds` dell'indice:
i documenti `lessonNotes` (e il loro `content`) non vengono **mai** letti. Ogni
indice è validato fail-closed (path coerente, `lessonIds` array di stringhe non
vuote ≤500, dedup). Ogni segmento di path (`programId`, `studentUid`,
`lessonId`) è validato come document ID Firestore (non vuoto, senza `/`, diverso
da `.`/`..`, entro il limite UTF-8) senza normalizzazione silenziosa; l'input
callable è realmente chiuso (solo `{ programId }`, proprietà extra rifiutate).
Un indice malformato o un id non valido interrompe l'operazione senza cancellare
path arbitrari e senza esporre path o contenuti. Il risultato è minimale
(`status`, `notesDeleted`, `indexesDeleted`) e non contiene uid, path, lessonId
o contenuti. La cleanup è invocata da `deleteProgram` **prima di qualsiasi
operazione distruttiva** sul corso, così un fallimento lascia il corso
completamente integro per il retry (idempotente, non globalmente atomico). Le
Firestore Rules degli appunti **non sono modificate** da questa change. Nessun
indice composito (filtro campo singolo → indice single-field automatico).

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

- L'import non sostituisce mai l'albero attivo: Storage e indici sono preparati sotto un nuovo `importId`; finché lo **switch atomico** non cambia `activeImportId`, l'app legge l'import precedente. Da **HARD-02B-2** le scritture non sono più un'unica transazione ma avvengono in **chunk ≤400 mutazioni** durante uno **staging invisibile**, seguito da uno switch atomico ≤3 mutazioni (`activeImportId` + `imports/{id}.status='active'` + audit). Le nuove `publicLessons` sono import-scoped e portano il nuovo `importId`: durante lo staging **non sono leggibili** dallo studente, perché la lettura non-owner è vincolata (query **e** Security Rules) a `importId == programs/{id}.activeImportId` (HARD-02B-1). Non esiste quindi mai un momento in cui una lezione è visibile allo studente senza il corrispondente controllo docente, né una proiezione parziale: la visibilità commuta atomicamente su `activeImportId`. Un errore prima dello switch lascia l'import precedente intatto (`not_applied`); il cleanup delle vecchie `publicLessons` è differito, idempotente e best-effort (mai dati tecnici/Storage), con esito non bloccante `cleanupPending`.
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
- **Residenza dati (HARD-F02, risolto):** DEV usa Firestore `europe-west8` e Storage/Function gateway `us-central1` (verificati); target PROD `europe-west8` con co-locazione, previa verifica di supporto. Nessun dato DEV sarà migrato. Hosting/Auth non sono dichiarati Italia-only.
- (M3-full, specifica rinviata) il sistema registrerebbe, a fini di audit, nome dichiarato (`Cognome Nome`), IP, user-agent e timestamp per ogni tentativo digitale; dati auto-dichiarati, non verificati. Non applicabile a M3-lite.

---

## 7. Markdown e rendering

- Il Markdown è trattato come input non fidato: nessun script, iframe, event handler o URL pericoloso nel rendering.
- Il pool non è mai esposto nel rendering della lezione o nella proiezione del Portale.
- Il package interno `lesson-contract` (`packages/lesson-contract`, non pubblicato su npm) è l'unico parser autorizzato; qualsiasi estensione non dichiarata viene rifiutata.

### 7.1 Security header e CSP di Hosting (HARD-01B, F03)

Difesa in profondità a livello di trasporto, configurata **solo** in `firebase.json` (`hosting.headers`), applicata a ogni risposta Hosting (`source: "**"`). Enforced, non report-only. Guardrail statico di non-regressione in `apps/web/src/hostingHeaders.test.ts`.

| Header | Valore | Motivo |
|---|---|---|
| `X-Content-Type-Options` | `nosniff` | Blocca il MIME-sniffing. |
| `X-Frame-Options` | `DENY` | Anti-clickjacking (ridondante con `frame-ancestors 'none'`, per browser datati). |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Mantiene la comunicazione con la popup cross-origin di Google Auth ed evita warning/rotture su `window.closed`, senza usare `unsafe-none`. |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Non perde path/query cross-origin. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)` | Disabilita sensori/pagamenti non usati; **mantiene** Fullscreen same-origin per la Modalità verifica; clipboard non ristretta. |
| `Content-Security-Policy` | vedi sotto | Confina origini di script/stili/connessioni/frame. |

**CSP** (una sola riga in `firebase.json`), con motivazione per ogni origine non-`self`:

- `default-src 'self'` · `base-uri 'self'` · `object-src 'none'` · `frame-ancestors 'none'` · `form-action 'self'` — baseline restrittiva.
- `script-src 'self' https://apis.google.com` — bundle Vite con hash serviti dallo stesso origin e loader ufficiale richiesto da Firebase Google Auth (`signInWithPopup`), confermato dallo smoke DEV. **Nessun** `unsafe-inline`/`unsafe-eval`; nessun'altra origine script (niente analytics/ads).
- `style-src 'self' 'unsafe-inline'` — `'unsafe-inline'` **necessario** per gli inline `style={{…}}` di React (stili dinamici in `CourseWorkspace`/`DidatticaView`); ammesso solo su `style-src`, mai su `script-src`.
- `img-src 'self' data: blob: https://*.googleusercontent.com` — immagini delle lezioni ammesse solo se **same-origin/importate** (`'self'`), `data:` (favicon SVG e immagini generate per il canvas PDF), `blob:` (immagini da Blob) o **foto profilo Google** (`*.googleusercontent.com`). Immagini remote arbitrarie di terze parti restano **intenzionalmente bloccate** per privacy e sicurezza: `img-src` **non** viene ampliato a `https:` o `*` senza una decisione futura esplicita.
- `font-src 'self' data:` — font locali ed eventuali font embedded via `data:` nel CSS.
- `connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://firebasestorage.googleapis.com https://storage.googleapis.com https://*.cloudfunctions.net` — `'self'` copre il gateway same-origin `/api/repository/**`; `identitytoolkit`+`securetoken` = Firebase Auth (login e refresh token); `firestore.googleapis.com` = Firestore (WebChannel su HTTPS, nessun `wss` necessario); `firebasestorage`+`storage.googleapis.com` = download/upload Storage e relativi redirect; `*.cloudfunctions.net` = callable Firebase `aiCorrectionPreview`/`aiCorrectionRun` del modulo M5.
- `frame-src https://*.firebaseapp.com https://accounts.google.com` — iframe/handler di Firebase Auth (`*.firebaseapp.com`) e superficie di scelta account/consenso Google usata da `signInWithPopup`.

**Cache** (`hosting.headers`, l'ultima regola che matcha vince): shell SPA (`index.html`, servito su ogni route) → `Cache-Control: no-cache` (rivalidazione obbligatoria, niente SPA vecchia bloccata dopo un deploy); `/assets/**` (bundle Vite con hash) → `public, max-age=31536000, immutable`. Il gateway `/api/repository/**` ha un **blocco dedicato** `Cache-Control: no-store` a livello Hosting: contenendo operazioni autenticate e dati sensibili, non si dipende dall'interazione tra il `no-cache` globale di Hosting e il `no-store` restituito dalla Cloud Function — Hosting stesso impone `no-store`.

> **Stato:** **RESOLVED (15/07/2026).** Deployato su `schoolforge-dev` (PR #179/#180/#181) e verificato: header/cache via HTTP reale (shell `no-cache` + CSP enforced + `nosniff` + `X-Frame-Options: DENY` + COOP `same-origin-allow-popups`; `/assets/*` `immutable`; `/api/repository/*` `no-store`) e flussi applicativi (login Google docente/studente, lezioni, salvataggio Didattica, gateway, download PDF/CSV/ZIP, verifica online con Fullscreen) confermati manualmente dal docente su DEV — checklist `evidenze/hard-01b-dev-smoke.md` (12/12 PASS). COOP è impostato su `same-origin-allow-popups`, compatibile con `signInWithPopup`; COEP/CORP non sono introdotti. I warning COOP di Chrome sul polling `window.closed` della popup Auth sono rumore browser noto, non violazioni CSP né finding aperti.

---

## 8. IA — Modulo 5 (correzione assistita; **M5-05C implementato, provider reale disabilitato**)

Contratto completo e mitigazioni in [m5-ai-assisted-roadmap.md](m5-ai-assisted-roadmap.md) (§11). **Stato M5-01+M5-02:** le due Function `onCall` `aiCorrectionPreview`/`aiCorrectionRun` implementano il motore in **modalità mock deterministica** — autorizzazione owner-only, feature flag `disabled|mock` (default `disabled`, solo server-side), validazione input rigorosa (solo ID), rilettura server-side di verifica/snapshot/submission (mai testi dal client), scoring chiuse deterministico, aperte via `MockAiGrader` con validazione output, scritture atomiche M4 via Admin SDK (mai sovrascrittura), idempotenza `aiCorrectionRuns` (solo metadata). **Stato M5-03:** UI batch client-only (`apps/web`) che consuma solo le callable mock — il client costruisce il **payload chiuso** (`buildRequest`: solo `verificationId`/`submissionIds`/`requestId`, mai testi/risposte/soluzioni/nomi/email), non legge mai direttamente `aiCorrectionRuns`, «Valutate» arriva da una singola lettura mirata owner-only delle `corrections` (nessuna Rule modificata, nessun listener/polling), errori mostrati senza dettagli sensibili. **Stato M5-04:** azioni massive Completa/Riapri/Restituisci client-only che **riusano** i service M4 (`completeCorrection`/`reopenCorrection`/`returnCorrection`) — nessuna nuova Cloud Function, **nessuna modifica alle Security Rules** (le scritture passano dalle Rules M4 già esistenti), nessuna modifica alle `evaluations`, nessuna restituzione automatica; eleggibilità calcolata sulla stessa lettura owner-only, concorrenza limitata a 3, un errore per-riga non blocca le altre. **Zero token reali, costo 0, nessuna chiamata esterna.** Sintesi degli invarianti di sicurezza (già applicati; provider reale/Secret/budget = M5-05):

**M5-05C (stato storico):** adapter OpenAI e harness sintetico furono introdotti con provider disabilitato. L’attivazione controllata e Gate G7 sono stati completati nei pacchetti successivi.

**M5-05D1 (stato storico).** Ha introdotto l’ordine fail-closed **auth/owner → config → kill switch → limiti → secret/grader → lease**, la fonte unica del modello e i ceiling DEV. I pacchetti successivi hanno collegato costi, attivato il provider e chiuso G7 senza indebolire questi guardrail.

**M5-05D2A** elimina dai nuovi `aiCorrectionRuns` tutti gli identificativi linkabili e i contenuti. Il contratto v2 persiste soltanto versione, stato, SHA-256 dell'insieme canonico, conteggi/uso aggregati, metadata provider/config applicabili, lease, timestamp, risultati ordinali ed `expireAt`. Non salva `submissionId`, `verificationId`, UID, nomi/email, domande, risposte, soluzioni o feedback. Il replay ricostruisce gli ID esclusivamente dalla selezione corrente validata; un legacy run non versionato è rifiutato e richiede un nuovo `requestId`, senza migrazione. Retention DEV: 30 giorni. Le Rules negano ogni accesso client — owner incluso — a `aiCorrectionRuns/**`, `settings/aiConfig` e `aiBudgetLedger/**`; l'Admin SDK continua a bypassarle.

**M5-05D2B-1.** Costo e budget sono in micro-USD interi. Il ledger mensile server-only contiene soltanto aggregati e prenotazioni indicizzate dal `requestId` opaco; la macchina `reserved → pending` e la riconciliazione gated dalla lease mantengono `costActual ≤ costSettled ≤ costReservation`. I successivi ceiling per operazione/giorno/mese sono ora approvati e attivi.

**M5-05E-1** formalizza HG-M5-1/2/3/4 senza attivare il provider. Una nuova config reale accetta esclusivamente lo snapshot pinned `gpt-5.4-nano-2026-03-17` con listino `v2-2026-07-17-hg-m5`; alias e coppie arbitrarie sono rifiutati. I tre limiti monetari obbligatori sono interi positivi e possono solo restringere i ceiling server-side: 250.000 micro-USD per operazione, 1.000.000 al giorno UTC e 5.000.000 al mese UTC. Il limite per operazione usa la prenotazione conservativa comprensiva dei retry e blocca prima di lease, ledger e provider. Giornaliero e mensile sono verificati nella stessa transazione del documento `aiBudgetLedger/{YYYY-MM}`; spesa riconciliata, `reserved` valide e `pending` concorrono al limite, e ogni prenotazione conserva il `dayKey`/`monthKey` originale per la riconciliazione oltre mezzanotte. Il ledger resta server-only e privo di UID, ID applicativi o contenuti. `expireAt` è definitivamente a 30 giorni, ma senza policy TTL Firebase non avviene alcuna cancellazione automatica. Errori distinti `operation_budget_exceeded` e `daily_budget_exceeded` sono mostrati in italiano. Provider reale disabilitato: zero secret letti/creati, chiamate, costi e deploy.

**M5-QUALITY-07/M5-08.** L’allowlist runtime contiene due coppie univoche: `gpt-5.4-nano-2026-03-17`→`v2-2026-07-17-hg-m5` e `gpt-5.6-luna`→`v5-2026-07-20-luna-dev`. L'accoppiamento è fail-closed prima del secret, grader e budget; non esiste fallback automatico. Dopo benchmark e revisione docente, il rollout controllato ha abilitato Luna su DEV. Il caso malevolo benchmark ha ottenuto 0 in tutte le modalità/ripetizioni, senza eseguire istruzioni o esporre dettagli interni. **Gate G7 PASS; M5 COMPLETATO.** Nessuna ispezione manuale specifica di `aiCorrectionRuns` o `aiBudgetLedger` è dichiarata: privacy e accounting sono sostenuti dai test automatici.

**M5-05D2B-2.** L’SDK usa `maxRetries: 0`; l’unica policy è applicativa, con retry ≤ 1 e timeout ≤ 60 s dalla config validata. Solo i transitori sono ritentati; `Retry-After`, backoff/jitter e deadline sono limitati e testati. La prenotazione copre tutti i tentativi e `aiCorrectionRuns` conserva soltanto telemetria aggregata privacy-safe.

**AIGEN-01 — generazione IA di contenuti (pool/lezione).** Due callable owner-only `aiContentPreview`/`aiContentGenerate` con payload **chiuso discriminato** (`kind: pool|lesson`): il client non invia mai model ID/listino/prezzi/budget/API key/system prompt. Ordine **fail-closed** identico allo schema M5 (auth→owner→kill switch→payload→dimensioni→profilo/modello/listino→stima/limiti→run/lease→budget→provider→validazione output→persistenza→riconciliazione→finalizzazione). I run vivono in una collection **server-only** distinta `aiContentRuns/{opaqueRunId}` con `opaqueRunId = SHA-256(canonical(["ai-content/v1", ownerUid, requestId]))` (server-side, mai dal client) e chiave budget **namespaced** `SHA-256(canonical(["ai-content-budget/v1", ownerUid, requestId]))` (non collide col ledger della correzione). Il documento è **privacy-minimal**: versione, stato, `inputHash`, profilo/modello/listino, token/costi aggregati, lease, `output` strutturato, timestamp, `expireAt` (24h) — **mai** UID/email/nome/API key/testo sorgente/guidance/prompt/raw response. `opaqueRunId`/`inputHash`/budget key sono **fingerprint pseudonimi**, non anonimi. Le Rules negano ogni accesso client (owner, studente, anonimo) a `aiContentRuns/**`; solo l'Admin SDK vi accede; il replay passa solo dai callable dopo nuova autorizzazione. La validazione output rifiuta fail-closed ID/campi tecnici prodotti dal modello; il materiale lezione/pool e la guidance sono delimitati come **dati** (difese prompt-injection). Provider reale **disabilitato dal kill switch**: zero secret/chiamate/costi/deploy. La materializzazione `schoolforge-pool/v2` (con ID) è di AIGEN-02, nel web. Policy TTL da configurare al rollout (delete differita e fatturabile). **AIGEN-01-REVIEW-FIX:** switch dedicato `AI_CONTENT_MODE` (`disabled|mock|openai`, default `disabled`, indipendente da `AI_CORRECTION_MODE`) — `disabled` → `feature_disabled` **prima** di provider/secret/lease/budget/write; la **preview non ha accesso al secret** (nessun binding `OPENAI_API_KEY`, nessun provider/prenotazione/scrittura); il secret è letto **solo** da `aiContentGenerate` in mode `openai`, dopo config/limiti/lease. Provider reale cablato riusando il transport Responses API della correzione (nessun nuovo client). Budget con macchina **`reserved → pending → reconciled`**: `markPending` gated dalla lease subito prima del provider (se fallisce, provider non chiamato); crash reserved → rilascio, pending → addebito del tetto; prenotazione conservativa (`ceil(byteUTF8 payload + hard max_output_tokens) × tentativi`) distinta dalla stima UI, con `actual ≤ settled ≤ reservation`; errori/usage tipizzati (pre-invocazione = costo 0, invocazione-incerta/usage assente = settlement conservativo, mai un costo inventato). Il documento tecnico ha `expireAt`/timestamp come `Timestamp` ed è letto con un **parser fail-closed** (mai `as`): legacy/malformato/`completed` senza output → rifiutato, nessun replay di output non validato. Lease derivata dall'intera finestra timeout+retry; `executionId` via `crypto.randomUUID()`. Limiti sull'**intero** payload normalizzato e bound prudenziale del documento run (< 1 MiB). Schema Structured Output **strict discriminato** per il pool. **AIGEN-CONTEXT-01 (solo lezione).** Il payload lezione porta `difficolta` e un **indice compatto dell'UDA** (`udaContext`) con sole posizione/titolo/sottotitolo: **nessun ID tecnico** (`lessonId`/`udaId`/`filename`/`storageRef`/`publicLessonId`), nessun corpo Markdown, pool, domanda, soluzione, concetto o obiettivo delle altre lezioni, nessun dato studente. La validazione è fail-closed su presenza dei metadati obbligatori (titolo, difficoltà, ≥1 concetto, ≥1 obiettivo, titolo UDA, indice), su ordine 1-based consecutivo, coerenza di `currentLessonPosition`, cap di 60 voci / 20 KB e **rifiuto di ogni proprietà extra**; il sottotitolo resta facoltativo e non esistono valori sintetici o fallback silenziosi. L'indice è costruito **solo** dall'albero già in memoria nel workspace: nessuna nuova lettura Firestore/Storage, nessun listener, nessuna Function o documento aggiuntivo. Nel prompt della lezione i **metadati definiscono il perimetro didattico** (livello 3) e le `INDICAZIONI_DOCENTE` (livello 4) sono autorevoli **solo entro quel perimetro**: non possono spostare la lezione su un altro argomento. Titoli, sottotitoli, difficoltà, concetti, obiettivi e voci dell'indice sono trattati come **contenuto, mai come istruzioni** — un'eventuale injection al loro interno non è eseguita — e il corpo attuale resta materiale non attendibile. Il preflight client è **solo UX** (evita callable, prenotazione, provider, run e costo quando i metadati mancano): il server ripete autorevolmente ogni validazione. `difficolta` e `udaContext` entrano nell'`inputHash`, quindi cambiarli invalida la `requestId`; `aiContentRuns` continua a non conservare UID, ID tecnici, prompt grezzo o altri dati non previsti.

**CONCEPT-MAP-01 — mappa concettuale (terzo kind IA).** Payload chiuso e deliberatamente povero: `{ requestId, modelProfile: 'economy', lessonBody }`, nessuna proprietà extra (⇒ `invalid_input`). Non transitano titolo, metadati, UDA, indice, pool, indicazioni docente, ID tecnici o dati studente: la mappa può affermare soltanto ciò che è ricavabile dal corpo. Il profilo è **fisso** a `economy` e un valore diverso è rifiutato, mai degradato in silenzio. Il corpo è delimitato nel prompt come `CORPO_LEZIONE`, **dato non attendibile**: qualunque istruzione o prompt injection al suo interno non modifica contratto, schema o comportamento, e il preambolo di sicurezza della mappa non nomina blocchi che non esistono nel suo prompt. La **struttura dell'artefatto non è affidata al modello**: il provider restituisce tre campi chiusi e il server compone il Markdown canonico aggiungendo intestazioni, fence del diagramma e l'avvertenza, che è una costante e non un campo dello schema. La validazione dei tre campi è fail-closed e **senza aggiustamenti**: rifiuta heading ATX e Setext, HTML (tag reali, commenti, doctype, CDATA), fence, front matter, spazi esterni, ossatura non a elenco, sintesi puntata e righe del diagramma oltre 80 code point; il controllo HTML non è generico su `<`, così un confronto matematico non viene scambiato per markup. Il run persiste il **documento composto** (`{ conceptMapMarkdown }`, chiave unica, ≤ 32 KB UTF-8), mai i campi grezzi, e il parser fail-closed del documento tecnico accetta in replay soltanto un Markdown che sia byte per byte ciò che il compositore avrebbe prodotto — restituendolo identico, senza ricomporlo. La difesa finale contro l'XSS resta invariata: la mappa è Markdown e attraversa la stessa pipeline sanitizzata di tutto il resto (parser controllato → DOMPurify), senza alcuna modifica alla sanificazione né alla CSP. `AI_CONCEPT_MAP_PROMPT_VERSION` è separata da quella di pool e lezione ma **non è ancora persistita nel run** e non è usata per replay o audit.

**CONCEPT-MAP-02 — persistenza e visibilità della mappa.** La mappa vive in due copie: `LessonDoc.conceptMapMarkdown` (autorevole, dentro la sottocollezione owner-only) e `PublicLessonDoc.conceptMapMarkdown` (proiezione studente). La visibilità è un **confine dati, non una condizione di interfaccia**: finché `completed !== true` il campo non deve esistere nel documento pubblico, così uno studente non può leggerlo nemmeno con un `get()` diretto su un id noto. Le Security Rules difendono l'invariante in scrittura — un `publicLessons` con `completed != true` che contenga il campo è rifiutato, e il docente non può conservarlo smarcando la lezione — e `readPublicConceptMap` lo riapplica in lettura per difesa in profondità, restituendo `null` anche se un documento malformato lo contenesse. Salvataggio e cambio svolta/non svolta sono **transazioni** e non batch: entrambe leggono la mappa privata prima di decidere, quindi una race non può lasciare una proiezione non svolta con la mappa né una svolta senza. Fail-closed su documento mancante, `ownerUid` diverso, `importId` o `programId` incoerenti e mappa privata presente ma malformata. L'identità della coppia è **dimostrata**, non assunta: owner, import e corso da soli non distinguono due lezioni dello stesso corso e import, quindi l'indirizzo della proiezione è derivato dal `LessonDoc` e quello ricevuto dal chiamante è solo confrontato — letture sequenziali, rifiuto prima della seconda lettura, e confronto dei campi identitari stabili `udaDir`/`path`/`filename` perché l'indirizzo giusto non basta se il documento che ci sta è un altro; il testo non è mai normalizzato. **Confine dichiarato delle Rules:** verificano tipo, non-vuotezza, l'invariante su `completed` e un tetto di 32.000 **caratteri** — `size()` non conta i byte UTF-8, quindi il bound è più debole di quello applicativo da 32.000 byte; la validazione dimensionale autorevole e quella della struttura canonica restano applicative. Nessun indice, nessun documento nuovo, nessun accesso a Storage.

**CONCEPT-MAP-03 — interfaccia.** L'interfaccia **non introduce alcuna superficie di sicurezza nuova**: nessuna Function, nessun endpoint, nessuna Rule, nessuna dipendenza, nessuna modifica alla CSP né alla sanificazione. La mappa è resa dalla stessa pipeline sanificata di tutto il resto (Markdown → parser controllato → DOMPurify → render), sia nell'anteprima del docente sia nel portale studente: un Markdown ostile arrivato dal modello o incollato a mano non ha un percorso privilegiato. Il payload verso il provider resta il più povero possibile — quattro campi, corpo della lezione e nulla d'altro — e il client non lo arricchisce: profilo, listino, modello, metadati, indicazioni docente e ID tecnici non transitano. **La visibilità studente non è delegata all'interfaccia:** la vista non decide nulla, rende soltanto ciò che la proiezione contiene, e il controllo è positivo (stringa non vuota) invece di `!== null`, perché un documento privo del campo darebbe `undefined !== null` e passerebbe — il confine dati di CONCEPT-MAP-02 resta l'unica garanzia, e questa è difesa in profondità sopra di esso. Nessun placeholder rivela allo studente l'esistenza di una mappa che non può leggere. Lato docente la scrittura è **esclusivamente** esplicita: nessun autosave, guardia sincrona contro il doppio invio, e nessuna callable invocata all'apertura, così nessun gesto involontario produce spesa o scrittura. La validazione del risultato IA lato client riusa il **contratto autorevole** della persistenza (`isValidConceptMap`): stesso tipo, stessa non-vuotezza e stesso cap di 32.000 **byte UTF-8**, mai riscritto. Un cap duplicato sarebbe finito in caratteri, e i caratteri non sono byte: una mappa fitta di accenti o di caratteri di disegno del diagramma sarebbe passata dal client per essere poi rifiutata dal salvataggio, con il testo precedente ormai perso. Il rifiuto è fail-closed e non tocca il draft corrente. Rimosso `lessonPdf.ts` (codice morto, nessun import): meno codice non raggiungibile da mantenere in perimetro.

**CONCEPT-MAP-04 — la mappa come scheda.** Spostare la mappa dal menu «Azioni» a una scheda della lezione **non sposta alcun confine di sicurezza**: nessuna Function, callable, Rule, dipendenza, modifica alla CSP o alla sanificazione, e nessuna nuova lettura. Entrambe le schede rendono Markdown attraverso la stessa pipeline sanificata (parser controllato → DOMPurify), quindi una mappa ostile non guadagna alcun percorso privilegiato dal fatto di avere un pannello proprio. **La visibilità studente resta un confine dati.** La scheda compare se e solo se `readPublicConceptMap` ha restituito una stringa non vuota dalla proiezione: la condizione non è `completed`, perché legarla al flag sostituirebbe il confine dati di CONCEPT-MAP-02 con un confine di rendering, e un documento pubblico che contenesse comunque il campo resterebbe leggibile con un `get()` diretto. Quando la mappa non è proiettata la tablist **non esiste affatto**: nessuna scheda disabilitata e nessun placeholder rivelano allo studente l'esistenza di una mappa privata. Lato docente la scrittura resta esclusivamente esplicita — nessun autosave, guardia sincrona contro il doppio invio, nessuna callable alla selezione della scheda — così nessun gesto involontario produce spesa o scrittura. Rimosso `ConceptMapDialog` (senza chiamanti): meno codice non raggiungibile in perimetro.

**CONCEPT-MAP-05 — quality-only e artefatto v2.** Il vincolo di profilo è applicato **due volte e in modo asimmetrico**: il client non espone `modelProfile` nella firma di `buildConceptMapRequest` — quindi nessun percorso dell'interfaccia può costruire una richiesta Economy — e il server la rifiuta comunque `invalid_input` nella validazione del payload, che precede secret, provider, stima, prenotazione, lease, run e qualunque scrittura. La difesa che conta è la seconda: un client è codice che gira sulla macchina di qualcun altro, e un payload arbitrario resta sempre possibile. Il rifiuto non è una degradazione silenziosa a quality — sarebbe una spesa non richiesta — ma un errore. Pool e lezione non sono toccati: il vincolo vive nel ramo `concept_map` della validazione, non nel parser condiviso del profilo, così gli altri due kind non perdono metà del proprio contratto per un effetto collaterale. Lo Structured Output passa a **due** campi e `outlineMarkdown` è rifiutato come qualunque proprietà extra: la superficie che il modello può riempire si restringe, non si allarga. La struttura resta decisa dal server — intestazioni, fence e avvertenza sono costanti — e la validazione resta fail-closed e senza aggiustamenti. **Compatibilità senza indebolimento:** il parser del documento persistito riconosce anche la forma v1 già salvata, ma la tolleranza è esclusivamente sulla *forma canonica*, non sui vincoli: una v1 con ossatura in prosa, sintesi numerata, diagramma troppo largo o avvertenza alterata è rifiutata esattamente come una v2 malformata, e il documento è restituito byte per byte senza conversioni. La pipeline di sanificazione, la CSP e il contratto di visibilità studente (CONCEPT-MAP-02) non cambiano.

**CONCEPT-MAP-06 — profilo esplicito dentro una sessione modale.** Questa fase
sostituisce esclusivamente la decisione quality-only della fase precedente:
il server accetta i soli valori chiusi `economy|quality`, senza fallback, e il
client li rende entrambi visibili a ogni nuova generazione con Quality
preselezionato. Il profilo non è memorizzato nell'editor né riutilizzato in modo
invisibile fra sessioni. Cambiare configurazione invalida stima e `requestId`;
preview e generate ricevono lo stesso payload. Il risultato resta isolato nella
review e non tocca il draft corrente prima di «Usa questa bozza»; nessuna
scrittura avviene prima di «Salva mappa». Non cambiano secret, provider,
prenotazione, validazione output, sanificazione, Rules o visibilità studente.

**POOL-ROLLOUT-01 — Quality obbligatorio per i pool.** Il profilo inviato dal
client non è una fonte autorevole: il builder ufficiale rende Economy
irrappresentabile, ma il confine di sicurezza è la validazione server del ramo
`kind:'pool'`. Un payload Economy viene rifiutato `invalid_input` prima di
configurazione runtime, secret, costruzione del provider/porte, stima, budget,
lease, run e qualunque scrittura. Il server non sostituisce mai Economy con
Quality: un fallback silenzioso trasformerebbe una richiesta meno costosa in
una spesa maggiore non confermata. Il vincolo non è nel parser condiviso del
profilo, quindi lezioni, mappe concettuali e correzione IA mantengono i propri
contratti. Nessuna nuova Rule, collection, chiave, dipendenza o superficie di
rete.

- **Feature flag** globale `disabled|mock|openai` risolto da `AI_CORRECTION_MODE`, default sicuro `disabled`; sul percorso `openai`, kill switch e modello arrivano dalla config runtime validata, senza fallback. Provider/modello definitivi = Human Gate aperto.
- **Gateway server-side owner-only:** verifica dell'uid dal token Firebase e confronto con `settings/owner` (stesso pattern del `repositoryGateway`) — **implementato in M5-01**.
- **Autorizzazione per ID, mai per testo:** il client invia solo ID (`verificationId`, `submissionIds`, `requestId`); il server rilegge submission, snapshot e soluzioni via Admin SDK. Il client non può iniettare testi arbitrari come parte della verifica.
- **Contesto IA chiuso:** solo domanda snapshot, soluzione/criterio, `maxPoints` e risposta studente; nessun dato personale (nome/email) inviato al provider.
- **Contenuto studente = non attendibile e potenzialmente ostile:** trattato come dato con delimitatori, mai come istruzione. **Vietati** browsing web, retrieval, tool esterni, code execution; l'IA non attiva verifiche, non invia email, non cancella dati, non completa/restituisce correzioni.
- **Validazione output server-side:** schema rigido + punteggi `0..maxPoints` multipli di 0,25 (regole di `correctionContract.ts`); output non valido scartato senza corrompere la correzione; idempotenza via `requestId`.
- **Chiave API:** il binding `OPENAI_API_KEY` è associato soltanto ad `aiCorrectionRun`. La chiave non è mai letta da client, Firestore o file versionati e non è mai stampata. Prompt/output grezzi non entrano in Firestore o log.
- **Trasporto OpenAI:** Responses API senza tool, web, retrieval o file; Structured Outputs strict più validazione applicativa; timeout 60 s per tentativo; retry SDK disattivati e massimo un retry applicativo per errori transitori. Test e harness usano transport/grader fake senza rete.
- **La correzione automatica** (C-03, Gate G8) resta **fuori** dalla linea M5-00→M5-05.

---

## 8b. Varianti equivalenti (VEX — VEX-01A e VEX-01B implementati)

**Assegnazione server-side e isolamento (VEX-01B).** La guardia fail-closed di VEX-01A è
**rimossa**: `equivalent_variants` è ora attivabile. Le garanzie di sicurezza:

- **Attivazione:** `activateVerification` costruisce lo snapshot VEX (owner-only, immutabile)
  con tutte le alternative + soluzioni, ma la `publishedProjection` (student-readable) contiene
  **solo le domande comuni** — nessuna alternativa né soluzione è mai leggibile dalla proiezione.
- **Callable `assignVerificationVariant`** (Admin SDK): unico produttore dell'assegnazione.
  Autorizzazione fail-closed (auth, studente approvato dello stesso owner, classe, `active` +
  `onlineEnabled`, modalità corretta, snapshot valido). Restituisce **solo** le domande
  assegnate sanitizzate — mai soluzioni, alternative non assegnate, `teacherSnapshot` o gruppi.
- **`assignedQuestionOrders` è SERVER-ONLY:** le Firestore Rules negano allo studente di
  crearlo, modificarlo o rimuoverlo; gli altri studenti non lo leggono; un autosave normale lo
  lascia immutato (test emulator dedicati). Lo scrive **una sola volta** la callable, in
  transazione idempotente; un valore persistito invalido è **fail-closed** (nessuna
  rigenerazione silenziosa). RNG crittograficamente sicuro (`node:crypto`), scelta uniforme,
  nessun bilanciamento globale, ripetizioni ammesse.
- Lo studente legge **il proprio** `assignedQuestionOrders` (soli `order`, non contenuti): è la
  sua assegnazione, non espone le alternative altrui.

**Svolgimento studente (VEX-02A).**

- Il portale instrada `equivalent_variants` **solo** sulla callable: `OnlineExamView` riceve
  esclusivamente le domande assegnate (sanitizzate, senza soluzioni). La proiezione pubblica non
  contiene le alternative; il browser non le legge mai. La risposta della callable è validata
  fail-closed lato client (modalità/coerenza order/assenza soluzioni): payload malformato o
  modalità sconosciuta **bloccano** l'avvio senza fallback.
- **Risposte ristrette alla variante:** `answers`/`flagged` possono contenere **solo** order
  assegnati. Enforcement doppio: filtro client fail-closed (difesa applicativa, non sufficiente)
  **e** Firestore Rules. Le Rules non sanno convertire numeri→stringa né iterare, quindi la
  callable scrive `assignedAnswerKeys` (mirror **string** server-only di `assignedQuestionOrders`,
  stessa singola scrittura) e le Rules impongono
  `answers.keys().hasOnly(assignedAnswerKeys) && flagged.keys().hasOnly(assignedAnswerKeys)`. Lo
  studente non può creare/modificare/rimuovere `assignedQuestionOrders`/`assignedAnswerKeys`, né
  trasformare una submission VEX in `same_questions`, né alterare i campi identitari; altri
  studenti non leggono/scrivono la submission. `same_questions` resta interamente invariato.
- **PDF studente disabilitato/nascosto** in `equivalent_variants`: nessun modo client-side di
  ottenere il PDF completo (esporrebbe/ometterebbe le domande in modo incoerente con la variante).

**Correzione/IA/restituzione/export (VEX-02B).** Ogni flusso post-consegna usa il risolutore
canonico `resolveAssignedQuestions` (fail-closed) come unica fonte di verità sulle domande
applicabili:

- la correzione manuale costruisce lo scheletro delle `evaluations` sulla **sola variante**
  (dal teacherSnapshot owner-only, non dalla proiezione comune-only); un'evaluation con order
  estraneo blocca il caricamento; totali/percentuale/`maxPoints` sulla variante;
- la correzione **IA** riceve esclusivamente le domande aperte assegnate (mai testi/soluzioni/
  metadati di alternative non assegnate); una variante malformata esclude la consegna
  (`invalid_variant`) **prima** del grader e della prenotazione budget (le altre proseguono);
- la `CorrectionReturnDoc` (student-readable) contiene **solo** domande/risposte/evaluation
  assegnate e, se abilitate, solo le relative soluzioni — mai `commonQuestionOrders`,
  `equivalentGroups`, `alternativeOrders`, alternative non assegnate o il teacherSnapshot;
- gli export riferiti a una consegna (registro PDF/CSV) usano i totali della variante; il **PDF
  docente** della verifica resta completo (insieme docente), il **PDF studente** resta disabilitato
  in VEX. Le Rules restano invariate (`correctionReturns` è già letto solo dallo studente
  proprietario quando visibile); la proiezione è costruita e validata dal service client del
  docente owner e la scrittura resta soggetta alle Rules. Dopo l'eliminazione di una submission un nuovo svolgimento riceve una
  **nuova** assegnazione server-side.

Il rollout VEX-03A su `schoolforge-dev` è completato: baseline server/Rules SHA
`1399faeb1539b1adf1fd9d0ead1bb485ca5d9d53`, Hosting finale VEX-02C SHA
`adba8e3208c33ece05fbc928f598e0197c4ba94b`. Smoke multi-studente, isolamento delle
alternative, correzione e restituzione sono stati confermati dal docente: **Gate GVEX PASS**.
Evidenze in `evidenze/gvex-human-gate.md`.

Requisiti di sicurezza congelati per `equivalent_variants` (dettaglio in
[`vex-contract.md`](vex-contract.md) §4–5):

- lo studente **non** deve ricevere né poter leggere alternative **non assegnate**; la
  `publishedProjection` **non** contiene tutte le alternative leggibili dallo studente;
- le domande assegnate arrivano **solo** da una callable owner/student-auth che verifica
  approvazione/classe/`active+public+online`, legge il `teacherSnapshot` congelato, crea o
  recupera **atomicamente** l'assegnazione e restituisce solo le domande assegnate **senza
  soluzioni**;
- primo avvio concorrente ⇒ **una sola** assegnazione definitiva (transazione),
  retry/reload idempotenti; unica scrittura aggiuntiva `assignedQuestionOrders`; nessuna
  nuova scrittura ai riaccessi;
- nessun listener/polling/scheduler, nessun documento per domanda, nessuna copia del pool;
  `same_questions` resta client-side e non paga la callable;
- **PDF studente disabilitato/nascosto** in `equivalent_variants` (un PDF dalla proiezione
  completa esporrebbe le alternative); il **PDF docente** continua a usare l'insieme
  completo configurato;
- correzione manuale/IA e restituzione operano **solo** sugli order assegnati
  (`assignedQuestionOrders`); `correctionReturns` contiene solo le domande assegnate; i
  gruppi equivalenti garantiscono lo stesso `maxPoints`, quindi totali/percentuali
  coerenti tra varianti.

---

## 8e. Etichette operative del docente (VDIF-01 — implementato)

Le **etichette differenziate** sono strumenti operativi **privati del docente**:
servono al sistema per sapere *quale versione servire*, mai *perché*. Il
contratto completo è in
[`verifiche-differenziate-roadmap.md`](verifiche-differenziate-roadmap.md);
qui il perimetro di sicurezza effettivamente in vigore.

**Due collezioni, entrambe owner-only in ogni direzione:**

- `differentiationLabels/{labelId}` — contratto **chiuso a otto chiavi**
  (`labelId`, `ownerUid`, `name`, `nameKey`, `assignedCount`,
  `draftUsageCount`, `createdAt`, `updatedAt`). Nessun campo `color`, `note`,
  `description` o `category`: ognuno sarebbe l'appiglio per scrivere una
  motivazione, ed è ciò che il principio «nessun dato sanitario o certificativo
  nel database» vieta. SchoolForge **non** classifica il significato del nome;
  `nameKey` esiste solo per l'unicità;
- `differentiationLabelNames/{reservationId}` — prenotazione del nome, contratto
  chiuso a quattro chiavi, `update` **sempre negato**: una prenotazione si crea
  e si rilascia, non si muta. `reservationId = hex(SHA-256(UTF8(ownerUid +
  U+0000 + nameKey)))`: il nome **non compare in chiaro nel path**, perché un
  path finisce in log, messaggi di errore e tracce di rete.

**Lo studente è sempre negato**, in lettura, `list` e scrittura, su entrambe le
collezioni; l'anonimo pure. Nessun campo di questi documenti — nomi e contatori
inclusi — raggiunge una superficie leggibile dallo studente: non esiste alcuna
proiezione, alcun mirror e alcun percorso student-readable che li tocchi.

**Che cosa garantiscono le Rules:** ownership, forma chiusa, tipi,
`labelId == document id`, `ownerUid == auth.uid`, immutabilità di
`labelId`/`ownerUid`/`createdAt`, contatori interi `>= 0`, creazione ammessa
**solo** con entrambi a `0`, movimento di **una sola unità** per scrittura,
`createdAt`/`updatedAt == request.time`. Il `list` è autorizzato solo se la
query filtra davvero su `ownerUid`.

**Confine Rules/service, dichiarato.** CEL non calcola SHA-256, non normalizza
Unicode e non conta code point o byte UTF-8: le Rules **non** verificano che
`reservationId` sia l'hash della coppia, che `nameKey` derivi da `name`, né i
limiti esatti di 40 code point / 120 byte. Quelle garanzie sono del **service
owner-only**, che le applica prima di ogni scrittura ed è fail-closed su ogni
documento incoerente — stesso confine già in vigore per
`teacherSnapshot`/`evaluations` (§3): l'unico principal che può scrivere è
l'owner, lo stesso già fidato per ogni altro percorso owner-only.

**Unicità e atomicità.** Creazione, rinomina ed eliminazione sono **una sola
transazione ciascuna**, comprensiva dell'evento di audit: due tentativi
concorrenti sullo stesso nome puntano allo stesso documento di prenotazione e
uno solo committa. L'audit (`label.created`/`updated`/`deleted`) porta
`targetId == labelId` e **`reason` sempre `null`**: il registro è owner-only, ma
il nome dell'etichetta è testo libero e non ha motivo di transitare nei log.

**Eliminazione fail-closed, su due livelli.** Il service richiede
`assignedCount === 0` **e** `draftUsageCount === 0`, riletti **dentro** la
transazione che elimina, più una prenotazione coerente. Le **Rules** applicano
la stessa condizione sui contatori come difesa in profondità: un'etichetta in
uso non è eliminabile nemmeno da una scrittura diretta che aggirasse il service.
VDIF-01 non muove ancora i contatori (lo faranno VDIF-02 e VDIF-03/04) ma li
difende già: nessuna cascata, nessuna riparazione silenziosa.

**Lettura fail-closed sulla canonicità.** Il parser rifiuta un documento il cui
`name` non sia già la forma canonica o il cui `nameKey` non sia derivato dal
nome, oltre a timestamp mancanti o incoerenti. Non è pedanteria: la prenotazione
è indirizzata dall'hash di `(ownerUid, nameKey)`, quindi un `nameKey` estraneo
avrebbe la propria prenotazione altrove e l'unicità del nome smetterebbe di
essere garantita. Il documento viene rifiutato, mai corretto in lettura.

---

## 8c. Chiusura e consegna forzata dal docente (FORCE-SUBMIT-01 — implementato)

Il docente può acquisire e chiudere una verifica online che lo studente ha **iniziato ma non
consegnato**. La transizione `draft → submitted` è **server-side e transazionale** (callable
`forceSubmitSubmission`, Admin SDK): non esiste alcun percorso client per ottenerla.

- **Autorizzazione fail-closed**, nell'ordine: autenticazione → verifica esistente →
  `verification.ownerUid == auth.uid` → submission esistente → coerenza dei campi identitari
  (`submissionId` deterministico, `verificationId`, `studentUid`, `ownerUid`). Ogni incoerenza è
  un errore: nessun documento inatteso viene mai «riparato».
- **Input chiuso** `{ verificationId, studentUid }`. Il client non può proporre `ownerUid`,
  `submissionId`, `answers`, `deliveryCode`, `status`, timestamp né `forcedByTeacher`: qualunque
  chiave extra è rifiutata prima di ogni lettura. L'id della consegna è **sempre** ricalcolato
  server-side come `${verificationId}_${studentUid}`, e il codice consegna è generato server-side
  (`SF-YYYY-XXXX`, RNG `node:crypto`).
- **Nessuna consegna viene mai creata.** Se lo studente non ha iniziato, non esiste alcuna
  submission e l'operazione fallisce con `not-found`: non si materializza mai una consegna vuota a
  nome di uno studente che non ha svolto la verifica.
- **`forcedByTeacher` è server-only** ed è il letterale `true`, **assente** (mai `false`) sulle
  consegne normali. Le Rules non sono state modificate: i key-set chiusi già in vigore lo rendono
  impossibile da scrivere per il client — `submissions` create/update e `submissionReceipts` create
  usano `keys().hasOnly([...])`/`diff().affectedKeys().hasOnly([...])` che non includono il campo,
  quindi ogni tentativo dello studente (con `true`, `false` o qualunque valore) è negato. Solo
  l'Admin SDK, che bypassa le Rules, può scriverlo. Test emulator dedicati
  (`force-submit-01-forced-close.rules.test.ts`) lo dimostrano, insieme al fatto che dopo la
  chiusura lo studente non può più modificare né leggere la submission, che un altro studente non
  legge la ricevuta, che lo studente proprietario legge la propria ricevuta forzata, che non esiste
  accesso anonimo e che la consegna normale non regredisce.
- **Ciò che non viene toccato.** La chiusura congela l'**ultima versione già salvata**:
  `answers`, `flagged`, `attentionEvents`, `assignedQuestionOrders`, `assignedAnswerKeys` e
  `startedAt` restano invariati, e **`lastSavedAt` non viene mai riscritto** — sovrascriverlo
  cancellerebbe l'unica traccia di quanto fosse vecchia la versione acquisita. Il testo che lo
  studente non ha mai autosalvato **non è recuperabile**, e l'interfaccia lo dichiara nella
  conferma.
- **Coerenza richiesta anche per non fare nulla.** Confermare un esito senza scritture non è
  gratis dal punto di vista della sicurezza: sia il replay di una chiusura forzata sia una consegna
  normale già avvenuta richiedono una ricevuta esistente e **completamente coerente** con la
  submission (identità, `deliveryCode`, `submittedAt` confrontato in modo deterministico,
  `verificationTitle`, `className`) e un marcatore coerente su **entrambi** i documenti —
  `true` per la chiusura forzata, completamente assente per la consegna normale. Qualunque
  divergenza è `failed_precondition` con zero scritture: non si conferma mai come riuscito uno
  stato che non lo è. Analogamente una submission ancora `draft` **non può** avere una ricevuta:
  se esiste, l'operazione fallisce chiuso invece di sovrascriverla.
- **Metadati validati prima di scrivere.** Titolo verifica (stringa canonica non vuota),
  `className` (stringa canonica **oppure** `null`) e campi identitari sono validati fail-closed
  prima di comporre le due scritture. La callable non inventa e non normalizza mai un metadato
  mancante o malformato.
- **Id validati sui byte.** Il limite Firestore sugli id documento è espresso in **byte UTF-8**:
  gli id in ingresso e l'id concatenato `${verificationId}_${studentUid}` sono verificati sulla
  dimensione reale in byte (≤ 1500) e sulle forme riservate **prima** di costruire qualunque
  `DocumentReference`.
- **Concorrenza.** Verifica, submission e ricevuta sono lette **dentro** la transazione: un
  autosave o una consegna dello studente in corso fanno ripartire la transazione con dati freschi.
  Una consegna normale avvenuta nel frattempo non viene **mai** sovrascritta (`already_submitted`,
  zero scritture). Un replay di una chiusura già completata è idempotente (zero scritture, nessun
  nuovo codice) e richiede una ricevuta esistente e coerente, altrimenti è fail-closed.
- **Trasparenza verso lo studente.** La ricevuta porta lo stesso marcatore, e la schermata di
  conferma dice esplicitamente «Consegna acquisita dal docente»: lo studente non viene mai indotto
  a credere di aver consegnato lui. Se una scrittura dello studente viene respinta perché la
  consegna è stata chiusa, il portale esegue **una sola** lettura puntuale della ricevuta (nessun
  listener, nessun polling) e chiude la sessione mostrando la conferma reale.
- **Risposta sanitizzata:** `{ status: 'submitted' | 'already_submitted' }` — nessun uid, nessun
  contenuto, nessun codice consegna. I log non contengono id, uid o contenuti.

---

## 8d. Chiusura multipla con preavviso (FORCE-SUBMIT-02 — implementato)

La chiusura forzata è ora **solo** massiva e **solo** con 60 secondi di preavviso. La callable per
singola consegna di FORCE-SUBMIT-01 è stata **rimossa**: lasciarla avrebbe significato mantenere una
via per chiudere una verifica senza il preavviso promesso allo studente. Il suo core transazionale
resta e viene riusato dalla task.

- **Due momenti, due Function.** `scheduleForceCloseSubmissions` (callable owner-only) programma;
  `runScheduledForceClose` (task queue Cloud Tasks, `scheduleTime` a +60 s) esegue. Nessuna Function
  resta in attesa per un minuto, nessun `setTimeout` del browser partecipa alla decisione: la
  chiusura avviene anche se docente e studente chiudono tutto.
- **Input chiuso e limitato.** `{ verificationId, studentUids[] }`, uid unici, cap esplicito di 60
  (una classe abbondante), id validati come document ID Firestore sui **byte UTF-8** — compreso
  l'id consegna concatenato — prima di costruire qualunque riferimento. Il client non propone
  `ownerUid`, `requestId`, scadenza, durata del preavviso né stato.
- **Nessuna consegna viene mai creata.** Uno studente che non ha iniziato produce `not_started`:
  zero scritture, zero task, nessun documento materializzato a suo nome.
- **Programmare non consegna.** L'unica scrittura della programmazione sono tre marcatori
  server-only. Stato, `answers`, `flagged`, `attentionEvents` e `lastSavedAt` restano intatti: fino
  alla scadenza lo studente può ancora salvare **e consegnare normalmente**.
- **I marcatori sono server-only ma leggibili dall'interessato.** Le Rules non sono state
  modificate: i key-set chiusi già in vigore non li includono, quindi né lo studente né il docente
  possono crearli, modificarli o rimuoverli con una scrittura diretta — mentre `allow get` sulla
  propria bozza li rende leggibili proprio allo studente che ne è oggetto. È questa combinazione a
  permettere il banner con **un solo** listener su **un solo** documento, senza query, senza
  polling e senza alcuna collezione o indice aggiuntivo.
  `force-submit-02-scheduled-close.rules.test.ts` lo dimostra: lo studente legge la propria
  richiesta; un altro studente e un client anonimo no; il client non può crearla, alterarne la
  scadenza, cambiarne il `requestId` né rimuoverla per sottrarsi alla chiusura (nemmeno dentro il
  batch della consegna normale); il salvataggio durante il preavviso è ammesso e **conserva** i
  marcatori; dopo la chiusura ogni scrittura è negata.
- **Idempotenza e concorrenza.** Una riga già programmata risponde `already_scheduled` senza una
  seconda task: doppio click e retry sono innocui. La task agisce solo se ritrova esattamente la
  propria richiesta: consegna normale avvenuta nel frattempo, riprogrammazione con un altro
  `requestId`, programmazione rimossa, consegna eliminata, verifica passata ad altri, consegna
  doppia o tardiva della task ⇒ **no-op sicuro con zero scritture**, mai un errore ritentabile su
  uno stato già corretto. Una consegna normale non viene **mai** trasformata in `forcedByTeacher`.
- **Compensazione e limiti dichiarati.** Firestore e Cloud Tasks **non** condividono una
  transazione, e nessun disegno può renderle atomiche. La scrittura dei marcatori viene **prima**
  (così non può esistere una task senza il marcatore che la rende riconoscibile); il nome della task
  è derivato dal `requestId`, quindi un retry dell'accodamento non crea duplicati; se l'accodamento
  fallisce — dopo **tentativi limitati**, tutti con lo stesso nome task deterministico — si esegue
  una **compensazione transazionale condizionata allo stesso `requestId`**, a sua volta con
  tentativi limitati, che non tocca mai una programmazione diversa. Se anche la compensazione
  fallisce l'esito è `failed_cleanup`: esplicito, mai un successo apparente, e **recuperabile
  dall'applicazione** — ripetere «Chiudi consegne» sulle stesse righe riaccoda la task già
  persistita con lo stesso `requestId` e la **stessa scadenza**, senza aprire una nuova finestra e
  senza riscrivere nulla. Procedura operativa in [`runbook-operativo-v1.md`](runbook-operativo-v1.md) §9b.
- **Nessuno studente resta bloccato.** Ogni via terminale della task porta a uno di quattro esiti:
  consegna forzata con ricevuta; consegna normale già effettuata **con rimozione dei marcatori**;
  programmazione non più valida **con rimozione dei marcatori**; oppure errore permanente sui
  metadati, che rimuove comunque i marcatori. La combinazione «scadenza superata + marcatori
  presenti + nessuna ricevuta» è vietata ed è verificata da un test dedicato su tutti gli scenari.
  Gli errori infrastrutturali temporanei sono propagati perché Cloud Tasks ritenti; quelli
  permanenti non vengono inghiottiti lasciando il documento bloccato.
- **Sessanta secondi per ciascuno.** `forceCloseRequestedAt` e `forceCloseDeadline` sono calcolati
  **per singolo studente**, dallo stesso istante letto dall'orologio della Function e scritti come
  `Timestamp` espliciti: anche l'ultimo di un batch da 60 riceve il preavviso pieno. La relazione
  `deadline − requestedAt === 60 s` è parte del contratto ed è verificata fail-closed ovunque sia
  autorevole — server, task e client: una coppia che non la rispetta non è una programmazione valida
  e non produce alcun banner.
- **Mai una chiusura anticipata.** Il payload della task porta anche la scadenza canonica: se la
  coda consegna prima del tempo la task **rilancia** invece di chiudere, e viene ritentata.
- **Trasparenza.** Il banner dichiara la richiesta e il tempo residuo, il countdown è **ricalcolato
  dalla scadenza server-side** a ogni tick (un contatore che decrementa prometterebbe più tempo del
  reale dopo una scheda sospesa), e alla scadenza i controlli si bloccano subito. La ricevuta resta
  quella di FORCE-SUBMIT-01, con «Consegna acquisita dal docente».

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
| G6 (M4, M4-00→M4-04 completati — **Gate G6 superato**) | Correzione, audit, eliminazione ed export solo docente; export non persistito; richiede G5 (M3-full, superato). Contratto, service/Rules, workspace docente, lettura studente, ciclo di vita, Registro Correzioni ed export **CSV e PDF** sono implementati; export **Markdown rinviato** per assenza di caso d'uso. Evidenze in `evidenze/g6-m4-checklist-finale.md`. |
| G7/G8 (V2) | C-02 risolta / C-03; AI senza web; audit completo; opt-in; rollback verificato. |
