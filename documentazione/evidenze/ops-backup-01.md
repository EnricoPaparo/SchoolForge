# OPS-BACKUP-01 — decisione sul backup documentale

**Data:** 22 agosto 2026  
**Ambiente:** PROD  
**Esito:** strategia approvata

## Decisione

Per l'uso corrente da parte di un singolo docente non vengono attivati backup
gestiti o schedulati di Firestore e Cloud Storage. Il costo atteso sarebbe
ridotto, ma la priorità dichiarata è conservare gli elaborati e gli esiti
scolastici, non ripristinare automaticamente l'intero stato di SchoolForge.

La strategia scelta è:

- archivio delle correzioni dopo ogni verifica conclusa e restituita;
- CSV del Registro Correzioni;
- ZIP dei corsi dopo modifiche didattiche importanti;
- verifica di leggibilità degli export appena prodotti;
- due copie in destinazioni separate e protette;
- nessun file con dati studente nel repository Git o in cartelle pubbliche.

## Confine e rischio accettato

Questi file costituiscono un **backup documentale**, non un backup tecnico del
sistema. In caso di perdita di Firestore o Storage permettono di consultare gli
elaborati conservati, ma non di ricostruire automaticamente classi, studenti,
configurazioni, audit e stato operativo.

Il docente accetta la possibile ricostruzione manuale. La decisione va
rivalutata se aumentano docenti, classi o dati reali, oppure se ricreare lo stato
di SchoolForge diventa più oneroso del costo di backup e restore gestiti.

## Costi

La strategia non introduce operazioni cloud automatiche o costi applicativi
nuovi. Restano soltanto lo spazio delle copie scelto dal docente e gli eventuali
costi del servizio esterno in cui decide di conservarle.
