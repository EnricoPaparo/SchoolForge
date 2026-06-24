# SchoolForge — Sicurezza e protezione dei dati

**Versione:** 2.2
**Stato:** requisiti da implementare nei pacchetti F-04 e successivi

---

## 1. Obiettivo

Proteggere Markdown, asset, dati dichiarati dagli studenti, risposte, punteggi, correzioni, audit e segreti senza trasformare il Portale in un sistema di autenticazione studente. La sicurezza del docente è garantita da Firebase Auth e Security Rules; il Portale applica accesso limitato, lock per nome+cognome e un audit trail nome+IP, ma non certifica l'identità dello studente.

---

## 2. Confini e minacce principali

| Asset | Minaccia | Controllo richiesto |
|---|---|---|
| Sezione docente | Accesso di soggetto non owner | Firebase Auth + `ownerUid` nelle Security Rules. |
| Firestore/Storage | Lettura o scrittura diretta non autorizzata | Security Rules default-deny; percorsi sensibili protetti per ruolo. |
| Verifica pubblica | Enumerazione o accesso a soluzioni | Token casuale non enumerabile; lookup `get` su hash del token, mai `list`; proiezione pubblica senza soluzioni; rate limit. |
| Tentativo digitale | Forgery o riuso del token sessione | Gateway server-side; cookie Secure/HttpOnly/SameSite verificato a ogni lettura, bozza e consegna. |
| Tentativo digitale | Doppio avvio della stessa persona dichiarata | Participant lock per verifica e nome+cognome normalizzati, creato dalla Cloud Function in transazione. |
| Import didattico | Pubblicazione parziale tra Storage e Firestore | Upload sotto `importId` isolato, poi commit transazionale del solo `activeImportId`. |
| Verifica attiva | Modifica retroattiva di fonti/regole | Snapshot pubblicato immutabile all'attivazione; per modificare si duplica la bozza. |
| Accountability accessi | Abuso del link, accessi non riconosciuti | Log nome dichiarato + IP + user-agent + timestamp; Report Accessi consultabile dal docente. |
| Markdown | XSS o asset non sicuri | Parser condiviso, sanitizzazione e whitelist rendering. |
| AI (V2) | Dati non autorizzati o prompt injection | C-02 risolta, contesto chiuso, nessun web/tool, feature flag, audit. |
| Segreti AI (V2) | Esposizione in Git/client/log | Secret Manager (solo M5/V2), accesso minimo, rotazione. |

---

## 3. Security Rules — principi

Le Security Rules Firestore e Storage sono il perimetro di sicurezza principale nei Moduli 1–4.

**Regole obbligatorie:**

- Default-deny: qualsiasi percorso non esplicitamente aperto è negato.
- `ownerUid` è verificato come `request.auth.uid == resource.data.ownerUid` o confrontato con `settings/owner.ownerUid`.
- `publicVerificationLinks/{SHA-256(token)}` consente al portale solo `get` del documento esatto: nessun `list`, nessuna configurazione privata e nessun token in chiaro nel database.
- Il client portale non legge né scrive direttamente `deliveryAttempts`, `answers`, `snapshot`, `participantLocks` o `accessLog`: tutte le operazioni digitali passano dal gateway.
- `verifications/*/publishedSnapshot` contiene le soluzioni ed è leggibile solo da owner e Function; `publishedProjection` è l'unico dato pubblico, senza soluzioni e solo quando la verifica è attiva.
- `deliveryAttempts/*/accessLog` è scritto solo dalla Cloud Function e leggibile solo dall'owner (Report Accessi).
- Il reset docente è ammesso solo in una transazione Firestore su un tentativo `in_progress`, con motivazione, invalidazione sessione, rilascio lock e audit append-only; le Rules verificano lo stato e il batch previsto. Non può riaprire una consegna.
- `corrections`, `correctionEvents` e `auditEvents` sono leggibili solo dall'owner. Gli eventi di audit sono solo append: il docente può crearli con schema/azione ammessi, ma non aggiornarli o cancellarli.

Le Security Rules esatte vengono scritte e testate in F-04 con Emulator Suite obbligatoria. Nessuna regola permissiva temporanea è ammessa con dati reali.

---

## 4. Gateway M3: `startDigitalAttempt` e `continueDigitalAttempt`

Le due Function sono il punto critico di sicurezza del Portale digitale. Sono le sole a usare Admin SDK sul percorso pubblico.

**Garanzie richieste:**

- La transazione Firestore è atomica: participant lock + tentativo + snapshot + voce `accessLog` in un'unica operazione.
- Il participant lock usa `SHA-256(nomeNormalizzato + U+001F + cognomeNormalizzato)` ed è unico per verifica; una seconda chiamata con la stessa coppia viene rifiutata con `PARTICIPANT_ALREADY_USED`.
- Lo snapshot include le soluzioni private in Firestore ma non le include nella risposta HTTP al client.
- Il token di sessione è generato server-side, consegnato come `Set-Cookie: resumeToken=...; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`.
- Solo l'hash del token di sessione è salvato in Firestore (`resumeTokenHash`); il token in chiaro non è mai persistito.
- `continueDigitalAttempt` confronta hash, scadenza e stato del tentativo prima di ogni `get`, `saveDraft` o `submitAttempt`; nessuna Security Rule tenta di autorizzare un cookie.
- `submitAttempt` rende immutabili risposte e snapshot in transazione; il reset docente revoca la sessione impostando lo stato a `cancelled` prima di rimuovere il lock.
- Vengono registrati nome dichiarato (`Cognome Nome`), IP, user-agent e timestamp in `accessLog` come audit trail.
- Rate limit applicato per IP e per token verifica.

---

## 5. PDF e documenti — nessuna persistenza

- PDF docente, PDF cartaceo studente, programma svolto (PDF/Markdown) ed export verifiche (PDF/Markdown/CSV) sono generati nel browser e non scritti su Cloud Storage o Firestore.
- Nessuna Cloud Function produce o salva PDF.
- I file temporanei del browser (blob URL) sono rilasciati immediatamente dopo il download.

### 5.1 Import e pubblicazione immutabile

- L'import non sostituisce mai l'albero attivo: Storage e indici sono preparati sotto un nuovo `importId`; finché la transazione non cambia `activeImportId`, l'app legge l'import precedente.
- Gli import incompleti non sono visibili e possono essere rimossi da lifecycle o comando docente; non costituiscono una cronologia utente.
- L'attivazione copia fonti, regole, candidati e soluzioni nel `publishedSnapshot`. Da `attiva` in poi configurazione e fonti non sono più modificabili.

---

## 6. Dati, privacy ed export

- Il Portale raccoglie solo nome, cognome, classe facoltativa e risposte. Non raccoglie email.
- All'accesso il sistema registra, a fini di audit, nome dichiarato (`Cognome Nome`), IP, user-agent e timestamp; sono dati auto-dichiarati, non verificati.
- Log e telemetria non contengono risposte, dati personali completi o punteggi non necessari.
- Il docente può eliminare una consegna: dati personali e correzioni sono rimossi; resta audit non identificativo.
- `Esporta verifiche` è disponibile solo al docente e generato on-demand nel browser.
- Firestore/Storage/Functions applicativi usano Milano `europe-west8`; Hosting/Auth non sono dichiarati Italia-only.

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
| G4 | Gateway `startDigitalAttempt`/`continueDigitalAttempt` con participant lock nome+cognome e cookie HttpOnly/Secure; nessun write Firestore dal portale; log nome+IP; soluzioni non nel response; bozza/consegna immutabile; reset controllato e auditato. |
| G5 | Correzione, audit, eliminazione ed export solo docente; export non persistito. |
| G6/G7 (V2) | C-02 risolta / C-03; AI senza web; audit completo; opt-in; rollback verificato. |
