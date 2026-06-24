# SchoolForge — Sicurezza e protezione dei dati

**Versione:** 2.0
**Data:** 24 giugno 2026
**Stato:** baseline
**Input vincolante:** [Architettura v2.0](architettura.md), [Analisi dei requisiti v2.0](analisi-requisiti.md)
**Destinatari:** team di implementazione, responsabile operativo, revisore di sicurezza

---

## 1. Scopo e perimetro

Questo documento consolida in un unico riferimento tutte le decisioni, le regole e i controlli di sicurezza di SchoolForge. Traduce NFR-SEC-01–05, BR-AUTH-01, BR-MD-01, BR-VER-11/12, NFR-AI-01–02 e gli ADR dell'architettura v2.0 in regole concrete, implementabili e verificabili.

L'obiettivo non è la sicurezza teorica. L'obiettivo è garantire che:

1. solo il Docente proprietario possa leggere o modificare i dati gestionali di SchoolForge;
2. lo Studente acceda al solo Portale Verifiche, senza poter leggere soluzioni, dati di altri studenti o configurazioni interne;
3. ogni email possa scaricare/svolgere una Verifica una sola volta, in modo atomico (email bruciata);
4. i dati personali degli studenti e le risposte alle prove siano protetti in transito e a riposo;
5. il provider AI (Modulo 5) non ampli la superficie di attacco oltre il necessario;
6. un'eventuale compromissione sia rilevabile e contenibile.

Coerentemente con la v2.0, **Google Forms, l'import roster Google Education e Google Drive sono eliminati**: non esistono token OAuth Forms/roster da proteggere, né artefatti su Drive.

---

## 2. Modello di minaccia

Il modello segue la metodologia STRIDE applicata ai componenti principali di SchoolForge.

### 2.1 Asset da proteggere

| Asset | Sensibilità | Conseguenze di una compromissione |
|---|---|---|
| Markdown e asset delle Lezioni | Media | Perdita di conoscenza didattica proprietaria |
| Domande e soluzioni del pool / snapshot Verifiche | Alta | Divulgazione delle risposte prima della somministrazione |
| Risposte degli studenti, punteggi, percentuali | Alta | Violazione privacy di minori; rischio legale/disciplinare |
| Registro email bruciate (`burned`) | Alta | Aggiramento del vincolo "un download per studente" |
| Credenziali provider AI (Modulo 5) | Alta | Costi non autorizzati; accesso a dati didattici |
| Configurazione `settings/owner` | Critica | Acquisizione del controllo completo del sistema |
| Log di audit | Media | Manipolazione della tracciabilità delle azioni |

### 2.2 Analisi STRIDE

| Componente | Spoofing | Tampering | Repudiation | Info Disclosure | Denial of Service | Elevation of Privilege |
|---|---|---|---|---|---|---|
| Firebase Auth / token docente | Mitigato da Google Sign-In + controllo `sub` server-side | Mitigato da token firmati JWT | Mitigato da audit log append-only | Basso rischio | Dipende da Google | Mitigato da backend authority |
| Firebase Auth / token studente (Portale) | Mitigato da Google Sign-In + verifica dominio Education | Token firmati JWT | Email bruciata + audit | Mitigato: il portale non riceve soluzioni | Dipende da Google | Mitigato: nessun privilegio docente sul token studente |
| Cloud Functions (backend) | Verifica token Firebase per ogni richiesta | Transazioni Firestore e validazione input (Zod) | Audit event per azione rilevante | Nessuno stack trace in risposta | Rate limiting Cloud Functions | Nessun ruolo elevabile |
| Firestore | Accesso solo tramite SDK con auth | Security Rules + backend authority | Append-only audit | Rules che negano accesso senza token valido | Dipende da Google | `ownerUid` su ogni documento; `burned` solo backend |
| Cloud Storage | Non applicabile | Storage Rules + backend authority | Audit event import | Bucket privato, URL firmati a scadenza breve | Dipende da Google | Nessun URL pubblico |
| Web app docente (browser) | CSP e HTTPS | Input sanitization e CSP | Browser non scrive audit | Modello rendering privo di soluzioni/pool | Non applicabile | Nessun privilegio backend nel browser |
| Portale Verifiche (browser) | CSP e HTTPS | Risposte validate server-side | Consegna con timestamp + audit | Nessuna soluzione/opzione corretta nel payload svolgimento | Non applicabile | Studente non può invocare endpoint docente |
| AiGateway (Modulo 5) | Contesto chiuso costruito dal backend | Nessun tool esterno | Audit AI con hash contesto | Context restriction; output validato | Fuori controllo SchoolForge | Non applicabile |

### 2.3 Rischi residui accettati

| Rischio | Motivazione accettazione |
|---|---|
| Disponibilità dipende da Google Cloud | Scelta architetturale deliberata (ADR-01); SLA Google adeguato per uso didattico |
| Deterrenza anti-cheat del Portale non è sicurezza | Dichiarato esplicitamente (BR-POR-02): il docente è l'anti-cheat reale |
| Prompt injection su risposte studenti (Modulo 5) | Mitigato dal contesto chiuso; non eliminabile con modelli fondazionali |
| Condivisione di un link verifica tra studenti | L'email bruciata limita a un download per email; più email restano possibili (atteso) |

---

## 3. Firestore Security Rules

Le regole seguono il principio "nega tutto per default, concedi il minimo necessario". Il backend (service account Cloud Functions) bypassa le rules; queste proteggono da accessi diretti al database. In particolare, **nessuna collezione consente scritture dirette dal client**: ogni scrittura passa dal backend, comprese le consegne del Portale e i record `burned`.

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ── Funzioni di supporto ──────────────────────────────────────────────

    // Docente proprietario: claim iniettato dal backend al primo login verificato.
    function isOwner() {
      return request.auth != null
          && request.auth.token.schoolforge_owner == true;
    }

    // ── settings/owner ────────────────────────────────────────────────────
    // Lettura: solo docente proprietario. Scrittura: mai dal client (solo backend).
    match /settings/owner {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── Collezioni di dominio del docente ─────────────────────────────────
    // Lettura: solo docente. Scrittura: solo backend (service account).
    match /programs/{programId}       { allow read: if isOwner(); allow write: if false; }
    match /udas/{udaId}               { allow read: if isOwner(); allow write: if false; }
    match /lessons/{lessonId}         { allow read: if isOwner(); allow write: if false; }
    match /questionIndex/{questionId} { allow read: if isOwner(); allow write: if false; }

    match /exams/{examId} {
      allow read: if isOwner();
      allow write: if false; // attivazione e stati: solo backend
      // Snapshot immutabile creato al momento dell'attivazione: solo backend.
      match /items/{itemId} {
        allow read: if isOwner();
        allow write: if false;
      }
    }

    // ── burned: registro email bruciate ───────────────────────────────────
    // Né il docente né lo studente leggono o scrivono direttamente.
    // La verifica-e-scrittura è una transazione atomica eseguita SOLO dal backend.
    match /burned/{examId}/emails/{email} {
      allow read: if false;
      allow write: if false;
    }

    // ── students ──────────────────────────────────────────────────────────
    // Dati personali. Lettura solo docente; creazione lazy e update solo backend.
    match /students/{studentId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── submissions: risposte studenti ────────────────────────────────────
    // Inserite dal Portale tramite backend; lette solo dal docente.
    // Lo studente NON legge le proprie risposte dopo la consegna.
    match /submissions/{submissionId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── corrections ───────────────────────────────────────────────────────
    match /corrections/{correctionId} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── auditEvents ───────────────────────────────────────────────────────
    // Lettura docente (storico); scrittura mai dal client; append-only lato backend.
    match /auditEvents/{eventId} {
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

- Il custom claim `schoolforge_owner: true` viene iniettato dal backend al primo login verificato del docente tramite Firebase Admin SDK, dopo aver confrontato il soggetto Google (`sub`) con `settings/owner.googleSubject`.
- Lo **Studente non ha alcun claim di proprietà**: il suo token Google scolastico autentica le sole chiamate al backend del Portale (§ 3.1). Non può leggere alcuna collezione Firestore direttamente: le rules negano ogni lettura a chi non è owner.
- Le Security Rules sono il secondo livello di difesa. Il controllo principale è nel backend: ogni endpoint verifica token, soggetto/dominio e precondizioni di business prima di operare.
- La collezione `burned` non è leggibile né scrivibile da alcun client: il vincolo "un download per email" è garantito solo dalla transazione backend (§ 3.2). Questa scelta è deliberata e non deve essere allentata.

### 3.1 Accesso dello Studente al Portale Verifiche

Lo Studente non scrive mai direttamente su Firestore. Il flusso è interamente mediato dal backend:

1. il Portale chiama `getExamPublic` (nessuna autenticazione): riceve solo titolo e stato, mai domande o soluzioni;
2. lo Studente si autentica con Google scolastico; il backend verifica che l'email appartenga al dominio Education configurato (`settings/owner.allowedDomain`);
3. per il canale digitale, `startDigitalAttempt` restituisce le domande **senza** `solution` né `correct_option_ids`;
4. `submitAnswers` salva la Consegna tramite backend; lo Studente non può rileggerla.

Il backend rifiuta (`FORBIDDEN`) qualsiasi tentativo di un token studente di invocare endpoint del Docente.

### 3.2 Transazione di email bruciata

Il download/avvio per uno Studente è protetto da una transazione Firestore atomica (BR-VER-12):

```text
transaction:
  ref = burned/{examId}/emails/{normalizedEmail}
  doc = get(ref)
  if doc exists:            → abort → EMAIL_BURNED (HTTP 409)
  else:
    set(ref, { email, burnedAt: now, channel })
    commit
  poi: genera PDF / avvia attempt
```

- L'email è normalizzata (lowercase, trim) prima del confronto, per evitare aggiramenti banali.
- Il documento `burned` è creato **dentro** la stessa transazione che autorizza il download: due richieste simultanee con la stessa email non possono entrambe avere successo.
- Il **Docente** (`generatePdfDocente`) non passa da questa transazione e non crea record `burned`.
- Esiste una funzione amministrativa auditata per invalidare manualmente un record `burned` errato (cfr. piano-implementazione §10.2); non è esposta come auto-servizio.

---

## 4. Cloud Storage Security Rules

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    function isOwner() {
      return request.auth != null
          && request.auth.token.schoolforge_owner == true;
    }

    // ── repository/current ───────────────────────────────────────────────
    // Lettura: docente (download diretto del sorgente). Scrittura: solo backend.
    match /repository/current/{allPaths=**} {
      allow read: if isOwner();
      allow write: if false;
    }

    // ── staging ──────────────────────────────────────────────────────────
    // Upload iniziale consentito al docente nel proprio prefisso import.
    // Promozione a current e cancellazione: solo backend.
    match /staging/{importId}/{allPaths=**} {
      allow write: if isOwner()
                   && request.resource.size < 50 * 1024 * 1024; // 50 MB per file
      allow read: if isOwner();
      allow delete: if false;
    }

    // ── exports ──────────────────────────────────────────────────────────
    // Export ZIP temporanei generati dal backend e scaricabili dal docente.
    match /exports/{exportId}/{allPaths=**} {
      allow read: if isOwner();
      allow write: if false;
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

- Il limite di 50 MB per file in staging è un controllo aggiuntivo lato client/rules; il backend valida ulteriormente dimensione e tipo prima di promuovere.
- Il bucket non deve avere URL pubblici. Tutti i file sono accessibili tramite URL firmati a scadenza breve generati dal backend.
- **I PDF non vengono mai scritti su Cloud Storage**: sono generati on-demand e trasmessi al richiedente. Non esiste alcun prefisso per PDF persistenti.
- Gli oggetti orfani in staging vengono rimossi da una Cloud Function schedulata (default: 24 ore).

---

## 5. Content Security Policy (CSP)

Entrambe le app (web docente e Portale) su Firebase Hosting devono dichiarare la CSP nell'header HTTP `Content-Security-Policy`, configurata in `firebase.json` (`hosting.headers`).

```json
{
  "key": "Content-Security-Policy",
  "value": "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://storage.googleapis.com data:; font-src 'self'; connect-src 'self' https://*.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://*.cloudfunctions.net; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self';"
}
```

**Spiegazione delle direttive:**

| Direttiva | Valore | Motivazione |
|---|---|---|
| `default-src` | `'none'` | Nega tutto per default; ogni risorsa va consentita esplicitamente |
| `script-src` | `'self'` | Solo script dal proprio dominio; nessun inline script |
| `style-src` | `'self' 'unsafe-inline'` | Stili inline per il renderer Markdown; da restringere con nonce se si adotta CSS-in-JS |
| `img-src` | `'self' https://storage.googleapis.com data:` | Immagini dal bundle e da Cloud Storage; `data:` per immagini base64 nel Markdown |
| `connect-src` | Firebase SDK + Google APIs + Cloud Functions | Solo le API necessarie |
| `frame-src` | `'none'` | Nessun iframe; previene clickjacking |
| `object-src` | `'none'` | Nessun plugin |
| `base-uri` | `'self'` | Previene `<base>` injection |

**Header aggiuntivi obbligatori (entrambe le app):**

```json
[
  { "key": "X-Content-Type-Options", "value": "nosniff" },
  { "key": "X-Frame-Options", "value": "DENY" },
  { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
  { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" },
  { "key": "Strict-Transport-Security", "value": "max-age=31536000; includeSubDomains" }
]
```

> Nota Portale: la modalità fullscreen di svolgimento richiede l'API `requestFullscreen`, che non è governata dalla CSP. La disabilitazione del copia-incolla è una misura di deterrenza UI (BR-POR-02), non una garanzia di sicurezza.

---

## 6. CORS

Le Cloud Functions v2 non richiedono configurazione CORS esplicita se invocate tramite Firebase SDK callable. Per eventuali endpoint HTTP puri, la configurazione CORS deve:

1. consentire solo le origini dei due domini Firebase Hosting di produzione (web docente e Portale) e, in sviluppo, `http://localhost:*`;
2. negare credenziali su endpoint pubblici non applicabili;
3. non usare `Access-Control-Allow-Origin: *` su alcun endpoint che restituisca dati applicativi.

```typescript
import cors from 'cors';

const allowedOrigins = [
  process.env.HOSTING_URL,          // es. https://schoolforge-prod.web.app
  process.env.PORTALE_URL,          // es. https://portale.schoolforge.app
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
| Credenziali provider AI (Modulo 5) | Secret Manager (`schoolforge/ai-provider-key`) | Solo service account Cloud Functions AiGateway |
| Firebase Admin SDK key | Secret Manager in CI o variabile protetta CI | Solo pipeline CI/CD |
| `settings/owner` (soggetto Google) | Firestore (non è un segreto tecnico) | Backend e docente tramite UI |

Non esistono più token OAuth Google Forms o roster: l'eliminazione di Forms/Drive/roster rimuove un'intera classe di segreti dalla superficie da gestire.

### 7.2 Regole operative per i segreti

1. **Mai nel codice sorgente.** Nessun segreto, token o chiave API in file TypeScript, JSON, YAML, `.env` committati, commenti o log.
2. **Mai in Firestore o Cloud Storage.** Questi sistemi sono leggibili (tramite regole) dal docente; i segreti appartengono a Secret Manager.
3. **Mai nei log.** Cloud Logging non riceve chiavi, risposte AI complete o risposte degli studenti.
4. **Mai nel browser.** Il client riceve solo token Firebase di breve durata; nessuna chiave AI.
5. **Rotazione senza downtime.** I segreti sono letti da Secret Manager a runtime, non cablati in build.

### 7.3 Pipeline CI/CD e segreti

| Variabile CI | Contenuto | Accesso |
|---|---|---|
| `FIREBASE_TOKEN_CI` | Token per deploy/test su `dev`/`test` | Solo job CI; mai in log |
| `FIREBASE_TOKEN_PROD` | Token per deploy `prod` | Solo job `deploy-prod` post-gate |
| `FIREBASE_PROJECT_ID_DEV` / `_PROD` | ID progetti | Dev a tutti i job; Prod solo a deploy post-gate |

Le variabili CI devono essere "protected" e "masked". Un job di PR non deve avere accesso alle variabili di produzione. La pipeline non stampa mai variabili d'ambiente in output.

---

## 8. Sanitizzazione del Markdown

Il renderer Markdown deve usare una libreria di sanitizzazione (es. DOMPurify) con configurazione restrittiva prima di inserire HTML nel DOM.

### 8.1 Tag e attributi consentiti

```typescript
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

// Forza target="_blank" + rel="noopener noreferrer" su tutti i link.
// Blocca URL pericolosi (file://, javascript:, data: su img non base64).
```

### 8.2 Cosa non deve mai apparire nel rendering di fruizione

Il modello dati consegnato alla pagina di fruizione (`getLessonForRendering`) non deve contenere:

- domande del pool (`.pool.md`) o il loro contenuto;
- soluzioni e chiavi di risposta;
- opzioni corrette di domande chiuse.

Sono visibili solo le domande di autoverifica (`kind: self_check`). Questo è un controllo **backend**, non solo frontend: l'endpoint costruisce un modello privo di questi elementi, indipendentemente da ciò che il browser richiede (BR-MD-01).

---

## 9. Protezione dati personali

### 9.1 Dati personali in SchoolForge V1

| Dato | Fonte | Finalità | Conservazione |
|---|---|---|---|
| Nome, cognome studente | Inserimento studente al portale o manuale docente | Identificazione consegne, archiviazione | Fino a eliminazione esplicita |
| Email studente (Google scolastica) | Inserimento al portale | Identità dello studente, email bruciata, matching consegne | Fino a eliminazione esplicita |
| Classe (opzionale) | Inserimento studente o docente | Organizzazione | Fino a eliminazione esplicita |
| Risposte alle verifiche | Svolgimento digitale o inserimento manuale | Correzione e storico | Immutabili; eliminazione solo su decisione del Docente |
| Punteggi e percentuali | Calcolo backend | Storico valutativo | Immutabili con rettifiche tracciate |

I dati riguardano **minori**: le regole di minimizzazione vanno applicate con rigore (vedi anche brief, sezione privacy, e i verbali in `documentazione/decisioni/`).

### 9.2 Regole di minimizzazione

1. I log applicativi (Cloud Logging) non contengono nome, email, risposte o punteggi di studenti.
2. Gli audit event contengono solo identificativi tecnici (`studentId`, `submissionId`, `examId`), non dati anagrafici né testo delle risposte.
3. I prompt inviati all'AI per la correzione (Modulo 5) sono mostrati al Docente prima dell'invio (NFR-AI-02) e non contengono informazioni identificative dello studente non necessarie alla correzione.
4. L'export ZIP del repository contiene solo Markdown e asset; nessun dato anagrafico, risposta o punteggio.
5. Il PDF non viene mai conservato; il file `.txt` del programma svolto non contiene dati di studenti.

### 9.3 Consenso per l'invio di dati all'AI (Modulo 5)

Prima di inviare risposte di uno studente a un provider AI, il backend deve:

1. verificare un consenso operativo del Docente (per Verifica o per singola Consegna), in linea con la decisione C-02;
2. mostrare al Docente i dati che verranno trasmessi (lezione, domanda, soluzione, risposta — senza identificativi anagrafici non necessari);
3. richiedere conferma esplicita o riferirsi a una configurazione persistente chiaramente revocabile;
4. registrare nell'audit event: provider, modello, timestamp, finalità, hash del contesto e consenso.

### 9.4 Eliminazione dei dati

SchoolForge V1 non implementa eliminazione automatica o schedulata. Il Docente può eliminare Lezioni (file da Storage e indice da Firestore; non modifica Verifiche esistenti). L'eliminazione fisica di dati personali da Firestore (studente, consegne) richiede un'operazione backend auditata e non è disponibile come auto-servizio nella V1; la base giuridica e i tempi di retention sono definiti nel verbale di decisione privacy.

---

## 10. Sicurezza dell'integrazione AI (Modulo 5)

### 10.1 Controlli di contesto

`AiGateway` implementa i seguenti controlli prima di ogni chiamata:

```typescript
interface AiContext {
  lessonContent: string;       // solo contenuto della/e lezione/i selezionata/e
  questionPrompt: string;
  solution: string;
  studentResponse?: string;    // solo per correzione; opzionale per generazione
  // Non presenti: altri file, URL, tool, funzioni, browser, retrieval
}

// Il context non deve superare una dimensione massima configurabile (anti prompt-injection).
function validateContextSize(ctx: AiContext, maxTokensEstimate: number): void;

// Il prompt di sistema è un template fisso versionato, non costruito da input utente.
function buildSystemPrompt(templateVersion: string): string;
```

Non esistono rubriche: la valutazione AI propone un punteggio entro il `maxScore` dell'item (`coeff_difficoltà × coeff_peso`), non criteri strutturati.

### 10.2 Protezione da prompt injection

Il Markdown delle lezioni è scritto dal Docente, non input non fidato. Per precauzione:

1. il contenuto è troncato al limite di token prima dell'invio;
2. il prompt di sistema specifica che l'AI non deve eseguire istruzioni presenti nel contenuto della lezione;
3. l'output dell'AI è validato con Zod prima di essere restituito (struttura, tipi, limiti numerici);
4. un punteggio proposto che eccede il `maxScore` dell'item viene rifiutato dal gateway, non solo dalla UI.

### 10.3 Audit AI

Ogni invocazione AI produce un documento in `auditEvents`:

```typescript
interface AiAuditEvent {
  actor: 'system';
  action: 'ai_invocation';
  purpose: 'question_generation' | 'correction_proposal';
  provider: string;
  modelId: string;
  templateVersion: string;
  contextHash: string;         // hash SHA-256 del contesto inviato
  lessonIds: string[];
  examId?: string;
  submissionId?: string;
  outcome: 'success' | 'error' | 'refused';
  approvedBy?: 'teacher' | 'automatic';
  approvedAt?: Timestamp;
  timestamp: Timestamp;
}
```

---

## 11. Checklist di sicurezza per gate

### Gate G2 (M1 — Repository)

- [ ] Account non autorizzato riceve HTTP 403 su tutti gli endpoint
- [ ] Account non autorizzato riceve errore anche accedendo direttamente a Firestore (Security Rules)
- [ ] Le domande del pool e le soluzioni non compaiono nel modello di rendering della lezione
- [ ] La CSP è attiva e blocca script inline non autorizzati
- [ ] Nessun segreto nel codice sorgente (scan automatico in CI)
- [ ] URL firmati di Storage hanno scadenza ≤ 1 ora
- [ ] Gli header di sicurezza HTTP sono presenti su tutte le risposte di entrambe le app

### Gate G3 (M2 — Verifiche e Portale)

- [ ] Una verifica attivata non è modificabile tramite chiamata diretta API
- [ ] Soluzioni e opzioni corrette non compaiono nel payload del Portale (download e svolgimento)
- [ ] Il PDF non viene scritto su alcuno storage dopo la generazione
- [ ] Un secondo download/svolgimento con la stessa email è rifiutato con 409 (email bruciata)
- [ ] La transazione `burned` è atomica: due richieste simultanee con la stessa email non riescono entrambe
- [ ] Il download del Docente non crea record `burned`
- [ ] Un token studente non può invocare endpoint del Docente

### Gate G4 (M3 — Correzione)

- [ ] Dati anagrafici e testo risposte assenti nei log Cloud Logging e negli audit event
- [ ] Le rettifiche conservano valore precedente, autore, data e motivazione (append-only)

### Gate G5 (M4 — Storico)

- [ ] Lo storico è leggibile solo dal Docente; nessun endpoint espone risultati di uno studente ad altri
- [ ] Le query usano indici dichiarati; nessuna scansione client di dati personali

### Gate G5-AI / G6 (Modulo 5)

- [ ] Nessuna chiamata AI senza consenso esplicito del Docente
- [ ] Il contesto inviato all'AI non contiene lezioni non selezionate né web/retrieval
- [ ] L'output AI è validato (schema Zod) prima dell'uso
- [ ] Un punteggio AI > `maxScore` dell'item viene rifiutato dal gateway
- [ ] L'audit contiene hash del contesto e modello usato
- [ ] La modalità automatica non è attiva per default (C-03)

---

## Appendice A — Strumenti di scansione consigliati in CI

| Strumento | Scopo | Quando |
|---|---|---|
| `gitleaks` o `truffleHog` | Rilevamento segreti nel codice sorgente | Ogni PR |
| `npm audit` / `pnpm audit` | Vulnerabilità nelle dipendenze | Ogni PR + settimanale |
| `eslint-plugin-security` | Pattern insicuri nel codice TypeScript | Ogni PR |
| `zod` (runtime) | Validazione input/output AI e API | Runtime |
| `@firebase/rules-unit-testing` | Test automatici delle Security Rules (incl. `burned` e accesso studente) | Ogni modifica alle rules |
| Lighthouse | Header sicurezza, CSP, HTTPS | Ogni deploy staging |
