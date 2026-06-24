# SchoolForge — Sicurezza e protezione dei dati

**Versione:** 2.0
**Stato:** requisiti da implementare nei pacchetti F-04 e successivi

---

## 1. Obiettivo

Proteggere Markdown, asset, dati dichiarati dagli studenti, risposte, punteggi, correzioni, audit e segreti senza trasformare il Portale in un sistema di autenticazione studente. La sicurezza del docente è garantita da Firebase Auth e Security Rules; il Portale applica accesso limitato e deterrenza, non certifica l'identità dello studente.

---

## 2. Confini e minacce principali

| Asset | Minaccia | Controllo richiesto |
|---|---|---|
| Sezione docente | Accesso di soggetto non owner | Firebase Auth + `ownerUid` nelle Security Rules. |
| Firestore/Storage | Lettura o scrittura diretta non autorizzata | Security Rules default-deny; percorsi sensibili protetti per ruolo. |
| Verifica pubblica | Enumerazione o accesso a soluzioni | Token casuale non enumerabile; proiezione pubblica senza soluzioni; rate limit. |
| Tentativo digitale | Forgery del token sessione | Token firmato server-side nella Cloud Function; cookie Secure/HttpOnly/SameSite. |
| Lock email cartaceo | Doppio download concorrente | Transazione Firestore client-side con Security Rule `!exists()`. |
| Markdown | XSS o asset non sicuri | Parser condiviso, sanitizzazione e whitelist rendering. |
| AI | Dati non autorizzati o prompt injection | C-02, contesto chiuso, nessun web/tool, feature flag, audit. |
| Segreti AI | Esposizione in Git/client/log | Secret Manager (solo M5), accesso minimo, rotazione. |

---

## 3. Security Rules — principi

Le Security Rules Firestore e Storage sono il perimetro di sicurezza principale nei Moduli 1–4.

**Regole obbligatorie:**

- Default-deny: qualsiasi percorso non esplicitamente aperto è negato.
- `ownerUid` è verificato come `request.auth.uid == resource.data.ownerUid` o confrontato con `settings/owner.ownerUid`.
- `deliveryAttempts/*/snapshot/items` non espone mai il campo `soluzione` al client portale (Security Rule con `request.auth == null` blocca il campo, o la Function non lo include nella proiezione).
- `recipientLocks/{emailHash}` consente la creazione solo se `!exists(resource)` — garanzia atomica del lock.
- `corrections`, `correctionEvents` e `auditEvents` sono leggibili solo dall'owner.

Le Security Rules esatte vengono scritte e testate in F-04 con Emulator Suite obbligatoria. Nessuna regola permissiva temporanea è ammessa con dati reali.

---

## 4. Cloud Function: startDigitalAttempt

Questa funzione è il punto critico di sicurezza del Portale digitale.

**Garanzie richieste:**

- La transazione Firestore è atomica: lock + tentativo + snapshot in un'unica operazione.
- Lo snapshot include le soluzioni private in Firestore ma non le include nella risposta HTTP al client.
- Il token di sessione è generato server-side, consegnato come `Set-Cookie: resumeToken=...; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`.
- Solo l'hash del token è salvato in Firestore (`resumeTokenHash`); il token in chiaro non è mai persistito.
- Rate limit applicato per IP e per token verifica.

---

## 5. PDF e documenti — nessuna persistenza

- PDF docente, PDF cartaceo studente, programma svolto (PDF/Markdown) ed export verifiche (PDF/Markdown/CSV) sono generati nel browser e non scritti su Cloud Storage o Firestore.
- Nessuna Cloud Function produce o salva PDF.
- I file temporanei del browser (blob URL) sono rilasciati immediatamente dopo il download.

---

## 6. Dati, privacy ed export

- Il Portale raccoglie solo nome, cognome, email, classe facoltativa e risposte.
- L'email è normalizzata solo per il lock (lowercase, trim); non si verifica dominio o titolare.
- Log e telemetria non contengono risposte, dati personali completi o punteggi non necessari.
- Il docente può eliminare una consegna: dati personali e correzioni sono rimossi; resta audit non identificativo.
- `Esporta verifiche` è disponibile solo al docente e generato on-demand nel browser.
- Firestore/Storage/Functions applicativi usano Milano `europe-west8`; Hosting/Auth non sono dichiarati Italia-only.

---

## 7. Markdown e rendering

- Il Markdown è trattato come input non fidato: nessun script, iframe, event handler o URL pericoloso nel rendering.
- Il pool non è mai esposto nel rendering della lezione o nella proiezione del Portale.
- Il package `lesson-contract` è l'unico parser autorizzato; qualsiasi estensione non dichiarata viene rifiutata.

---

## 8. AI — Modulo 5

- Prima di M5: C-02 approvata e feature flag `aiEnabled = true`.
- Contesto AI: solo lezione sorgente, domanda snapshot, soluzione, risposta studente e nota docente.
- Vietati: browsing web, retrieval, tool esterni, attivazione verifiche, invio email, cancellazione dati.
- La correzione automatica richiede anche C-03, opt-in per verifica, audit e possibilità di rettifica.
- La chiave API AI vive in Secret Manager; non raggiunge mai client, Firestore, Markdown o Git.

---

## 9. Backup, costi e incidenti

- Backup giornaliero Firestore e versioning Storage, conservazione minima 30 giorni.
- RPO 24 ore; RTO best-effort; il Docente controlla backup e restore.
- Budget e avvisi Firebase configurati prima di `prod`.
- In caso di incidente: fermare il write path interessato, preservare audit, valutare ultimo backup, ripristinare e documentare.

---

## 10. Checklist ai gate

| Gate | Controlli minimi |
|---|---|
| G1 | Security Rules default-deny testate in Emulator; `ownerUid` funzionante; budget e backup configurati. |
| G2 | Sanitizzazione Markdown verificata; Storage privato; import non scrive contenuti parziali; ZIP portabile. |
| G3 | PDF generato nel browser senza persistenza; lock email concorrente testato; nessun PDF in Storage. |
| G4 | `startDigitalAttempt` con token sessione cookie HttpOnly/Secure; soluzioni non nel response; bozza/consegna immutabile. |
| G5 | Correzione, audit, eliminazione ed export solo docente; export non persistito. |
| G6/G7 | C-02/C-03; AI senza web; audit completo; opt-in; rollback verificato. |
