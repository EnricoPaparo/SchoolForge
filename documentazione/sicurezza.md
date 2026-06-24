# SchoolForge — Sicurezza e protezione dei dati

**Stato:** requisiti di sicurezza da implementare nei pacchetti F-04 e successivi

## 1. Obiettivo

Proteggere Markdown, asset, dati dichiarati dagli studenti, risposte, punteggi, correzioni, audit e segreti senza trasformare il Portale in un sistema di autenticazione studente. La sicurezza del docente è forte; il Portale applica accesso limitato e deterrenza, non certifica l'identità dello studente.

## 2. Confini e minacce principali

| Asset | Minaccia | Controllo richiesto |
|---|---|---|
| Pannello docente | Accesso di soggetto non owner | Firebase Auth + controllo `ownerUid` in ogni Cloud Function. |
| Firestore/Storage | Lettura o scrittura diretta dal client | Security Rules default-deny; backend autorevole. |
| Verifica pubblica | Enumerazione o accesso a soluzioni | Token casuale non enumerabile, proiezione pubblica minima, rate limit. |
| Tentativo digitale | Furto/riuso sessione | Token opaco hashato, cookie Secure/HttpOnly/SameSite e scadenza. |
| Email cartacea | Doppio invio concorrente | Lock Firestore e MailGateway idempotente. |
| Markdown | XSS o asset non sicuri | Parser condiviso, sanitizzazione e whitelist rendering. |
| AI | Invio dati non autorizzati o prompt injection | C-02, contesto chiuso, nessun web/tool, audit e feature flag. |
| Segreti | Esposizione in Git/client/log | Secret Manager, accesso minimo e rotazione. |

## 3. Autorizzazione Firebase

- Solo `settings/owner.ownerUid` può usare API docente.
- Le Security Rules negano per default lettura/scrittura diretta di Firestore e Storage; il client usa Cloud Functions per operazioni di dominio.
- Il Portale non riceve Firebase custom claims di studente e non può leggere `snapshot` privati, correzioni, audit o indici completi.
- Ogni endpoint pubblico verifica token verifica, stato `active`, schema payload, rate limit e stato del tentativo.
- Le operazioni irreversibili richiedono conferma esplicita e audit.

Le regole Firestore e Storage esatte vengono create in F-04 con test Emulator obbligatori. Nessuna regola permissiva temporanea è ammessa con dati reali.

## 4. Dati, privacy ed export

- Il Portale raccoglie solo nome, cognome, email, classe facoltativa e risposte.
- L'email è normalizzata solo per il lock; non si verifica dominio, titolare o appartenenza.
- Log e telemetria non contengono risposte, PDF, email complete o punteggi non necessari.
- Il docente può eliminare una consegna; dati personali e correzioni sono rimossi, mentre resta audit non identificativo.
- `Esporta verifiche` è disponibile solo al docente e genera il documento on-demand, senza persisterlo.
- Firestore/Storage/Functions applicativi usano Milano `europe-west8` ove supportato; Hosting/Auth non sono dichiarati Italia-only.

## 5. Markdown, PDF ed email

- Il Markdown è trattato come input non fidato: nessun script, iframe, event handler o URL pericoloso nel rendering.
- Il pool non è mai esposto nel rendering della lezione o nella proiezione Portale.
- PDF docente, PDF cartaceo ed export non vengono scritti in Cloud Storage o Firestore.
- Il provider email riceve solo destinatario e documento necessari all'invio; la relativa credenziale vive in Secret Manager.

## 6. AI

Prima di M5 devono essere approvati C-02 e provider/condizioni. Il backend invia soltanto lezione sorgente, domanda snapshot, soluzione, risposta e nota docente. Nessun browsing, retrieval web, tool esterno, attivazione verifica, invio email o cancellazione è consentito all'AI.

La correzione automatica richiede anche C-03, opt-in per verifica, limiti di punteggio, audit e possibilità di rettifica.

## 7. Backup, costi e incidenti

- Backup giornaliero Firestore e protezione/versioning Storage, conservazione minima 30 giorni.
- RPO 24 ore; RTO best-effort; il docente owner controlla backup e restore.
- Budget e avvisi Firebase sono configurati prima di `prod`.
- In caso di incidente: fermare il write path interessato, preservare audit, valutare ultimo backup, ripristinare e registrare l'esito.

## 8. Checklist ai gate

| Gate | Controlli minimi |
|---|---|
| G1 | OwnerUid, Rules default-deny, Secret Manager, budget, backup e restore test. |
| G2 | Sanitizzazione Markdown, Storage privato, import atomico, export ZIP. |
| G3 | PDF non persistenti, lock email concorrente, MailGateway idempotente. |
| G4 | Token Portale, nessuna soluzione client, bozza e consegna immutabile. |
| G5 | Correzione/audit/eliminazione/export solo docente. |
| G6/G7 | C-02/C-03, AI senza web, audit, opt-in e rollback. |
