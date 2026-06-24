# SchoolForge — Modello dati ER

**Versione:** 2.0
**Data:** 24 giugno 2026
**Riferimento:** [Architettura v2.0](../architettura.md), sezione 8.2

Questo diagramma rappresenta il modello dati operativo in Cloud Firestore. Le collezioni di Cloud Storage (`repository/current/`, `staging/`, `exports/`) non sono incluse perché non hanno relazioni Firestore; la loro struttura è in [architettura.md](../architettura.md), sezione 8.1.

In v2.0 **non** esistono più le collezioni `classes`, `assignments`, `artifacts` e `integrationStatus` (eliminate con Forms/roster/Drive). È introdotta la collezione `burned` per l'email bruciata. Gli `exam_items` non contengono rubriche.

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
        string schoolYear
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
        array competenze
        array obiettivi
        string periodo
        number ore
        boolean svolto
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
        string poolPath
        string status
        array validationErrors
        string plainText
        boolean svolto
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    QUESTION_INDEX {
        string id PK
        string lessonId FK
        string tipo
        string difficolta
        string peso
        string testo
        boolean availability
        string ownerUid
        timestamp indexedAt
    }

    EXAMS {
        string id PK
        string title
        string status
        array sourceLessonIds
        map configuration
        number seed
        timestamp activatedAt
        timestamp closedAt
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    EXAM_ITEMS {
        string id PK
        string examId FK
        string testo
        string tipo
        string difficolta
        string peso
        array opzioni
        array correctOptionIds
        string soluzione
        number punteggioMax
        string sourceLessonId FK
        map aiProvenance
    }

    BURNED_EMAILS {
        string email PK
        string examId FK
        string channel
        timestamp burnedAt
    }

    STUDENTS {
        string id PK
        string email
        string firstName
        string lastName
        string className
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    SUBMISSIONS {
        string id PK
        string examId FK
        string studentId FK
        string email
        string classNameAtSubmission
        array risposte
        string channel
        timestamp submittedAt
        string ownerUid
    }

    CORRECTIONS {
        string submissionId PK_FK
        array items
        number percentuale
        boolean percentageIsDefinitive
        string stato
        string ownerUid
        timestamp createdAt
        timestamp updatedAt
    }

    AUDIT_EVENTS {
        string id PK
        string attore
        string azione
        string oggettoType
        string oggettoId
        timestamp timestamp
        string esito
        string motivazione
        map minimalData
        string ownerUid
    }

    PROGRAMS ||--o{ UDAS : "contiene"
    UDAS ||--o{ LESSONS : "contiene"
    LESSONS ||--o{ QUESTION_INDEX : "indicizza domande pool da"
    LESSONS }o--o{ EXAM_ITEMS : "origine di (via sourceLessonId)"
    EXAMS ||--|{ EXAM_ITEMS : "ha items (subcollection, snapshot)"
    EXAMS ||--o{ BURNED_EMAILS : "registra email bruciate (subcollection)"
    EXAMS ||--o{ SUBMISSIONS : "riceve consegne"
    STUDENTS ||--o{ SUBMISSIONS : "ha consegnato"
    SUBMISSIONS ||--|| CORRECTIONS : "ha correzione"
```

---

## Note sul modello

### `EXAM_ITEMS` è una subcollection di `EXAMS`
In Firestore: `exams/{examId}/items/{itemId}`. È lo **snapshot immutabile** creato in transazione al momento dell'attivazione. Solo il backend scrive, e solo in quel momento. Non contiene rubriche: il punteggio massimo è `coeff_difficoltà × coeff_peso`.

### `BURNED_EMAILS` è una subcollection di `EXAMS`
In Firestore: `burned/{examId}/emails/{email}` (la chiave è l'email normalizzata). Né docente né studente vi accedono direttamente: la verifica-e-scrittura è una transazione atomica del solo backend (vedi architettura §8.3 e sicurezza §3.2). Garantisce un download/svolgimento per email per verifica.

### `CORRECTIONS` ha chiave `submissionId`
Una Consegna ha al più una Correzione (1-a-1); la chiave coincide con quella della Consegna per evitare un join. Ogni item conserva punteggio, commento, origine (`manual`/`ai_proposed`/`automatic`) e lo storico delle rettifiche.

### `QUESTION_INDEX` non è la fonte canonica
È derivato dai file `.pool.md` correnti validi e aggiornato a ogni import/sostituzione/eliminazione. In caso di discrepanza, il Markdown in Cloud Storage è autoritativo.

### `STUDENTS` è creato lazy
Il record nasce al primo accesso al Portale (o alla prima consegna manuale) con la sola `email` come chiave univoca; nome, cognome e classe sono facoltativi e completabili in seguito dal docente.

### Integrità storica della classe
`SUBMISSIONS.classNameAtSubmission` registra la classe dichiarata al momento della consegna; un successivo aggiornamento del record studente non altera lo storico (BR-STO-01).

### `EXAM_ITEMS.aiProvenance`
Presente solo per domande generate da AI (Modulo 5): provider, modelId, templateVersion, contextHash. Nullable per domande archiviate dal pool.

### Campi presenti su ogni documento applicativo
| Campo | Tipo | Scopo |
|---|---|---|
| `ownerUid` | `string` | Semplifica i controlli di sicurezza nel backend; unico nella V1 |
| `createdAt` | `Timestamp` | Data di creazione |
| `updatedAt` | `Timestamp` | Data dell'ultimo aggiornamento |

`auditEvents`, `exam_items` e `burned` (immutabili/append-only) non hanno `updatedAt`.

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
        { "fieldPath": "tipo", "order": "ASCENDING" },
        { "fieldPath": "difficolta", "order": "ASCENDING" }
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
        { "fieldPath": "azione", "order": "ASCENDING" },
        { "fieldPath": "timestamp", "order": "DESCENDING" }
      ]
    }
  ]
}
```
