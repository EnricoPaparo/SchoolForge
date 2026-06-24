# SchoolForge — Glossario

---

## Dominio didattico

| Termine | Significato |
|---|---|
| Programma | Materia o percorso che contiene una o più UDA. |
| UDA | Unità organizzativa rappresentata da `uda-XX-titolo.md`. |
| Lezione | Contenuto Markdown didattico, con pool opzionale associato. |
| Pool | File `.pool.md` strutturato secondo `schoolforge-pool/v1`; non è renderizzato come lezione. |
| Domanda | Item di pool con tipo, difficoltà, peso, testo e soluzione. |
| Domanda di autoverifica | Domanda visibile nella lezione; non è una domanda del pool di verifica. |
| Classe | Voce della lista configurata dal docente nelle impostazioni; usata nelle verifiche e come menu a tendina nel portale. |
| Programma svolto | Documento generato on-demand nel browser (PDF e Markdown) dalle UDA/lezioni flaggate dal docente. |

---

## Verifiche e Portale

| Termine | Significato |
|---|---|
| Verifica | Configurazione con fonti, classi, quantità, tipi, difficoltà, minimi e varianti. |
| Configurazione immutabile | Configurazione bloccata dopo l'attivazione; non equivale a copiare tutte le domande. |
| Tentativo | Accesso cartaceo o digitale associato a verifica e recapito normalizzato. |
| Email bruciata | Regola che consente un solo tentativo per coppia verifica/recapito; non prova l'identità. |
| Lock email | Documento Firestore creato in transazione al primo tentativo; blocca canali successivi per lo stesso recapito. |
| Canale cartaceo | Lo studente scarica il PDF direttamente nel browser; il sistema non invia email. |
| Canale digitale | Lo studente svolge la verifica nel Portale; le risposte sono strutturate in Firestore. |
| Snapshot digitale | Copia privata delle domande (con soluzioni) create dalla Cloud Function al tentativo digitale; mai esposta al client portale. |
| Consegna definitiva | Tentativo digitale inviato; domande e risposte non sono più modificabili. |
| Bozza | Risposte temporanee riprendibili nello stesso browser con token di sessione. |
| Token di sessione | Cookie HttpOnly/Secure/SameSite generato dalla Cloud Function `startDigitalAttempt`; consente la ripresa del tentativo nello stesso browser. |
| Portale Verifiche | Sezione pubblica dell'applicazione (`/exam/:token`) per canale cartaceo e digitale; senza account studente. |
| Export verifiche | Documento generato on-demand nel browser (PDF, Markdown o CSV) da tutte le consegne digitali definitive. |

---

## Correzione e AI

| Termine | Significato |
|---|---|
| Correzione | Punteggi e commenti assegnati dal docente a una consegna digitale. |
| Rettifica | Modifica auditata di un punteggio/commento con valore precedente e motivazione obbligatoria. |
| Percentuale | `punti assegnati / punti massimi × 100`; non è un voto elettronico. |
| Correzione assistita AI | Proposta non definitiva di punteggio e commento, approvabile dal docente. |
| Correzione automatica | Esito AI definitivo solo con opt-in della verifica e C-03 approvata. |
| AiGateway | Componente Cloud Function che invia contesto chiuso al provider AI e registra audit. |

---

## Tecnico e operativo

| Termine | Significato |
|---|---|
| `ownerUid` | UID Firebase Authentication dell'unico docente autorizzato nella V1. |
| Cloud Firestore | Database operativo di stati, tentativi, snapshot, lock, correzioni e audit. |
| Cloud Storage | File Markdown, asset; non contiene PDF o export didattici persistenti. |
| Cloud Functions v2 | Backend usato solo per `startDigitalAttempt` (M3) e AI (M5). |
| Security Rules | Regole Firestore e Storage che garantiscono autorizzazione e default-deny; sono il perimetro di sicurezza principale nei Moduli 1–4. |
| `@react-pdf/renderer` | Libreria browser per la generazione di PDF on-demand nel client; nessun server coinvolto. |
| `lesson-contract` | Package TypeScript condiviso; parser e validatore del contratto pool v1. |
| Firebase Emulator Suite | Ambiente locale per Auth, Firestore, Storage e Functions con dati sintetici. |
| Secret Manager | Archivio dei segreti per la chiave API AI; introdotto solo in M5. |
| Gate | Controllo umano o tecnico che abilita il modulo successivo. |
| DoR / DoD | Condizioni minime per iniziare / dichiarare completato un pacchetto. |
| RPO | Perdita dati massima accettata: 24 ore. |
| RTO | Tempo di ripristino; in SchoolForge è best-effort, senza target numerico. |

---

## Fuori scope intenzionale

Google Workspace obbligatorio, account studenti, invio email agli studenti, MailGateway, Google Forms, Google Drive API, LMS, registro elettronico, PDF persistenti, editor Markdown integrato, generazione AI di domande e multi-docente non sono termini del dominio V1.
