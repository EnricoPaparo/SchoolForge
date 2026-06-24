# SchoolForge — Glossario

---

## Dominio didattico

| Termine | Significato |
|---|---|
| Programma | Materia o percorso che contiene una o più UDA. |
| UDA | Unità organizzativa rappresentata da `uda-XX-titolo.md`. |
| Lezione | Contenuto Markdown didattico, con pool opzionale associato. |
| Pool | File `.pool.md` strutturato secondo `schoolforge-pool/v1`; non è renderizzato come lezione. |
| Domanda | Item di pool con tipo, difficoltà (`1`/`2`/`3`), peso (`1`/`2`/`3`), testo e soluzione. Il punteggio massimo è `difficoltà × peso` (scala lineare, 1–9). |
| Domanda di autoverifica | Domanda visibile nella lezione; non è una domanda del pool di verifica. |
| Classe | Voce della lista configurata dal docente nelle impostazioni; usata nelle verifiche e come menu a tendina nel portale. |
| Programma svolto | Documento generato on-demand nel browser (PDF e Markdown) dalle UDA/lezioni flaggate dal docente. |

---

## Verifiche e Portale

| Termine | Significato |
|---|---|
| Verifica | Configurazione con fonti, classi, quantità, tipi, difficoltà, minimi e varianti. È un link aperto o chiuso: nessuna lista di destinatari preassegnati. |
| Verifica aperta / chiusa | Stato gestito dal docente: finché è aperta, chiunque abbia il link può accedere; chiusa, non accetta nuovi tentativi. |
| Configurazione in bozza | Fonti, minimi, varianti e canali sono modificabili solo nello stato `bozza`. Per cambiare una verifica pubblicata si duplica una nuova bozza. |
| Snapshot pubblicato | Copia privata e immutabile di fonti, regole, candidati e soluzioni creata all'attivazione; rende riproducibile la verifica anche se le lezioni cambiano. |
| Snapshot immutabile del tentativo | Copia privata delle domande effettivamente assegnate a uno studente; è immutabile dal momento dell'avvio. |
| Tentativo | Accesso digitale associato a una verifica e a una coppia nome+cognome normalizzata. Il canale cartaceo non genera tentativi. |
| Tentativo di Accesso | Evento registrato all'avvio di un tentativo digitale: nome dichiarato (`Cognome Nome`), indirizzo IP, timestamp e user-agent. Dà visibilità di audit al docente; non prova l'identità. |
| Report Accessi | Vista per-verifica disponibile al docente con i tentativi di accesso digitali (nome dichiarato, IP, timestamp). |
| Participant lock | Documento Firestore creato dalla Cloud Function per `verifica + nome+cognome normalizzati`; impedisce un secondo avvio digitale con la stessa coppia. È un limite operativo, non una prova d'identità. Il docente può rilasciarlo solo annullando un tentativo in corso con audit. |
| Canale cartaceo | Canale puramente fisico: il PDF è generato e scaricato nel browser. Non crea record di tentativo né log di accesso; al più incrementa un contatore atomico `downloadCount`. Il sistema non invia email. |
| downloadCount | Contatore atomico opzionale sul documento della verifica, incrementato a ogni download cartaceo; non contiene dati personali. |
| Canale digitale | Lo studente svolge la verifica nel Portale; avvio, ripresa, bozza e consegna passano dal gateway Cloud Functions. Il browser non scrive direttamente in Firestore. |
| Snapshot digitale | Copia privata delle domande (con soluzioni) create dalla Cloud Function al tentativo digitale; mai esposta al client portale. |
| Consegna definitiva | Tentativo digitale inviato; domande e risposte non sono più modificabili. |
| Bozza | Risposte temporanee riprendibili nello stesso browser con token di sessione. |
| Token di sessione | Cookie HttpOnly/Secure/SameSite generato da `startDigitalAttempt` e verificato da `continueDigitalAttempt`; consente la ripresa del tentativo nello stesso browser. |
| Portale Verifiche | Sezione pubblica dell'applicazione (`/exam/:token`) per canale cartaceo e digitale; senza account studente. |
| Export verifiche | Documento generato on-demand nel browser (PDF, Markdown o CSV) da tutte le consegne digitali definitive. |

---

## Correzione e AI

| Termine | Significato |
|---|---|
| Correzione | Punteggi e commenti assegnati dal docente a una consegna digitale. |
| Rettifica | Modifica auditata di un punteggio/commento con valore precedente e motivazione obbligatoria. |
| Registro Correzioni | Popup nella UI di correzione con una tabella per consegna corretta (nome, cognome, punteggio, percentuale, data consegna), per la verifica rapida degli esiti; export opzionale in PDF o CSV generato nel browser. |
| Percentuale | `punti assegnati / punti massimi × 100`; non è un voto elettronico. |
| Correzione assistita AI | Proposta non definitiva di punteggio e commento, approvabile dal docente. |
| Correzione automatica | Esito AI definitivo solo con opt-in della verifica e C-03 approvata. Modulo M5, pianificato per la V2. |
| AiGateway | Componente Cloud Function (M5/V2) che invia contesto chiuso al provider AI e registra audit. |

---

## Tecnico e operativo

| Termine | Significato |
|---|---|
| `ownerUid` | UID Firebase Authentication dell'unico docente autorizzato nella V1. |
| Cloud Firestore | Database operativo di stati, tentativi, snapshot, log di accesso, correzioni e audit. |
| Import isolato | Insieme di Markdown, asset e indici preparato sotto un `importId` prima di diventare visibile. |
| `activeImportId` | Puntatore sul Programma che rende visibile un solo import completo; il suo commit Firestore evita una pubblicazione parziale tra Storage e indici. |
| Cloud Storage | File Markdown e asset sotto `repository/imports`; non contiene PDF o export didattici persistenti. |
| Cloud Functions v2 | Backend usato per il gateway M3 `startDigitalAttempt`/`continueDigitalAttempt` e AI (M5). |
| Security Rules | Regole Firestore e Storage che garantiscono autorizzazione e default-deny; sono il perimetro di sicurezza principale nei Moduli 1–4. |
| `@react-pdf/renderer` | Libreria browser per la generazione di PDF on-demand nel client; nessun server coinvolto. |
| `lesson-contract` | Package TypeScript interno del monorepo (`packages/lesson-contract`, non pubblicato su npm); schemi Zod, parser e validatore del contratto pool v1, condiviso tra SPA e Cloud Functions via workspace reference. |
| Firebase Emulator Suite | Ambiente locale per Auth, Firestore, Storage e Functions con dati sintetici. |
| Secret Manager | Archivio dei segreti per la chiave API AI; introdotto solo in M5 (V2). |
| Gate | Controllo umano o tecnico che abilita il modulo successivo. |
| DoR / DoD | Condizioni minime per iniziare / dichiarare completato un pacchetto. |
| RPO | Perdita dati massima: in V1 best-effort, affidata all'export manuale Firestore dal docente e alla ridondanza nativa di Cloud Storage; nessun target numerico garantito. |
| RTO | Tempo di ripristino; in SchoolForge è best-effort, senza target numerico. |

---

## Fuori scope intenzionale

Google Workspace obbligatorio, account studenti, invio email agli studenti, MailGateway, Google Forms, Google Drive API, LMS, registro elettronico, PDF persistenti, editor Markdown integrato, generazione AI di domande e multi-docente non sono termini del dominio V1.
