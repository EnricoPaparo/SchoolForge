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

## Autenticazione e ruoli (M3-lite)

| Termine | Significato |
|---|---|
| M3-lite | Fase decisa del Modulo 3: Portale studente autenticato con Google, in sola lettura (Lezioni + Verifiche, solo download PDF studente). Nessuna Cloud Function, nessun account custom, nessuna consegna online. |
| M3-full | Fase successiva a M3-lite, specifica rinviata e non pianificata in dettaglio: verifiche online con tentativi, consegna, lock e un eventuale gateway server-side. |
| TeacherShell | Sezione autenticata dell'applicazione (`/teacher/*`) montata quando `uid == ownerUid`; gestisce contenuti, verifiche, classi e impostazioni. |
| StudentShell | Sezione autenticata dell'applicazione (`/student/*`, M3-lite) montata per qualunque utente Google autenticato diverso da `ownerUid`; sola lettura, due sole sezioni: Lezioni e Verifiche. |
| Google Workspace for Education | Suite di account Google per istituti scolastici. Da M3-lite gli studenti possono autenticarsi con un account personale o con un account Workspace for Education, senza distinzione. |
| `ownerUid` | UID Firebase Authentication dell'unico docente autorizzato. Confrontato con `uid` dell'utente autenticato per risolvere il ruolo (docente vs studente). |
| `settings/ownerPublic` | Documento Firestore leggibile da qualunque utente autenticato, contenente solo `ownerUid`; usato per instradare il client su TeacherShell/StudentShell. Non sostituisce le Security Rules delle risorse protette. |
| Proiezione read-only | Documento pubblico dedicato (es. `publicLessons`, `publishedProjection`) privo di pool, soluzioni e percorsi tecnici, creato dal docente nello stesso flusso di scrittura del documento tecnico corrispondente, per essere letto in sicurezza dallo studente. |

## Verifiche e Portale

| Termine | Significato |
|---|---|
| Verifica | Configurazione con fonti, classi, quantità, tipi, difficoltà, minimi e varianti. |
| Stato della verifica (`status`) | `bozza`, `attiva`, `chiusa`, `archiviata`. Solo la bozza è modificabile; l'attivazione congela configurazione e contenuti. |
| Visibilità (`visibility`) | Campo indipendente dallo stato: `hidden` o `public`. All'attivazione parte da `hidden`; il docente la pubblica/nasconde più volte mentre la verifica resta `attiva`. Solo `attiva`+`public` è visibile allo studente (M3-lite). |
| Configurazione in bozza | Fonti, minimi, varianti e canali sono modificabili solo nello stato `bozza`. Per cambiare una verifica pubblicata si duplica una nuova bozza. |
| Snapshot pubblicato | Copia privata e immutabile di fonti, regole, candidati e soluzioni creata all'attivazione; rende riproducibile la verifica anche se le lezioni cambiano. Mai esposta allo studente. |
| Canale cartaceo | Canale puramente fisico: il PDF è generato e scaricato nel browser dal docente. Non crea record di tentativo né log di accesso; al più incrementa un contatore atomico `downloadCount`. Il sistema non invia email. |
| downloadCount | Contatore atomico opzionale sul documento della verifica, incrementato a ogni download cartaceo; non contiene dati personali. |
| Portale studente (M3-lite) | StudentShell: sezioni Lezioni e Verifiche, sola lettura. Lo studente scarica solo il PDF studente delle verifiche `attiva`+`public`, con lo stesso renderer del canale cartaceo. Nessuna consegna online. |
| Export verifiche | Documento generato on-demand nel browser (PDF, Markdown o CSV) da tutte le consegne digitali definitive. Dipende da M3-full. |

### M3-full — specifica rinviata

| Termine | Significato |
|---|---|
| Verifica aperta / chiusa (M3-full) | Stato del link pubblico: finché è aperta, chiunque abbia il link potrebbe accedere; chiusa, non accetterebbe nuovi tentativi. Non è il modello di accesso di M3-lite. |
| Snapshot immutabile del tentativo | Copia privata delle domande effettivamente assegnate a uno studente; sarebbe immutabile dal momento dell'avvio. |
| Tentativo | Accesso digitale associato a una verifica e a una coppia nome+cognome normalizzata. Il canale cartaceo e M3-lite non generano tentativi. |
| Tentativo di Accesso | Evento registrato all'avvio di un tentativo digitale: nome dichiarato (`Cognome Nome`), indirizzo IP, timestamp e user-agent. Darebbe visibilità di audit al docente; non proverebbe l'identità. |
| Report Accessi | Vista per-verifica disponibile al docente con i tentativi di accesso digitali (nome dichiarato, IP, timestamp). |
| Participant lock | Documento Firestore creato dalla Cloud Function per `verifica + nome+cognome normalizzati`; impedirebbe un secondo avvio digitale con la stessa coppia. Non è una prova d'identità. |
| Canale digitale (M3-full) | Lo studente svolgerebbe la verifica nel Portale; avvio, ripresa, bozza e consegna passerebbero dal gateway Cloud Functions. Il browser non scriverebbe direttamente in Firestore. |
| Snapshot digitale | Copia privata delle domande (con soluzioni) creata dalla Cloud Function al tentativo digitale; mai esposta al client. |
| Consegna definitiva | Tentativo digitale inviato; domande e risposte non sarebbero più modificabili. |
| Bozza (M3-full) | Risposte temporanee riprendibili nello stesso browser con token di sessione. |
| Token di sessione | Cookie HttpOnly/Secure/SameSite generato da `startDigitalAttempt` e verificato da `continueDigitalAttempt`; consentirebbe la ripresa del tentativo nello stesso browser. |

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
| Cloud Functions v2 | Non usato da M3-lite. Backend riservato ad AI (M5/V2) e a un eventuale gateway M3-full `startDigitalAttempt`/`continueDigitalAttempt` (specifica rinviata). |
| Security Rules | Regole Firestore e Storage che garantiscono autorizzazione e default-deny; sono il perimetro di sicurezza principale nei Moduli 1–4. |
| `@react-pdf/renderer` | Libreria browser per la generazione di PDF on-demand nel client; nessun server coinvolto. |
| `lesson-contract` | Package TypeScript interno del monorepo (`packages/lesson-contract`, non pubblicato su npm); schemi Zod, parser e validatore del contratto pool v1, condiviso tra SPA e Cloud Functions via workspace reference. |
| Firebase Emulator Suite | Ambiente locale per Auth, Firestore, Storage e Functions con dati sintetici. |
| Secret Manager | Archivio dei segreti per la chiave API AI; introdotto solo in M5 (V2). |
| Gate | Controllo umano o tecnico che abilita il modulo successivo. |
| DoR / DoD | Condizioni minime per iniziare / dichiarare completato un pacchetto. |
| RPO | Perdita dati massima: in V1 best-effort, affidata all'export manuale Firestore dal docente e alla ridondanza nativa di Cloud Storage; nessun target numerico garantito. |
| RTO | Tempo di ripristino; in SchoolForge è best-effort, senza target numerico. |
| Repository Editor (RE) | Implementato (RE-00 → RE-07): editor minimale Markdown-first per creare, modificare, eliminare e riordinare UDA e lezioni da portale, senza CMS visuale complesso, AI o consegna online. |

---

## Fuori scope intenzionale

Google Workspace obbligatorio per il Docente, account SchoolForge dedicato per lo studente (registrazione, credenziali proprie), invio email agli studenti, MailGateway, Google Forms, Google Drive API, LMS, registro elettronico, PDF persistenti, editor visuale/WYSIWYG complesso, generazione AI di domande e multi-docente non sono termini del dominio corrente. In M3-lite sono inoltre fuori scope: consegna e risposte online, tentativi, lock di partecipazione, allowlist di dominio Google e Cloud Functions.
