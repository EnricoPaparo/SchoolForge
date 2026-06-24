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
        SPA->>CS: scrivi Markdown e asset in repository/current (Security Rules)
        SPA->>F: aggiorna programs/udas/lessons e questionIndex
        SPA->>F: scrivi auditEvents
        SPA-->>D: import completato
    else errori bloccanti
        SPA-->>D: mostra errori — nessuna scrittura
    end
```

## Note

- La validazione avviene interamente nel browser tramite il package `lesson-contract`; nessuna Cloud Function è coinvolta nell'import.
- Un pool invalido blocca solo il pool: la lezione resta consultabile e importabile.
- Le Security Rules Firestore e Storage garantiscono che solo l'`ownerUid` possa scrivere in `repository/current`.
- Se un file su Storage o Firestore fallisce a metà import, lo stato Firestore non viene aggiornato finché tutti i file non sono scritti correttamente (gestione transazionale nel client).
