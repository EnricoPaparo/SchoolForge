# SchoolForge — Modello dati Firestore

```mermaid
erDiagram
    OWNER_SETTINGS ||--o{ PROGRAM : owns
    PROGRAM ||--o{ UDA : contains
    UDA ||--o{ LESSON : contains
    LESSON ||--o{ QUESTION_INDEX : derives
    VERIFICATION ||--o{ RECIPIENT_LOCK : protects
    VERIFICATION ||--o{ DELIVERY_ATTEMPT : receives
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
        string difficolta
        string peso
        number maxPoints
        boolean valid
    }
    VERIFICATION {
        string state
        string publicTokenHash
        object config
        string[] classes
    }
    RECIPIENT_LOCK {
        string emailHash
        string channel
        string attemptId
        string state
    }
    DELIVERY_ATTEMPT {
        string verificationId
        string channel
        object declaredData
        string state
        string resumeTokenHash
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

- `questionIndex` è derivato dai pool; Markdown in Cloud Storage resta la fonte canonica.
- `recipientLocks/{emailHash}` è unico per verifica e blocca entrambi i canali: lo stesso hash non può avere due lock distinti.
- `snapshot/items` esiste solo per tentativi digitali, è creato dalla Cloud Function `startDigitalAttempt` e diventa immutabile alla consegna. Il campo `soluzione` non è mai esposto al client portale.
- PDF, export didattici e programma svolto non sono entità Firestore o Cloud Storage.
- `OWNER_SETTINGS.classes` è la lista di classi configurata dal docente; usata in `VERIFICATION.config.classes` e come menu nel portale.
