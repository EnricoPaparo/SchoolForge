# SchoolForge — Strategia di test

**Versione:** 2.0
**Data:** 24 giugno 2026
**Stato:** baseline
**Input vincolante:** [Architettura v2.0](architettura.md), sezione 15; [Piano di implementazione v2.0](piano-implementazione.md), sezione 9
**Destinatari:** team di implementazione, QA, responsabile tecnico

---

## 1. Filosofia

SchoolForge gestisce conoscenza didattica, dati personali di minori e documenti valutativi. La qualità del test non è opzionale: un bug nell'attivazione di una Verifica, nel calcolo della percentuale, nella protezione dei dati di uno studente o nella transazione di email bruciata ha conseguenze reali.

Principi guida:

1. **Test come specifica eseguibile.** Ogni requisito funzionale e ogni regola di business ha almeno un test che ne verifica il rispetto e un test che ne verifica la violazione.
2. **Nessuna fiducia implicita nel percorso felice.** Casi negativi, boundary e precondizioni non rispettate sono test di prima classe.
3. **Isolamento reale.** I test non usano servizi cloud reali. L'unica eccezione documentata sono i test manuali con account Google Workspace for Education (checklist, non CI).
4. **Test che falliscono per le ragioni giuste.** Un test che passa senza verificare il comportamento atteso è peggio di nessun test.
5. **Velocità come requisito.** La suite unit+contract deve completarsi in meno di 60 secondi su un laptop standard. I test E2E devono essere parallelizzabili.

---

## 2. Stack di test

| Strumento | Versione minima | Scopo |
|---|---|---|
| **Vitest** | 2.x | Test unitari e di integrazione TypeScript (backend e `lesson-contract`) |
| **Playwright** | 1.45.x | Test end-to-end di web app docente e Portale Verifiche |
| **Firebase Emulator Suite** | ultima stabile | Emulazione locale di Firestore, Storage, Auth, Functions |
| **@firebase/rules-unit-testing** | ultima stabile | Test delle Security Rules Firestore e Storage |
| **Zod** | 3.x | Validazione runtime degli schema (usata anche nei test come fixture validator) |
| **@testing-library/react** | 16.x | Test dei componenti React isolati |
| **MSW (Mock Service Worker)** | 2.x | Mock degli endpoint Firebase Callable Functions nei test React |

---

## 3. Livelli di test

### 3.1 Unit test

**Scopo:** Verificare la logica di ogni modulo in isolamento, senza I/O esterno.

**Cosa testare:**
- Parser e validatore `lesson-contract`: `parseUda`, `parseLessonMarkdown`, `parsePoolMarkdown` (tutti i casi validi e invalidi del contratto v1)
- Calcolo punteggio massimo per item (`coeff_difficoltà × coeff_peso`, arrotondamento a 2 decimali)
- Calcolo percentuale (`Σ punti / Σ max × 100`, stato `non_definitiva`)
- Macchina a stati delle Verifiche (`bozza` → `attiva` → `chiusa`/`annullata`; transizioni negate)
- Macchina a stati delle Correzioni (`da_correggere` → `in_corso` → `definitiva`)
- Validazione configurazione verifica (somma minimi ≤ totale; totale = aperte + chiuse)
- Selezione domande dal pool (rispetto minimi per difficoltà; seed fisso vs per-email)
- Logica di deduplicazione del corpus (UDA + Lezioni selezionate)
- Validazione dei payload delle Cloud Functions (schema Zod)
- Normalizzazione email per la chiave `burned` (lowercase/trim)
- Costruzione del contesto AI (verifica che non includa lezioni non selezionate) — Modulo 5
- Validazione output AiGateway (punteggio ≤ `maxScore` dell'item) — Modulo 5
- Funzioni di utilità (sanitizzazione Markdown, normalizzazione testo per ricerca)

**Coverage minima:** 90% linee per `lesson-contract`, `domain/`, `services/`; 80% per `api/`, `repositories/`.

**Convenzione file:** `*.test.ts` nella stessa cartella del file testato.

---

### 3.2 Contract test

**Scopo:** Verificare il contratto Lesson Markdown v1 con un set esaustivo di fixture. Nella v2 i file lezione e pool sono **separati**: `lezione-XXX.md` e `lezione-XXX.pool.md`.

**Fixture da includere:**

```
packages/lesson-contract/src/__fixtures__/
  uda/
    valid/
      minimal-uda.md              # campi obbligatori
      full-uda.md                 # competenze, obiettivi, periodo, ore
    invalid/
      missing-kind.md
      empty-competencies.md
      unknown-program-id.md
  lesson/
    valid/
      minimal-lesson.md           # solo Contenuto
      lesson-with-selfcheck.md    # ## Autoverifica con kind: self_check
      lesson-with-images.md       # immagini relative e HTTPS
      lesson-with-tables-code.md  # tabelle, blocchi codice, liste
    invalid/
      missing-schoolforge-field.md
      missing-id.md
      missing-uda-id.md
      objectives-not-a-list.md
      content-section-missing.md
      sections-wrong-order.md
  pool/
    valid/
      pool-open.md                # domanda open con soluzione
      pool-closed-single.md       # closed_single con options e correct_option_ids
      pool-closed-multiple.md     # closed_multiple
      pool-mixed.md               # più domande di tipi diversi
    invalid/
      duplicate-question-id.md
      unknown-type.md
      unknown-difficulty.md
      unknown-weight.md
      closed-without-options.md
      closed-without-correct.md
      correct-option-not-in-options.md
      missing-solution.md
      malformed-yaml-block.md
```

Ogni fixture valida ha uno snapshot dell'output atteso del parser. Ogni fixture invalida ha la lista degli errori attesi con file, riga (quando applicabile) e messaggio.

**Test parametrici:**

```typescript
describe('lesson-contract parser', () => {
  describe('valid pool fixtures', () => {
    const fixtures = glob.sync('__fixtures__/pool/valid/*.md');
    it.each(fixtures)('parses %s without errors', (fixturePath) => {
      const result = parsePoolMarkdown(readFileSync(fixturePath, 'utf8'));
      expect(result.errors).toHaveLength(0);
      expect(result.questions).toMatchSnapshot();
    });
  });

  describe('invalid pool fixtures', () => {
    const fixtures = glob.sync('__fixtures__/pool/invalid/*.md');
    it.each(fixtures)('rejects %s with explicit errors', (fixturePath) => {
      const result = parsePoolMarkdown(readFileSync(fixturePath, 'utf8'));
      expect(result.errors.length).toBeGreaterThan(0);
      result.errors.forEach(err => {
        expect(err).toMatchObject({ message: expect.any(String) });
      });
    });
  });
});
```

---

### 3.3 Integration test

**Scopo:** Verificare l'interazione tra backend, Firestore e Storage usando Firebase Emulator Suite.

**Setup:**

```bash
firebase emulators:exec --only firestore,storage,auth,functions \
  --project schoolforge-test-ci "pnpm run test:integration"
```

**Cosa testare:**

**Sicurezza (Firestore e Storage Rules):**
```typescript
describe('Firestore Security Rules', () => {
  it('denies unauthenticated reads on /lessons', async () => { ... });
  it('denies reads from a non-owner authenticated user', async () => { ... });
  it('allows reads from the owner', async () => { ... });
  it('denies direct writes from the owner (all domain collections)', async () => { ... });
  it('denies any client read/write on /burned', async () => { ... });
  it('denies a student token from reading submissions', async () => { ... });
});
```

**Import atomico:**
```typescript
describe('commitImport atomicity', () => {
  it('makes NO lesson visible if commit fails halfway', async () => { ... });
  it('makes ALL selected lessons visible after successful commit', async () => { ... });
  it('does not leave orphaned staging files after commit', async () => { ... });
  it('does not add pool questions of invalid lessons to questionIndex', async () => { ... });
});
```

**Attivazione Verifica:**
```typescript
describe('activateExam', () => {
  it('freezes exam items into exams/{id}/items and sets status attiva', async () => { ... });
  it('rejects activation if any item is missing solution or maxScore', async () => { ... });
  it('rejects modification of an active exam', async () => { ... });
  it('does NOT update exam items when source lesson is replaced', async () => { ... });
  it('does NOT update exam items when source lesson is deleted', async () => { ... });
  it('fixes a single seed for variant tutte_uguali', async () => { ... });
});
```

**Email bruciata (cuore della v2):**
```typescript
describe('email bruciata transaction', () => {
  it('serves the PDF and creates a burned record on first request', async () => { ... });
  it('rejects a second request with the same email (409)', async () => { ... });
  it('normalizes email (case/trim) before checking burned', async () => { ... });
  it('does NOT create a burned record for the teacher PDF', async () => { ... });
  it('allows only ONE of two concurrent requests with the same email', async () => {
    // due transazioni simultanee → esattamente un successo, un 409
  });
  it('burns email identically for the digital channel (startDigitalAttempt)', async () => { ... });
});
```

**Portale — svolgimento digitale:**
```typescript
describe('portale digital attempt', () => {
  it('returns questions WITHOUT solutions or correct_option_ids', async () => { ... });
  it('rejects access for an email outside the Education domain', async () => { ... });
  it('saves a structured submission on submitAnswers', async () => { ... });
  it('rejects a second submitAnswers for the same attempt', async () => { ... });
  it('creates the student lazily on first portal access', async () => { ... });
});
```

**Calcolo percentuale:**
```typescript
describe('correction percentage calculation', () => {
  it('calculates correct percentage for complete correction', async () => { ... });
  it('marks percentage as non_definitiva when items are missing', async () => { ... });
  it('recalculates percentage on score update', async () => { ... });
  it('preserves previous score, author, date and reason on rettifica', async () => { ... });
});
```

**Audit:**
```typescript
describe('audit log', () => {
  it('writes audit event on lesson import', async () => { ... });
  it('writes audit event on exam activation', async () => { ... });
  it('writes audit event on correction update with previous value', async () => { ... });
  it('does NOT include student response text or personal data in audit event', async () => { ... });
});
```

---

### 3.4 End-to-end test (Playwright)

**Scopo:** Verificare i flussi completi del Docente (web app) e dello Studente (Portale) su ambiente `test`.

**Configurazione:**

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  projects: [
    { name: 'web-docente', use: { ...devices['Desktop Chrome'], baseURL: process.env.TEST_APP_URL } },
    { name: 'portale-studente', use: { ...devices['Pixel 7'], baseURL: process.env.TEST_PORTALE_URL } },
  ],
});
```

**Suite E2E obbligatorie per gate:**

**G2 — Repository:**
```typescript
test('teacher imports a lesson folder (lesson + pool) and views it rendered', async ({ page }) => {
  // 1. Login docente
  // 2. Repository > Importa: cartella con 3 lezioni valide (con .pool.md) e 1 invalida
  // 3. Verifica piano: 3 valide, 1 invalida con errori riga/file
  // 4. Conferma le 3 valide
  // 5. Apri una lezione in fruizione
  // 6. Verifica rendering Markdown e immagini
  // 7. Verifica che le domande del pool e le soluzioni NON siano nel DOM
  // 8. Scarica export ZIP e verifica struttura apribile fuori SchoolForge
});

test('pool questions and solutions are NOT shown in lesson view', async ({ page }) => {
  const poolElements = page.locator('[data-source="pool"]');
  await expect(poolElements).toHaveCount(0);
});
```

**G3 — Verifiche e Portale:**
```typescript
test('teacher creates, activates exam and downloads docente PDF', async ({ page }) => {
  // 1. Crea verifica da 2 lezioni, configura totale/aperte/chiuse/minimi difficoltà
  // 2. Attiva con conferma → stato "attiva"
  // 3. Scarica PDF docente: campi intestazione vuoti, nessuna data, niente soluzioni
  // 4. Sostituisce una lezione sorgente
  // 5. Verifica che lo snapshot della verifica sia invariato
});

test('student downloads exam PDF only once (email bruciata)', async ({ page }) => {
  // Portale: apri link verifica attiva
  // Autentica con email Google scolastica (account test)
  // Canale cartaceo: scarica PDF (filename con nome+cognome)
  // Secondo tentativo con la stessa email → bloccato con messaggio esplicito (409)
});

test('student completes the digital channel and submits', async ({ page }) => {
  // Portale fullscreen: tutte le domande in sequenza
  // Nessuna soluzione visibile; header sticky con bottone Consegna
  // Consegna → risposte salvate; il docente le vede in "da_correggere"
});

test('teacher exports programma svolto as .txt', async ({ page }) => {
  // Flagga UDA/lezioni come svolte; scarica .txt strutturato
});
```

**G4 — Correzione:**
```typescript
test('teacher corrects a digital submission and sees percentage', async ({ page }) => {
  // 1. Apri consegna da correggere
  // 2. Assegna punteggio (0..maxScore) a ogni item
  // 3. Verifica percentuale definitiva
  // 4. Rettifica un punteggio con motivazione
  // 5. Verifica valore precedente, nuovo valore e motivazione nell'audit trail
});
```

**G5 — Storico:**
```typescript
test('teacher consults student history and filters by exam', async ({ page }) => {
  // Studente creato lazy compare con la sola email
  // Storico filtrabile per verifica; percentuali definitive e non_definitiva
});
```

**Accessibilità (smoke test per milestone):**
```typescript
test('main views are keyboard-navigable', async ({ page }) => {
  // Navigazione da tastiera nelle viste principali; focus visibile e skip links
});
```

---

### 3.5 Test manuali (checklist)

Richiedono account reali Google Workspace for Education e non sono automatizzabili in CI. Eseguiti prima dei gate che coinvolgono l'autenticazione Google reale o l'AI.

**Checklist pre-G3 (autenticazione reale Portale):**
- [ ] Studente con email del dominio Education configurato accede al Portale
- [ ] Studente con email Google NON Education viene rifiutato
- [ ] Download PDF studente con dati precompilati corretti
- [ ] Secondo download con la stessa email rifiutato
- [ ] Docente scarica il PDF senza limiti e senza bruciare email

**Checklist pre-G5-AI (Provider AI — Modulo 5):**
- [ ] Configurare il provider AI con account sandbox (decisione C-02)
- [ ] Generare domande da 1 lezione e verificare che non includano contenuti di altre lezioni
- [ ] Verificare che l'audit contenga hash del contesto e modello
- [ ] Inviare una risposta studente per la correzione assistita previo consenso esplicito
- [ ] Verificare che il punteggio proposto non superi il `maxScore` dell'item
- [ ] Rifiutare una proposta AI e verificare che resti esclusa dall'approvazione massiva
- [ ] Verificare che la correzione AI sia distinguibile da quella manuale nello storico

---

## 4. Testing del parser Markdown (`lesson-contract`)

Il parser è il componente più critico: un bug qui compromette importazione, `questionIndex`, composizione delle verifiche e rendering. Copertura al 100% dei branch.

### 4.1 Casi limite obbligatori

**Front matter (UDA e lezione):**
- `schoolforge: 2` (versione non supportata) → errore esplicito con istruzione di migrazione
- `id` con caratteri non ammessi o spazi → errore
- `id` uguale a una lezione esistente → conflitto (non errore parser)
- `objectives`/`competencies` come stringa invece di lista → errore
- lezione con `program_id` presente ma `uda_id` assente → errore
- `uda_id` che non appartiene al `program_id` → errore (rilevato in fase di import)

**Corpo lezione:**
- Sezioni in ordine sbagliato (`## Autoverifica` prima di `## Contenuto`) → errore
- Sezione `## Contenuto` mancante o duplicata → errore
- `## Autoverifica` assente → valido (opzionale)
- Immagine con URL `file://` o `javascript:` → errore di sicurezza
- HTML inline (`<script>`) → parsing senza esecuzione; segnalato come warning (il renderer sanifica)

**Blocchi `schoolforge-question` nel file `.pool.md`:**
- YAML malformato (indentazione) → errore con riga
- `id` duplicato nello stesso pool → errore
- `type` non in `['open','closed_single','closed_multiple']` → errore
- `difficulty` non in `['bassa','media','alta']` → errore
- `weight` non in `['basso','medio','alto']` → errore
- `closed_single`/`closed_multiple` senza `options` → errore
- `correct_option_ids` che riferisce un id non in `options` → errore
- `solution` mancante → errore
- Campi extra non dichiarati → warning (permissivo per estensibilità, BR-MD-VER-03)

> Nota v2: non esistono blocchi `assessment` dentro la lezione né rubriche. Le domande di verifica vivono solo nel file `.pool.md`; nella lezione sono ammesse solo domande `kind: self_check`.

### 4.2 Golden file test

```typescript
it('parses pool-closed-single.md to expected structure', () => {
  const input = readFileSync('__fixtures__/pool/valid/pool-closed-single.md', 'utf8');
  expect(parsePoolMarkdown(input)).toMatchSnapshot();
});
```

Gli snapshot sono committati; le modifiche richiedono review esplicita.

---

## 5. Testing delle Firebase Security Rules

Testate con `@firebase/rules-unit-testing` contro gli emulatori Firestore e Storage.

### 5.1 Pattern di test

```typescript
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

describe('Firestore rules', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'schoolforge-test',
      firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
  });

  const owner = () => testEnv.authenticatedContext('owner-uid', { schoolforge_owner: true }).firestore();
  const student = () => testEnv.authenticatedContext('stud-uid', {}).firestore();

  it('owner can read a lesson', async () => {
    await assertSucceeds(owner().collection('lessons').doc('lesson-1').get());
  });
  it('student cannot read submissions', async () => {
    await assertFails(student().collection('submissions').doc('s1').get());
  });
  it('nobody can read burned directly', async () => {
    await assertFails(owner().collection('burned').doc('e1').get());
    await assertFails(student().collection('burned').doc('e1').get());
  });
  it('owner cannot write directly to lessons', async () => {
    await assertFails(owner().collection('lessons').doc('new').set({ title: 'x' }));
  });
  it('unauthenticated user cannot read anything', async () => {
    await assertFails(testEnv.unauthenticatedContext().firestore().collection('lessons').doc('l1').get());
  });
});
```

### 5.2 Copertura minima delle rules

Per ogni collezione di dominio: "owner legge", "non autenticato non legge", "autenticato non-owner non legge", "owner non scrive direttamente", "unauthenticated non scrive". Per `burned`: nessun client legge o scrive.

---

## 6. Gestione dei dati di test

### 6.1 Fixture statiche

File committati sotto `__fixtures__/` o `test/fixtures/`. Nessun dato personale reale. Email nelle fixture nel formato `studente-N@test.schoolforge.example`.

### 6.2 Factory functions

```typescript
// test/factories/lesson.ts
export function createLessonFixture(overrides?: Partial<Lesson>): Lesson {
  return {
    id: `lesson-test-${crypto.randomUUID()}`,
    title: 'Lezione di test',
    programId: 'program-test',
    udaId: 'uda-test',
    status: 'valid',
    objectives: ['Obiettivo 1'],
    storagePath: 'repository/current/program-test/uda-test/lezione-001.md',
    poolPath: 'repository/current/program-test/uda-test/lezione-001.pool.md',
    ...overrides,
  };
}
```

### 6.3 Seed e cleanup

I test di integrazione su emulatore devono: usare progetti distinti per suite parallele; ripulire i dati dopo ogni test (`clearFirestore()` in `afterEach`); non assumere stato pre-esistente.

---

## 7. CI pipeline e test

Coerente con il piano di implementazione §7.6.

```yaml
on: [push, pull_request]

jobs:
  unit-and-contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck
      - run: pnpm run lint
      - run: pnpm run test:unit
      - run: pnpm run test:coverage
      - run: pnpm audit --audit-level=moderate

  integration:
    runs-on: ubuntu-latest
    needs: unit-and-contract
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: npm install -g firebase-tools
      - run: firebase emulators:exec --only firestore,storage,auth,functions "pnpm run test:integration"

  e2e:
    runs-on: ubuntu-latest
    needs: integration
    if: github.base_ref == 'main'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm run test:e2e
        env:
          TEST_APP_URL: ${{ secrets.TEST_APP_URL }}
          TEST_PORTALE_URL: ${{ secrets.TEST_PORTALE_URL }}
```

**Regole di merge:**
- PR bloccata se `unit-and-contract` non è verde
- PR bloccata se `integration` non è verde
- `e2e` richiesto prima dei gate di fase (G2, G3, G4, G5)
- Un test che fallisce non può essere skippato senza issue tracciata

---

## 8. Coverage minima per gate

| Gate | Package | Coverage minima |
|---|---|---|
| G2 | `lesson-contract` | 100% branch |
| G2 | `domain/repository` | 90% |
| G2 | `firestore.rules`, `storage.rules` | 100% casi elencati in §5.2 |
| G3 | `domain/exams` | 90% |
| G3 | `services/pdf`, `services/email-bruciata` | 90% |
| G3 | `domain/portale` | 90% |
| G4 | `domain/corrections` | 95% |
| G5 | `domain/storico` | 85% |
| G5-AI | `integrations/ai-gateway` | 90% |

---

## 9. Test dei casi negativi obbligatori

Devono essere presenti come test espliciti prima del gate corrispondente. Non sostituibili da "funziona nel percorso felice".

| Caso negativo | Gate | Tipo di test |
|---|---|---|
| Account non autorizzato riceve 403 su ogni endpoint | G2 | Integration |
| Markdown invalido non entra nel repository | G2 | Integration |
| Asset mancante non blocca l'import delle lezioni valide | G2 | Integration |
| Domande del pool/soluzioni assenti nel modello di fruizione | G2 | Unit + E2E |
| Somma minimi difficoltà > totale → attivazione rifiutata | G3 | Unit |
| Tentativo di modificare verifica attiva → rifiuto | G3 | Integration |
| Lezione modificata/eliminata dopo attivazione → snapshot invariato | G3 | Integration |
| Secondo download con stessa email → 409 (email bruciata) | G3 | Integration |
| Due richieste concorrenti con stessa email → un solo successo | G3 | Integration |
| Download docente non crea record `burned` | G3 | Integration |
| Email fuori dominio Education → accesso Portale rifiutato | G3 | Integration |
| Payload Portale privo di soluzioni/opzioni corrette | G3 | Integration |
| Secondo `submitAnswers` per stesso attempt → rifiuto | G3 | Integration |
| Percentuale con item senza punteggio → `non_definitiva` | G4 | Unit |
| Rettifica punteggio → valore precedente conservato in audit | G4 | Integration |
| Verifica `annullata`/`chiusa` non accetta nuovi accessi dal Portale | G3 | Unit |
| Studente senza nome/cognome compare comunque con la sua email | G5 | Integration |
| Proposta AI incompleta esclusa dall'approvazione massiva | G5-AI | Integration |
| Punteggio AI > `maxScore` item → rifiuto dal gateway | G5-AI | Unit |
| Chiamata AI senza consenso esplicito → rifiuto | G5-AI | Integration |
