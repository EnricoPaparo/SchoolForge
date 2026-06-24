# SchoolForge — Glossario

## Dominio didattico

| Termine | Significato |
|---|---|
| Programma | Materia o percorso che contiene una o più UDA. |
| UDA | Unità organizzativa rappresentata da `uda-XX-titolo.md`. |
| Lezione | Contenuto Markdown didattico, con pool opzionale associato. |
| Pool | File `.pool.md` strutturato secondo `schoolforge-pool/v1`; non è renderizzato come lezione. |
| Domanda | Item di pool con tipo, difficoltà, peso, testo e soluzione. |
| Domanda di autoverifica | Domanda visibile nella lezione; non è una domanda del pool di verifica. |
| Programma svolto | File `.txt` generato dalle UDA/lezioni selezionate dal docente. |

## Verifiche e Portale

| Termine | Significato |
|---|---|
| Verifica | Configurazione con fonti, quantità, tipi, difficoltà, minimi, varianti e canali. |
| Configurazione immutabile | Configurazione bloccata dopo l'attivazione; non equivale a copiare tutte le domande. |
| Tentativo | Accesso cartaceo o digitale associato a verifica e recapito normalizzato. |
| Email bruciata | Regola che consente un solo tentativo per coppia verifica/recapito; non prova l'identità. |
| Snapshot digitale | Copia privata delle domande effettivamente assegnate a un tentativo digitale, con dati necessari a correzione/export. |
| Consegna definitiva | Tentativo digitale inviato; domande e risposte non sono più modificabili dallo studente. |
| Bozza | Risposte temporanee riprendibili nello stesso browser con token opaco. |
| Portale Verifiche | Applicazione separata e pubblica per invio cartaceo o svolgimento digitale, senza account studente. |
| Export verifiche | Documento unico generato da tutte le consegne digitali definitive e dai loro snapshot. |

## Correzione e AI

| Termine | Significato |
|---|---|
| Correzione | Punteggi e commenti assegnati dal docente a una consegna digitale. |
| Rettifica | Nuova modifica auditata di un punteggio/commento con valore precedente e motivazione. |
| Percentuale | `punti assegnati / punti massimi × 100`; non è un voto elettronico. |
| Correzione assistita AI | Proposta non definitiva di punteggio e commento, approvabile dal docente. |
| Correzione automatica | Esito AI definitivo solo con opt-in della verifica e C-03 approvata. |
| AiGateway | Componente backend che invia contesto chiuso al provider AI e registra provenienza/audit. |

## Tecnico e operativo

| Termine | Significato |
|---|---|
| `ownerUid` | UID Firebase Authentication dell'unico docente autorizzato nella V1. |
| Cloud Firestore | Database operativo di stati, tentativi, snapshot, correzioni e audit. |
| Cloud Storage | File Markdown, asset e staging; non contiene PDF o export didattici persistenti. |
| Cloud Functions v2 | Backend autorevole per regole, transazioni e integrazioni. |
| Firebase Emulator Suite | Ambiente locale per Auth, Firestore, Storage e Functions con dati sintetici. |
| Secret Manager | Archivio dei segreti per provider email e AI. |
| Gate | Controllo umano o tecnico che abilita il modulo successivo. |
| DoR / DoD | Condizioni minime per iniziare / dichiarare completato un pacchetto. |
| RPO | Perdita dati massima accettata: 24 ore. |
| RTO | Tempo di ripristino; in SchoolForge è best-effort, non contrattuale. |

## Fuori scope intenzionale

Google Workspace obbligatorio, account studenti, roster/classi gestiti, Google Forms, Google Drive API, LMS, registro elettronico, PDF persistenti, editor Markdown integrato e generazione AI di domande non sono termini del dominio V1 perché non sono funzionalità previste.
