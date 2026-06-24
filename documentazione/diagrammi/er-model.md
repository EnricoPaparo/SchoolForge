# SchoolForge — Modello dati Firestore

```mermaid
erDiagram
    OWNER_SETTINGS ||--o{ PROGRAM : owns
    PROGRAM ||--o{ UDA : contains
    UDA ||--o{ LESSON : contains
    LESSON ||--o{ QUESTION_INDEX : derives
    VERIFICATION ||--o{ PARTICIPANT_LOCK : protects
    VERIFICATION ||--o{ DELIVERY_ATTEMPT : receives
    DELIVERY_ATTEMPT ||--o{ SNAPSHOT_ITEM : contains
    DELIVERY_ATTEMPT ||--o{ ANSWER : contains
    DELIVERY_ATTEMPT ||--o| CORRECTION : receives
    CORRECTION ||--o{ CORRECTION_EVENT : records
    OWNER_SETTINGS ||--o{ AUDIT_EVENT : produces

    OWNER_SETTINGS { string ownerUid }
    LESSON { string storagePath string validationStatus }
    QUESTION_INDEX { string questionRef string difficulty string weight }
    VERIFICATION { string state string publicTokenHash object config object publishedQuestionSnapshot }
    PARTICIPANT_LOCK { string participantKeyHash string channel string attemptId }
    DELIVERY_ATTEMPT { string verificationId string state object declaredData }
    SNAPSHOT_ITEM { string questionText object options string solution number maxPoints }
    ANSWER { string itemId string value string state }
    CORRECTION { number percentage string state }
    CORRECTION_EVENT { string previousValue string nextValue string reason }
    AUDIT_EVENT { string actor string action datetime timestamp }
```

## Vincoli

- `questionIndex` è derivato dai pool; Markdown in Cloud Storage resta la fonte canonica.
- `participantLocks/{participantKeyHash}` è unico per verifica e collega entrambi i canali; contiene HMAC di nome/cognome normalizzati, non email.
- Il `publishedQuestionSnapshot` è creato all'attivazione e rende stabile una verifica anche se le lezioni correnti cambiano.
- Gli item snapshot esistono solo per tentativi digitali e diventano immutabili alla consegna.
- PDF ed export non sono entità Firestore o Cloud Storage.
