# SchoolForge — Sequenza importazione didattica

```mermaid
sequenceDiagram
    participant D as Docente
    participant SPA as SPA docente
    participant LC as lesson-contract (browser)
    participant CS as Cloud Storage
    participant F as Firestore

    D->>SPA: seleziona file/cartella
    SPA->>LC: valida UDA, lezioni e pool v1
    LC-->>SPA: anteprima + errori strutturati (file/domanda/campo)

    alt validazione ok (o errori solo sui pool)
        D->>SPA: conferma import
        SPA->>CS: scrivi Markdown e asset in repository/imports/{programId}/{importId}
        SPA->>F: prepara imports/{importId}, UDA, lezioni e questionIndex
        SPA->>F: transazione: activeImportId + auditEvents
        SPA-->>D: import visibile e completato
    else errori bloccanti
        SPA-->>D: mostra errori — nessuna scrittura
    end
```

## Note

- La validazione avviene interamente nel browser tramite il package `lesson-contract`; nessuna Cloud Function è coinvolta nell'import.
- Un pool invalido blocca solo il pool: la lezione resta consultabile e importabile.
- Le Security Rules Firestore e Storage garantiscono che solo l'`ownerUid` possa scrivere sotto gli import isolati.
- Storage e Firestore non offrono una transazione condivisa: l'atomicità riguarda la visibilità. Se un upload o la preparazione indici fallisce, `activeImportId` non cambia e l'app continua a leggere l'import precedente; gli artefatti incompleti non sono visibili e sono eliminabili con lifecycle/scarto docente.
