# SchoolForge — Modello dati ER

**Versione:** 1.0
**Data:** 22 giugno 2026
**Riferimento:** [Architettura v1.0](../architettura.md), sezione 7.2

Questo diagramma rappresenta il modello dati operativo in Cloud Firestore. Le collezioni di Cloud Storage (`repository/current/`, `staging/`, `exports/`) non sono incluse perché non hanno relazioni Firestore; la loro struttura è documentata in [architettura.md](../architettura.md), sezione 7.1.

---

## Diagramma ER

```mermaid
erDiagram
    SETTINGS_OWNER {
        string googleSubject PK
        string allowedEmail
        string allowedDomain
        map featureFlags
        timestamp createdAt
        timestamp updatedAt
    }

    PROGRAMS {
        string id PK
        string title
        boolean active
        number sortOrder
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    UDAS {
        string id PK
        string programId FK
        string title
        boolean active
        number sortOrder
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    LESSONS {
        string id PK
        string programId FK
        string udaId FK
        string title
        array objectives
        string storagePath
        string assetBasePath
        string status
        array validationErrors
        string plainText
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    QUESTION_INDEX {
        string id PK
        string lessonId FK
        string kind
        string type
        string difficulty
        string prompt
        boolean availability
        string ownerUid
        timestamp indexedAt
    }

    EXAMS {
        string id PK
        string status
        array sourceLessonIds
        map configuration
        timestamp publishedAt
        map googleForm
        map pdfMetadata
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    EXAM_ITEMS {
        string id PK
        string examId FK
        string prompt
        string type
        string difficulty
        array options
        array correctOptionIds
        string solution
        map rubric
        number maxScore
        string sourceLessonId FK
        map aiProvenance
    }

    CLASSES {
        string id PK
        string name
        boolean active
        string externalSource
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    STUDENTS {
        string id PK
        string classId FK
        string firstName
        string lastName
        string email
        string googleExternalId
        boolean active
        string previousEmail
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    ASSIGNMENTS {
        string id PK
        string examId FK
        string classId FK
        array studentIds
        string channel
        string status
        string formId
        timestamp createdAt
        timestamp closedAt
        string ownerUid
    }

    SUBMISSIONS {
        string id PK
        string assignmentId FK
        string examId FK
        string studentId FK
        string classIdAtSubmission
        array responses
        string origin
        string sourceResponseId
        string status
        timestamp submittedAt
        timestamp importedAt
        string ownerUid
    }

    CORRECTIONS {
        string submissionId PK_FK
        array itemScores
        array itemComments
        string provenance
        string status
        number percentage
        boolean percentageIsDefinitive
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    ARTIFACTS {
        string id PK
        string examId FK
        string submissionId FK
        string type
        string hash
        string driveUrl
        string driveFileId
        string ownerUid
        timestamp generatedAt
    }

    AUDIT_EVENTS {
        string id PK
        string actor
        string action
        string objectType
        string objectId
        timestamp timestamp
        string outcome
        string reason
        map minimalData
        string ownerUid
    }

    INTEGRATION_STATUS {
        string id PK
        string type
        boolean connected
        array scopesGranted
        string lastOutcome
        string lastErrorSafe
        timestamp lastCheckedAt
        string ownerUid
    }

    PROGRAMS ||--o{ UDAS : "contiene"
    UDAS ||--o{ LESSONS : "contiene"
    LESSONS ||--o{ QUESTION_INDEX : "indicizza domande da"
    LESSONS }o--o{ EXAM_ITEMS : "origine di (via sourceLessonId)"
    EXAMS ||--|{ EXAM_ITEMS : "ha items (subcollection)"
    EXAMS ||--o{ ASSIGNMENTS : "assegnata in"
    CLASSES ||--o{ STUDENTS : "contiene"
    CLASSES ||--o{ ASSIGNMENTS : "destinataria di"
    ASSIGNMENTS ||--o{ SUBMISSIONS : "genera"
    STUDENTS ||--o{ SUBMISSIONS : "ha consegnato"
    SUBMISSIONS ||--|| CORRECTIONS : "ha correzione"
    EXAMS ||--o{ ARTIFACTS : "ha artefatti"
    SUBMISSIONS ||--o{ ARTIFACTS : "ha artefatti"
```

---

## Note sul modello

### Relazioni implicite da capire

**`EXAM_ITEMS` è una subcollection di `EXAMS`**
In Firestore, `exams/{examId}/items/{itemId}`. Il diagramma ER la rappresenta come entità separata per chiarezza. L'immutabilità degli item è garantita dalle regole di accesso (solo backend può scrivere, e solo al momento della pubblicazione).

**`CORRECTIONS` ha chiave `submissionId` come PK**
Una Consegna ha al più una Correzione. La relazione è 1-a-1; la chiave della Correzione coincide con quella della Consegna per design, evitando un join.

**`QUESTION_INDEX` non è la fonte canonica**
Il `questionIndex` è derivato dal Markdown e aggiornato ad ogni import. In caso di discrepanza, il Markdown in Cloud Storage è autoritativo. L'indice serve per la composizione rapida; non va usato come fonte di verità per il contenuto delle domande.

**`STUDENTS.classIdAtSubmission` vs `SUBMISSIONS.classIdAtSubmission`**
Lo Studente può cambiare Classe nel tempo. La Consegna registra la Classe al momento dell'assegnazione in `classIdAtSubmission` per garantire l'integrità storica (BR-ARC-02).

**`EXAM_ITEMS.aiProvenance`**
Presente solo per domande generate da AI. Contiene provider, modelId, templateVersion, contextHash. Nullable per domande archiviate.

### Campi presenti su ogni documento applicativo

| Campo | Tipo | Scopo |
|---|---|---|
| `ownerUid` | `string` | Semplifica i controlli di sicurezza nel backend; unico nella V1 |
| `createdAt` | `Timestamp` | Data di creazione |
| `updatedAt` | `Timestamp` | Data dell'ultimo aggiornamento |

`auditEvents` e `exam_items` (immutabili) non hanno `updatedAt`.

---

## Indici Firestore richiesti (da `firestore.indexes.json`)

```json
{
  "indexes": [
    {
      "collectionGroup": "lessons",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "udaId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "questionIndex",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "lessonId", "order": "ASCENDING" },
        { "fieldPath": "kind", "order": "ASCENDING" },
        { "fieldPath": "difficulty", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "exams",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "submissions",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "examId", "order": "ASCENDING" },
        { "fieldPath": "status", "order": "ASCENDING" },
        { "fieldPath": "submittedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "submissions",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "studentId", "order": "ASCENDING" },
        { "fieldPath": "submittedAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "auditEvents",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "action", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ]
}
```
