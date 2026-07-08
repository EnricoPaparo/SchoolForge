# SchoolForge — Contratto API

**Versione:** 3.0
**Stato:** contratto pre-implementazione
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
| `src/features/student/` | StudentShell M3-lite: routing, lettura `publicLessons`, lettura verifiche `attiva`+`public`, download PDF studente. |
| `functions/src/startDigitalAttempt.ts`, `functions/src/continueDigitalAttempt.ts` | M3-full, specifica rinviata: non presenti nella baseline corrente. |

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
| `proposeCorrection`, `approveCorrection`, `bulkApproveCorrections`, `enableAutomaticCorrection` | M5 (V2) | Richiedono chiave API AI in Secret Manager. |

Un eventuale **M3-full** (specifica rinviata, §4) aggiungerebbe `startDigitalAttempt` e `continueDigitalAttempt` per emettere e verificare una sessione server-side con cookie HttpOnly/Secure, perché il browser non potrebbe scrivere tentativi direttamente. Non fanno parte della baseline corrente.

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

// students/{uid} — registro di approvazione (M3-lite)
// uid == uid Firebase Auth dello studente. Un utente Google non-owner senza
// documento qui è trattato come 'pending' ai fini dell'autorizzazione.
// Lettura e scrittura solo owner: non esiste ancora una UI docente per
// popolarlo (arriva in una milestone successiva).
interface Student {
  uid: string;
  ownerUid: string;
  email: string;         // identità Google verificata da Firebase, non autodichiarata
  displayName: string | null;
  status: 'pending' | 'approved' | 'blocked';
  classId: string | null; // riservato al filtro futuro per classe, non ancora applicato da alcuna Rule
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
// resta fuori scope.
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
  title: string;
  storagePath: string;         // percorso in Cloud Storage
  order: number;
  validationStatus: 'valid' | 'invalid' | 'pending';
}

// lessons/{lessonId} — documento tecnico, leggibile SOLO dall'owner
interface Lesson {
  id: string;
  udaId: string;
  programId: string;
  title: string;
  storagePath: string;
  poolPath: string | null;     // null se pool assente
  poolStatus: 'valid' | 'invalid' | 'absent';
  poolErrors: string[];
  order: number;
}

// publicLessons/{lessonId} — proiezione read-only (M3-lite)
// Scritta dal client docente nello stesso flusso che scrive `lessons`,
// sotto lo stesso importId isolato (vedi BR-REP-03). Non contiene alcun
// riferimento al pool. Leggibile SOLO da uno studente approvato
// (students/{uid}.status == 'approved') con il portale attivo
// (settings/studentAccess.studentPortalEnabled == true) E il cui classId
// è incluso nella classIds del programma padre (M3L-C, letto via get() sul
// programma) — l'autenticazione Google da sola non è sufficiente, e nemmeno
// l'approvazione da sola: senza una classe compatibile la lettura è negata
// (§3.4a, §6).
interface PublicLesson {
  id: string;
  ownerUid: string;
  programId: string;
  importId: string;
  udaId: string;
  udaDir: string;               // usata dallo StudentShell per raggruppare le lezioni per UDA
  path: string;
  filename: string;
  contentPath: string;          // percorso Storage del solo file lezione .md, mai del pool
  createdAt: Timestamp;
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
  publicTokenHash: string | null;   // M3-full, specifica rinviata: non usato da M3-lite
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

// publicVerificationLinks/{SHA-256(verificationToken)} — M3-full, specifica rinviata.
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

// verifications/{verificationId}/publishedProjection/items — senza soluzioni
// Riusata da M3-lite per il download del PDF studente quando la verifica
// è attiva+public (oltre che dal canale cartaceo, M2).
interface PublishedProjectionMeta {
  title: string;
  state: 'attiva';
  visibility: 'hidden' | 'public';
  channels: ('cartaceo' | 'digitale')[];
  variant: 'tutte_uguali' | 'tutte_diverse';
}

interface PublishedProjectionItem {
  questionId: string;
  order: number;
  tipo: string;
  difficolta: 1 | 2 | 3;
  peso: 1 | 2 | 3;
  maxPoints: number;
  testo: string;
  opzioni: { id: string; testo: string }[] | null;
  lessonSource: string;
}

// ---------------------------------------------------------------------------
// M3-full — specifica rinviata. I tipi seguenti (DeliveryAttempt, AccessLogEntry,
// SnapshotItem, Answer) descrivono un'eventuale consegna online successiva a
// M3-lite; non sono introdotti dalla baseline corrente, che non produce
// tentativi né consegne.
// ---------------------------------------------------------------------------

// deliveryAttempts/{attemptId} — solo canale digitale (il canale cartaceo non crea tentativi)
interface DeliveryAttempt {
  id: string;
  verificationId: string;
  declaredData: {
    name: string;
    surname: string;
    class?: string;
  };
  declaredName: string;            // "Cognome Nome" auto-dichiarato, non verificato
  declaredIp: string;              // IP di provenienza al momento dell'accesso
  userAgent: string;               // user-agent del browser dello studente
  state: 'in_progress' | 'submitted' | 'cancelled';
  resumeTokenHash: string | null;  // hash del cookie di ripresa
  resumeTokenExpiry: Timestamp | null;
  createdAt: Timestamp;
  submittedAt: Timestamp | null;
}

// deliveryAttempts/{id}/accessLog/{logId} — subcollection
interface AccessLogEntry {
  declaredName: string;            // "Cognome Nome"
  declaredIp: string;
  userAgent: string;
  timestamp: Timestamp;
}

// deliveryAttempts/{id}/snapshot/items — subcollection
interface SnapshotItem {
  questionId: string;
  order: number;
  tipo: string;
  difficolta: 1 | 2 | 3;
  peso: 1 | 2 | 3;
  maxPoints: number;               // difficolta * peso (1–9)
  testo: string;
  opzioni: { id: string; testo: string }[] | null;
  soluzione: string | string[];    // privato; mai esposto al client portale
  lessonSource: string;
}

// deliveryAttempts/{id}/answers — subcollection
interface Answer {
  itemId: string;
  value: string | string[] | null;
  state: 'draft' | 'submitted';
  updatedAt: Timestamp;
}

// corrections/{attemptId} e correctionEvents — Modulo 4, dipende da M3-full
// (operano sull'attemptId di una consegna digitale; non popolati da M3-lite)
interface Correction {
  attemptId: string;
  verificationId: string;
  totalPoints: number;
  maxPoints: number;
  percentage: number | null;       // null se non definitiva
  state: 'partial' | 'complete';
  origin: 'manual' | 'ai_assisted' | 'ai_auto';
  updatedAt: Timestamp;
}

// correctionEvents/{eventId}
interface CorrectionEvent {
  attemptId: string;
  itemId: string;
  actor: string;                   // ownerUid o 'ai'
  previousScore: number | null;
  newScore: number;
  previousComment: string | null;
  newComment: string;
  reason: string;                  // obbligatorio per rettifiche
  createdAt: Timestamp;
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
| Importa Markdown/asset | Prepara `programs/{programId}/imports/{importId}` con UDA, lezioni e `questionIndex`; transazione finale aggiorna `activeImportId` e audit | Scrivi in `repository/imports/{programId}/{importId}/{udaId}/` |
| Sostituisci file | Esegue un nuovo import isolato, poi committa il nuovo `activeImportId` | Nessun overwrite dell'import attivo |
| Elimina file/cartella | Crea un nuovo import completo senza i file, poi committa il puntatore | Gli import non attivi sono eliminabili con lifecycle/scarto docente |
| Programma svolto | Leggi `programs`, `udas`, `lessons` (flag svolto) | — |
| Export ZIP | Leggi struttura + download file Storage | — |

Il parser `lesson-contract` (package interno `packages/lesson-contract/src/index.ts`, riesportato da `src/contracts/lesson.ts`) esegue la validazione nel client prima di qualsiasi scrittura. Se il client riceve errori, la UI li mostra senza scrivere su Firestore o Storage. Se un upload fallisce prima del commit, l'import precedente rimane l'unico visibile.

L'import scrive, nella stessa transazione di commit, sia il documento tecnico `lessons/{id}` sia la proiezione pubblica `publicLessons/{id}` (M3-lite, §3.5): entrambi puntano allo stesso `activeImportId` e diventano visibili insieme.

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
| Lezioni | `get students/{uid}` per il proprio `classId` (assente/null → nessuna lezione mostrata); query `programs` con `where('classIds', 'array-contains', classId)`; per ciascun programma trovato, query `publicLessons` con `where('programId', '==', id)`; lettura del file `.md` da Cloud Storage tramite `contentPath` (Storage Rules: lettura consentita solo a uno studente approvato con portale attivo, mai per `.pool.md`). Filtro per classe implementato in M3L-C, sia lato query client sia lato Security Rules (`isClassmateOf()`, §6). |
| Elenco verifiche visibili | Query `verifications/{id}/publishedProjection` per le verifiche note al client, concessa solo quando il padre è `state == "attiva" && visibility == "public"` **e** lo studente è approvato con portale attivo; il documento padre `verifications/{id}` non è mai leggibile dallo studente |
| Download PDF studente | Lettura `verifications/{id}/publishedProjection`; genera il PDF nel browser con `VerificaPdfRenderer mode="student"` |

Nessuna di queste operazioni scrive su Firestore o Storage, crea un record, o richiama una Cloud Function. Le Security Rules negano allo studente ogni lettura di `lessons`, `questionIndex`, `publishedSnapshot`, `corrections`, `correctionEvents`, `auditEvents` e `settings/owner` (eccetto `settings/ownerPublic`).

### 3.4a Approvazione studente — chi può leggere il Portale (M3-lite)

Un utente Google non-owner è un **richiedente/studente potenziale**, non uno studente autorizzato: l'autenticazione da sola non concede alcuna lettura. Ogni operazione della tabella §3.4 richiede, in aggiunta alle condizioni già indicate, entrambe queste condizioni verificate dalle Security Rules (non solo lato client):

- `get settings/studentAccess` → `studentPortalEnabled == true` (interruttore globale; assente = portale disattivato);
- `get students/{request.auth.uid}` → `status == "approved"` (assente, `pending` o `blocked` negano tutti allo stesso modo).

Questa milestone consegna solo lo schema (`StudentAccessSettings`, `Student`) e le Security Rules che li applicano; **non** consegna una UI docente per creare/approvare/bloccare uno studente, né l'assegnazione di una classe. Fino a quella milestone successiva, `students/{uid}` va popolato manualmente dal docente (o da un futuro strumento di amministrazione) perché uno studente veda qualunque contenuto.

`classId` su `Student` e `classIds` su `Program` filtrano ulteriormente cosa uno studente approvato vede: un programma senza classi assegnate, o una verifica senza `classId` (non ancora implementato), non sono visibili a nessuno studente anche se altrimenti pubblici. Lo schema e la UI docente per assegnare le classi ai programmi sono implementati da M3L-A4. Il filtro per classe sulla sezione **Lezioni** (query client + Security Rules) è implementato da M3L-C. Il filtro per classe sulla sezione **Verifiche** resta specifico di una milestone successiva (M3L-D) e non è ancora implementato.

### 3.5 Correzione ed export (Modulo 4, dipende da M3-full)

> Le operazioni seguenti richiedono le consegne digitali di un eventuale M3-full (specifica rinviata, §4); non sono utilizzabili con M3-lite, che non produce consegne.

| Operazione | Scrittura Firestore |
|---|---|
| Leggi consegne | Query `deliveryAttempts` filtrata per `ownerUid` |
| Assegna punteggio | Scrivi `corrections` e `correctionEvents` |
| Rettifica | Appendi `correctionEvents`, aggiorna `corrections` |
| Registro Correzioni (popup) | Solo lettura `corrections` + `deliveryAttempts` (nome, cognome, punteggio, percentuale, data consegna); export PDF/CSV generato nel browser, nessuna scrittura |
| Elimina consegna | Transazione: rimuove `declaredData`, `answers`, `corrections`; preserva `auditEvents` |
| Reset tentativo in corso | Transazione docente con `confirmation: true` e motivazione: porta il tentativo a `cancelled`, invalida la sessione, rimuove il lock e scrive audit; una consegna non è riapribile |
| Export verifiche | Leggi `deliveryAttempts` + `snapshot/items` + `answers` + `corrections`; genera nel browser |

---

## 4. Gateway M3-full: tentativo digitale (specifica rinviata)

> Questa sezione descrive l'eventuale gateway Cloud Functions di un **M3-full**, fase successiva a M3-lite e non pianificata in dettaglio. Nessuno degli endpoint seguenti esiste nella baseline corrente; M3-lite non li richiede.

I soli endpoint di un eventuale M3-full sarebbero `startDigitalAttempt` e `continueDigitalAttempt`. Entrambi scriverebbero tramite Admin SDK: il portale non riceverebbe né userebbe credenziali Firestore per `deliveryAttempts`, risposte o snapshot.

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

## 5. Cloud Functions AI — Modulo 5 (fuori scope V1 / pianificato per V2)

Disponibili solo in V2, con C-02 risolta (provider AI configurato dal docente) e feature flag `aiEnabled = true`.

| Funzione | Request | Response |
|---|---|---|
| `proposeCorrection` | `{ attemptId, itemId }` | `{ proposal: { score, comment, explanation } }` |
| `approveCorrection` | `{ attemptId, itemId, score, comment }` | `{ correctionId }` |
| `bulkApproveCorrections` | `{ attemptId, approvals: [{ itemId, score, comment }] }` | `{ applied: number, skipped: number }` |
| `enableAutomaticCorrection` | `{ verificationId, confirmation: true }` | `{ enabled: boolean }` — richiede anche C-03 |

Tutte richiedono Firebase ID token con `ownerUid` verificato server-side.

---

## 6. Proiezioni Security Rules

Le Security Rules Firestore devono garantire, per la baseline corrente (M1+M2+M3-lite):

| Percorso | Docente (`ownerUid`) | Studente approvato (`students/{uid}.status == "approved"` + `studentPortalEnabled == true`) | Google autenticato non approvato | Non autenticato |
|---|---|---|---|---|
| `settings/owner` | Lettura + scrittura | — | — | — |
| `settings/ownerPublic` | Lettura + scrittura | Solo lettura (`ownerUid`, per routing UI) | Solo lettura (`ownerUid`, per routing UI) | — |
| `settings/studentAccess` | Lettura + scrittura | — (letto dalle Rules via `get()`, mai dal client studente) | — | — |
| `students/{uid}` | Lettura + scrittura | — (nessuna UI/Rule di autolettura in questa milestone) | — | — |
| `programs` (documento top-level) | Lettura + scrittura sull'import attivo/preparato | Solo lettura, solo se `classIds` include il proprio `classId` (M3L-C; assente/vuoto → nessuno studente) | — | — |
| `programs/*/imports/**` (`udas`, `lessons`, `questionIndex`, dati tecnici) | Lettura + scrittura sull'import attivo/preparato | — (mai, indipendentemente dalla classe) | — | — |
| `publicLessons` | Lettura + scrittura (stesso flusso di import) | Solo lettura, solo se il programma padre ha `classIds` compatibile con il proprio `classId` (M3L-C) | — | — |
| `verifications` | Lettura + scrittura solo per bozza e transizioni consentite; scrittura di `visibility` su verifica `attiva` | — (documento padre mai leggibile dallo studente, vedi `publishedProjection`) | — | — |
| `verifications/*/publishedSnapshot` | Lettura | — | — | — |
| `verifications/*/publishedProjection` | Lettura | Lettura solo quando `state == "attiva" && visibility == "public"` | — | — |
| `corrections`, `correctionEvents` | Lettura + scrittura | — | — | — |
| `auditEvents` | Lettura + sola creazione append-only con schema ammesso | — | — | — |

Un Google-autenticato non approvato (nessun documento `students/{uid}`, oppure `pending`/`blocked`, oppure `studentPortalEnabled == false`) non ha alcuna riga con permesso diverso da "—" nella colonna dedicata: è trattato come un non-owner qualunque, con l'unica eccezione di `settings/ownerPublic` (necessaria solo per il routing UI, non per l'autorizzazione).

Le Security Rules esatte vengono scritte e testate con Emulator Suite obbligatoria, incluso il gate M3-lite e il gate di approvazione studente (§3.4a).

> I percorsi seguenti (`publicVerificationLinks`, `verifications/*/participantLocks`, `deliveryAttempts` e sottocollezioni) restano specifica di un eventuale M3-full e non esistono nella baseline corrente:
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

Le condizioni seguenti restano specifica di un eventuale M3-full (link pubblico, tentativi, sessione):

| Condizione | Messaggio utente | Azione suggerita |
|---|---|---|
| Nome e cognome già usati | "Per questa verifica risulta già avviato un tentativo con questi dati. Contatta il docente se è un errore." | Contattare il docente |
| Verifica non attiva | "Il link non è attivo o la verifica è chiusa." | Contattare il docente |
| Rate limit | "Troppo richieste. Attendere qualche minuto." | Riprovare |
| Sessione digitale scaduta o revocata | "La sessione non è più valida. Contatta il docente per un eventuale reset del tentativo." | Contattare il docente |

---

## 8. Versionamento

Gli endpoint Cloud Function sono sotto `/v1`. Cambi incompatibili richiedono nuova versione. I payload pubblici non espongono mai soluzioni, correzioni o configurazioni interne.
