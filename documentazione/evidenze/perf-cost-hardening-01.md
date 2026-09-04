# PERF-COST-AUDIT-01 — baseline di hardening

## Scopo

Questa evidenza chiude l'audit prestazioni, costi, affidabilità e sicurezza
successivo agli interventi COURSE-CARDS-LITE-01. Registra soltanto decisioni
supportate dal codice e dai gate: evita listener, polling, istanze minime,
denormalizzazioni o servizi aggiuntivi privi di misure.

## Esito sintetico

| Area | Decisione | Evidenza e impatto |
| --- | --- | --- |
| Aggiornamento studente | Implementato in #462 | Rimossi pulsante fisso e refresh su focus/visibility; restano caricamento all'ingresso, aggiornamenti conseguenti alle azioni e retry contestuale. Nessun polling o listener aggiunto. |
| Letture profilo studente | Implementato in #466 | La `classId` già validata da `RoleGate` viene riusata nelle viste studente, eliminando due letture iniziali duplicate di `students/{uid}`; retry e cambio classe rivalidano il dato. |
| Diagnostica generazione | Implementato in #464 | Un evento terminale per `aiContentPreview`/`aiContentGenerate`, senza contenuti, UID, token, costi, scritture o nuovi servizi. |
| Dipendenze | Implementato in #469 | Audit portato da 4 `critical` e 43 `high` a zero `critical/high`; restano 5 `moderate`, senza override incompatibili. |
| Affidabilità generazione | Mantieni | `AiCompleteLessonGenerationDialog` usa guardia `runningRef`, request ID stabile, input conservati e retry delle sole immagini mancanti. Un secondo meccanismo sarebbe duplicato. |
| App Check | Gate umano/architetturale | Client e Functions non inizializzano né impongono App Check. Attivarlo richiede provider, site key, registrazione ambienti e rollout graduale; un enforcement non preparato rischierebbe di rifiutare richieste DEV legittime. |
| Cold start Functions | Mantieni baseline a costo zero | Le configurazioni esplicite usano `minInstances: 0`; non si introducono istanze calde a costo fisso. Nessuna misura dimostra che separare gli import dell'entrypoint compensi complessità e rischio. |
| Piano visivo | Mantieni configurazione misurata | La generazione slot resta a 512 MiB, concorrenza 1 e timeout 120 s: i log DEV già registrano picchi 258–277 MiB e fallimenti a 256 MiB. Ridurre memoria è regressivo; una concorrenza superiore non è validata da queste misure. |
| Libreria corsi | Misurare prima di cambiare modello | Il caricamento costa 1 query programmi + 1 query classi + 1 lettura metadata per programma attivo, senza UDA/lezioni/Storage. Eliminare l'N-per-programma richiede denormalizzazione e strategia di consistenza. |

## Prestazioni e costo operativo

La baseline studente non esegue refresh periodici né al ritorno della finestra:
F5 resta il meccanismo universale per un riallineamento volontario, mentre le
azioni interne che cambiano stato aggiornano la vista nel loro flusso. Questo
evita letture Firestore invisibili durante la normale consultazione e non
aggiunge timer, listener o traffico in background.

La libreria Didattica mantiene card leggere: nessuna statistica strutturale,
lezione, pool o risorsa Storage viene letta prima dell'apertura del corso. La
lettura del metadata dell'anno scolastico resta esplicita e limitata ai
programmi con import attivo. Un'eventuale proiezione dell'anno nel documento
programma va decisa solo con volumi e latenza reali, insieme alla politica di
backfill e coerenza.

Sul server non vengono abilitate istanze minime. Le sole risorse superiori alla
baseline restano quelle già giustificate dalla normalizzazione binaria delle
immagini. La sola telemetria #464 non aggiunge invocazioni provider né
documenti Firestore.

## Sicurezza e dipendenze

La correzione DEPS-SECURITY-01 aggiorna bundle web, test Rules, runtime
Functions e tooling. Il rollout DEV ridistribuisce Hosting e tutte le Functions
esportate, con target espliciti, perché `firebase-admin` e
`firebase-functions` sono condivise dal pacchetto server. Nessuna regola,
schema, configurazione, secret o modalità provider cambia.

App Check resta intenzionalmente non attivo. Prima di abilitarlo servono una
scelta del provider web, site key e domini DEV, registrazione dei client,
monitoraggio delle richieste legittime e solo infine enforcement progressivo
sulle callable/HTTPS. È un gate di prodotto e infrastruttura, non una patch
locale sicura.

## Gate per interventi futuri

- App Check: decisione provider/site key e piano di rollout separato.
- Libreria corsi: misure di p50/p95, numero di programmi attivi per docente e
  conteggio letture reali prima di valutare denormalizzazione o paginazione.
- Cold start: misure per singola Function in DEV; nessuna `minInstances > 0`
  senza beneficio dimostrato e approvazione del costo fisso.
- Moderate advisory residue: intervenire solo quando esiste un percorso di
  upgrade compatibile e testabile, senza override trasversali speculativi.

## Confini

Questo audit non modifica UI o runtime, non chiama provider reali, non legge
secret, non esegue migrazioni e non autorizza PROD.
