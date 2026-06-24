# SchoolForge — Modello dati Firestore

```mermaid
erDiagram
    OWNER_SETTINGS ||--o{ PROGRAM : owns
    PROGRAM ||--o{ IMPORT : "points to active"
    IMPORT ||--o{ UDA : contains
    UDA ||--o{ LESSON : contains
    LESSON ||--o{ QUESTION_INDEX : derives
    VERIFICATION ||--o{ DELIVERY_ATTEMPT : "receives (solo digitale)"
    VERIFICATION ||--o{ PARTICIPANT_LOCK : protects
    VERIFICATION ||--|| PUBLIC_VERIFICATION_LINK : exposes
    VERIFICATION ||--o{ PUBLISHED_SNAPSHOT_ITEM : freezes
    VERIFICATION ||--o{ PUBLISHED_PROJECTION_ITEM : exposes
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
    PROGRAM {
        string activeImportId
    }
    IMPORT {
        string importId
        string status
        datetime createdAt
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
    PUBLIC_VERIFICATION_LINK {
        string tokenHash
        string verificationId
        string state
    }
    PUBLISHED_SNAPSHOT_ITEM {
        string questionId
        string soluzione
        number maxPoints
    }
    PUBLISHED_PROJECTION_ITEM {
        string questionId
        string testo
        object opzioni
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
- `questionIndex` è riallineato esclusivamente tramite re-import dall'interfaccia. Un import viene preparato sotto `importId`; solo la transazione che cambia `PROGRAM.activeImportId` lo rende visibile.
- `deliveryAttempt` esiste solo per il canale digitale. Il canale cartaceo è puramente fisico e non crea record di tentativo né voci di `accessLog`; al più incrementa il contatore atomico `VERIFICATION.downloadCount`.
- Il tentativo digitale è protetto da un participant lock per verifica e nome+cognome normalizzati; non esiste alcun lock basato su email.
- `PUBLIC_VERIFICATION_LINK` è indicizzato dall'hash del token URL e consente soltanto il lookup pubblico puntuale; non è elencabile né contiene configurazione o soluzioni.
- `accessLog` registra ogni tentativo di accesso digitale (`declaredName` nel formato `Cognome Nome`, `declaredIp`, `userAgent`, `timestamp`) e alimenta il Report Accessi del docente. È un log di audit, non una prova d'identità.
- `PUBLISHED_SNAPSHOT_ITEM` congela fonti, regole, candidati e soluzioni all'attivazione. La configurazione è modificabile solo in bozza; per cambiare una verifica pubblicata si crea una nuova bozza. `snapshot/items` esiste solo per tentativi digitali, è creato dalla Cloud Function ed è immutabile dal momento dell'avvio. Il campo `soluzione` non è mai esposto al client portale.
- PDF, export didattici e programma svolto non sono entità Firestore o Cloud Storage.
- `OWNER_SETTINGS.classes` è la lista di classi configurata dal docente; usata in `VERIFICATION.config.classes` e come menu nel portale.
