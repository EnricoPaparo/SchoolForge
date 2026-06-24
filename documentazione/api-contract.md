# SchoolForge — Contratto API Cloud Functions

**Versione:** 2.0
**Data:** 24 giugno 2026
**Stato:** baseline
**Input vincolante:** [Architettura v2.0](architettura.md), sezioni 9 e 10; [Analisi dei requisiti v2.0](analisi-requisiti.md)
**Destinatari:** team di implementazione frontend e backend

---

## 1. Convenzioni generali

### 1.1 Trasporto e autenticazione

Tutti gli endpoint sono Firebase Callable Functions HTTPS (SDK `httpsCallable`) oppure endpoint HTTP con autenticazione Bearer. Il client deve includere il token Firebase nell'header `Authorization: Bearer <firebase-id-token>` per gli endpoint HTTP. Le Callable Functions gestiscono l'autenticazione tramite SDK.

Esistono **due superfici di autenticazione distinte**:

- **Docente** (web app): il backend verifica per ogni richiesta token Firebase valido, soggetto Google (`sub`) corrispondente a `settings/owner.googleSubject` e account/dominio corrispondente alla configurazione `settings/owner`. Se una verifica fallisce: `UNAUTHORIZED` con HTTP 403.
- **Studente** (Portale Verifiche): il backend verifica token Firebase Google valido e appartenenza dell'email al dominio Education configurato. Lo studente non è proprietario: può invocare solo gli endpoint del Modulo Portale (§5) e solo per la verifica indicata dal link. Ogni altro endpoint risponde `FORBIDDEN`.

Gli endpoint pubblici del Portale che precedono l'autenticazione studente (es. `getExamPublic`) non restituiscono mai soluzioni, opzioni corrette o configurazioni interne.

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
  | 'EMAIL_BURNED'         // email già usata per questa verifica (download/svolgimento)
  | 'INTEGRATION_ERROR'    // errore provider AI (Modulo 5)
  | 'INTERNAL_ERROR';      // errore non classificabile; loggato server-side
```

### 1.3 Operazioni con conferma

Le operazioni irreversibili o con impatto storico (`activateExam`, `commitImport`, `deleteLesson`, `cancelExam`, `bulkApproveCorrections`) richiedono un campo `confirmation: true` nel payload. Il backend verifica questo campo come prerequisito, ma non lo sostituisce alla validazione delle precondizioni di business.

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

### 1.6 Vincoli di perimetro v2

Coerentemente con l'architettura v2.0, questo contratto **non** espone: Google Forms, import roster Google Education, registrazione di artefatti su Google Drive, rubriche di correzione, varianti multiple della stessa verifica conservate, PDF persistenti. Qualsiasi endpoint che reintroduca questi concetti costituisce ampliamento di perimetro e richiede approvazione del committente.

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
  aiProvider: { connected: boolean; provider?: string };
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
  schoolYear?: string;    // es. "2025/2026", usato nell'export programma svolto
  sortOrder?: number;
};
```

**Response:** `{ programId: string }`

**Errori:** `UNAUTHORIZED`, `VALIDATION_ERROR`

---

### `updateProgram`

**Callable Function:** `updateProgram`

**Request:**
```typescript
type UpdateProgramRequest = {
  programId: string;
  title?: string;
  schoolYear?: string;
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
  competencies: string[];   // lista non vuota
  objectives: string[];     // lista non vuota
  period?: string;
  hours?: number;           // intero positivo
  sortOrder?: number;
};
```

**Response:** `{ udaId: string }`

**Note:** Il backend materializza il file `UDA.md` corrispondente in `repository/current`; il docente non edita il file a mano.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND` (programId), `VALIDATION_ERROR`

---

### `updateUda`

**Callable Function:** `updateUda`

**Request:**
```typescript
type UpdateUdaRequest = {
  udaId: string;
  title?: string;
  competencies?: string[];
  objectives?: string[];
  period?: string;
  hours?: number;
  sortOrder?: number;
  active?: boolean;
  svolto?: boolean;         // include l'UDA nell'export del programma svolto
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

Dopo il caricamento in staging, richiede al backend di analizzare i file (lesson.md, pool.md, UDA.md e asset) e restituire un piano di importazione.

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
    hasPool: boolean;         // true se è presente il file .pool.md associato
    poolQuestionCount: number;
    assetCount: number;
  }>;
  invalidFiles: Array<{
    relativePath: string;
    errors: Array<{ line?: number; message: string }>;
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

Promuove i file validati dallo staging al repository corrente. Operazione atomica visibile.

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

**Note:** Se fallisce a metà, nessuna Lezione viene promossa. Il backend aggiorna `lessons` e `questionIndex` e pulisce lo staging dopo il commit o in caso di errore.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (importId scaduto), `INTERNAL_ERROR`

---

### `replaceLesson`

Sostituisce una singola Lezione con un nuovo file Markdown (stesso `id`). Non modifica Verifiche esistenti.

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

### `getLessonForRendering`

Restituisce il modello di una Lezione per il rendering di fruizione. Il modello è costruito server-side ed è **privo** di domande del pool, soluzioni e opzioni corrette (BR-MD-01).

**Callable Function:** `getLessonForRendering`

**Request:** `{ lessonId: string }`

**Response:**
```typescript
type GetLessonForRenderingResponse = {
  lessonId: string;
  title: string;
  objectives: string[];
  contentHtml: string;          // Markdown già renderizzato e sanificato server-side
  selfCheckQuestions: Array<{   // solo kind: self_check
    id: string;
    prompt: string;
  }>;
  // Non presenti: pool, soluzioni, opzioni corrette
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`

---

### `exportRepository`

Genera un export ZIP del repository (Markdown e asset correnti). L'operazione è asincrona; il link al file viene restituito quando pronto.

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

### `exportProgrammaSvolto`

Genera il file di testo del programma svolto per un Programma, includendo le UDA e le Lezioni flaggate come svolte.

**Callable Function:** `exportProgrammaSvolto`

**Request:**
```typescript
type ExportProgrammaSvoltoRequest = {
  programId: string;
};
```

**Response:**
```typescript
type ExportProgrammaSvoltoResponse = {
  filename: string;       // es. "programma-svolto-tpsit-3.txt"
  content: string;        // testo semplice, scaricato dal client; non conservato su Storage
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`

---

## 4. Modulo Verifiche (Docente)

### `createExamDraft`

**Callable Function:** `createExamDraft`

**Request:**
```typescript
type CreateExamDraftRequest = {
  title: string;
  sourceLessonIds?: string[];   // lezioni singole
  sourceUdaIds?: string[];      // UDA: il backend risolve tutte le lezioni valide con pool non vuoto
  configuration: {
    totalQuestions: number;
    openQuestions: number;
    closedQuestions: number;
    // livelli di difficoltà ammessi con minimo garantito per livello selezionato
    difficulty: {
      bassa?: { include: boolean; min: number };
      media?: { include: boolean; min: number };
      alta?: { include: boolean; min: number };
    };
    variant: 'tutte_uguali' | 'tutte_diverse';
  };
};
```

**Response:**
```typescript
type CreateExamDraftResponse = {
  examId: string;
  resolvedLessonIds: string[];      // lezioni deduplicate e valide incluse
  availableQuestions: {
    open: number;
    closed: number;
    byDifficulty: { bassa: number; media: number; alta: number };
  };
  shortfall?: {                      // presente se il corpus non copre la configurazione
    open: number;
    closed: number;
    byDifficulty: { bassa: number; media: number; alta: number };
    aiRequired: boolean;             // true se servirebbe l'AI per coprire il fabbisogno
  };
};
```

**Note:** Almeno uno tra `sourceLessonIds` e `sourceUdaIds` deve essere presente e risolvere almeno una lezione valida.

**Errori:** `UNAUTHORIZED`, `VALIDATION_ERROR` (es. somma minimi > totale; totale ≠ aperte + chiuse), `PRECONDITION_FAILED` (nessuna lezione valida selezionata)

---

### `composeExam`

Aggiorna la composizione della bozza con le domande selezionate dal pool e, opzionalmente, da proposte AI già approvate.

**Callable Function:** `composeExam`

**Request:**
```typescript
type ComposeExamRequest = {
  examId: string;
  items: Array<{
    questionId: string;
    source: 'archived' | 'ai_approved';
  }>;
};
```

**Response:**
```typescript
type ComposeExamResponse = {
  examId: string;
  status: 'bozza';
  completenessCheck: {
    missingSolutions: string[];     // questionId senza soluzione
    missingMaxScores: string[];
  };
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (exam non in stato bozza)

---

### `activateExam`

Congela la configurazione della Verifica e la rende immutabile e disponibile al Portale.

**Callable Function:** `activateExam`

**Request:**
```typescript
type ActivateExamRequest = {
  examId: string;
  confirmation: true;
};
```

**Note:** Il backend esegue una transazione Firestore che verifica completezza (soluzioni, punteggi massimi, almeno una domanda), copia gli item nella subcollection `exams/{examId}/items`, imposta `status: 'attiva'`, fissa il seed se `variant: 'tutte_uguali'` e crea un audit event. Se la verifica non è completa: `PRECONDITION_FAILED` con lista degli item mancanti. Dopo l'attivazione la verifica non legge più i Markdown.

**Response:** `{ examId: string; activatedAt: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`, `CONFLICT` (già attiva)

---

### `closeExam`

Chiude una Verifica attiva: non accetta nuove richieste dal Portale; le consegne esistenti restano consultabili.

**Callable Function:** `closeExam`

**Request:** `{ examId: string; confirmation: true }`

**Response:** `{ examId: string; closedAt: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (non attiva)

---

### `cancelExam`

**Callable Function:** `cancelExam`

**Request:**
```typescript
type CancelExamRequest = {
  examId: string;
  reason: string;        // obbligatorio; registrato nell'audit
  confirmation: true;
};
```

**Note:** L'annullamento non elimina Consegne o Correzioni esistenti.

**Response:** `{ examId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`

---

### `generatePdfDocente`

Genera on-demand il PDF della verifica per il Docente, con intestazione vuota e compilabile a mano. Non brucia email e non scrive su Storage.

**Callable Function:** `generatePdfDocente`

**Request:**
```typescript
type GeneratePdfDocenteRequest = {
  examId: string;
};
```

**Response:**
```typescript
type GeneratePdfDocenteResponse = {
  filename: string;
  pdfBase64: string;      // stream/base64 trasmesso al client; non conservato dal sistema
  generatedAt: string;
};
```

**Note:** Campi intestazione: titolo precompilato; nome/cognome/email/classe vuoti compilabili; nessuna data; Punti/Max Punti vuoti. Nessun record `burned` creato.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (verifica non `attiva` né `chiusa`)

---

## 5. Modulo Portale Verifiche (Studente)

Gli endpoint di questa sezione sono invocati dall'app **Portale Verifiche** su URL separato. Salvo `getExamPublic`, richiedono autenticazione Google studente con email del dominio Education configurato.

### `getExamPublic`

Restituisce lo stato pubblico minimo di una Verifica a partire dal link. Non richiede autenticazione studente e non espone domande, soluzioni o configurazione.

**Callable Function:** `getExamPublic`

**Request:**
```typescript
type GetExamPublicRequest = {
  examId: string;
};
```

**Response:**
```typescript
type GetExamPublicResponse = {
  examId: string;
  title: string;
  status: 'attiva' | 'chiusa' | 'annullata';
  acceptsAccess: boolean;       // true solo se status === 'attiva'
  channels: Array<'cartaceo' | 'digitale'>;
};
```

**Errori:** `NOT_FOUND`

---

### `burnEmailAndGeneratePdf`

Canale cartaceo. Verifica atomicamente che l'email non abbia già scaricato/svolto la Verifica, crea il record `burned` e genera il PDF personalizzato.

**Callable Function:** `burnEmailAndGeneratePdf`

**Request:**
```typescript
type BurnEmailAndGeneratePdfRequest = {
  examId: string;
  firstName: string;
  lastName: string;
  email: string;          // email Google scolastica autenticata
  className?: string;     // facoltativo, non bloccante
};
```

**Response:**
```typescript
type BurnEmailAndGeneratePdfResponse = {
  filename: string;       // include nome e cognome, es. "Verifica-Reti-Mario-Rossi.pdf"
  pdfBase64: string;      // generato on-demand, non conservato
  generatedAt: string;
};
```

**Note:** La transazione legge `burned/{examId}/emails/{email}`; se assente lo crea e serve il PDF; se presente non genera nulla. Campi PDF studente: titolo, nome/cognome/email precompilati, data del giorno, classe se inserita, Punti/Max Punti vuoti.

**Errori:** `UNAUTHORIZED` (email fuori dominio Education), `NOT_FOUND`, `PRECONDITION_FAILED` (verifica non attiva), `EMAIL_BURNED` (HTTP 409)

---

### `startDigitalAttempt`

Canale digitale. Verifica/brucia l'email e restituisce le domande dello svolgimento (senza soluzioni né opzioni corrette).

**Callable Function:** `startDigitalAttempt`

**Request:**
```typescript
type StartDigitalAttemptRequest = {
  examId: string;
  firstName: string;
  lastName: string;
  email: string;
  className?: string;
};
```

**Response:**
```typescript
type StartDigitalAttemptResponse = {
  attemptId: string;
  examTitle: string;
  questions: Array<{
    examItemId: string;
    type: 'open' | 'closed_single' | 'closed_multiple';
    difficulty: 'bassa' | 'media' | 'alta';
    weight: 'basso' | 'medio' | 'alto';
    maxScore: number;                       // arrotondato a 2 decimali
    prompt: string;
    options?: Array<{ id: string; text: string }>;  // senza indicazione di correttezza
  }>;
};
```

**Note:** Brucia l'email come `burnEmailAndGeneratePdf`. Il payload non contiene mai `solution` né `correct_option_ids`.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`, `EMAIL_BURNED` (HTTP 409)

---

### `submitAnswers`

Salva le risposte dello svolgimento digitale come Consegna strutturata su Firestore.

**Callable Function:** `submitAnswers`

**Request:**
```typescript
type SubmitAnswersRequest = {
  attemptId: string;
  responses: Array<{
    examItemId: string;
    responseText?: string;          // per domande aperte
    selectedOptionIds?: string[];   // per domande chiuse
  }>;
};
```

**Response:**
```typescript
type SubmitAnswersResponse = {
  submissionId: string;
  submittedAt: string;
};
```

**Note:** La consegna è immutabile nel dato sorgente; un secondo invio per lo stesso `attemptId` è rifiutato.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`, `CONFLICT` (attempt già consegnato)

---

## 6. Modulo Correzione (Docente)

### `listSubmissions`

**Callable Function:** `listSubmissions`

**Request:**
```typescript
type ListSubmissionsRequest = {
  examId?: string;
  status?: 'da_correggere' | 'in_corso' | 'definitiva';
} & PaginatedRequest;
```

**Response:** `PaginatedResponse<SubmissionSummary>`

```typescript
type SubmissionSummary = {
  submissionId: string;
  examId: string;
  studentEmail: string;
  studentName?: string;
  className?: string;
  channel: 'portale' | 'cartacea';
  submittedAt: string;
  correctionStatus: 'da_correggere' | 'in_corso' | 'definitiva';
  percentage: number | 'non_definitiva';
};
```

**Errori:** `UNAUTHORIZED`

---

### `getSubmission`

Restituisce una Consegna con, per ogni item, testo domanda, soluzione di riferimento, punteggio massimo e risposta dello studente.

**Callable Function:** `getSubmission`

**Request:** `{ submissionId: string }`

**Response:**
```typescript
type GetSubmissionResponse = {
  submissionId: string;
  examId: string;
  studentEmail: string;
  items: Array<{
    examItemId: string;
    prompt: string;
    solution: string;
    options?: Array<{ id: string; text: string; correct: boolean }>;
    maxScore: number;
    studentResponseText?: string;
    studentSelectedOptionIds?: string[];
    assignedScore?: number;
    comment?: string;
    origin?: 'manual' | 'ai_proposed' | 'automatic';
  }>;
  percentage: number | 'non_definitiva';
  correctionStatus: 'da_correggere' | 'in_corso' | 'definitiva';
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`

---

### `createManualSubmission`

Registra una consegna cartacea inserita manualmente dal Docente per una Verifica attiva o chiusa.

**Callable Function:** `createManualSubmission`

**Request:**
```typescript
type CreateManualSubmissionRequest = {
  examId: string;
  studentEmail: string;     // crea lo studente lazy se non esiste
  firstName?: string;
  lastName?: string;
  className?: string;
  submittedAt?: string;     // ISO 8601; default: ora corrente
  notes?: string;
};
```

**Response:** `{ submissionId: string }`

**Note:** Per il cartaceo la correzione avviene fuori dal sistema; questo endpoint serve a creare il contenitore di consegna da correggere o annotare. Non duplica una consegna esistente per stesso `examId`+`studentEmail`.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`

---

### `updateItemScore`

Assegna o rettifica il punteggio e il commento di un item. Le rettifiche sono tracciate (append-only), non sovrascritture.

**Callable Function:** `updateItemScore`

**Request:**
```typescript
type UpdateItemScoreRequest = {
  submissionId: string;
  itemScores: Array<{
    examItemId: string;
    score: number;        // 0 ≤ score ≤ maxScore
    comment?: string;
    reason?: string;      // obbligatorio se sostituisce un valore già presente
  }>;
};
```

**Response:**
```typescript
type UpdateItemScoreResponse = {
  submissionId: string;
  percentage: number | 'non_definitiva';
  correctionStatus: 'in_corso' | 'definitiva';
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR` (score > maxScore; reason mancante su rettifica)

---

### `finalizeCorrection`

Marca la Correzione come definitiva quando tutti gli item hanno un punteggio.

**Callable Function:** `finalizeCorrection`

**Request:** `{ submissionId: string; confirmation: true }`

**Response:** `{ submissionId: string; percentage: number; correctionStatus: 'definitiva' }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (item privi di punteggio)

---

## 7. Modulo Storico (Docente)

### `listStudents`

**Callable Function:** `listStudents`

**Request:**
```typescript
type ListStudentsRequest = {
  query?: string;        // match su email, nome, cognome
  className?: string;
} & PaginatedRequest;
```

**Response:** `PaginatedResponse<StudentSummary>`

```typescript
type StudentSummary = {
  studentId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  className?: string;
  submissionCount: number;
};
```

**Errori:** `UNAUTHORIZED`

---

### `getStudentHistory`

**Callable Function:** `getStudentHistory`

**Request:** `{ studentId: string }`

**Response:**
```typescript
type GetStudentHistoryResponse = {
  studentId: string;
  email: string;
  results: Array<{
    examId: string;
    examTitle: string;
    percentage: number | 'non_definitiva';
    correctionStatus: string;
    submittedAt: string;
  }>;
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`

---

### `listExamResults`

**Callable Function:** `listExamResults`

**Request:**
```typescript
type ListExamResultsRequest = {
  examId: string;
} & PaginatedRequest;
```

**Response:** `PaginatedResponse<SubmissionSummary>`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`

---

### `updateStudent`

Aggiorna i campi facoltativi di uno Studente (nome, cognome, classe nel registro del docente). Non altera la classe registrata nelle Consegne storiche (BR-STO-01).

**Callable Function:** `updateStudent`

**Request:**
```typescript
type UpdateStudentRequest = {
  studentId: string;
  firstName?: string;
  lastName?: string;
  className?: string;
};
```

**Response:** `{ studentId: string }`

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `VALIDATION_ERROR`

---

## 8. Modulo AI — Modulo 5 (feature-flaggato)

Tutti gli endpoint di questa sezione rispondono `PRECONDITION_FAILED` se l'AI non è configurata (decisione C-02) e, per la modalità automatica, se C-03 non è risolta. Le invocazioni passano da `AiGateway` con contesto chiuso (lezione + domanda + soluzione + risposta), senza web né retrieval.

### `generateQuestions`

**Callable Function:** `generateQuestions`

**Request:**
```typescript
type GenerateQuestionsRequest = {
  examId: string;
  lessonIds: string[];
  count: number;
  type: 'open' | 'closed_single' | 'closed_multiple';
  difficulty: 'bassa' | 'media' | 'alta';
};
```

**Response:**
```typescript
type GenerateQuestionsResponse = {
  proposals: Array<{
    proposalId: string;
    prompt: string;
    type: string;
    difficulty: 'bassa' | 'media' | 'alta';
    weight: 'basso' | 'medio' | 'alto';
    options?: Array<{ id: string; text: string }>;
    correctOptionIds?: string[];
    solution: string;
    maxScore: number;
    sourceLessonId: string;
    provenance: AiProvenance;
  }>;
};

type AiProvenance = {
  provider: string;
  modelId: string;
  templateVersion: string;
  contextHash: string;     // hash SHA-256 del contesto inviato
  generatedAt: string;
};
```

**Note:** Una proposta diventa utilizzabile in una Verifica solo dopo approvazione esplicita del Docente (BR-VER-05).

**Errori:** `UNAUTHORIZED`, `PRECONDITION_FAILED` (AI non configurata), `INTEGRATION_ERROR`

---

### `proposeCorrection`

**Callable Function:** `proposeCorrection`

**Request:**
```typescript
type ProposeCorrectionRequest = {
  submissionId: string;
  consentGiven: true;   // consenso esplicito per invio dati a provider AI (NFR-AI-02)
};
```

**Response:**
```typescript
type ProposeCorrectionResponse = {
  proposals: Array<{
    examItemId: string;
    proposedScore: number;    // ≤ maxScore
    reasoning: string;
    provenance: AiProvenance;
    status: 'proposed' | 'blocked';   // blocked se mancano domanda/soluzione/risposta/lezione
  }>;
  styleAnomalies?: Array<{    // segnalazione consultiva, non bloccante
    examItemId: string;
    note: string;
  }>;
};
```

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED` (AI non configurata o consenso assente)

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
  skipped: number;        // proposte bloccate, incomplete o già modificate dal docente
  skippedItemIds: string[];
};
```

**Note:** Prima della conferma il client mostra numero e identificativi delle proposte incluse. Esclude automaticamente le proposte `blocked` o già gestite. Registra un audit per ogni Correzione interessata.

**Errori:** `UNAUTHORIZED`, `NOT_FOUND`, `PRECONDITION_FAILED`

---

## 9. Codici di errore di dominio

| Codice | Significato | Azione UI suggerita |
|---|---|---|
| `UNAUTHORIZED` | Token mancante, scaduto o soggetto/dominio non autorizzato | Reindirizza al login |
| `FORBIDDEN` | Autenticato ma senza permesso sull'oggetto/endpoint | Messaggio e torna alla lista |
| `NOT_FOUND` | Oggetto non trovato o già eliminato | Messaggio e aggiorna la lista |
| `VALIDATION_ERROR` | Input non conforme allo schema o alle regole di business | Mostra errori inline per campo |
| `CONFLICT` | Violazione unicità o stato incompatibile concorrente | Ricarica e mostra lo stato attuale |
| `PRECONDITION_FAILED` | Lo stato dell'oggetto non consente l'operazione | Messaggio con stato attuale e azione disponibile |
| `EMAIL_BURNED` | Email già usata per questa Verifica (HTTP 409) | Messaggio esplicito: download/svolgimento già effettuato |
| `INTEGRATION_ERROR` | Errore del provider AI | Messaggio con suggerimento di percorso manuale alternativo |
| `INTERNAL_ERROR` | Errore non classificabile (loggato server-side) | Messaggio generico; codice di correlazione per supporto |

---

## Appendice A — Tipi condivisi

```typescript
type ValidationError = {
  line?: number;
  field?: string;
  message: string;
};

// Coefficienti di punteggio (in lesson-contract)
type Difficulty = 'bassa' | 'media' | 'alta';
type Weight = 'basso' | 'medio' | 'alto';

// coeff: basso/bassa = 0.75; medio/media = 1.00; alto/alta = 1.50
// maxScore = coeff(difficulty) × coeff(weight), arrotondato a 2 decimali
```

---

## Appendice B — Mappatura endpoint → architettura

| Sezione architettura §10 | Endpoint di questo contratto |
|---|---|
| Autorizzazione | `getSession`, `getOwnerConfiguration` |
| Repository | `createProgram`, `updateProgram`, `createUda`, `updateUda`, `stageImport`, `previewImport`, `commitImport`, `replaceLesson`, `deleteLesson`, `getLessonForRendering`, `exportRepository`, `exportProgrammaSvolto` |
| Verifiche | `createExamDraft`, `composeExam`, `activateExam`, `closeExam`, `cancelExam`, `generatePdfDocente` |
| Portale | `getExamPublic`, `burnEmailAndGeneratePdf`, `startDigitalAttempt`, `submitAnswers` |
| Correzione | `listSubmissions`, `getSubmission`, `createManualSubmission`, `updateItemScore`, `finalizeCorrection` |
| Storico | `listStudents`, `getStudentHistory`, `listExamResults`, `updateStudent` |
| AI futuro | `generateQuestions`, `proposeCorrection`, `bulkApproveCorrections` |
