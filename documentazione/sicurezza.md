# SchoolForge — Sicurezza e protezione dei dati

**Versione:** 1.0
**Data:** 22 giugno 2026
**Stato:** baseline
**Input vincolante:** [Architettura v1.0](architettura.md), [Analisi dei requisiti v1.1](analisi-requisiti.md)
**Destinatari:** team di implementazione, responsabile operativo, revisore di sicurezza

---

## 1. Scopo e perimetro

Questo documento consolida in un unico riferimento tutte le decisioni, le regole e i controlli di sicurezza di SchoolForge. Traduce NFR-SEC-01–05, BR-AUTH-01, BR-MD-01, NFR-AI-01–02 e ADR-01–06 in regole concrete, implementabili e verificabili.

L'obiettivo non è la sicurezza teorica. L'obiettivo è garantire che:

1. solo il Docente proprietario possa leggere o modificare dati SchoolForge;
2. i dati personali degli studenti e le risposte alle prove siano protetti in transito e a riposo;
3. le integrazioni Google e AI non amplino la superficie di attacco oltre il necessario;
4. un'eventuale compromissione sia rilevabile e contenibile.

---

## 2. Modello di minaccia

Il modello segue la metodologia STRIDE applicata ai componenti principali di SchoolForge.

### 2.1 Asset da proteggere

| Asset | Sensibilità | Conseguenze di una compromissione |
|---|---|---|
| Markdown e asset delle Lezioni | Media | Perdita di conoscenza didattica proprietaria |
| Domande e soluzioni delle Verifiche | Alta | Divulgazione delle risposte prima della somministrazione |
| Risposte degli studenti e punteggi | Alta | Violazione privacy minori; rischio legale/disciplinare |
| Token OAuth Google (Forms, roster) | Critica | Accesso non autorizzato all'account Education del Docente |
| Credenziali provider AI | Alta | Costi non autorizzati; accesso a dati didattici |
| Configurazione `settings/owner` | Critica | Acquisizione del controllo completo del sistema |
| Log di audit | Media | Manipolazione della tracciabilità delle azioni |

### 2.2 Analisi STRIDE

| Componente | Spoofing | Tampering | Repudiation | Info Disclosure | Denial of Service | Elevation of Privilege |
|---|---|---|---|---|---|---|
| Firebase Auth / token docente | Mitigato da Google Sign-In + controllo `sub` server-side | Mitigato da token firmati JWT | Mitigato da audit log append-only | Basso rischio | Dipende da Google | Mitigato da backend authority |
| Cloud Functions (backend) | Mitigato da verifica token Firebase | Mitigato da transazioni Firestore e validazione input | Mitigato da audit event per ogni azione rilevante | Mitigato da nessuno stack trace in risposta | Mitigato da rate limiting Cloud Functions | Mitigato da nessun ruolo elevabile |
| Firestore | Non applicabile (accesso solo tramite SDK con auth) | Mitigato da Security Rules + backend authority | Mitigato da append-only audit | Mitigato da Security Rules che negano accesso senza token valido | Dipende da Google | Mitigato da ownerUid su ogni documento |
| Cloud Storage | Non applicabile | Mitigato da Storage Rules + backend authority | Mitigato da audit event import | Mitigato da bucket privato | Dipende da Google | Mitigato da nessun URL pubblico |
| Web app (browser) | Mitigato da CSP e HTTPS | Mitigato da input sanitization e CSP | Non applicabile (browser non scrive audit) | Mitigato da nessun dato assessment nel modello di visualizzazione | Non applicabile | Mitigato da nessun privilegio backend nel browser |
| Google Forms / roster | Mitigato da token OAuth in Secret Manager | Mitigato da idempotenza import e quarantena | Mitigato da integrationStatus e audit | Mitigato da scope minimi OAuth | Fuori controllo SchoolForge | Mitigato da scope minimi OAuth |
| AiGateway | Mitigato da contesto chiuso costruito dal backend | Mitigato da nessun tool esterno | Mitigato da audit AI con hash contesto | Mitigato da prompt injection detection e context restriction | Fuori controllo SchoolForge | Non applicabile |

### 2.3 Rischi residui accettati

| Rischio | Motivazione accettazione |
|---|---|
| Disponibilità dipende da Google Cloud | Scelta architetturale deliberata (ADR-01); SLA Google è adeguato per uso didattico |
| Prompt injection su risposte studenti | Rischio mitigato dal contesto chiuso; non eliminabile completamente con modelli fondazionali |
| Side-channel da metadati di utilizzo | Nell'uso singolo-docente il rischio è accettabile; da rivalutare in multi-docente |

---

## 3. Firestore Security Rules

Le regole seguenti implementano il principio "nega tutto per default, concedi il minimo necessario". Il backend (service account Cloud Functions) bypassa le rules; queste proteggono da accessi diretti al database.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Funzioni di supporto ──────────────────────────────────────────────

    // Verifica che il richiedente sia il docente proprietario autenticato.
    // Usa il claim 'sub' (soggetto Google stabile) che il backend ha verificato
    // e iniettato come custom claim durante il login.
    function isOwner() {
      return request.auth != null
          && request.auth.token.schoolforge_owner == true;
    }

    // Verifica che un documento di update non modifichi campi immutabili.
    function doesNotChange(fields) {
      return !request.resource.data.diff(resource.data).affectedKeys().hasAny(fields);
    }

    // ── settings/owner ────────────────────────────────────────────────────
    // Lettura: solo docente proprietario (per configurazione iniziale dell'UI).
    // Scrittura: mai dal client. Solo il backend (service account) configura l'owner.
    match /settings/owner {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── programs ──────────────────────────────────────────────────────────
    match /programs/{programId} {
      allow read: if isOwner();
      allow write: if false; // solo backend
    }

    // ── udas ──────────────────────────────────────────────────────────────
    match /udas/{udaId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── lessons ───────────────────────────────────────────────────────────
    match /lessons/{lessonId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── questionIndex ─────────────────────────────────────────────────────
    // Lettura consentita per composizione verifiche lato client (read-only).
    // Scrittura: solo backend al momento dell'import/sostituzione.
    match /questionIndex/{questionId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── exams ─────────────────────────────────────────────────────────────
    match /exams/{examId} {
      allow read: if isOwner();
      allow write: if false; // pubblicazione e stati: solo backend

      // items: subcollection immutabile dopo pubblicazione
      match /items/{itemId} {
        allow read: if isOwner();
        allow write: if false;
      }
    }

    // ── classes ───────────────────────────────────────────────────────────
    match /classes/{classId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── students ──────────────────────────────────────────────────────────
    // Dati personali: accesso strettamente al docente proprietario.
    match /students/{studentId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── assignments ───────────────────────────────────────────────────────
    match /assignments/{assignmentId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── submissions ───────────────────────────────────────────────────────
    // Risposte studenti: massima protezione.
    match /submissions/{submissionId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── corrections ───────────────────────────────────────────────────────
    match /corrections/{correctionId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── artifacts ─────────────────────────────────────────────────────────
    match /artifacts/{artifactId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── auditEvents ───────────────────────────────────────────────────────
    // Lettura: docente (per consultare lo storico).
    // Scrittura: mai dal client. Il log deve essere append-only lato backend.
    match /auditEvents/{eventId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── integrationStatus ─────────────────────────────────────────────────
    match /integrationStatus/{integrationId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── Catch-all: nega qualsiasi documento non elencato esplicitamente ───
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**Note implementative:**

- Il custom claim `schoolforge_owner: true` viene iniettato dal backend al primo login verificato del docente tramite Firebase Admin SDK. Il backend verifica il soggetto Google (`sub`) contro `settings/owner.googleSubject` prima di iniettare il claim.
- Le Security Rules sono un secondo livello di difesa. Il controllo principale avviene nel backend: ogni endpoint Cloud Function verifica token Firebase, soggetto Google stabile e configurazione `settings/owner` prima di eseguire qualsiasi operazione.
- Non esiste una regola che consenta scritture dirette dal client su collezioni di dominio. Questa scelta è deliberata e non deve essere allentata anche se un endpoint backend non fosse ancora implementato.

---

## 4. Cloud Storage Security Rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    // ── Funzione di supporto ─────────────────────────────────────────────
    function isOwner() {
      return request.auth != null
          && request.auth.token.schoolforge_owner == true;
    }

    // ── repository/current ───────────────────────────────────────────────
    // Lettura: docente proprietario (per download diretto del sorgente).
    // Scrittura: solo service account backend (promozione dal staging).
    match /repository/current/{allPaths=**} {
      allow read: if isOwner();
      allow write: if false; // solo backend service account
    }

    // ── staging ──────────────────────────────────────────────────────────
    // Il docente può caricare file nel proprio prefisso di staging.
    // Il prefisso è generato dal backend e comunicato al client come URL firmato
    // o come regola con prefisso specifico (importId).
    // La promozione da staging a current è esclusivamente backend.
    match /staging/{importId}/{allPaths=**} {
      // Upload iniziale consentito al docente autenticato; validazione avviene backend.
      allow write: if isOwner()
                   && request.resource.size < 50 * 1024 * 1024; // 50 MB per file
      allow read: if isOwner();
      allow delete: if false; // pulizia solo backend (job o cleanup function)
    }

    // ── exports ──────────────────────────────────────────────────────────
    // Export ZIP temporanei generati dal backend e scaricabili dal docente.
    match /exports/{exportId}/{allPaths=**} {
      allow read: if isOwner();
      allow write: if false; // solo backend
      allow delete: if false;
    }

    // ── Catch-all ────────────────────────────────────────────────────────
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

**Note implementative:**

- Il limite di 50 MB per file in staging è un controllo client-side aggiuntivo. Il backend valida ulteriormente dimensione e tipo di file prima di promuovere dal staging.
- Il bucket non deve avere URL pubblici. Tutti i file sono accessibili tramite URL firmati generati dal backend con scadenza breve.
- Gli oggetti orfani in staging vengono rimossi da una Cloud Function schedulata con scadenza configurabile (default: 24 ore).

---

## 5. Content Security Policy (CSP)

La web app SPA su Firebase Hosting deve dichiarare la seguente CSP nell'header HTTP `Content-Security-Policy`. La configurazione va in `firebase.json` nella sezione `hosting.headers`.

```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://storage.googleapis.com data:; font-src 'self'; connect-src 'self' https://firebaseapp.com https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
}
```

**Spiegazione delle direttive:**

| Direttiva | Valore | Motivazione |
|---|---|---|
| `default-src` | `'none'` | Nega tutto per default; ogni risorsa deve essere esplicitamente consentita |
| `script-src` | `'self'` | Solo script dal proprio dominio; nessun inline script |
| `style-src` | `'self' 'unsafe-inline'` | Consente stili inline per il renderer Markdown; da restringere se si adotta CSS-in-JS con nonce |
| `img-src` | `'self' https://storage.googleapis.com data:` | Immagini dal bundle e da Cloud Storage; `data:` per eventuali immagini base64 nel Markdown |
| `connect-src` | Firebase SDK + Google APIs | Solo le API necessarie all'applicazione |
| `frame-src` | `'none'` | Nessun iframe; previene clickjacking |
| `object-src` | `'none'` | Nessun plugin |
| `base-uri` | `'self'` | Previene attacchi via `<base>` injection |

**Header aggiuntivi obbligatori:**

```json
[
  { "key": "X-Content-Type-Options", "value": "nosniff" },
  { "key": "X-Frame-Options", "value": "DENY" },
  { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
  { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" },
  { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }
]
```

---

## 6. CORS

Le Cloud Functions v2 non richiedono configurazione CORS esplicita se invocate tramite Firebase SDK callable. Se viene esposto un endpoint HTTP puro, la configurazione CORS deve:

1. consentire solo l'origine del dominio Firebase Hosting di produzione e, in sviluppo, `http://localhost:*`;
2. negare credenziali (`withCredentials: false`) su endpoint pubblici non applicabili;
3. non usare `Access-Control-Allow-Origin: *` su alcun endpoint che restituisca dati applicativi.

```typescript
// Esempio di middleware CORS per endpoint HTTP puri in Cloud Functions
import cors from 'cors';

const allowedOrigins = [
  process.env.HOSTING_URL, // es. https://schoolforge-prod.web.app
  ...(process.env.NODE_ENV === 'development' ? ['http://localhost:5173'] : []),
];

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} non consentita`));
    }
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  credentials: false,
});
```

---

## 7. Gestione segreti e CI/CD

### 7.1 Classificazione dei segreti

| Segreto | Dove viene conservato | Chi può leggerlo |
|---|---|---|
| Token OAuth Google Forms | Secret Manager (`schoolforge/google-forms-token`) | Solo service account Cloud Functions autorizzato |
| Token OAuth roster Google Education | Secret Manager (`schoolforge/google-roster-token`) | Solo service account Cloud Functions autorizzato |
| Credenziali provider AI (futuro) | Secret Manager (`schoolforge/ai-provider-key`) | Solo service account Cloud Functions AiGateway |
| Firebase Admin SDK key | Secret Manager in CI o variabile protetta CI | Solo pipeline CI/CD |
| `settings/owner` (soggetto Google) | Firestore (non è un segreto tecnico) | Backend e docente tramite UI |

### 7.2 Regole operative per i segreti

1. **Mai nel codice sorgente.** Nessun segreto, token o chiave API deve comparire in file TypeScript, JSON, YAML, `.env` committati, commenti o log.
2. **Mai in Firestore o Cloud Storage.** Questi sistemi sono accessibili (tramite regole) al docente; i segreti appartengono a Secret Manager.
3. **Mai nei log.** Cloud Logging non deve ricevere token, risposte API complesse o risposte degli studenti.
4. **Mai nel browser.** Il client non riceve token OAuth, chiavi AI o refresh token. Riceve solo token Firebase applicativi di breve durata.
5. **Rotazione senza downtime.** L'implementazione deve supportare la rotazione di ogni segreto senza modifiche al codice: i segreti sono letti da Secret Manager a runtime, non cablati in variabili di build.

### 7.3 Pipeline CI/CD e segreti

| Variabile CI | Contenuto | Accesso |
|---|---|---|
| `FIREBASE_TOKEN` o OIDC | Token per deploy Firebase CLI | Solo job di deploy; mai in log |
| `GCP_SERVICE_ACCOUNT_KEY` | Chiave per operazioni GCP (migrazioni, backup) | Solo job amministrativi |
| `FIREBASE_PROJECT_ID_DEV` | ID progetto `dev` | Tutti i job CI |
| `FIREBASE_PROJECT_ID_PROD` | ID progetto `prod` | Solo job di deploy post-gate |

Le variabili CI devono essere marcate come "protected" e "masked" nel sistema CI. Un job di PR non deve avere accesso alle variabili di produzione.

La pipeline non deve mai stampare variabili d'ambiente in output, nemmeno per debug.

### 7.4 Rotazione dei token OAuth

Quando un token OAuth Google viene revocato o scade:

1. il backend rileva il fallimento dell'integrazione e aggiorna `integrationStatus` con l'errore (senza dettagli del token);
2. il Docente vede un banner di integrazione non disponibile nella UI;
3. i percorsi manuali (PDF, import manuale, storico) continuano a funzionare;
4. il Docente ri-autorizza l'integrazione tramite il flusso OAuth nella UI;
5. il backend aggiorna il segreto in Secret Manager e aggiorna `integrationStatus`.

---

## 8. Sanitizzazione del Markdown

Il renderer Markdown della web app deve usare una libreria di sanitizzazione (es. DOMPurify) con configurazione restrittiva prima di inserire HTML nel DOM.

### 8.1 Tag HTML consentiti nel rendering

```typescript
// Configurazione DOMPurify per il rendering delle lezioni
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr',
  'strong', 'em', 'del', 'code', 'pre',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'blockquote',
  'img',
  'a',
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'title',
  'class', 'id',
  'colspan', 'rowspan',
];

// Forza target="_blank" + rel="noopener noreferrer" su tutti i link
// Blocca URL locali (file://, javascript:, data: su img non-base64)
```

### 8.2 Cosa non deve mai apparire nel rendering di fruizione

Il modello dati consegnato alla pagina di fruizione non deve contenere:

- blocchi `assessment` o il loro contenuto;
- soluzioni e chiavi di risposta;
- rubriche di correzione;
- opzioni corrette di domande chiuse.

Questo è un controllo **backend**, non solo frontend. L'endpoint che restituisce la lezione per il rendering deve costruire un modello privo di questi elementi, indipendentemente da ciò che il browser richiede.

---

## 9. Protezione dati personali

### 9.1 Dati personali in SchoolForge V1

| Dato | Fonte | Finalità | Conservazione |
|---|---|---|---|
| Nome, cognome studente | Inserimento manuale o roster Google | Archiviazione e matching consegne | Fino all'archiviazione/eliminazione esplicita |
| Email studente | Inserimento manuale, roster o risposta Forms | Identificazione nelle consegne | Fino all'archiviazione/eliminazione esplicita |
| Identificativo Google studente | Roster Google Education | Matching stabile | Fino all'eliminazione esplicita |
| Risposte alle verifiche | Import Forms o inserimento manuale | Correzione e archiviazione | Immutabili; eliminazione solo su decisione del Docente |
| Punteggi e percentuali | Calcolo backend | Storico valutativo | Immutabili con rettifiche tracciate |

### 9.2 Regole di minimizzazione

1. I log applicativi (Cloud Logging) non devono contenere nome, email, risposte o punteggi di studenti.
2. Gli audit event contengono solo identificativi tecnici (`studentId`, `submissionId`), non dati anagrafici.
3. I prompt inviati all'AI per la correzione assistita devono essere mostrati al Docente prima dell'invio (NFR-AI-02) e non devono contenere informazioni identificative dello studente non necessarie alla correzione.
4. L'export ZIP del repository contiene solo Markdown e asset; non include dati anagrafici, risposte o punteggi.
5. I PDF di soluzione e rubrica non devono contenere dati di studenti specifici.

### 9.3 Consenso per l'invio di dati all'AI

Prima di inviare risposte di uno studente a un provider AI, il backend deve:

1. verificare che sia configurato un consenso operativo del Docente (globale per Verifica o per singola Consegna);
2. mostrare al Docente i dati che verranno trasmessi (lezione, domanda, soluzione, rubrica, risposta — senza identificativi anagrafici dello studente se non necessari);
3. richiedere conferma esplicita o fare riferimento a una configurazione persistente chiaramente revocabile;
4. registrare nell'audit event: provider, modello, timestamp, finalità, hash del contesto e consenso.

### 9.4 Eliminazione dei dati

SchoolForge V1 non implementa un sistema di eliminazione automatica o schedulata. Il Docente può eliminare:

- Lezioni (elimina file da Storage e indice da Firestore; non modifica Verifiche esistenti);
- Classi e Studenti (disattivazione; le Consegne storiche rimangono collegate ma lo Studente è marcato inattivo);
- Consegne in quarantena (scarto esplicito).

L'eliminazione fisica di dati personali da Firestore richiede un'operazione backend con audit. Non è disponibile come auto-servizio nella V1.

---

## 10. Sicurezza dell'integrazione AI

### 10.1 Controlli di contesto

Il modulo `AiGateway` deve implementare i seguenti controlli prima di ogni chiamata:

```typescript
interface AiContext {
  lessonContent: string;       // solo contenuto della lezione selezionata
  questionPrompt: string;
  solution: string;
  rubric: Rubric;
  studentResponse?: string;    // solo per correzione; opzionale per generazione
  // Non presenti: altri file, URL, tool, funzioni, browser
}

// Controllo: il context non deve superare una dimensione massima configurabile
// per prevenire prompt injection via contenuto Markdown molto lungo.
function validateContextSize(ctx: AiContext, maxTokensEstimate: number): void;

// Controllo: il prompt di sistema deve essere un template fisso versioned,
// non una stringa costruita dinamicamente da input utente.
function buildSystemPrompt(templateVersion: string): string;
```

### 10.2 Protezione da prompt injection

Il Markdown delle lezioni è contenuto scritto dal Docente, non input utente non fidato. Tuttavia, per precauzione:

1. il contenuto Markdown viene troncato al limite configurabile di token prima dell'invio;
2. il prompt di sistema specifica esplicitamente che l'AI non deve eseguire istruzioni presenti nel contenuto della lezione;
3. l'output dell'AI viene validato con Zod prima di essere restituito al chiamante (struttura, tipi, limiti numerici);
4. un punteggio proposto che eccede il massimo della rubrica viene rifiutato dal gateway, non solo dalla UI.

### 10.3 Audit AI

Ogni invocazione AI produce un documento in `auditEvents` con:

```typescript
interface AiAuditEvent {
  actor: 'system';
  action: 'ai_invocation';
  purpose: 'question_generation' | 'correction_proposal' | 'rubric_generation';
  provider: string;
  modelId: string;
  templateVersion: string;
  contextHash: string;         // hash SHA-256 del contesto inviato
  lessonIds: string[];         // lezioni incluse nel contesto
  examId?: string;
  submissionId?: string;
  outcome: 'success' | 'error' | 'refused';
  approvedBy?: string;         // 'teacher' | 'automatic'
  approvedAt?: Timestamp;
  timestamp: Timestamp;
}
```

---

## 11. Checklist di sicurezza per gate

### Gate G2 (Fase 1 — Repository)

- [ ] Account non autorizzato riceve HTTP 403 su tutti gli endpoint
- [ ] Account non autorizzato riceve errore 403 anche accedendo direttamente a Firestore (Security Rules)
- [ ] Un blocco `assessment` non compare nel modello di visualizzazione
- [ ] La CSP è attiva in produzione e blocca script inline non autorizzati
- [ ] Nessun segreto nel codice sorgente (scan automatico in CI)
- [ ] URL firmati di Storage hanno scadenza ≤ 1 ora
- [ ] Gli header di sicurezza HTTP sono presenti su tutte le risposte

### Gate G3 (Fase 2 — Verifiche)

- [ ] Una verifica pubblicata non è modificabile tramite chiamata diretta API
- [ ] Soluzione e rubrica non compaiono nell'endpoint di rendering lezione
- [ ] Il PDF di prova non contiene soluzione o rubrica
- [ ] Il PDF di soluzione non è accessibile senza autenticazione

### Gate G4 (Fase 3 — Archivio)

- [ ] Dati anagrafici studenti assenti nei log Cloud Logging
- [ ] Token OAuth Google conservato solo in Secret Manager
- [ ] La revoca dell'integrazione Forms non compromette storico manuale
- [ ] Una risposta Forms senza email certa finisce in quarantena, non nello storico

### Gate G5-AI (Correzione AI)

- [ ] Nessuna chiamata AI avviene senza consenso esplicito del Docente
- [ ] Il contesto inviato all'AI non contiene lezioni non selezionate
- [ ] L'output AI viene validato (schema Zod) prima dell'uso
- [ ] Un punteggio AI > punteggio massimo viene rifiutato dal gateway
- [ ] Il log di audit contiene hash del contesto e modello usato

---

## Appendice A — Strumenti di scansione consigliati in CI

| Strumento | Scopo | Quando |
|---|---|---|
| `gitleaks` o `truffleHog` | Rilevamento segreti nel codice sorgente | Ogni PR |
| `npm audit` / `pnpm audit` | Vulnerabilità nelle dipendenze | Ogni PR + settimanale |
| `eslint-plugin-security` | Pattern insicuri nel codice TypeScript | Ogni PR |
| `zod` (runtime) | Validazione input/output AI e API | Runtime |
| Firebase Rules Playground | Test manuale delle Security Rules | Ogni modifica alle rules |
| Lighthouse | Header sicurezza, CSP, HTTPS | Ogni deploy staging |
