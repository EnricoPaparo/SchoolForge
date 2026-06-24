# SchoolForge — Contratto API

**Versione:** 2.1
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
| `functions/src/index.ts` | Entry point delle Cloud Functions. |
| `functions/src/startDigitalAttempt.ts` | Funzione M3 `startDigitalAttempt`. |
| `src/components/pdf/VerificaPdfRenderer.tsx` | Renderer PDF unificato (`mode="teacher" \| "student"`). |

> Nota: nel contesto della SPA, `src/contracts/lesson.ts` riesporta gli schemi da `packages/lesson-contract/src/index.ts` per semplificare gli import del client.

---

## 1. Architettura API

### 1.1 Scritture client dirette

La maggior parte delle operazioni nei Moduli 1–4 usa Firebase SDK direttamente dal client con Firestore Security Rules. Non esistono Cloud Functions intermedie per repository, verifiche, correzione o export.

Il client docente è autenticato tramite Firebase Authentication; le Security Rules verificano `request.auth.uid == ownerUid` per ogni scrittura sensibile.

### 1.2 Cloud Functions

Le Cloud Functions sono usate solo per due categorie di operazioni:

| Funzione | Modulo | Motivo |
|---|---|---|
| `startDigitalAttempt` | M3 | Richiede token di sessione server-side con cookie HttpOnly/Secure. |
| `proposeCorrection`, `approveCorrection`, `bulkApproveCorrections`, `enableAutomaticCorrection` | M5 | Richiedono chiave API AI in Secret Manager. |

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
// settings/owner
interface OwnerSettings {
  ownerUid: string;
  classes: string[];           // lista classi configurate dal docente
  featureFlags: {
    aiEnabled: boolean;
    aiAutoEnabled: boolean;
  };
}

// programs/{programId}
interface Program {
  id: string;
  ownerUid: string;
  title: string;
  order: number;
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

// lessons/{lessonId}
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

// questionIndex/{questionId}
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
  state: 'bozza' | 'attiva' | 'chiusa' | 'archiviata';  // 'attiva' = link aperto
  publicTokenHash: string | null;  // presente solo se attiva
  sources: string[];               // lessonId[] o udaId[]
  config: {                        // sempre modificabile dal docente, anche dopo l'attivazione
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

// corrections/{attemptId}
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
| Importa Markdown/asset | Scrivi `lessons`, `udas`, aggiorna `questionIndex` | Scrivi in `repository/current/{programId}/{udaId}/` |
| Sostituisci file | Aggiorna `lessons` o `udas` con nuovo `storagePath` | Overwrite su Storage |
| Elimina file/cartella | Aggiorna stato `lessons`/`udas` | Elimina da Storage |
| Programma svolto | Leggi `programs`, `udas`, `lessons` (flag svolto) | — |
| Export ZIP | Leggi struttura + download file Storage | — |

Il parser `lesson-contract` (package interno `packages/lesson-contract/src/index.ts`, riesportato da `src/contracts/lesson.ts`) esegue la validazione nel client prima di qualsiasi scrittura. Se il client riceve errori, la UI li mostra senza scrivere su Firestore o Storage.

### 3.2 Verifiche

| Operazione | Scrittura Firestore |
|---|---|
| Crea/modifica bozza | `verifications.set()` — solo stato `bozza` |
| Attiva verifica | Transazione: valida config contro `questionIndex`, genera `publicTokenHash`, passa a `attiva` |
| Chiudi / archivia | Transazione con `confirmation: true` nel client, aggiorna stato e scrive `auditEvents` |
| Download PDF docente | Solo lettura Firestore + `questionIndex`; genera nel browser |

### 3.3 Canale cartaceo

| Operazione | Scrittura Firestore |
|---|---|
| Genera PDF cartaceo | Solo lettura Firestore + `questionIndex`; genera nel browser |
| Incremento contatore (opzionale) | Incremento atomico di `downloadCount` su `verifications`; nessun dato personale |

Il canale cartaceo è puramente fisico: cliccando "Stampa/Scarica PDF" il documento è generato nel browser e scaricato. Non crea alcun record di tentativo (`deliveryAttempts`) né voce di log di accesso. Non esiste lock né vincolo di unicità: più download sono ammessi. Al più viene incrementato il contatore atomico `downloadCount`.

### 3.4 Correzione ed export

| Operazione | Scrittura Firestore |
|---|---|
| Leggi consegne | Query `deliveryAttempts` filtrata per `ownerUid` |
| Assegna punteggio | Scrivi `corrections` e `correctionEvents` |
| Rettifica | Appendi `correctionEvents`, aggiorna `corrections` |
| Registro Correzioni (popup) | Solo lettura `corrections` + `deliveryAttempts` (nome, cognome, punteggio, percentuale, data consegna); export PDF/CSV generato nel browser, nessuna scrittura |
| Elimina consegna | Transazione: rimuove `declaredData`, `answers`, `corrections`; preserva `auditEvents` |
| Export verifiche | Leggi `deliveryAttempts` + `snapshot/items` + `answers` + `corrections`; genera nel browser |

---

## 4. Cloud Function: startDigitalAttempt

Questa è l'unica Cloud Function nei Moduli 1–4.

### Request

```
POST /v1/startDigitalAttempt
Authorization: Bearer <Firebase ID token studente — non richiesto>
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

Alla prima chiamata riuscita la Function normalizza nome e cognome, verifica in transazione l'assenza di `participantLocks/{SHA-256(nomeNormalizzato + U+001F + cognomeNormalizzato)}`, crea il lock e registra in `accessLog` il nome dichiarato (`Cognome Nome`), l'IP di provenienza, lo user-agent e il timestamp. Questi dati alimentano il Report Accessi del docente. Il nome è auto-dichiarato e non verificato.

### Response 4xx

| Condizione | Codice HTTP | Codice errore |
|---|---|---|
| Token verifica non trovato o verifica non attiva | 404 | `NOT_FOUND` |
| Nome e cognome già usati per la verifica | 409 | `PARTICIPANT_ALREADY_USED` |
| Rate limit raggiunto | 429 | `RATE_LIMITED` |
| Payload non valido | 400 | `VALIDATION_FAILED` |
| `declaredName` non valido (lunghezza fuori 2–100, caratteri non ammessi, vuoto o whitespace-only) | 400 | `VALIDATION_FAILED` |

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

Le Security Rules Firestore devono garantire:

| Percorso | Docente (`ownerUid`) | Client portale | Nessuno |
|---|---|---|---|
| `settings/owner` | Lettura + scrittura | — | Scrittura |
| `programs`, `udas`, `lessons`, `questionIndex` | Lettura + scrittura | Lettura limitata (solo verifica attiva) | — |
| `verifications` | Lettura + scrittura | Lettura proiezione pubblica (solo attiva) | Lettura completa |
| `verifications/*/participantLocks` | Lettura | Scrittura solo via Function | Lettura/scrittura diretta |
| `deliveryAttempts` | Lettura | Creazione + scrittura (solo proprio tentativo con token sessione) | Lettura altri tentativi |
| `deliveryAttempts/*/accessLog` | Lettura (Report Accessi) | Scrittura solo via Function | Lettura/scrittura diretta |
| `deliveryAttempts/*/snapshot/items` | Lettura completa | Lettura senza `soluzione` | — |
| `corrections`, `correctionEvents` | Lettura + scrittura | — | — |
| `auditEvents` | Lettura | — | Scrittura |

Le Security Rules esatte vengono scritte e testate in F-04 con Emulator Suite obbligatoria.

---

## 7. Messaggi di errore UX

| Condizione | Messaggio utente | Azione suggerita |
|---|---|---|
| Nome e cognome già usati | "Per questa verifica risulta già avviato un tentativo con questi dati. Contatta il docente se è un errore." | Contattare il docente |
| Verifica non attiva | "Il link non è attivo o la verifica è chiusa." | Contattare il docente |
| Configurazione non attivabile | "Impossibile attivare: [motivo specifico]." | Correggere la configurazione |
| Rate limit | "Troppo richieste. Attendere qualche minuto." | Riprovare |
| Pool insufficiente | "Non ci sono abbastanza domande per questa configurazione." | Aggiungere domande al pool |
| Token sessione scaduto | "La sessione è scaduta. Aprire di nuovo il link della verifica." | — |

---

## 8. Versionamento

Gli endpoint Cloud Function sono sotto `/v1`. Cambi incompatibili richiedono nuova versione. I payload pubblici non espongono mai soluzioni, correzioni o configurazioni interne.
