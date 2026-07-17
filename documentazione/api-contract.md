# SchoolForge — Contratto API

**Versione:** 3.2
**Stato:** in vigore — M1, M2, M3-lite, RE (Repository Editor), QE (Question Editor) e M3-full implementati (Gate G5 superato); M4-00→M4-04 implementati, incluso workspace, restituzione studente, Registro Correzioni, export CSV ed export PDF (Markdown rinviato); **Gate G6 superato** (vedi `evidenze/g6-m4-checklist-finale.md`); M5 resta fuori scope V1
**Autorità:** `analisi-requisiti.md` e `architettura.md`

---

## Struttura file nel repository

I tipi e gli artefatti di questo contratto risiedono nei seguenti percorsi:

| Percorso | Contenuto |
|---|---|
| `src/types/firestore.ts` | Tutte le interfacce dei documenti Firestore (sezione 2). |
| `src/types/functions.ts` | Tipi di request/response delle Cloud Functions. |
| `packages/lesson-contract/src/index.ts` | Schemi Zod del contratto pool v1 (package interno del workspace, non pubblicato su npm). |
| `functions/src/index.ts` | Entry point delle Cloud Functions (solo M5/V2 nella baseline corrente). |
| `src/components/pdf/VerificaPdfRenderer.tsx` | Renderer PDF unificato (`mode="teacher" \| "student"`); riusato dal canale cartaceo e dal Portale studente M3-lite. |
| `src/features/student/` | StudentShell M3-lite/M3-full: routing, lettura `publicLessons`, verifiche, svolgimento e consegna online. |
| `src/features/repository/corrections/correctionContract.ts` | M4-00: helper puri per punteggi, totali/percentuale derivati, completezza e transizioni di stato della correzione. |
| `src/features/repository/corrections/correctionsService.ts` | M4-01: service layer client-only (`openOrLoadCorrection`, `saveCorrection`, `completeCorrection`, `returnCorrection`, `reopenCorrection`, `setReturnVisibleToStudent`, `setSolutionsVisible`). Nessuna UI (M4-02+). |
| `src/features/repository/corrections/correctionReturnSize.ts` | M4-01: limite dimensionale conservativo su `correctionReturns` prima della scrittura. |

> Nota: nel contesto della SPA, `src/contracts/lesson.ts` riesporta gli schemi da `packages/lesson-contract/src/index.ts` per semplificare gli import del client.

---

## 1. Architettura API

### 1.1 Scritture client dirette

Le operazioni del docente nei Moduli 1–4 usano Firebase SDK direttamente dal client con Firestore Security Rules. Repository, bozze e pubblicazione, correzione ed export non richiedono una Function. Il Portale studente **M3-lite** è a sola lettura e usa lo stesso Firebase SDK client con Security Rules dedicate: non richiede alcuna Cloud Function (vedi §3.5).

Il client docente è autenticato tramite Firebase Authentication; le Security Rules verificano `request.auth.uid == ownerUid` per ogni scrittura sensibile. Il client studente (M3-lite) è autenticato con lo stesso Firebase Authentication, provider Google; le Security Rules verificano che l'utente sia autenticato e non sia l'owner per concedere le sole letture read-only descritte in §6.

### 1.2 Cloud Functions

M3-lite non introduce Cloud Functions. Nella baseline corrente le Cloud Functions sono usate solo per il modulo AI:

| Funzione | Modulo | Motivo |
|---|---|---|
| `aiCorrectionPreview` + `aiCorrectionRun` (gateway IA; **M5-05C adapter predisposto**) | M5 | Due Function `onCall`; default `disabled`, mock operativo, adapter OpenAI non configurato e nessuna chiamata reale; contratto in §5. |

La specifica corrente di **M3-full** è client-only: usa Firebase SDK + Security Rules, `submissions/{id}` e `submissionReceipts/{id}`. Non introduce `startDigitalAttempt`/`continueDigitalAttempt`, cookie HttpOnly o Cloud Functions dedicate. Le Cloud Function IA (`aiCorrectionPreview`/`aiCorrectionRun`) appartengono al Modulo 5 (§5); **M5-01** le ha implementate in **modalità mock** (0 token, nessuna scrittura), il comportamento pieno è M5-02.

#### Repository Storage Gateway (SGW) — TARGET, non ancora implementato

Per rendere gli accessi Storage del docente affidabili anche su Brave mobile è **approvato ma non ancora implementato** un gateway HTTPS same-origin: `POST /api/repository/{read|write|delete|batch-read|batch-write|delete-prefix}` → Hosting rewrite → **una** Cloud Function HTTPS 2ª gen (`repositoryGateway`) → Admin SDK → Storage. Autenticato con Firebase ID token, **solo owner**, solo Markdown/pool UTF-8 sotto `repository/{ownerUid}/imports/…`, con validazione path e limiti dimensione/numero file server-side. Il contratto completo (endpoint, request/response, status/error, limiti, atomicità, idempotenza, costi) è in [storage-gateway-roadmap.md](storage-gateway-roadmap.md) §Task 3. **Allo stato attuale queste Function non esistono** (`functions/src/index.ts` è vuoto); la web app accede a Storage **direttamente**.

### 1.3 Convenzioni risposta

Tutte le Cloud Functions restituiscono:

```json
{
  "requestId": "uuid-v4",
  "data": {},
  "error": null
}
```

Codici di errore di dominio: `VALIDATION_FAILED`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_STATE`, `PARTICIPANT_ALREADY_USED`, `RATE_LIMITED`, `CONFIRMATION_REQUIRED`.

Le operazioni irreversibili richiedono `confirmation: true` nel payload: attivazione/chiusura/archiviazione verifica, eliminazione consegna, abilitazione modalità automatica AI.

---

## 2. Struttura Firestore — Tipi TypeScript

I tipi seguenti definiscono la struttura dei documenti Firestore. Sono il contratto vincolante per l'implementazione.

```typescript
// settings/owner — leggibile e scrivibile solo dall'owner
interface OwnerSettings {
  ownerUid: string;
  classes: string[];           // lista classi configurate dal docente
  featureFlags: {
    aiEnabled: boolean;
    aiAutoEnabled: boolean;
  };
}

// settings/ownerPublic — leggibile da qualunque utente autenticato (M3-lite)
// Usato SOLO per instradare il client su TeacherShell/StudentShell.
// Non autorizza nulla di per sé: l'autorizzazione reale resta nelle Security
// Rules di ciascun percorso protetto.
interface OwnerPublicSettings {
  ownerUid: string;
}

// settings/studentAccess — interruttori globali del Portale studente (M3-lite)
// Lettura e scrittura solo owner; le Security Rules lo leggono internamente
// via get()/firestore.get(), mai il client studente direttamente. Assente
// = portale considerato disattivato (nessuna lettura studente concessa).
interface StudentAccessSettings {
  ownerUid: string;
  studentPortalEnabled: boolean;      // deve essere true per QUALUNQUE lettura studente
  newStudentRequestsEnabled: boolean; // riservato a un futuro flusso di richiesta autonoma; non usato da questa milestone
}

// settings/publicLessonsMigration — marker backfill M3F-08
// Owner-only in lettura e scrittura. Scritto esclusivamente da
// publicLessonsBackfillService.backfillPublicLessonsContent, e solo al
// termine di un'esecuzione con `failed.length === 0`. Assente, o con
// `publicLessonsContentVersion` diverso dalla versione corrente: il backfill
// non è (ancora) completo. L'avviso di manutenzione in DidatticaView legge
// questo singolo documento (isPublicLessonsMigrationComplete) invece di
// scandire ogni publicLessons a ogni mount, per decidere se mostrare il
// trigger di sincronizzazione.
// C'è una sola migrazione tracciata oggi, quindi il campo versione vale
// sempre 1 una volta impostato; un'eventuale migrazione futura userebbe un
// documento settings/ dedicato, non un secondo campo qui.
interface PublicLessonsMigrationDoc {
  publicLessonsContentVersion: 1;
  completedAt: Timestamp;
}

// students/{uid} — registro di approvazione (M3-lite)
// uid == uid Firebase Auth dello studente. Un utente Google non-owner senza
// documento qui è trattato come 'pending' ai fini dell'autorizzazione.
// Lettura e scrittura solo owner; popolato dalla UI docente di gestione
// studenti (StudentsView, M3L-A3): approvazione/blocco e assegnazione classe.
interface Student {
  uid: string;
  ownerUid: string;
  email: string;         // identità Google verificata da Firebase, non autodichiarata
  displayName: string | null;
  status: 'pending' | 'approved' | 'blocked';
  classId: string | null; // filtra Lezioni (M3L-C) e Verifiche (M3L-D) per classe, applicato dalle Security Rules
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// programs/{programId}
// classIds (M3L-A4): un programma senza classi assegnate (assente o []) non
// è visibile a nessuno studente, anche se le sue publicLessons esistono e il
// portale è attivo. UDA e lezioni ereditano la visibilità dal programma —
// non hanno un proprio campo classi. Programmi creati prima di questo campo
// sono letti con classIds: [] (programsService.listPrograms normalizza in
// lettura; nessuna migrazione distruttiva). Il filtro per classe lato
// StudentShell (sezione Lezioni) è implementato da M3L-C: uno studente
// approvato con classId valorizzato legge, tramite studentLessonsService,
// solo i programmi la cui classIds include la propria classe — sia lato
// client (query where('classIds', 'array-contains', classId)) sia lato
// Security Rules (isClassmateOf()). La sezione Verifiche studente (M3L-D)
// è implementata allo stesso modo, con filtro su publishedProjection (§3.4).
interface Program {
  id: string;
  ownerUid: string;
  title: string;
  order: number;
  activeImportId: string | null;  // unico import visibile al programma
  classIds: string[];
  createdAt: Timestamp;
}

// udas/{udaId}
interface Uda {
  id: string;
  programId: string;
  importId: string;
  dir: string;
  filename: string;
  order?: number;              // RE: ordinamento stabile; assente sui dati legacy
  storageBasePath: string;     // prefisso in Cloud Storage
  lessonCount: number;
  titolo?: string | null;      // EXP-01: titolo didattico dal front matter; assente sui dati legacy → fallback leggibile dal dir
  descrizione: string | null;
  competenze: string[];
  obiettivi: string[];
}

// lessons/{lessonId} — documento tecnico, leggibile SOLO dall'owner
interface Lesson {
  id: string;
  udaId: string;
  importId: string;
  publicLessonId?: string;     // HARD-02B-1: id import-scoped della proiezione publicLessons; assente sui dati legacy (→ bare lessonId)
  udaDir: string;
  path: string;
  filename: string;
  order?: number;              // RE: ordinamento stabile dentro la UDA; assente sui dati legacy
  storageRef: string;
  poolStorageRef: string | null;
  poolStatus: 'absent' | 'valid' | 'invalid';
  questionCount: number;
  completed?: boolean;
  completedAt?: Timestamp | null;
  titolo?: string | null;
  sottotitolo?: string | null;
  difficolta?: string | null;
  concettiChiave?: string[];
  obiettivi?: string[];
}

// publicLessons/{publicLessonId} — proiezione read-only (M3-lite)
// ID: da HARD-02B-1 import-scoped `${importId}_${lessonId}` (memorizzato anche
// in `LessonDoc.publicLessonId`); i documenti precedenti usano il bare
// `lessonId` (risolti via `resolvePublicLessonId`, senza doppia get). Scritta
// dal client docente nello stesso flusso che scrive `lessons`, sotto lo stesso
// importId isolato (vedi BR-REP-03). Non contiene alcun riferimento al pool.
// Leggibile SOLO da uno studente approvato (students/{uid}.status ==
// 'approved') con il portale attivo (settings/studentAccess.studentPortalEnabled
// == true), il cui classId è incluso nella classIds del programma padre (M3L-C,
// letto via get() sul programma) E il cui `importId` è uguale a
// `programs/{programId}.activeImportId` (HARD-02B-1): staging e import
// stale/superseded non sono leggibili dallo studente nemmeno con get diretto, e
// la query studente DEVE filtrare programId + importId. L'owner legge tutte le
// proiezioni. Autenticazione/approvazione da sole non bastano (§3.4a, §6).
interface PublicLesson {
  id: string;
  ownerUid: string;
  programId: string;
  importId: string;
  udaId: string;
  udaDir: string;               // usata dallo StudentShell per raggruppare le lezioni per UDA
  path: string;
  filename: string;
  order?: number;              // RE: ordinamento stabile dentro la UDA; assente sui dati legacy
  contentPath: string;          // percorso Storage del file lezione .md canonico (letto solo dal docente/dal backfill owner-only), mai del pool
  createdAt: Timestamp;
  // Parsati dal front matter YAML opzionale della lezione (titolo/sottotitolo/
  // difficolta/concetti_chiave/obiettivi — tutti opzionali).
  // tutti questi campi sono persistiti nella proiezione per mostrare
  // elenco/preview senza dover leggere il contenuto di ogni lezione.
  // Assenti sulle lezioni importate prima di questo campo: letti come null/[].
  titolo: string | null;
  sottotitolo?: string | null;
  difficolta: string | null;
  concettiChiave?: string[];
  obiettivi?: string[];
  // M3F-08: corpo Markdown della lezione, già "pulito" dal blocco front
  // matter — SOLO il corpo destinato allo studente, mai pool/soluzioni/
  // questionIndex/poolPath/metadati tecnici. Fonte unica di lettura per il
  // client studente: nessuna chiamata Storage, nessun fallback su
  // `contentPath` (storage.rules nega comunque quella lettura a un non-owner
  // — vedi sicurezza.md §3.2a). Limite conservativo: 700.000 byte UTF-8
  // (`MAX_LESSON_CONTENT_BYTES` in `lessonContentSize.ts`), ben sotto il
  // limite Firestore di 1 MiB per documento, per lasciare margine agli altri
  // campi della proiezione; ogni write path valida la dimensione prima di
  // scrivere e rifiuta con un errore esplicito se superata. Escluso dagli
  // indici a campo singolo (`firestore.indexes.json` fieldOverrides) — non è
  // mai oggetto di query, solo di lettura diretta per id. Assente sui
  // documenti scritti prima di M3F-08 ("legacy"): normalizzato a `null` da
  // `normalizeLessonContent()`, mai trattato come corpo vuoto valido — il
  // client mostra "Contenuto temporaneamente non disponibile" senza mai
  // tentare Storage. Storage resta la sorgente canonica (letta dal client
  // docente e dal backfill owner-only) ed esportabile via ZIP; `content` è
  // sempre una proiezione derivata, mai la fonte di verità.
  content?: string;
}

// questionIndex/{questionId} — leggibile SOLO dall'owner, mai dallo studente
interface QuestionIndex {
  lessonId: string;
  udaId: string;
  programId: string;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  difficolta: 1 | 2 | 3;
  peso: 1 | 2 | 3;
  maxPoints: number;           // difficolta * peso (scala lineare, 1–9)
  valid: boolean;
}

// verifications/{verificationId}
interface Verification {
  id: string;
  ownerUid: string;
  title: string;
  state: 'bozza' | 'attiva' | 'chiusa' | 'archiviata';
  visibility: 'hidden' | 'public';  // indipendente da state (M3-lite); default 'hidden' all'attivazione
  publicTokenHash: string | null;   // legacy gateway server-side: non usato da M3-lite né dalla specifica M3-full corrente
  sources: string[];               // lessonId[] o udaId[]
  config: {                        // modificabile solo nello stato 'bozza'
    totalQuestions: number;
    allowedTypes: string[];
    difficulties: { level: 1 | 2 | 3; min: number }[];
    variant: 'tutte_uguali' | 'tutte_diverse';
    channels: ('cartaceo' | 'digitale')[];
    classes: string[];             // classi associate (opzionale)
  };
  downloadCount: number;           // contatore atomico opzionale dei download cartacei; nessun dato personale
  activatedAt: Timestamp | null;
  createdAt: Timestamp;
}

// Il documento Verification non è MAI leggibile dallo studente, nemmeno
// quando state === 'attiva' && visibility === 'public': contiene
// sources/config/publicTokenHash, tecnici e mai necessari al client
// studente. Lo studente legge invece verifications/{id}/publishedProjection
// (titolo, domande senza soluzioni), e solo se approvato con portale attivo
// (§3.4a, §6) oltre alla condizione state/visibility.

// publicVerificationLinks/{SHA-256(verificationToken)} — legacy gateway server-side, non pianificato nella specifica M3-full corrente.
// Non introdotto da M3-lite, che non usa link pubblici né token: l'accesso
// dello studente è risolto da Firebase Authentication (ADR-06b).
interface PublicVerificationLink {
  verificationId: string;
  title: string;
  state: 'attiva';
  channels: ('cartaceo' | 'digitale')[];
  variant: 'tutte_uguali' | 'tutte_diverse';
}

// verifications/{verificationId}/publishedSnapshot/items — creato all'attivazione, privato
// Mai leggibile dallo studente, né in M3-lite né in un eventuale M3-full.
interface PublishedSnapshotItem extends SnapshotItem {
  candidate: true;
}

// verifications/{verificationId}/publishedProjection/data — solution-free,
// scritta all'attivazione (M2/M3-lite). Riusata per il download PDF
// studente quando la verifica è public (active o closed) e dal canale
// cartaceo (M2). `classId` e `visibility` sono duplicati qui dal genitore
// (eccezione deliberata: normalmente questo schema non duplica dati) — una
// query collectionGroup su questa sotto-collezione, necessaria perché il
// documento padre `verifications/{id}` non è mai leggibile dallo studente,
// è validabile da Firestore solo se i campi controllati dalle Security
// Rules sono anche i campi su cui la query filtra; un `get()` verso il
// padre (per leggere `status`) non è validabile in questo contesto. Per lo
// Da M4-LIFE-01 anche `status` è duplicato nella proiezione: assente sui
// legacy significa `active`; `closeVerification` lo porta a `closed`
// preservando `visibility`. Non contiene mai `soluzione`, `poolStorageRef`,
// `questionLocalId` o `questionIndexEntryId`.
interface PublishedProjectionDoc {
  ownerUid: string;
  title: string;
  className: string | null;
  classId: string | null;      // M3L-D — null = verifica mai assegnata a una classe, mai visibile
  visibility: 'hidden' | 'public';
  status?: 'active' | 'closed'; // legacy assente = active
  questions: PublicVerificationQuestion[];
  activatedAt: Timestamp;
}

interface PublicVerificationQuestion {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  maxPoints: number;
  testo: string;
  opzioni?: { id: string; testo: string }[];  // solo chiusa_singola/chiusa_multipla — id + testo, mai la soluzione
}

// teacherSnapshot (campo su verifications/{id}, owner-only, scritto solo
// all'attivazione) — corregge un'incoerenza preesistente: fino a questo
// contratto, teacherSnapshot conservava solo config.questionRefs (puntatori
// stabili ai pool correnti), quindi i PDF docente (normale e con soluzioni)
// di una verifica active/closed rileggevano testo e soluzioni dai pool
// *correnti* in Storage — modificare o eliminare un pool dopo l'attivazione
// poteva quindi cambiare o rompere il PDF di una verifica già attivata,
// contraddicendo il requisito di snapshot immutabile.
//
// Ogni nuova attivazione ora scrive anche `questions`: una copia completa e
// immutabile delle domande necessarie ai PDF docente, incluse le soluzioni.
// `questionRefs` resta per tracciabilità/compatibilità ma non è più la
// fonte dati dei PDF quando `questions` è presente. `questions` è
// deliberatamente minimale: mai poolStorageRef, questionLocalId o
// questionIndexEntryId (quelli restano solo su VerificationQuestionRef).
interface VerificationTeacherQuestionSnapshot {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  maxPoints: number;
  testo: string;
  opzioni?: { id: string; testo: string }[];
  soluzione: string | string[];   // string per aperta/chiusa_singola, string[] per chiusa_multipla
}

interface VerificationTeacherSnapshot {
  title: string;
  classId: string | null;
  className: string | null;
  programId: string;
  importId: string;
  questionRefs: VerificationQuestionRef[];  // tracciabilità/compatibilità, non più fonte dati PDF se questions è presente
  questions?: VerificationTeacherQuestionSnapshot[];  // assente solo su verifiche attivate prima di questo contratto (legacy)
  activatedAt: Timestamp;
}

// Compatibilità legacy: una verifica active/closed attivata prima di questo
// contratto non ha `teacherSnapshot.questions` — i suoi PDF continuano a
// essere generati rileggendo `questionRefs` dai pool correnti in Storage
// (stesso comportamento di prima, temporaneo, non una migrazione). Nessuna
// migrazione automatica è prevista: un docente che vuole rendere una
// verifica legacy pienamente indipendente dai pool può ricrearla (bozza →
// attivazione), ottenendo così uno snapshot completo.
//
// Limite dimensionale: prima di attivare, la dimensione serializzata di
// `questions` viene stimata e confrontata con una soglia conservativa
// (700 000 byte, vedi verificationSnapshotLimits.ts) ben al di sotto del
// limite Firestore di 1 MiB per documento — il documento `verifications/{id}`
// contiene anche `config` (incluso l'intero `questionRefs`) e gli altri
// campi di `teacherSnapshot`. Superata la soglia, l'attivazione fallisce
// con un errore leggibile, prima di aprire la transazione.

// ---------------------------------------------------------------------------
// M3-full — Verifiche online e consegne studenti (specifica in m3-full-roadmap.md)
// I tipi seguenti definiscono il contratto Firestore per la consegna online.
// Non sono introdotti da M3-lite. Implementazione a partire da M3F-01.
// ---------------------------------------------------------------------------

// submissions/{submissionId} — consegna studente online
// Un documento per (studentUid, verificationId). Creato all'avvio; aggiornato
// a ogni salvataggio bozza; bloccato immutabile alla consegna (status == 'submitted').
// submissionId è deterministico: `${verificationId}_${studentUid}`. Non usare UUID
// arbitrari: le Security Rules non possono fare query per garantire unicità.
// Il docente (ownerUid) può leggere tutte le submission delle proprie verifiche;
// lo studente legge/scrive la propria submission solo finché è draft. Dopo
// submitted legge solo submissionReceipts/{submissionId}.
// M4-LIFE-02 consente all'owner l'eliminazione completa e controllata.
interface SubmissionCorrectionSummary {
  totalPoints: number;
  maxPoints: number;
  percentage: number | null; // null solo quando maxPoints == 0
}

interface SubmissionDoc {
  submissionId: string;            // == Firestore doc id deterministico: `${verificationId}_${studentUid}`
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  status: 'draft' | 'submitted';
  // risposte sparse: solo le domande toccate; key = order.toString() (0-based,
  // stesso indice di PublicVerificationQuestion.order; la UI mostra order + 1)
  answers: Record<string, AnswerValue>;
  // marcatori UX opzionali: restano per docente/M4 ma non sono visibili allo studente dopo la consegna
  flagged: Record<string, boolean>;
  // log eventi attenzione (deterrenza leggera — non invalida automaticamente)
  attentionEvents: AttentionEvent[];
  deliveryCode: string | null;     // null finché status != 'submitted'; es. "SF-2026-A3B7"
  // snapshot leggibile nella schermata di conferma
  verificationTitle: string;
  className: string | null;
  startedAt: Timestamp;
  lastSavedAt: Timestamp;
  submittedAt: Timestamp | null;
  // Proiezione owner-only aggiornata dalla correzione; assente sui legacy e
  // finché non esiste almeno un salvataggio/completamento della correzione.
  correctionSummary?: SubmissionCorrectionSummary;
  correctionSummaryUpdatedAt?: Timestamp;
}

type AnswerValue =
  | { tipo: 'aperta'; testo: string }
  | { tipo: 'chiusa_singola'; selectedId: string | null }
  | { tipo: 'chiusa_multipla'; selectedIds: string[] };

interface AttentionEvent {
  type:
    | 'fullscreen_exit'
    | 'copy_attempt'
    | 'cut_attempt'
    | 'paste_attempt'
    | 'context_menu_attempt'
    | 'drag_attempt'
    | 'tab_blur'
    | 'window_blur'
    | 'visibility_hidden';
  ts: number; // ms epoch
}

// Proiezione client-side (non un documento Firestore separato) letta dal
// monitor consegne docente (submissionsMonitorService.watchSubmissions,
// M3F-05, dettaglio eventi M3F-09): il listener onSnapshot riceve la
// SubmissionDoc completa (Security Rules già autorizzano l'owner a leggerla
// per intero), ma il service la riduce a questa forma compatta PRIMA che
// arrivi alla UI — answers/flagged non vengono mai esposti oltre il service.
// attentionEvents qui è una copia sanificata (solo type+ts, cioè
// esattamente la stessa forma di AttentionEvent — mai answers/flagged) usata
// dalla dialog "Eventi di attenzione" (AttentionEventsDialog): aprirla non
// causa nuove letture, riusa solo i dati già arrivati dal listener.
interface SubmissionMonitorItem {
  studentUid: string;
  status: 'draft' | 'submitted';
  lastSavedAt: Timestamp;
  submittedAt: Timestamp | null;
  deliveryCode: string | null;
  correctionStatus: 'submitted' | 'in_progress' | 'completed' | 'returned';
  correctionSummary: SubmissionCorrectionSummary | null;
  attentionEventsCount: number;
  attentionEvents: { type: AttentionEvent['type']; ts: number }[];
}

// submissionReceipts/{submissionId} — ricevuta post-consegna leggibile dallo studente.
// Dopo status='submitted', lo studente non legge più la SubmissionDoc completa
// con le risposte: vede solo questo documento minimale. Il docente legge comunque
// la submission completa per il monitor e, in futuro, per M4.
interface SubmissionReceiptDoc {
  submissionId: string;            // stesso id deterministico della submission
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  verificationTitle: string;
  className: string | null;
  deliveryCode: string;
  submittedAt: Timestamp;
  correctionStatus?: 'submitted' | 'in_progress' | 'completed' | 'returned';
  correctionStatusUpdatedAt?: Timestamp;
}

// Campo aggiunto a verifications/{verificationId} in M3-full
// onlineEnabled: boolean — true = la verifica accetta submission online.
// Deve essere true (insieme a status=='active' e visibility=='public') perché
// uno studente possa avviare o aggiornare una submission. La chiusura
// (status='closed') blocca implicitamente l'online via Security Rules.

// Campo aggiunto a verifications/{verificationId} e mirrorato su
// verifications/{verificationId}/publishedProjection/data in M3F-09
// studentPdfEnabled: boolean — controlla ESCLUSIVAMENTE se lo studente può
// scaricare il PDF della verifica (StudentVerificationsView "Scarica PDF").
// Indipendente da onlineEnabled/visibility/status: non pubblica, non attiva
// l'online, non riapre una verifica chiusa. Assente su documenti legacy —
// letto sempre tramite normalizeStudentPdfEnabled(), che tratta un valore
// mancante/non booleano come false (fail-closed). Il docente può alternarlo
// mentre la verifica è draft, active o closed (setVerificationStudentPdfEnabled,
// scrittura atomica: documento verifica + mirror publishedProjection se
// esiste + audit event). Le Security Rules permettono, su active/closed,
// SOLO la modifica di studentPdfEnabled/updatedAt — mai status, visibility,
// config o ownerUid nella stessa scrittura. Una verifica hidden/draft/closed
// non diventa visibile allo studente solo perché studentPdfEnabled è true:
// resta comunque necessario visibility=='public' e classe compatibile.
// Se closed, il PDF può restare disponibile ma l'online resta sempre negato.

// corrections/{submissionId} — M4-00 (contratto), M4-01 (service+Rules, implementato)
// submissionId è lo stesso id deterministico di SubmissionDoc/SubmissionReceiptDoc
// (`${verificationId}_${studentUid}`). Nessun campo `origin`/AI: M4 è manuale.
// Se non esiste un documento, la UI deriva "Da correggere" senza crearne uno vuoto.
type CorrectionStatus = 'in_progress' | 'completed' | 'returned';

interface QuestionEvaluation {
  order: number;                   // stessa chiave di SubmissionDoc.answers / PublicVerificationQuestion.order
  points: number | null;           // null = non ancora valutata; 0 è un voto legittimo
  maxPoints: number;                // congelato da publishedProjection.questions[order] alla creazione
  feedback?: string;
}

interface Correction {
  submissionId: string;            // == Firestore doc id, == SubmissionDoc.submissionId
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  status: CorrectionStatus;
  evaluations: Record<string, QuestionEvaluation>; // key = order.toString()
  generalFeedback: string | null;
  totalPoints: number;             // derivato — mai scritto a mano
  maxPoints: number;                // derivato — mai scritto a mano
  percentage: number | null;       // derivato, arrotondato — null solo se maxPoints == 0
  createdAt: Timestamp;
  updatedAt: Timestamp;
  completedAt: Timestamp | null;   // impostato alla transizione a 'completed', azzerato alla riapertura
  returnedAt: Timestamp | null;    // impostato alla transizione a 'returned', azzerato alla riapertura
  reopenCount: number;             // 0 alla creazione, incrementato a ogni riapertura — mai azzerato
}

// Delta minimale di una domanda — registrato solo se points e/o feedback sono
// effettivamente cambiati rispetto all'ultimo salvataggio (mai l'intera QuestionEvaluation)
interface QuestionEvaluationDelta {
  order: number;
  previousPoints: number | null;
  nextPoints: number | null;
  previousFeedback?: string;
  nextFeedback?: string;
}

// correctionEvents/{eventId} — append-only. Un salvataggio con reopenCount == 0
// (primo giro di compilazione) non produce mai un evento, per quante volte il
// docente salvi. Solo un salvataggio dopo una riapertura (reopenCount > 0) che
// cambia effettivamente qualcosa scrive un evento 'scoreAdjusted', atomico con
// l'aggiornamento della correzione. Nessun tipo 'hidden': l'azione di
// nascondere/mostrare la restituzione (CorrectionReturn.visibleToStudent) è
// formalizzata, ma non lo è il comportamento docente/audit che la produce —
// lasciato a M4-01 invece di un tipo evento ambiguo.
interface CorrectionEvent {
  correctionId: string;            // == submissionId == Correction doc id
  ownerUid: string;
  type: 'reopened' | 'scoreAdjusted' | 'returned' | 'correctionCleared'; // correctionCleared: M5-04C
  actorUid: string;
  previousStatus: CorrectionStatus | null;
  nextStatus: CorrectionStatus;
  reason: string | null;
  questionDeltas?: QuestionEvaluationDelta[]; // solo le domande cambiate, mai la mappa intera
  generalFeedbackDelta?: { previous: string | null; next: string | null }; // solo se generalFeedback è cambiato
  timestamp: Timestamp;
}

// Recap per domanda, autosufficiente: copiato al momento della restituzione,
// non un riferimento a submissions/teacherSnapshot/publishedProjection (che
// potrebbero non essere più leggibili, es. verifica chiusa/nascosta).
interface CorrectionReturnQuestionView {
  order: number;
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla';
  testo: string;
  opzioni?: { id: string; testo: string }[]; // id+testo soltanto, mai quale sia corretta
  studentAnswer: AnswerValue | null;         // copiata da submissions.answers[order] alla restituzione
  points: number;                            // mai null: una correzione incompleta non può essere restituita
  maxPoints: number;
  feedback?: string;
  correctAnswer?: string | string[];         // presente solo se solutionsVisible == true per questa domanda
}

// correctionReturns/{submissionId} — proiezione minima ma autosufficiente,
// scritta solo dal docente (restituzione + i due toggle sotto); letta solo
// dallo studente. Le soluzioni non sono mai incluse automaticamente.
interface CorrectionReturn {
  correctionId: string;            // == submissionId
  verificationId: string;
  studentUid: string;
  ownerUid: string;
  verificationTitle: string;
  className: string | null;
  submittedAt: Timestamp;
  returnedAt: Timestamp;
  questions: CorrectionReturnQuestionView[];
  generalFeedback: string | null;
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;
  visibleToStudent: boolean;   // mostra/nasconde la restituzione senza cancellarla; le Rules M4-01 la applicano al read
  solutionsVisible: boolean;   // rispecchia esattamente se questions[*].correctAnswer è popolato in questo momento
}

// auditEvents/{eventId}
interface AuditEvent {
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  outcome: 'success' | 'failure';
  reason?: string;
  timestamp: Timestamp;
}
```

---

## 3. Operazioni client (Firestore SDK)

### 3.1 Repository didattico

| Operazione | Scrittura Firestore | Storage |
|---|---|---|
| Importa Markdown/asset | **Staging chunked** (≤400 mut./`writeBatch`, sequenziale — HARD-02B-2): scrive `imports/{importId}` (`status:'staging'`), UDA, lezioni, `questionIndex` e le nuove `publicLessons` (import-scoped, invisibili). Poi **switch atomico** (≤3 mutazioni: `activeImportId`+`imports/{id}.status='active'`+audit). Poi **cleanup differito** delle sole `publicLessons` del vecchio import. | Scrivi in `repository/imports/{programId}/{importId}/{udaId}/` |
| Sostituisci file | Esegue un nuovo import isolato (staging invisibile), poi switch atomico su `activeImportId`; il vecchio import diventa subito invisibile senza cancellare nulla | Nessun overwrite dell'import attivo |
| Elimina file/cartella | Crea un nuovo import completo senza i file, poi committa il puntatore | Gli import non attivi sono eliminabili con lifecycle/scarto docente |
| Programma svolto | Leggi `programs`, `udas`, `lessons` (flag svolto) | — |
| Export ZIP | Leggi struttura + download file Storage | — |

Il parser `lesson-contract` (package interno `packages/lesson-contract/src/index.ts`, riesportato da `src/contracts/lesson.ts`) esegue la validazione nel client prima di qualsiasi scrittura. Se il client riceve errori, la UI li mostra senza scrivere su Firestore o Storage. Se un upload fallisce prima del commit, l'import precedente rimane l'unico visibile.

### 3.1b Question Editor (QE-01 → QE-05, da implementare) — modifiche ai pool senza reimport

> Specifica definita in `question-editor-roadmap.md`. Non ancora implementato. I tipi e i contratti seguenti descrivono le operazioni previste.

Il service layer (`poolEditorService.ts`, da creare in QE-02) usa la stessa strategia Storage-poi-Firestore del Repository Editor. Non tocca mai `publishedSnapshot`, `publishedProjection` né verifiche attivate o chiuse.

| Operazione | Scrittura Firestore | Storage |
|---|---|---|
| Crea domanda / modifica domanda / elimina domanda | Aggiorna/crea/elimina l'entry `questionIndex/{entryId}` corrispondente; aggiorna `lessons/{id}.questionCount` e `poolStatus` | Riscrive integralmente il file `.pool.md` serializzato con il nuovo YAML |
| Crea pool (prima domanda) | Crea le entry `questionIndex`; imposta `lessons/{id}.poolStatus = 'valid'` e `questionCount` | Crea il file `.pool.md` |
| Elimina pool | Elimina tutte le entry `questionIndex` del pool; imposta `lessons/{id}.poolStatus = 'absent'`, `questionCount = 0`; bloccata se esistono bozze che referenziano domande del pool | Elimina il file `.pool.md` |

Il `questionIndex` continua a usare entryId deterministici `${lessonId}_${toDocId(q.id)}`. Modificare `id` di una domanda equivale a eliminare l'entry vecchia e creare quella nuova. Il formato YAML del file `.pool.md` rimane `schoolforge-pool/v1` invariato.

### 3.1a Repository Editor (RE-01 → RE-06) — modifiche dirette senza reimport

Implementato in `apps/web/src/features/repository/editor/repositoryEditorService.ts` (crea/modifica/riordina/elimina) e `apps/web/src/features/teacher/exportZip.ts` (export). Sempre Storage-poi-Firestore: se la scrittura Storage fallisce, Firestore non viene toccato; se Storage riesce ma Firestore fallisce, un errore distinto avvisa il docente di riprovare invece di lasciare la UI in uno stato ambiguo (vedi `repository-editor-roadmap.md` §7).

| Operazione | Scrittura Firestore | Storage |
|---|---|---|
| Modifica metadata corso (DUX-07B) | Aggiorna `imports/{importId}.programmaMeta`, `programs/{programId}.updatedAt` e audit `program.metadataUpdated` nello stesso batch | Riscrive o crea `programma.md`; preserva corpo e chiavi front matter estranee. Storage precede il batch Firestore, con errore distinto in caso di sincronizzazione parziale |
| Crea UDA / crea lezione | `udas`/`lessons` (+ `publicLessons` per la lezione, `content` = corpo fornito dal docente, validato con `assertLessonContentSize`) con `order` = massimo esistente + 1; `filename` tecnico generato da slug del titolo, mai da un contatore riusabile | Scrivi il nuovo file `.md` con front matter minimo valido |
| Modifica metadata UDA/lezione | Aggiorna solo i campi didattici (mai `order`/`filename`/`storageRef`/`content`); sincronizza `publicLessons` se la proiezione esiste — non tocca `content` | Riscrive il front matter del file esistente, corpo invariato |
| Modifica corpo Markdown lezione | Ricalcola e sincronizza i metadata Firestore/`publicLessons` dal front matter ricomposto; sincronizza anche `publicLessons.content` con il nuovo corpo (validato con `assertLessonContentSize` prima della scrittura Storage) | Riscrive l'intero file con lo stesso front matter e il nuovo corpo |
| Riordina UDA/lezione | Scambia `order` con il vicino in un unico `writeBatch` atomico (mai un `order` arbitrario, solo swap adiacente) | Nessuna — `dir`/`filename`/percorsi Storage non vengono mai rinominati per riordinare |
| Elimina UDA/lezione | Bloccata (nessuna scrittura) se `findRepositoryDeleteBlockers` trova una verifica collegata (vedi §5.2 di `sicurezza.md`); altrimenti elimina `udas`/`lessons`/`questionIndex`/`publicLessons` collegati | Elimina il/i file `.md` e l'eventuale pool; tollera un file già assente |
| Export ZIP | Legge `listUdas`/`listLessons` (già ordinati per `order`) e li scrive nell'archivio in un unico passaggio sequenziale, cosicché l'ordine fisico dello ZIP coincida con `order` — un reimport deriva l'`order` proprio da quella posizione fisica (vedi `buildImportPayload.ts`) | Solo lettura (`getBytes`); nessuna scrittura |

Riordino ed eliminazione non toccano mai Storage per il riordino, e l'eliminazione non modifica mai automaticamente le verifiche esistenti — il docente deve prima rimuoverle o modificarle.

L'import scrive il documento tecnico `lessons/{id}` e la proiezione pubblica `publicLessons/{id}` (M3-lite, §3.5), quest'ultima già con `content` (corpo Markdown estratto da `parseLessonMetadata`, validato con `assertLessonContentSize` — M3F-08). Da **HARD-02B-2** l'import non è più una singola transazione atomica: le scritture avvengono in **chunk ≤400 mutazioni** durante una fase di **staging invisibile** (i doc portano il nuovo `importId`, non ancora `activeImportId`), seguita da uno **switch atomico** che promuove `programs/{id}.activeImportId` al nuovo import (≤3 mutazioni). La proiezione diventa visibile allo studente **solo** allo switch, perché la visibilità dipende esclusivamente da `activeImportId` (query + Security Rules): durante lo staging lo studente continua a vedere l'import precedente, mai una proiezione parziale. Le vecchie `publicLessons` sono rimosse da un **cleanup differito, idempotente e best-effort** (`stalePublicLessonsCleanup.ts`) che tocca **solo** le `publicLessons` del vecchio import — mai UDA/lezioni/questionIndex/Storage; un cleanup fallito lascia l'import `committed` con `cleanupPending: true` (le residue sono già invisibili). Un errore **prima** dello switch → `not_applied`: `activeImportId` invariato, corso precedente intatto, nessun rollback finto. Helper di chunking condiviso in `repository/firestoreChunks.ts`.

### 3.2 Verifiche

| Operazione | Scrittura Firestore |
|---|---|
| Crea/modifica bozza | `verifications.set()` — solo stato `bozza` |
| Attiva verifica | Transazione: valida config contro `questionIndex`, crea `publishedSnapshot` privato e proiezione senza soluzioni, imposta `state: "attiva"` e `visibility: "hidden"` |
| Pubblica / nascondi verifica (M3-lite) | Aggiorna solo `visibility` (`"hidden" ↔ "public"`) su una verifica `attiva`; nessun'altra scrittura consentita da questa operazione |
| Chiudi / archivia | Transazione con `confirmation: true` nel client, aggiorna stato e scrive `auditEvents` |
| Download PDF docente | Solo lettura Firestore + `questionIndex`; genera nel browser |

Una verifica `attiva`, `chiusa` o `archiviata` non è modificabile nella sua configurazione. Per cambiare fonti o configurazione il docente duplica una nuova bozza. Il campo `visibility` è l'unica eccezione: è modificabile più volte finché la verifica resta `attiva`. Il canale cartaceo e M3-lite richiedono `variant: "tutte_uguali"` e usano la proiezione pubblicata.

`publicVerificationLinks/{publicTokenHash}` e `publicTokenHash` restano specifica di un eventuale M3-full (§4); M3-lite non li crea né li usa.

### 3.3 Canale cartaceo

| Operazione | Scrittura Firestore |
|---|---|
| Genera PDF cartaceo | Solo lettura di verifica e `publishedProjection`; genera nel browser |
| Incremento contatore (opzionale) | Incremento atomico di `downloadCount` su `verifications`; nessun dato personale |

Il canale cartaceo è puramente fisico: cliccando "Stampa/Scarica PDF" il documento è generato nel browser e scaricato dalla proiezione pubblicata. È disponibile solo per `tutte_uguali`; non crea alcun record di tentativo (`deliveryAttempts`) né voce di log di accesso. Non esiste lock né vincolo di unicità: più download sono ammessi. Al più viene incrementato il contatore atomico `downloadCount`.

All'apertura del link, il Portale calcola `SHA-256(verificationToken)` con Web Crypto e fa un solo `get` a `publicVerificationLinks/{hash}`; il documento restituisce l'identificatore della verifica e i soli metadati pubblici necessari per leggere `publishedProjection`. Non sono ammessi query o `list` sul percorso pubblico.

> Questo meccanismo di lookup via token appartiene a un eventuale M3-full. M3-lite non ne ha bisogno: l'identità è già risolta da Firebase Authentication, quindi lo studente legge `verifications`/`publishedProjection` direttamente, filtrati dalle Security Rules su `state`/`visibility` (§3.5).

### 3.4 Portale studente — M3-lite

| Operazione | Lettura Firestore/Storage |
|---|---|
| Risoluzione ruolo | `get settings/ownerPublic`; confronto client-side `uid === ownerUid` per instradare TeacherShell/StudentShell (non sostituisce le Security Rules; risolve solo il ruolo, non l'autorizzazione — vedi §3.4a) |
| Lezioni | `get students/{uid}` per il proprio `classId` (assente/null → nessuna lezione mostrata); query `programs` con `where('classIds', 'array-contains', classId)`; per ciascun programma trovato, query `publicLessons` con `where('programId', '==', id)`. Il corpo Markdown è letto **esclusivamente** da `publicLessons.content` (M3F-08) — nessuna chiamata a Cloud Storage dal client studente, nessun fallback su `contentPath`. Un documento senza `content` valido (`normalizeLessonContent()` → `null`, proiezione legacy) mostra "Contenuto temporaneamente non disponibile", senza retry. Filtro per classe implementato in M3L-C **solo lato Firestore** (`isClassmateOf()` su `programs`/`publicLessons`, sia lato query client sia lato Security Rules): è l'unico gate, e dal M3F-08 è anche l'unica strada per ottenere il corpo lezione — Storage nega comunque la lettura del Markdown a chiunque non sia l'owner, `contentPath` noto o meno (vedi §6). |
| Verifiche | `get students/{uid}` per il proprio `classId` (assente/null → nessuna verifica mostrata); un'unica query `collectionGroup('publishedProjection')` filtrata su `where('classId','==',classId)` **e** `where('visibility','==','public')` (entrambi i filtri sono obbligatori — vedi §6); il documento padre `verifications/{id}` non è mai letto (contiene `config.questionRefs`/`teacherSnapshot`). Filtro per classe implementato in M3L-D. |
| Download PDF studente | Nessuna lettura aggiuntiva: usa i dati già ottenuti dalla query precedente; genera il PDF nel browser con `downloadStudentPdfFromProjection` (stesso layout di disegno di `downloadStudentPdf`, mai da Storage/pool) |

Nessuna di queste operazioni scrive su Firestore o Storage, crea un record, o richiama una Cloud Function. Le Security Rules negano allo studente ogni lettura di `lessons`, `questionIndex`, `publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents` e `settings/owner` (eccetto `settings/ownerPublic`).

### 3.4a Approvazione studente — chi può leggere il Portale (M3-lite)

Un utente Google non-owner è un **richiedente/studente potenziale**, non uno studente autorizzato: l'autenticazione da sola non concede alcuna lettura. Ogni operazione della tabella §3.4 richiede, in aggiunta alle condizioni già indicate, entrambe queste condizioni verificate dalle Security Rules (non solo lato client):

- `get settings/studentAccess` → `studentPortalEnabled == true` (interruttore globale; assente = portale disattivato);
- `get students/{request.auth.uid}` → `status == "approved"` (assente, `pending` o `blocked` negano tutti allo stesso modo).

Lo schema (`StudentAccessSettings`, `Student`) e le Security Rules che li applicano sono affiancati dalla UI docente di gestione studenti (`StudentsView`, M3L-A3): il docente crea/approva/blocca uno studente e gli assegna una classe direttamente dall'interfaccia, senza scrivere Firestore a mano.

`classId` su `Student`, `classIds` su `Program` e `classId` su `PublishedProjectionDoc` filtrano ulteriormente cosa uno studente approvato vede: un programma senza classi assegnate, o una verifica senza `classId`, non sono visibili a nessuno studente anche se altrimenti pubblici. Lo schema e la UI docente per assegnare le classi ai programmi sono implementati da M3L-A4. Il filtro per classe è implementato sia sulla sezione **Lezioni** (query client + Security Rules, `isClassmateOf()`, M3L-C) sia sulla sezione **Verifiche** (query `collectionGroup` + Security Rules, M3L-D) — nessuna consegna, risposta online o punteggio è prevista per M3-lite in nessuna delle due sezioni.

### 3.5 Correzione ed export (Modulo 4, dipende da M3-full — completato)

> Le operazioni seguenti operano sulle consegne digitali di M3-full (`submissions/{id}`, path `${verificationId}_${studentUid}`), quindi non sono utilizzabili con M3-lite. M4-00→M4-03B implementano contratto, service/Rules, workspace, restituzione, ciclo di vita, eliminazione, Registro Correzioni, export CSV ed export PDF. Markdown rinviato (nessun caso d'uso).

| Operazione | Scrittura Firestore |
|---|---|
| Leggi consegne | Query/listener `submissions` già esistente, filtrato per `verificationId` + `ownerUid`; stato pubblico `submitted`/`in_progress`/`completed`/`returned`, mostrato come Consegnata/In correzione/Corretta/Restituita. Il monitor espone anche `correctionSummary` owner-only per Punteggio/Percentuale; valori assenti o ancora `submitted` = `—`. Le righe sono ordinate in memoria per studente, stato, punteggio, percentuale, data consegna o eventi: nessuna query/lettura aggiuntiva. Il mirror di stato è aggiornato solo ai cambi di fase, atomicamente anche su `submissionReceipts`; assente sui legacy = `submitted`. |
| Apri correzione | Se assente, crea `corrections/{submissionId}` con `status: 'in_progress'`, `reopenCount: 0`, `evaluations` inizializzate da `publishedProjection.questions` (`points: null`, `maxPoints` congelato); se presente, legge il documento esistente |
| Assegna punteggio (primo giro, `reopenCount == 0`) | Aggiorna `corrections/{submissionId}.evaluations[order]` e i totali derivati (`computeCorrectionTotals`); nello stesso batch aggiorna `submissions/{submissionId}.correctionSummary` + `correctionSummaryUpdatedAt`, combinandoli nell'unico update della submission quando cambia anche lo stato. Salvataggio esplicito, non ad ogni digitazione; **nessun** `correctionEvents` scritto, per quanti salvataggi avvengano. `submissionReceipts` non riceve mai punteggio/percentuale. |
| Completa correzione | Transizione `in_progress → completed`, ammessa solo se `isCorrectionComplete(evaluations)` (mappa non vuota, ogni domanda valutata); imposta `completedAt` |
| Restituisci | Transizione `completed → returned`; scrive `correctionReturns/{submissionId}` con `questions[]` autosufficiente (testo, opzioni, risposta consegnata, punti sempre definiti, `visibleToStudent: true`, `solutionsVisible: false`) nella stessa `writeBatch`; imposta `returnedAt`; appende `correctionEvents` (`type: 'returned'`) |
| Riapri | Transizione `completed \| returned → in_progress`; azzera `completedAt`/`returnedAt`; incrementa `reopenCount`; appende `correctionEvents` (`type: 'reopened'`, senza `questionDeltas` se nessuna domanda è stata ancora ritoccata) |
| Rettifica dopo riapertura (`reopenCount > 0`) | Aggiorna `corrections`; se `computeQuestionEvaluationDeltas`/`computeGeneralFeedbackDelta` produce almeno un cambiamento, appende atomicamente `correctionEvents` (`type: 'scoreAdjusted'`, `questionDeltas`/`generalFeedbackDelta` solo sui campi cambiati); se la correzione era già `returned`, la rettifica richiede prima la riapertura, poi eventualmente una nuova restituzione (che riscrive `correctionReturns` da zero, preservando `visibleToStudent`/`solutionsVisible` correnti) |
| Mostra/nascondi soluzioni | Aggiorna `correctionReturns.solutionsVisible`; `true` riscrive `correctAnswer` su ogni `questions[i]` dalle soluzioni congelate; `false` **rimuove** il campo da ogni domanda, non lo nasconde solo lato UI |
| Mostra/nascondi restituzione | Aggiorna `correctionReturns.visibleToStudent`; non tocca `corrections` né i punteggi |
| Registro Correzioni + CSV (M4-03A) | La tabella Consegne online già caricata è il Registro, senza popup duplicata. `buildCorrectionRegisterExportRows` deriva un modello canonico minimale dalle righe ordinate del monitor; `serializeCorrectionRegisterCsv` genera nel browser CSV UTF-8/BOM con separatore `;`, escaping e protezione formula. Colonne: studente, email, stato, punteggio, massimo, percentuale, data consegna, codice. Nessuna query/scrittura/persistenza; risposte, soluzioni, feedback, eventi, UID e id tecnici esclusi. |
| Elimina consegna (M4-LIFE-02, ridefinita da M5-06B) | `deleteSubmissionData(submissionId, ownerUid, db)`: preflight autorevole dopo ownership e prima di ogni scrittura; blocca se esiste qualunque evidenza di prima restituzione (`correctionReturns/{id}` anche nascosta, `corrections.status == 'returned'`, mirror `correctionStatus == 'returned'` su submission/receipt). Se ammessa, elimina in ordine i `correctionEvents` owner-scoped, `corrections/{id}`, poi `submissionReceipts/{id}` e `submissions/{id}`; **non elimina mai `correctionReturns`** (la sua esistenza è già causa di blocco). Idempotente e ripetibile, chunk di `delete` a ≤400 mutazioni. Al successo, un solo `auditEvents` **non identificativo** (`action: 'submission.deleted'`, `targetId: verificationId`, `actorUid: ownerUid`, timestamp — mai studentUid/submissionId/risposte). Nessuna lettura Storage. Eliminabili: consegne senza correzione, correzioni `in_progress` e `completed` mai restituite, sia su verifica `active` sia `closed`. UI: azione icon-only in Consegne online su verifica `active` **o** `closed`, mostrata solo per una consegna non restituita (per una restituita il cestino è disabilitato con spiegazione accessibile), con conferma; il dialog spiega che se la verifica è ancora disponibile lo studente potrà rifarla, mentre una verifica chiusa resta chiusa. |
| Blocco eliminazione verifica (M4-LIFE-02) | Prima di `deleteVerification`, guard applicativo `where('ownerUid','==',ownerUid) + where('verificationId','==',id) + limit(1)` su `submissions`: se esiste una consegna, interrompe **senza scrivere** con «Elimina prima tutte le consegne associate a questa verifica.». Guard applicativo perché le Rules non verificano l'assenza di documenti via query inversa nel modello single-owner. |
| Export PDF (M4-03B) | `downloadCorrectionRegisterPdf({ verificationTitle, className, rows, generatedAt? })` genera nel browser un PDF A4 landscape stampabile del Riepilogo consegne e correzioni, riusando **le stesse** `CorrectionRegisterExportRow[]` già ordinate del CSV (nessuna riordinatura). jsPDF via `import('jspdf')` dinamico (mai nell'entry bundle), layout tabellare disegnato a mano (no autotable/html2canvas): intestazione con conteggi per stato, colonne studente/email/stato/punteggio/percentuale/data/codice con wrapping, intestazioni ripetute a ogni pagina, footer «Pagina X di Y». Filename `aaaammgg-classe-titolo-riepilogo-correzioni.pdf` (segmento classe omesso se assente) via `sanitizeForFilename`/`formatDateForFilename`. Nessuna query/lettura/scrittura/persistenza; UID, submissionId, risposte, soluzioni, feedback ed eventi esclusi. **Markdown non implementato** (duplicativo, nessun caso d'uso). |

---

## 4. Gateway digitale server-side legacy (non pianificato)

> Questa sezione è mantenuta solo come traccia storica del vecchio modello server-side. È superata dalla specifica M3-full corrente in `m3-full-roadmap.md`, che è client-only e usa `submissions/{id}` + `submissionReceipts/{id}` con Security Rules. Nessuno degli endpoint seguenti è pianificato.

Nel vecchio modello server-side, gli endpoint previsti sarebbero stati `startDigitalAttempt` e `continueDigitalAttempt`. Entrambi avrebbero scritto tramite Admin SDK: il portale non avrebbe ricevuto né usato credenziali Firestore per `deliveryAttempts`, risposte o snapshot. Questo modello è superato dalla specifica M3-full corrente client-only.

### Request

```
POST /v1/startDigitalAttempt
Content-Type: application/json

{
  "verificationToken": "uuid-pubblico-verifica",
  "declaredData": {
    "name": "Mario",
    "surname": "Rossi",
    "class": "3A"           // opzionale
  }
}
```

#### Regole di validazione di `declaredData`

`name` e `surname` (che compongono il `declaredName` nel formato `Cognome Nome`) sono validati server-side:

| Vincolo | Regola |
|---|---|
| Lunghezza minima | `minLength` 2 |
| Lunghezza massima | `maxLength` 100 |
| Caratteri ammessi | lettere (incluse lettere accentate), spazi, apostrofi (`'`) e trattini (`-`) |
| Non vuoto | non può essere vuoto né composto solo da spazi (whitespace-only) |

`class`, se presente, deve corrispondere a una voce della lista classi configurata dal docente. La violazione di una qualsiasi di queste regole produce `VALIDATION_FAILED`.

### Response 200

```json
{
  "requestId": "req-uuid",
  "data": {
    "attemptId": "attempt-uuid",
    "questions": [
      {
        "id": "snapshot-item-uuid",
        "order": 1,
        "tipo": "aperta",
        "difficolta": 2,
        "peso": 3,
        "maxPoints": 6,
        "testo": "Spiega la differenza tra HTTP e HTTPS.",
        "opzioni": null
      }
    ]
  },
  "error": null
}
```

Il cookie di ripresa (`Set-Cookie: resumeToken=...; HttpOnly; Secure; SameSite=Strict; Max-Age=3600`) è impostato nell'header HTTP della risposta. Non compare nel body JSON.

Le soluzioni (`soluzione`) non sono mai incluse nella risposta al client portale.

Alla prima chiamata la Function calcola `SHA-256(verificationToken)`, risolve `publicVerificationLinks/{tokenHash}` e verifica che la verifica sia attiva. Se la chiamata riesce normalizza nome e cognome, verifica in transazione l'assenza di `participantLocks/{SHA-256(nomeNormalizzato + U+001F + cognomeNormalizzato)}`, crea il lock e registra in `accessLog` il nome dichiarato (`Cognome Nome`), l'IP di provenienza, lo user-agent e il timestamp. Questi dati alimentano il Report Accessi del docente. Il nome è auto-dichiarato e non verificato.

### Response 4xx

| Condizione | Codice HTTP | Codice errore |
|---|---|---|
| Token verifica non trovato o verifica non attiva | 404 | `NOT_FOUND` |
| Nome e cognome già usati per la verifica | 409 | `PARTICIPANT_ALREADY_USED` |
| Rate limit raggiunto | 429 | `RATE_LIMITED` |
| Payload non valido | 400 | `VALIDATION_FAILED` |
| `declaredName` non valido (lunghezza fuori 2–100, caratteri non ammessi, vuoto o whitespace-only) | 400 | `VALIDATION_FAILED` |

### 4.2 `continueDigitalAttempt`

```
POST /v1/continueDigitalAttempt
Cookie: resumeToken=<token opaco HttpOnly>
Content-Type: application/json
```

```json
{ "action": "get" }
```

```json
{ "action": "saveDraft", "itemId": "snapshot-item-uuid", "value": "risposta" }
```

```json
{ "action": "submitAttempt", "confirmation": true }
```

La Function confronta l'hash del cookie, la scadenza e lo stato `in_progress` del tentativo. `get` restituisce solo domande e risposte del medesimo tentativo, senza soluzioni; `saveDraft` aggiorna una sola risposta; `submitAttempt` esegue la transizione atomica a `submitted`, rende definitive le risposte e aggiunge l'audit. Il cookie non è mai restituito nel body.

| Condizione | Codice HTTP | Codice errore |
|---|---|---|
| Cookie assente, non valido, scaduto o revocato | 401 | `UNAUTHORIZED` |
| Tentativo non in corso oppure non associato alla sessione | 409 | `INVALID_STATE` |
| `submitAttempt` senza conferma | 400 | `CONFIRMATION_REQUIRED` |
| Payload o `itemId` non valido | 400 | `VALIDATION_FAILED` |

---

## 5. Gateway IA — Modulo 5 (correzione assistita; **M5-05C implementato ma provider reale disabilitato**)

Contratto **provider-agnostic** — vedi [m5-ai-assisted-roadmap.md](m5-ai-assisted-roadmap.md). Supera i contratti precedenti (`proposeCorrection`/`approveCorrection`/`bulkApproveCorrections`/`enableAutomaticCorrection`) e la nozione di «proposta IA» persistente.

**Stato:** **M5-01** ha introdotto le due Function `onCall`, il feature flag e `MockAiGrader`; **M5-02** ha implementato il **motore server-side completo in modalità mock** (`functions/src/aiCorrectionEngine.ts`): preflight reale (`aiCorrectionPreview`) con eleggibilità/conteggi/stima token e **nessuna scrittura**, ed esecuzione (`aiCorrectionRun`) che valuta le chiuse in modo deterministico, le aperte via `MockAiGrader`, scrive atomicamente per consegna nel contratto M4 (mai sovrascrivendo `points !== null`) ed è **idempotente in concorrenza** via `aiCorrectionRuns/{requestId}` con una **lease** (`executionId` + `leaseExpiresAt`): run concluso → replay; run `running` con lease valida di un altro tentativo → nessuna ri-elaborazione; lease scaduta → takeover; `finishRun` scrive solo se possiede ancora la lease. **Solo mock**: `tokensEstimated` deterministico (domanda+soluzione+risposta+overhead, identico in preview e run), `tokensActual` = usage reale del provider → **0 col mock**, costo 0, nessuna chiamata esterna. Le risposte reali del motore (mock) hanno forma `{ mode:'mock', phase, requestId, verificationId, counts, tokensEstimated, tokensActual, cost:0, results/excluded, status, idempotentReplay }`; le **response tipizzate qui sotto** restano la forma **target** del contratto (con provider reale in M5-05).

**M5-04B — feedback generale della consegna.** `AiGraderOutput` include un campo facoltativo **`generalFeedback?: string`** prodotto **nella stessa** chiamata delle aperte (mai una seconda invocazione): motivazione sintetica del punteggio + consiglio concreto (o complimento se il risultato è massimo), tono professionale, **nessun dato personale**, **≤ 700 caratteri**. Per calcolare i **totali finali** senza una seconda chiamata, `AiGraderInput` porta un `submissionContext: { priorPoints, totalMaxPoints }` (punti già fissati = domande già valutate + chiuse deterministiche). Il motore applica il feedback al campo **`generalFeedback` già esistente** in `corrections/{submissionId}` **solo se** dopo la correzione la consegna è **interamente valutata** e il docente **non** ne ha già scritto uno (mai sovrascritto), nella **stessa** transazione delle valutazioni (nessuna lettura/scrittura aggiuntiva). Consegne con **sole chiuse**: nessuna chiamata al grader, feedback generato deterministicamente dai totali finali (stessa funzione pura del mock), a **0 token e 0 costo** (nessuna quota aggiunta). **Validazione atomica**: quando la consegna ha domande aperte il feedback è **richiesto**; se l'output del grader è assente, non stringa, vuoto o > 700 caratteri, l'**intero** output per quella consegna è invalido → **nessun** punteggio, **nessun** feedback, **nessun** `commitSubmission` (consegna `failed`, nessuna scrittura parziale); le altre consegne del batch proseguono e le valutazioni già presenti del docente restano intatte. `tokensEstimated` include la quota per il feedback (⌈700/4⌉ token) **solo** per le consegne con domande aperte, identica in preview e run; `tokensActual`/`costActual` restano **0** col mock. Il testo del feedback **non** è mai scritto in `aiCorrectionRuns` (solo metadata).

**M5-04C — scoring chiuse deterministico + «Azzera correzione».** Le domande **chiuse** sono valutate da codice (0 grader/token/costo) con `scoreClosedQuestion`, che ora ritorna `{ evaluable, points, feedback }`. **chiusa_singola**: la soluzione è normalizzata dal formato **canonico** `["id"]` (lesson-contract) e dal **legacy** `"id"`; una soluzione assente/vuota/multi-elemento/malformata rende la domanda **non valutabile** (`points` resta `null`, mai uno zero ingiusto). **chiusa_multipla**: **punteggio parziale** — `reward = correctSelected/correctTotal`, `penalty = wrongTotal>0 ? wrongSelected/wrongTotal : 0`, `points = round₀.₂₅(maxPoints·clamp(reward−penalty,0,1))` in `[0, maxPoints]`; ordine/duplicati irrilevanti, ID sconosciuti = selezioni errate, opzioni lette dal `teacherSnapshot` congelato. **Feedback deterministico** basato solo sui conteggi (mai ID/testi di soluzione; la visibilità delle soluzioni resta il toggle M4). Nessuna migrazione automatica: gli zeri già persistiti (`points !== null`) restano «valutati». **`clearCorrection(submissionId, db)`** (client, transazione, owner-only via Rules): azzera tutti i `points` a `null`, rimuove i feedback per domanda e `generalFeedback`, ricalcola i totali con l'helper canonico, aggiorna il mirror `correctionSummary`/`correctionStatus`, **mantiene `status: 'in_progress'`**, e scrive un solo evento `correctionCleared` (`previousStatus`/`nextStatus == 'in_progress'`, nessun contenuto). No-op se non c'è nulla da azzerare; rifiuta (senza scritture parziali) se la correzione non è più `in_progress`. Non tocca `SubmissionDoc`/`SubmissionReceiptDoc`/`CorrectionReturnDoc` e non cancella documenti.

**M5-05D1 — guardrail server-side prima del provider reale.** `settings/aiConfig` è validato fail-closed e `model` è l'unica fonte autoritativa del modello (`OPENAI_MODEL` non è usata); anche la coppia `model`/`priceListVersion` deve essere nota. L'ordine del run reale è **auth/owner → config/kill switch → classificazione/limiti → secret/grader → lease/scritture**: config assente/invalida/disabilitata restituisce `feature_disabled` senza leggere il secret o costruire il provider. Hard ceiling DEV: 30 consegne/op, 20 aperte/consegna, 10 000 token/consegna, 300 000 token/op, concorrenza 3, timeout 60 000 ms, retry 1, budget 5 USD; Firestore può solo restringerli. L'allowlist production usata per validare la coppia contiene esclusivamente `gpt-5-nano-2025-08-07` ($0,05/M input, $0,40/M output; [fonte OpenAI](https://developers.openai.com/api/docs/models/gpt-5-nano), verificata 2026-07-16); ledger e calcolo costi restano non wired. Letture reali oltre all'owner: preview = config + verifica + submission/correction per ID; run = stesso preflight riusato, poi lettura transazionale run doc in begin/finish e correction in ogni commit. Nessun provider reale, costo o deploy.

**M5-05D2A — contratto privacy-minimal di `aiCorrectionRuns`.** La selezione viene ordinata server-side e identificata da SHA-256 di `verificationId` + insieme canonico. Il documento v2 non salva `submissionId`, `verificationId`, UID o contenuti: conserva soltanto metadata tecnici/aggregati, lease e `resultOrdinals: [{ ordinal, status, reasonCode? }]`. La response live mantiene gli ID; un replay ricostruisce `ordinal → submissionId` esclusivamente dalla selezione corrente validata. Nel replay esito/motivo per riga e conteggi aggregati restano autoritativi; i contatori diagnostici per-riga non vengono persistiti e valgono 0. Stesso insieme in ordine diverso ⇒ stesso replay; insieme differente ⇒ `invalid_input`. Run legacy senza versione v2 ⇒ fail-safe e nuovo `requestId`, nessuna migrazione/dual write. `expireAt` è generato server-side a 30 giorni DEV, provvisorio in attesa di HG-M5-4; senza policy TTL configurata non elimina documenti. Run/config/ledger tecnico sono server-only nelle Rules. Provider reale, costo runtime, budget e retry restano disabilitati/non wired.

**M5-05D2B-1 — costo e budget mensile collegati al runtime.** Preview e run espongono, oltre a `tokensEstimated`/`tokensActual` (compat), la ripartizione `inputTokens*`/`outputTokens*`/`totalTokens*` e i costi in **micro-USD interi** `costEstimatedMicroUsd`/`costActualMicroUsd` (più `costEstimated`/`costActual` in USD per il dialog); il run espone anche `costReservationMicroUsd`. La stima usa `ceil` (conservativa) e coincide tra preview e run a parità di selezione/config; l'effettivo usa `nearest` sui token **realmente** riportati dal provider, validati come interi non negativi con coerenza del totale (assenti/incoerenti ⇒ 0, mai inventati). Mock e sole-chiuse restano 0. Un output rifiutato che portava usage fatturabile è comunque contabilizzato (`AiGraderInvalidOutputError` provider-agnostico) senza salvare punteggi/feedback. **Stima informativa vs. tetto prenotato:** `costEstimatedMicroUsd` è la stima mostrata all'utente; `costReservationMicroUsd` è il **tetto conservativo** effettivamente prenotato — per ogni chiamata somma il **massimo output** del grader (`maxOutputTokensPerCall`) e un **upper bound provabile dell'input** dell'esatto payload (`reservationInputTokenUpperBound`), garantendo `costActualMicroUsd ≤ costReservationMicroUsd`. `aiBudgetLedger/{YYYY-MM}` (chiave UTC deterministica, server-only) è aggiornato con **tre transazioni** sul solo percorso reale con lavoro aperto: prenotazione `reserved` **atomica prima** del provider (idempotente su `requestId`, hard stop al 100%, `budget_exceeded` prima di ogni chiamata), `markBudgetInvoked` (`reserved → pending`, gated dalla lease, subito prima del provider) e riconciliazione (libera l'eccedenza, addebita l'effettivo, idempotente, gated così un worker vecchio dopo takeover è no-op). **Macchina a stati crash-safe:** una `reserved` scaduta è rilasciata (recuperabile, nessun costo); una `pending` scaduta è addebitata al tetto (crash dopo il provider ⇒ mai sottocontabilizzare). **Fail-closed:** se le porte di budget o i bounds del grader mancano sul percorso reale, `budget_unavailable` **prima** di qualsiasi chiamata (mai fail-open). Ordine run reale: config/kill switch → limiti → stima → lease → **prenotazione** → **markBudgetInvoked** → provider → commit → **riconciliazione** → finalizzazione; `completed`/replay e `locked`/`conflict`/`legacy` non prenotano né chiamano il provider. Il budget è solo quello mensile DEV della config (≤ 5 USD/mese); per-operazione/giornaliero non sono introdotti (HG-M5). Nessun secret, chiamata reale, TTL o deploy.

**M5-05D2B-2 — retry applicativo controllato.** L'SDK OpenAI gira sempre con `maxRetries: 0`: l'**unica** policy di retry è quella applicativa (pura, iniettabile). Numero di retry e timeout per tentativo vengono dalla **config runtime validata** (ceiling DEV: retry ≤ 1, timeout ≤ 60 s) ⇒ ≤ 2 tentativi per chiamata. Ritentati solo i transitori (connessione, timeout, 408/409/429/≥ 500); tutto il resto (4xx permanenti, output invalido, `budget_*`, abort, errore ignoto) è **fail-closed** senza retry. `Retry-After` è estratto dagli header (`retry-after-ms`, secondi, HTTP-date, parser puro in ms): valore ≤ cap (8 s) rispettato, oltre il cap ⇒ nessuna attesa arbitraria e errore ritentabile **manualmente** (`retry_after_exceeded`); assente/invalido ⇒ backoff esponenziale con **full jitter** (base 500 ms, cap 4 s, `random`/`sleep` iniettati, sleep annullabile). Una **deadline complessiva monotona** blocca nuovi tentativi senza tempo residuo (`deadline_exceeded`, nessuna scrittura parziale); `aiCorrectionRun` ha `timeoutSeconds = 540` esplicito e `RUN_LEASE_MS` a 9 min così la lease copre l'intera invocazione. La **prenotazione** copre tutti i tentativi ammessi (`bound × (retry + 1)`): budget insufficiente ⇒ rifiuto prima della prima chiamata; **nessuna** seconda prenotazione tra i tentativi. Accounting: `costActualMicroUsd` = solo usage noto; i tentativi dal costo **incerto** confluiscono in `costSettledMicroUsd` (prudente fino al tetto del tentativo, `costActual ≤ costSettled ≤ costReservation`); il ledger addebita `costSettled`. `aiCorrectionRuns` aggiunge la telemetria retry aggregata (`attemptsTotal`/`retriesTotal`/`retryReasonCodes`/`retryDelayTotalMs`/`unknownBillingAttempts`) e `costSettledMicroUsd`, **senza** ID/UID/PII. UI invariata con codici leggibili (`rate_limited`/`provider_timeout`/`provider_unavailable`/`deadline_exceeded`/`retry_after_exceeded`). Mock/sole-chiuse: nessun retry/provider/costo. Nessun secret, chiamata reale, TTL o deploy.

**M5-05E-1 — Human Gate e guardrail di costo approvati.** Dal 17 luglio 2026 la sola coppia ammessa per una nuova configurazione reale è OpenAI Responses API + snapshot pinned `gpt-5.4-nano-2026-03-17`, con Structured Outputs e listino `v2-2026-07-17-hg-m5`: 200.000 micro-USD/M input e 1.250.000 micro-USD/M output ([fonte ufficiale OpenAI](https://developers.openai.com/api/docs/models/gpt-5.4-nano)). `settings/aiConfig` richiede interi positivi `maxOperationCostMicroUsd ≤ 250000`, `dailyBudgetMicroUsd ≤ 1000000` e `monthlyBudgetMicroUsd ≤ 5000000`; campo mancante, invalido o sopra ceiling ⇒ fail-closed. L'ordine del run reale è **auth/owner → config/kill switch → classificazione/limiti → costruzione grader e prenotazione conservativa → limite operazione → lease → transazione ledger giornaliera/mensile → provider**. Il limite operazione usa `costReservationMicroUsd` comprensivo dei tentativi e fallisce con `operation_budget_exceeded` prima di lease/ledger/provider; il ledger mensile mantiene anche aggregati giornalieri UTC e `dayKey` sulle prenotazioni, con errore distinto `daily_budget_exceeded`. La riconciliazione usa il giorno/mese originali anche oltre mezzanotte. `expireAt` resta server-generated a 30 giorni; la policy TTL reale non è configurata. Evidenza e forma esatta della config: [hg-m5-human-gate.md](evidenze/hg-m5-human-gate.md). L'approvazione decisionale **non attiva** provider, secret, chiamate, costi o deploy; M5/G7 restano aperti.

**M5-05C — adapter e benchmark harness.** Il feature mode server-side è `disabled|mock|openai`, con default `disabled`. `mock` conserva il comportamento esistente; `openai` non ha fallback e richiede il modello dalla configurazione runtime validata e il secret Functions v2 `OPENAI_API_KEY` disponibile esclusivamente ad `aiCorrectionRun`. `OpenAiGrader` usa una sola Responses API call per consegna, Structured Outputs strict e una seconda validazione applicativa atomica; `usage` può includere `{ tokens, inputTokens, outputTokens }`. Il payload non include PII, UID, classe, corso/lezione completa o domande chiuse. Retry SDK = 0, timeout per tentativo = 60 s, retry applicativo massimo = 1 solo per errori transitori. Il benchmark harness usa esclusivamente fixture sintetiche e un `AiGrader` iniettato. **Nessuna chiave o modello sono configurati, nessuna chiamata reale/costo/deploy è autorizzata; Human Gate e G7 restano aperti.**

**Due** Cloud Functions v2 `onCall` scale-to-zero (**2 invocazioni per operazione batch**: preview + run), protette da Firebase ID token con `ownerUid` verificato server-side e attive solo dietro feature flag:

| Funzione | Request (**ID tecnici + sola indicazione pedagogica opzionale**) | Response |
|---|---|---|
| `aiCorrectionPreview` (preflight, **0 token, nessun provider**) | `{ verificationId, submissionIds: string[], requestId, teacherGuidance?: string }` | `{ eligible: string[], excluded: [{ submissionId, reason }], openToGrade: number, closedToGrade: number, closedOnlySubmissions: number, tokensEstimated, costEstimated, model }` |
| `aiCorrectionRun` (esecuzione, dopo conferma) | `{ verificationId, submissionIds: string[], requestId, teacherGuidance?: string }` | `{ results: [{ submissionId, outcome: 'succeeded'\|'partial'\|'failed', openGraded: number, openSkipped: number, closedGraded: number, tokensEstimated, tokensActual, costEstimated, costActual, reason? }] }` |

**M5-06A — indicazione docente e calibrazione.** `teacherGuidance` è opzionale, viene normalizzata con trim e ha un massimo di 200 caratteri; vale per tutte le consegne del batch. Preview e run usano lo stesso valore. Il valore entra nel payload provider, nella stima/prenotazione e nell'hash dell'identità idempotente, ma il testo non viene persistito in `aiCorrectionRuns`, ledger o log. Una modifica richiede una nuova preview e un nuovo `requestId`. È contenuto non attendibile subordinato alle istruzioni server-side: non può cambiare schema, limiti, sicurezza, provider o dati ammessi. Il feedback per domanda resta strutturato e validato, con limite massimo 1.500 caratteri e dettaglio adattivo; punteggio `0..maxPoints` a step di 0,25 invariato.

**M5-06C — conferma immutabile.** La UI conserva uno snapshot della richiesta usata per la preview (`selection`, `teacherGuidance`, `requestId`) e usa esattamente quello nel run. In conferma l'indicazione è sola lettura; tornare alla modifica elimina snapshot e preview e genera una nuova identità, quindi il run resta impossibile fino a una nuova preview. Il feedback generale OpenAI descrive l'esito complessivo, punti di forza, lacune ricorrenti e un passo concreto senza ripetere in sequenza i feedback delle domande. Le sole chiuse mantengono feedback deterministico complessivo, zero provider/token/costo.

Comportamento (contratto M5): `aiCorrectionPreview` calcola eleggibilità/conteggi/stima **senza** chiamare il provider. `aiCorrectionRun` rilegge server-side submission + `publishedProjection`/`teacherSnapshot` via Admin SDK (verifica ownership), **ripete l'eleggibilità** (consegna con dati cambiati dal preview → esclusa con motivo), valuta le **chiuse** in modo **deterministico** (0 token; **anche consegne con sole chiuse**), invia **al massimo una richiesta provider per consegna** con tutte le **aperte** eleggibili (`points === null`; consegne con sole chiuse → nessuna chiamata), valida l'output con schema rigido e i punteggi con le regole di `correctionContract.ts` (`0..maxPoints`, step 0,25), scrive i risultati nelle `evaluations` di `corrections/{submissionId}` **lasciando `status == 'in_progress'`** (mai `completed`/`returned`). Stato/idempotenza/audit/utilizzo in **`aiCorrectionRuns/{requestId}`** (una sola collezione, **mai contenuti**). Idempotente su `requestId`; non sovrascrive domande già valutate. La chiave del provider vive solo in **Secret Manager**, mai lato client/repo/Firestore/log. **Nessuna** correzione automatica, **nessuna** restituzione automatica, **nessun** web/retrieval/tool.

---

## 6. Proiezioni Security Rules

Le Security Rules Firestore devono garantire, per la baseline corrente (M1+M2+M3-lite):

| Percorso | Docente (`ownerUid`) | Studente approvato (`students/{uid}.status == "approved"` + `studentPortalEnabled == true`) | Google autenticato non approvato | Non autenticato |
|---|---|---|---|---|
| `settings/owner` | Lettura + scrittura | — | — | — |
| `settings/ownerPublic` | Lettura + scrittura | Solo lettura (`ownerUid`, per routing UI) | Solo lettura (`ownerUid`, per routing UI) | — |
| `settings/studentAccess` | Lettura + scrittura | — (letto dalle Rules via `get()`, mai dal client studente) | — | — |
| `settings/publicLessonsMigration` (M3F-08) | Lettura + scrittura | — | — | — |
| `students/{uid}` | Lettura + scrittura | — (nessuna UI/Rule di autolettura in questa milestone) | — | — |
| `programs` (documento top-level) | Lettura + scrittura sull'import attivo/preparato | Solo lettura, solo se `classIds` include il proprio `classId` (M3L-C; assente/vuoto → nessuno studente) | — | — |
| `programs/*/imports/**` (`udas`, `lessons`, `questionIndex`, dati tecnici) | Lettura + scrittura sull'import attivo/preparato | — (mai, indipendentemente dalla classe) | — | — |
| `publicLessons` | Lettura + scrittura (stesso flusso di import) | Solo lettura, solo se il programma padre ha `classIds` compatibile con il proprio `classId` (M3L-C) | — | — |
| `verifications` | Lettura + scrittura solo per bozza e transizioni consentite; scrittura di `visibility` su verifica `attiva` | — (documento padre mai leggibile dallo studente, vedi `publishedProjection`) | — | — |
| `verifications/*/publishedSnapshot` | Lettura | — | — | — |
| `verifications/*/publishedProjection` | Lettura + scrittura | Lettura solo quando `visibility == "public"` (che vale solo mentre il padre è `active` — vedi §3.4a) **e** `classId` è compatibile col proprio `classId` (M3L-D; assente/`null` → nessuno studente) | — | — |
| `corrections`, `correctionEvents` | Lettura + scrittura (M4-01) | — | — | — |
| `correctionReturns` | Lettura + scrittura (M4-01) | Solo lettura della propria (`studentUid`), solo quando `visibleToStudent == true` | — | — |
| `aiCorrectionRuns/**` | — (server-only) | — | — | — |
| `settings/aiConfig` | — (server-only) | — | — | — |
| `aiBudgetLedger/**` | — (server-only, non wired) | — | — | — |

**Confine Rules/service per la correzione (M4-01)**: le Security Rules di `corrections`/`correctionEvents`/`correctionReturns` verificano ownership, identità dei campi principali e la matrice di transizione di stato ammessa (`isValidCorrectionTransition`, specchio di `isValidCorrectionStatusTransition` in `correctionContract.ts`) — mai il contenuto dettagliato di `evaluations`/`questionDeltas` (range dei punteggi, coerenza dei delta), che resta responsabilità del service owner-only, come già avviene per `teacherSnapshot`/`config` altrove in questo codebase.
| `auditEvents` | Lettura + sola creazione append-only con schema ammesso | — | — | — |

Un Google-autenticato non approvato (nessun documento `students/{uid}`, oppure `pending`/`blocked`, oppure `studentPortalEnabled == false`) non ha alcuna riga con permesso diverso da "—" nella colonna dedicata: è trattato come un non-owner qualunque, con l'unica eccezione di `settings/ownerPublic` (necessaria solo per il routing UI, non per l'autorizzazione).

**Storage Rules — modello attuale (M3F-08)**: `storage.rules` non chiama mai `firestore.get()`/`firestore.exists()`, e non concede più alcuna lettura sotto `repository/{ownerUid}/**` a un non-owner — Markdown lezione e pool sono entrambi owner-only, senza eccezioni per estensione o `customMetadata`. Il gate di classe/approvazione resta **solo su Firestore** (discovery `programs`→`publicLessons`, sopra), ma dal M3F-08 è anche l'unica strada per ottenere il corpo lezione, perché il client studente non legge mai Storage. Fino a M3F-07 inclusa, un blocco aggiuntivo concedeva la lettura di un file `.md` (non `.pool.md`) a qualunque utente autenticato non-owner — il compromesso storico security-vs-reliability descritto sotto — rimosso da M3F-08. `importRepository` continua a scrivere `customMetadata: { kind, programId, ownerUid, importId }` all'upload, ma nessuna Security Rule lo legge: resta solo per eventuale diagnostica. **Limite residuo chiuso**: un `contentPath` esatto, anche se conosciuto o indovinato, non è più leggibile da nessuno tranne l'owner — vedi `sicurezza.md` §3.2a per il dettaglio e lo storico del compromesso.

**Verifiche studente (M3L-D, esteso da M4-LIFE-01)**: lo studente scopre le verifiche della propria classe con un'unica query `collectionGroup('publishedProjection')` filtrata su `classId`+`visibility`; il parent non è mai letto. La proiezione duplica anche `status` per distinguere `active`/`closed` nella UI (legacy assente = `active`). La chiusura preserva `visibility`: una `closed+public` resta consultabile/PDF, mentre le Rules sul parent negano comunque avvio, ripresa, autosave e consegna online. Il match usa il prefisso ricorsivo `{path=**}` necessario alle collection group query e l'indice resta quello già esistente su `classId`+`visibility`.

**Correzioni restituite allo studente (M4-02B)**: `studentCorrectionReturnsService.loadStudentCorrectionReturns` legge tutte e sole le proprie restituzioni visibili con un'unica query `collection('correctionReturns')` filtrata su `studentUid == uid` **e** `visibleToStudent == true` — mai una scansione client-side della collezione, mai un `getDoc` per verifica. Entrambi i filtri sono richiesti dalla stessa regola già usata per `publishedProjection` sopra: la `allow read` esistente su `correctionReturns` (M4-01, invariata da M4-02B) autorizza già esattamente questa combinazione di campi in `resource.data`, quindi non è stata necessaria alcuna modifica a `firestore.rules` né alcun nuovo indice in `firestore.indexes.json` (due soli filtri di uguaglianza non richiedono un indice composito). Deliberatamente **nessun `orderBy` sulla query stessa**: `orderBy` esclude dal risultato ogni documento privo del campo ordinato, il che renderebbe irraggiungibile una `returnedAt` legacy/malformata indipendentemente da un successivo ordinamento lato client — l'ordinamento (`returnedAt` decrescente, mancante/malformato sempre in fondo, mai escluso) avviene quindi esclusivamente in JS. Il workspace di lettura (`StudentCorrectionView`) fa un secondo tipo di lettura, un `getDoc` singolo per submissionId (`loadStudentCorrectionReturn`, usato solo dal pulsante "Ricarica" manuale) — stessa regola, stesso confine: risolve a `null` solo per "documento assente" o `permission-denied` (restituzione appena nascosta/mai appartenuta allo studente), trattato come "non più disponibile"; qualunque altro errore (rete, offline) viene rilanciato, mai confuso con una restituzione nascosta.

Le Security Rules esatte vengono scritte e testate con Emulator Suite obbligatoria, incluso il gate M3-lite e il gate di approvazione studente (§3.4a).

> I percorsi seguenti (`publicVerificationLinks`, `verifications/*/participantLocks`, `deliveryAttempts` e sottocollezioni) appartengono al modello gateway Cloud Functions valutato per M3-full e mai realizzato — M3-full (completato) usa invece `submissions`/`submissionReceipts` con Security Rules client-only (vedi tabella sopra e `m3-full-roadmap.md`). Non esistono nella baseline corrente, nota storica:
>
> | Percorso | Docente (`ownerUid`) | Client portale M3-full | Nessuno |
> |---|---|---|---|
> | `publicVerificationLinks/{publicTokenHash}` | Lettura + scrittura | Solo `get` sul documento esatto, mai `list` | Scrittura |
> | `verifications/*/participantLocks` | Lettura; modifica solo nella transazione di reset ammessa | — | Lettura/scrittura diretta |
> | `deliveryAttempts` | Lettura; reset ammesso solo su `in_progress` | — | Lettura/scrittura diretta |
> | `deliveryAttempts/*/accessLog` | Lettura (Report Accessi) | — | Lettura/scrittura diretta |
> | `deliveryAttempts/*/snapshot/items` | Lettura completa | — | Lettura/scrittura diretta |

---

## 7. Messaggi di errore UX

| Condizione | Messaggio utente | Azione suggerita |
|---|---|---|
| Login con account non autorizzato/non Google | "Accedi con il tuo account Google per continuare." | Rieffettuare il login con Google |
| Nessuna verifica visibile (M3-lite) | "Non ci sono verifiche disponibili al momento." | Attendere che il docente pubblichi una verifica |
| Configurazione non attivabile | "Impossibile attivare: [motivo specifico]." | Correggere la configurazione |
| Pool insufficiente | "Non ci sono abbastanza domande per questa configurazione." | Aggiungere domande al pool |

Le condizioni seguenti appartengono al modello gateway (link pubblico, tentativi, sessione server-side) valutato per M3-full e mai realizzato — nota storica, non applicabile a M3-full (completato), che non ha link pubblico né tentativi anonimi:

| Condizione | Messaggio utente | Azione suggerita |
|---|---|---|
| Nome e cognome già usati | "Per questa verifica risulta già avviato un tentativo con questi dati. Contatta il docente se è un errore." | Contattare il docente |
| Verifica non attiva | "Il link non è attivo o la verifica è chiusa." | Contattare il docente |
| Rate limit | "Troppo richieste. Attendere qualche minuto." | Riprovare |
| Sessione digitale scaduta o revocata | "La sessione non è più valida. Contatta il docente per un eventuale reset del tentativo." | Contattare il docente |

---

## 8. Versionamento

Gli endpoint Cloud Function sono sotto `/v1`. Cambi incompatibili richiedono nuova versione. I payload pubblici non espongono mai soluzioni, correzioni o configurazioni interne.
