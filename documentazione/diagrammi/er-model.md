# SchoolForge — Modello dati Firestore

```mermaid
erDiagram
    OWNER_SETTINGS ||--o{ PROGRAM : owns
    PROGRAM ||--o{ UDA : contains
    UDA ||--o{ LESSON : contains
    LESSON ||--o{ QUESTION_INDEX : derives
    VERIFICATION ||--o{ DELIVERY_ATTEMPT : "receives (solo digitale)"
    VERIFICATION ||--o{ PARTICIPANT_LOCK : protects
    DELIVERY_ATTEMPT ||--o{ ACCESS_LOG : records
    DELIVERY_ATTEMPT ||--o{ SNAPSHOT_ITEM : contains
    DELIVERY_ATTEMPT ||--o{ ANSWER : contains
    DELIVERY_ATTEMPT ||--o| CORRECTION : receives
    CORRECTION ||--o{ CORRECTION_EVENT : records
    OWNER_SETTINGS ||--o{ AUDIT_EVENT : produces

    OWNER_SETTINGS {
        string ownerUid
        string[] classes
        object featureFlags
    }
    LESSON {
        string storagePath
        string poolPath
        string poolStatus
        string[] poolErrors
    }
    QUESTION_INDEX {
        string questionRef
        string tipo
        number difficolta
        number peso
        number maxPoints
        boolean valid
    }
    VERIFICATION {
        string state
        string publicTokenHash
        object config
        string[] classes
        number downloadCount
    }
    PARTICIPANT_LOCK {
        string participantKeyHash
        string attemptId
        datetime timestamp
    }
    DELIVERY_ATTEMPT {
        string verificationId
        object declaredData
        string state
        string resumeTokenHash
    }
    ACCESS_LOG {
        string declaredName
        string declaredIp
        string userAgent
        datetime timestamp
    }
    SNAPSHOT_ITEM {
        string testo
        object opzioni
        string soluzione
        number maxPoints
    }
    ANSWER {
        string itemId
        string value
        string state
    }
    CORRECTION {
        number percentage
        string state
        string origin
    }
    CORRECTION_EVENT {
        string previousValue
        string nextValue
        string reason
        string actor
    }
    AUDIT_EVENT {
        string actor
        string action
        datetime timestamp
    }
```

## Vincoli

- `questionIndex` è derivato dai pool; Markdown in Cloud Storage resta la fonte canonica. `difficolta` e `peso` sono valori `1`/`2`/`3` e `maxPoints` = `difficolta × peso` (1–9).
- `questionIndex` è riallineato esclusivamente tramite re-import dall'interfaccia: modifiche dirette ai file in Storage senza re-import lasciano l'indice desincronizzato.
- `deliveryAttempt` esiste solo per il canale digitale. Il canale cartaceo è puramente fisico e non crea record di tentativo né voci di `accessLog`; al più incrementa il contatore atomico `VERIFICATION.downloadCount`.
- Il tentativo digitale è protetto da un participant lock per verifica e nome+cognome normalizzati; non esiste alcun lock basato su email.
- `accessLog` registra ogni tentativo di accesso digitale (`declaredName` nel formato `Cognome Nome`, `declaredIp`, `userAgent`, `timestamp`) e alimenta il Report Accessi del docente. È un log di audit, non una prova d'identità.
- `snapshot/items` esiste solo per tentativi digitali, è creato dalla Cloud Function `startDigitalAttempt` ed è immutabile dal momento dell'avvio. La configurazione della verifica resta invece sempre modificabile dal docente. Il campo `soluzione` non è mai esposto al client portale.
- PDF, export didattici e programma svolto non sono entità Firestore o Cloud Storage.
- `OWNER_SETTINGS.classes` è la lista di classi configurata dal docente; usata in `VERIFICATION.config.classes` e come menu nel portale.
