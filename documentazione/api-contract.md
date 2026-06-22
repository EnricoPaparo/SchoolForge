# SchoolForge — Contratto API Cloud Functions

**Versione:** 1.0
**Data:** 22 giugno 2026
**Stato:** baseline
**Input vincolante:** [Architettura v1.0](architettura.md), sezione 9
**Destinatari:** team di implementazione frontend e backend

---

## 1. Convenzioni generali

### 1.1 Trasporto e autenticazione

Tutti gli endpoint sono Firebase Callable Functions HTTPS (SDK `httpsCallable`) oppure endpoint HTTP con autenticazione Bearer. Il client deve includere il token Firebase nel header `Authorization: Bearer <firebase-id-token>` per gli endpoint HTTP. Le Callable Functions gestiscono l'autenticazione tramite SDK.

Il backend verifica per ogni richiesta:

1. token Firebase valido e non scaduto;
2. soggetto Google (`sub`) corrispondente a `settings/owner.googleSubject`;
3. account/dominio corrispondente alla configurazione `settings/owner`.

Se una qualsiasi verifica fallisce, la risposta è `{ code: "UNAUTHORIZED", message: "..." }` con HTTP 403.

### 1.2 Formato risposta

```typescript
// Risposta di successo
type SuccessResponse<T> = {
  data: T;
};

// Risposta di errore
type ErrorResponse = {
  code: ErrorCode;
  message: string;       // leggibile dall'utente, senza stack trace
  details?: unknown;     // informazioni aggiuntive strutturate, mai segreti
};

type ErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'  // stato non compatibile con l'operazione
  | 'INTEGRATION_ERROR'    // errore Google Forms / roster / AI
  | 'INTERNAL_ERROR';      // errore non classificabile; loggato server-side
```

### 1.3 Operazioni con conferma

Le operazioni irreversibili o con impatto storico richiedono un campo `confirmation: true` nel payload. Il backend verifica questo campo come prerequisito, ma non lo sostituisce alla validazione delle precondizioni di business.

### 1.4 Paginazione

Le liste che possono crescere nel tempo (storico, consegne, audit) usano cursor-based pagination:

```typescript
type PaginatedRequest = {
  pageSize: number;   // max 100
  cursor?: string;    // opaque cursor dalla risposta precedente
};

type PaginatedResponse<T> = {
  items: T[];
  nextCursor?: string;  // assente se è l'ultima pagina
  totalCount?: number;  // quando computabile senza full scan
};
```

### 1.5 Versionamento dell'API

La V1 non usa prefisso di versione negli endpoint: tutti i percorsi sono a radice (`/api/*`). Le breaking change richiedono un nuovo endpoint con suffisso versione e deprecazione esplicita dell'endpoint precedente tramite log di warning e header `Deprecation`.

---

## 2. Modulo Autorizzazione

### `getSession`

Restituisce la configurazione della sessione corrente del Docente.

**Callable Function:** `getSession`

**Request:** `{}`

**Response:**
```typescript
type GetSessionResponse = {
  ownerEmail: string;
  ownerDisplayName: string;
  featureFlags: {
    googleFormsEnabled: boolean;
    rosterImportEnabled: boolean;
    aiEnabled: boolean;
    aiAutoCorrectEnabled: boolean;
  };
};
```

**Errori:** `UNAUTHORIZED`

---

### `getOwnerConfiguration`

Restituisce la configurazione completa del proprietario (solo per setup iniziale e pannello impostazioni).

**Callable Function:** `getOwnerConfiguration`

**Request:** `{}`

**Response:**
```typescript
type GetOwnerConfigurationResponse = {
  googleSubject: string;
  allowedEmail: string;
  allowedDomain: string | null;
  featureFlags: Record<string, boolean>;
  integrations: {
    googleForms: { connected: boolean; lastError?: string };
    rosterApi: { connected: boolean; lastError?: string };
    aiProvider: { connected: boolean; provider?: string };
  };
};
```

**Errori:** `UNAUTHORIZED`

---

## 3. Modulo Repository

### `createProgram`

**Callable Function:** `createProgram`

**Request:**
```typescript
type CreateProgramRequest = {
  title: string;          // non vuoto, max 200 caratteri
  sortOrder?: number;
};
```

**Response:**
```typescript
type CreateProgramResponse = {
  programId: string;
};
```

**Errori:** `UNAUTHORIZED`, `VALIDATION_ERROR`

---

### `updateProgram`

**Callable Function:** `updateProgram`

**Request:**
```typescript
type UpdateProgramRequest = {
  programId: string;
  title?: string;
  sortOrder?: number;
  active?: boolean;
};
```

**Note:** La disattivazione (`active: false`) è consentita solo se non esistono Lezioni o UDA attive collegate. Altrimenti: `PRECONDITION_FAILED`.

**Response:** `{ programId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `PRECONDITION_FAILED`

---

### `createUda`

**Callable Function:** `createUda`

**Request:**
```typescript
type CreateUdaRequest = {
  programId: string;
  title: string;
  sortOrder?: number;
};
```

**Response:** `{ udaId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND` (programId), `VALIDATION_ERROR`

---

### `updateUda`

**Callable Function:** `updateUda`

**Request:**
```typescript
type UpdateUdaRequest = {
  udaId: string;
  title?: string;
  sortOrder?: number;
  active?: boolean;
};
```

**Response:** `{ udaId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `PRECONDITION_FAILED`

---

### `stageImport`

Inizia il processo di importazione: restituisce URL firmati per il caricamento dei file in staging. Il client usa questi URL per caricare direttamente su Cloud Storage senza passare attraverso le Functions.

**Callable Function:** `stageImport`

**Request:**
```typescript
type StageImportRequest = {
  files: Array<{
    relativePath: string;  // percorso relativo alla radice dell'import
    contentType: string;
    sizeBytes: number;
  }>;
};
```

**Response:**
```typescript
type StageImportResponse = {
  importId: string;
  uploadUrls: Array<{
    relativePath: string;
    signedUrl: string;        // scadenza 30 minuti
  }>;
  expiresAt: string;          // ISO 8601
};
```

**Errori:** `UNAUTHORIZED`, `VALIDATION_ERROR` (file troppo grandi, tipi non consentiti)

**Limiti:** max 200 file per importazione; max 50 MB per file; max 500 MB totali per importazione.

---

### `previewImport`

Dopo il caricamento in staging, richiede al backend di analizzare i file e restituire un piano di importazione.

**Callable Function:** `previewImport`

**Request:**
```typescript
type PreviewImportRequest = {
  importId: string;
};
```

**Response:**
```typescript
type PreviewImportResponse = {
  validLessons: Array<{
    relativePath: string;
    lessonId: string;
    title: string;
    programId: string;
    udaId: string;
    action: 'create' | 'replace';
    assetCount: number;
  }>;
  invalidFiles: Array<{
    relativePath: string;
    errors: Array<{ line: number; message: string }>;
  }>;
  conflicts: Array<{
    lessonId: string;
    existingTitle: string;
    incomingTitle: string;
  }>;
  missingAssets: Array<{
    lessonRelativePath: string;
    assetRelativePath: string;
  }>;
  unknownPrograms: string[];   // program_id nel front matter non presenti in Firestore
  unknownUdas: string[];       // uda_id nel front matter non presenti in Firestore
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND` (importId non trovato o scaduto), `INTERNAL_ERROR`

---

### `commitImport`

Promuove i file validati dallo staging al repository corrente.

**Callable Function:** `commitImport`

**Request:**
```typescript
type CommitImportRequest = {
  importId: string;
  confirmation: true;
  selectedLessonIds: string[];  // sottoinsieme dei lessonId da previewImport.validLessons
};
```

**Response:**
```typescript
type CommitImportResponse = {
  committed: number;
  skipped: number;
};
```

**Note:** Operazione atomica visibile. Se fallisce a metà, nessuna Lezione viene promossa. Il backend pulisce lo staging dopo il commit o in caso di errore.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (importId scaduto), `INTERNAL_ERROR`

---

### `replaceLesson`

Sostituisce una singola Lezione con un nuovo file Markdown (stesso `id`).

**Callable Function:** `replaceLesson`

**Request:**
```typescript
type ReplaceLessonRequest = {
  lessonId: string;
  importId: string;      // importId contenente il nuovo file già in staging
  confirmation: true;
};
```

**Response:** `{ lessonId: string; validationStatus: 'valid' | 'invalid'; errors?: ValidationError[] }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT` (id mismatch)

---

### `deleteLesson`

Elimina la Lezione corrente dal repository. Non modifica Verifiche esistenti.

**Callable Function:** `deleteLesson`

**Request:**
```typescript
type DeleteLessonRequest = {
  lessonId: string;
  confirmation: true;
};
```

**Response:** `{ lessonId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`

---

### `exportRepository`

Genera un export ZIP del repository. L'operazione è asincrona; il link al file viene restituito quando pronto.

**Callable Function:** `exportRepository`

**Request:** `{}`

**Response:**
```typescript
type ExportRepositoryResponse = {
  exportId: string;
  downloadUrl: string;    // URL firmato, scadenza 1 ora
  generatedAt: string;    // ISO 8601
  lessonCount: number;
};
```

**Errori:** `UNAUTHORIZED`, `INTERNAL_ERROR`

---

## 4. Modulo Verifiche

### `createExamDraft`

**Callable Function:** `createExamDraft`

**Request:**
```typescript
type CreateExamDraftRequest = {
  title: string;
  sourceLessonIds: string[];   // almeno uno; le UDA vengono risolte lato backend
  sourceUdaIds?: string[];
  configuration: {
    totalQuestions: number;
    openQuestions: number;
    closedQuestions: number;
    difficulty: 'base' | 'intermedia' | 'avanzata' | 'mista';
    difficultyDistribution?: {  // obbligatorio se difficulty === 'mista'
      base: number;
      intermedia: number;
      avanzata: number;
    };
  };
};
```

**Response:**
```typescript
type CreateExamDraftResponse = {
  examId: string;
  resolvedLessonIds: string[];      // lezioni deduplicatem valide incluse
  availableQuestions: {
    total: number;
    open: number;
    closed: { base: number; intermedia: number; avanzata: number };
  };
  shortfall?: {                      // presente se il corpus non copre la configurazione
    open: number;
    closed: { base: number; intermedia: number; avanzata: number };
    aiRequired: boolean;
  };
};
```

**Errori:** `UNAUTHORIZED`, `VALIDATION_ERROR`, `PRECONDITION_FAILED` (nessuna lezione valida selezionata)

---

### `composeExam`

Aggiorna la composizione della bozza con le domande selezionate.

**Callable Function:** `composeExam`

**Request:**
```typescript
type ComposeExamRequest = {
  examId: string;
  items: Array<{
    questionId: string;
    source: 'archived' | 'ai_generated';
    // campi opzionali per domande generate da AI o modificate manualmente
    overridePrompt?: string;
    overrideSolution?: string;
    overrideRubric?: Rubric;
    overrideMaxScore?: number;
  }>;
};
```

**Response:**
```typescript
type ComposeExamResponse = {
  examId: string;
  status: 'bozza' | 'in_revisione';
  completenessCheck: {
    missingSolutions: string[];     // questionId senza soluzione
    missingRubrics: string[];
    missingMaxScores: string[];
  };
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (exam non in stato bozza/in_revisione)

---

### `publishExam`

Congela la Verifica e la rende immutabile.

**Callable Function:** `publishExam`

**Request:**
```typescript
type PublishExamRequest = {
  examId: string;
  confirmation: true;
};
```

**Note:** Il backend esegue una transazione Firestore che verifica completezza (soluzioni, rubriche, punteggi), scrive gli item nella subcollection `exams/{examId}/items`, imposta `status: 'pubblicata'` e crea un audit event. Se la verifica non è completa: `PRECONDITION_FAILED` con lista degli item mancanti.

**Response:** `{ examId: string; publishedAt: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`, `CONFLICT` (già pubblicata)

---

### `cancelExam`

**Callable Function:** `cancelExam`

**Request:**
```typescript
type CancelExamRequest = {
  examId: string;
  reason: string;
  confirmation: true;
};
```

**Response:** `{ examId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (esame con consegne non può essere annullato)

---

### `generatePdf`

**Callable Function:** `generatePdf`

**Request:**
```typescript
type GeneratePdfRequest = {
  examId: string;
  type: 'exam' | 'solution' | 'rubric';
};
```

**Response:**
```typescript
type GeneratePdfResponse = {
  artifactId: string;
  downloadUrl: string;    // URL firmato, scadenza 1 ora
  generatedAt: string;
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (exam deve essere in stato `pronta` o `pubblicata`)

---

## 5. Modulo Google Forms

### `connectGoogleForms`

Avvia il flusso OAuth per collegare l'account Google Forms del Docente.

**Callable Function:** `connectGoogleForms`

**Request:** `{}`

**Response:**
```typescript
type ConnectGoogleFormsResponse = {
  authorizationUrl: string;  // URL a cui reindirizzare il browser per il consenso OAuth
  state: string;             // CSRF token per il callback
};
```

**Errori:** `UNAUTHORIZED`, `CONFLICT` (già connesso)

---

### `createGoogleForm`

Crea un Google Form a partire da una Verifica pubblicata.

**Callable Function:** `createGoogleForm`

**Request:**
```typescript
type CreateGoogleFormRequest = {
  examId: string;
};
```

**Response:**
```typescript
type CreateGoogleFormResponse = {
  formId: string;
  formUrl: string;
  editUrl: string;
  incompatibilities: Array<{
    questionId: string;
    reason: string;       // es. "tipo non supportato da Google Forms"
  }>;
};
```

**Note:** Se `incompatibilities` non è vuoto ma non è bloccante, il Form viene creato con un avviso. Se ci sono incompatibilità bloccanti: `PRECONDITION_FAILED`.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`, `INTEGRATION_ERROR`

---

### `importFormResponses`

**Callable Function:** `importFormResponses`

**Request:**
```typescript
type ImportFormResponsesRequest = {
  assignmentId: string;
};
```

**Response:**
```typescript
type ImportFormResponsesResponse = {
  imported: number;
  alreadyPresent: number;    // import idempotente
  quarantined: number;       // risposte senza mapping certo
  quarantineIds: string[];   // submissionId in quarantena per revisione
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (assignment senza Form collegato), `INTEGRATION_ERROR`

---

## 6. Modulo Anagrafica

### `listClasses`

**Callable Function:** `listClasses`

**Request:**
```typescript
type ListClassesRequest = {
  includeInactive?: boolean;
} & PaginatedRequest;
```

**Response:** `PaginatedResponse<ClassSummary>`

```typescript
type ClassSummary = {
  classId: string;
  name: string;
  active: boolean;
  studentCount: number;
  externalSource?: 'google_education';
};
```

---

### `saveClass`

Crea o aggiorna una Classe.

**Callable Function:** `saveClass`

**Request:**
```typescript
type SaveClassRequest = {
  classId?: string;   // assente = crea; presente = aggiorna
  name: string;
  active?: boolean;
};
```

**Response:** `{ classId: string }`

**Errori:** `UNAUTHORIZED`, `VALIDATION_ERROR`, `CONFLICT` (nome duplicato)

---

### `saveStudent`

**Callable Function:** `saveStudent`

**Request:**
```typescript
type SaveStudentRequest = {
  studentId?: string;
  firstName: string;
  lastName: string;
  email: string;
  classId: string;
  active?: boolean;
};
```

**Response:** `{ studentId: string }`

**Errori:** `UNAUTHORIZED`, `VALIDATION_ERROR`, `CONFLICT` (email duplicata tra studenti attivi)

---

### `previewRosterImport`

**Callable Function:** `previewRosterImport`

**Request:** `{}`

**Response:**
```typescript
type PreviewRosterImportResponse = {
  toCreate: Array<{ classId?: string; name: string; students: StudentPreview[] }>;
  toUpdate: Array<{ classId: string; changes: Record<string, unknown> }>;
  toArchive: Array<{ classId?: string; studentId?: string; reason: string }>;
  warnings: string[];
};
```

**Errori:** `UNAUTHORIZED`, `INTEGRATION_ERROR`, `PRECONDITION_FAILED` (roster non connesso)

---

### `applyRosterImport`

**Callable Function:** `applyRosterImport`

**Request:**
```typescript
type ApplyRosterImportRequest = {
  confirmation: true;
  selectedChanges: {
    createClassIds: string[];
    updateClassIds: string[];
    archiveClassIds: string[];
    createStudentIds: string[];
    updateStudentIds: string[];
    archiveStudentIds: string[];
  };
};
```

**Response:** `{ applied: number; skipped: number }`

**Errori:** `UNAUTHORIZED`, `PRECONDITION_FAILED`, `INTEGRATION_ERROR`

---

## 7. Modulo Archivio

### `createAssignment`

**Callable Function:** `createAssignment`

**Request:**
```typescript
type CreateAssignmentRequest = {
  examId: string;
  channel: 'pdf' | 'google_forms';
  recipientType: 'class' | 'students';
  classId?: string;
  studentIds?: string[];
  notes?: string;
};
```

**Response:** `{ assignmentId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `PRECONDITION_FAILED` (exam non pubblicata)

---

### `closeAssignment`

**Callable Function:** `closeAssignment`

**Request:**
```typescript
type CloseAssignmentRequest = {
  assignmentId: string;
  confirmation: true;
};
```

**Response:** `{ assignmentId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`

---

### `createManualSubmission`

**Callable Function:** `createManualSubmission`

**Request:**
```typescript
type CreateManualSubmissionRequest = {
  assignmentId: string;
  studentId: string;
  responses: Array<{
    examItemId: string;
    responseText?: string;
    selectedOptionIds?: string[];
  }>;
  submittedAt?: string;  // ISO 8601; default: ora corrente
  notes?: string;
};
```

**Response:** `{ submissionId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT` (consegna già esistente per studentId+assignmentId)

---

### `resolveQuarantine`

**Callable Function:** `resolveQuarantine`

**Request:**
```typescript
type ResolveQuarantineRequest = {
  submissionId: string;
  resolution: 'assign_student' | 'discard';
  studentId?: string;   // obbligatorio se resolution === 'assign_student'
  reason?: string;
};
```

**Response:** `{ submissionId: string; newStatus: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`

---

### `recordDriveArtifact`

**Callable Function:** `recordDriveArtifact`

**Request:**
```typescript
type RecordDriveArtifactRequest = {
  examId?: string;
  submissionId?: string;
  type: 'exam_pdf' | 'solution_pdf' | 'rubric_pdf' | 'submission_pdf';
  driveUrl: string;
  driveFileId?: string;
};
```

**Note:** Almeno uno tra `examId` e `submissionId` deve essere presente.

**Response:** `{ artifactId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`

---

### `updateCorrection`

**Callable Function:** `updateCorrection`

**Request:**
```typescript
type UpdateCorrectionRequest = {
  submissionId: string;
  itemCorrections: Array<{
    examItemId: string;
    score: number;
    comment?: string;
    reason?: string;    // obbligatorio se sostituisce un valore già presente
  }>;
};
```

**Response:**
```typescript
type UpdateCorrectionResponse = {
  submissionId: string;
  percentage: number | 'non_definitiva';
  correctionStatus: 'in_progress' | 'complete';
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR` (score > maxScore)

---

## 8. Modulo AI (Fase 4)

### `generateQuestions`

**Callable Function:** `generateQuestions`

**Request:**
```typescript
type GenerateQuestionsRequest = {
  examId: string;
  lessonIds: string[];
  count: number;
  type: 'open' | 'closed_single' | 'closed_multiple';
  difficulty: 'base' | 'intermedia' | 'avanzata';
};
```

**Response:**
```typescript
type GenerateQuestionsResponse = {
  proposals: Array<{
    proposalId: string;
    prompt: string;
    type: string;
    difficulty: string;
    options?: Array<{ id: string; text: string }>;
    correctOptionIds?: string[];
    solution: string;
    rubric: Rubric;
    maxScore: number;
    sourceLessonId: string;
    provenance: AiProvenance;
  }>;
};

type AiProvenance = {
  provider: string;
  modelId: string;
  templateVersion: string;
  contextHash: string;
  generatedAt: string;
};
```

**Errori:** `UNAUTHORIZED`, `PRECONDITION_FAILED` (AI non configurata), `INTEGRATION_ERROR`

---

### `proposeCorrection`

**Callable Function:** `proposeCorrection`

**Request:**
```typescript
type ProposeCorrectionRequest = {
  submissionId: string;
  consentGiven: true;   // consenso esplicito per invio dati a provider AI
};
```

**Response:**
```typescript
type ProposeCorrectionResponse = {
  proposals: Array<{
    examItemId: string;
    proposedScore: number;
    reasoning: string;
    criteriaApplied: string[];
    provenance: AiProvenance;
    status: 'proposed';
  }>;
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (AI non configurata o dati mancanti)

---

### `bulkApproveCorrections`

**Callable Function:** `bulkApproveCorrections`

**Request:**
```typescript
type BulkApproveCorrectionRequest = {
  examId?: string;
  submissionIds?: string[];  // almeno uno tra examId e submissionIds
  confirmation: true;
};
```

**Response:**
```typescript
type BulkApproveCorrectionResponse = {
  approved: number;
  skipped: number;        // proposte bloccate, incomplete, già modificate
  skippedIds: string[];   // submissionId esclusi con motivo
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`

---

## 9. Codici di errore di dominio

| Codice | Significato | Azione UI suggerita |
|---|---|---|
| `UNAUTHORIZED` | Token mancante, scaduto o soggetto non autorizzato | Reindirizza al login |
| `FORBIDDEN` | Autenticato ma senza permesso sull'oggetto specifico | Messaggio e torna alla lista |
| `NOT_FOUND` | Oggetto non trovato o già eliminato | Messaggio e aggiorna la lista |
| `VALIDATION_ERROR` | Input non conforme allo schema o alle regole di business | Mostra errori inline per campo |
| `CONFLICT` | Violazione unicità o stato incompatibile concorrente | Ricarica e mostra lo stato attuale |
| `PRECONDITION_FAILED` | Lo stato dell'oggetto non consente l'operazione | Messaggio con stato attuale e azione disponibile |
| `INTEGRATION_ERROR` | Errore Google Forms / roster / AI | Messaggio con suggerimento di percorso manuale alternativo |
| `INTERNAL_ERROR` | Errore non classificabile (loggato server-side) | Messaggio generico; codice di correlazione per supporto |

---

## Appendice A — Tipi condivisi

```typescript
type ValidationError = {
  line?: number;
  field?: string;
  message: string;
};

type Rubric = {
  maxScore: number;
  criteria: Array<{
    id: string;
    description: string;
    maxScore: number;
  }>;
};

type StudentPreview = {
  firstName: string;
  lastName: string;
  email: string;
  googleExternalId?: string;
};
```
