# SchoolForge — Strategia di test

**Versione:** 1.0
**Data:** 22 giugno 2026
**Stato:** baseline
**Input vincolante:** [Architettura v1.0](architettura.md), sezione 14; [Piano di implementazione v1.0](piano-implementazione.md), sezione 9
**Destinatari:** team di implementazione, QA, responsabile tecnico

---

## 1. Filosofia

SchoolForge è un sistema che gestisce conoscenza didattica, dati personali di minori e documenti valutativi. La qualità del test non è opzionale: un bug nella pubblicazione di una Verifica, nel calcolo della percentuale o nella protezione dei dati di uno studente ha conseguenze reali.

I principi guida sono:

1. **Test come specifica eseguibile.** Ogni requisito funzionale e ogni regola di business ha almeno un test che ne verifica il rispetto e un test che ne verifica la violazione.
2. **Nessuna fiducia implicita nel percorso felice.** I casi negativi, i boundary e le precondizioni non rispettate sono test di prima classe.
3. **Isolamento reale.** I test non usano servizi cloud reali. L'unica eccezione documentata e intenzionale sono i test di integrazione manuali con Google Education (checklist, non automatici).
4. **Test che falliscono per le ragioni giuste.** Un test che fallisce per un'asserzione sbagliata è un test non valido; un test che passa pur senza testare il comportamento atteso è peggio di nessun test.
5. **Velocità come requisito.** La suite unit+contract deve completarsi in meno di 60 secondi su un laptop standard. I test E2E devono essere parallelizzabili.

---

## 2. Stack di test

| Strumento | Versione minima | Scopo |
|---|---|---|
| **Vitest** | 2.x | Test unitari e di integrazione TypeScript (backend e `lesson-contract`) |
| **Playwright** | 1.45.x | Test end-to-end della web app |
| **Firebase Emulator Suite** | ultima stabile | Emulazione locale di Firestore, Storage, Auth, Functions |
| **Zod** | 3.x | Validazione runtime degli schema (usata anche nei test come fixture validator) |
| **@testing-library/react** | 16.x | Test dei componenti React isolati |
| **MSW (Mock Service Worker)** | 2.x | Mock degli endpoint Firebase Callable Functions nei test React |
| **supertest** | 6.x | Test HTTP degli endpoint Cloud Functions fuori dall'emulatore |

---

## 3. Livelli di test

### 3.1 Unit test

**Scopo:** Verificare la logica di ogni modulo in isolamento, senza I/O esterno.

**Cosa testare:**
- Parser e validatore `lesson-contract` (tutti i casi validi e invalidi del contratto Markdown v1)
- Calcolo percentuale (`(score / maxScore) * 100`, arrotondamento, stato `non_definitiva`)
- Macchina a stati delle Verifiche (transizioni consentite e negate)
- Macchina a stati delle Consegne
- Macchina a stati delle Assegnazioni
- Logica di deduplicazione del corpus (UDA + Lezioni selezionate)
- Validazione dei payload delle Cloud Functions (schema Zod)
- Logica di matching email studenti (Import Forms)
- Costruzione del contesto AI (verifica che non includa lezioni non selezionate)
- Validazione output AiGateway (punteggio ≤ massimo, criteri rubrica presenti)
- Funzioni di utilità (sanitizzazione Markdown, normalizzazione testo per ricerca)

**Coverage minima:** 90% linee per `lesson-contract`, `domain/`, `services/`; 80% per `api/`, `repositories/`.

**Convenzione file:** `*.test.ts` nella stessa cartella del file testato.

---

### 3.2 Contract test

**Scopo:** Verificare il contratto Lesson Markdown v1 con un set esaustivo di fixture.

**Fixture da includere:**

```
packages/lesson-contract/src/__fixtures__/
  valid/
    minimal.md                  # solo campi obbligatori
    full-self-check.md          # self_check con tutti i campi
    full-assessment-open.md     # assessment aperto con rubrica
    full-assessment-closed.md   # assessment chiuso con opzioni e chiave
    multiple-questions.md       # più domande di entrambi i tipi
    with-images.md              # immagini relative e HTTPS
    with-tables-code.md         # tabelle, blocchi codice, liste
  invalid/
    missing-schoolforge-field.md
    missing-id.md
    duplicate-question-id.md
    invalid-question-kind.md
    unknown-difficulty.md
    closed-without-options.md
    closed-without-correct.md
    correct-option-not-in-options.md
    rubric-score-mismatch.md    # sum(criteria.maxScore) ≠ rubric.maxScore
    self-check-in-wrong-section.md
    assessment-in-autoverifica.md
    missing-content-section.md
    sections-wrong-order.md
    program-id-empty.md
    objectives-empty-list.md
```

Ogni fixture valida ha uno snapshot dell'output atteso del parser. Ogni fixture invalida ha la lista degli errori attesi con file, riga e messaggio.

**Test parametrici:**

```typescript
describe('lesson-contract parser', () => {
  describe('valid fixtures', () => {
    const fixtures = glob.sync('__fixtures__/valid/*.md');
    it.each(fixtures)('parses %s without errors', async (fixturePath) => {
      const result = await parseLessonMarkdown(readFileSync(fixturePath, 'utf8'));
      expect(result.errors).toHaveLength(0);
      expect(result.lesson).toMatchSnapshot();
    });
  });

  describe('invalid fixtures', () => {
    const fixtures = glob.sync('__fixtures__/invalid/*.md');
    it.each(fixtures)('rejects %s with expected errors', async (fixturePath) => {
      const result = await parseLessonMarkdown(readFileSync(fixturePath, 'utf8'));
      expect(result.errors.length).toBeGreaterThan(0);
      // ogni errore ha file, line, message
      result.errors.forEach(err => {
        expect(err).toMatchObject({ line: expect.any(Number), message: expect.any(String) });
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
# prima di eseguire i test di integrazione
firebase emulators:start --only firestore,storage,auth,functions --project schoolforge-dev
```

**Cosa testare:**

**Sicurezza (Firestore e Storage Rules):**
```typescript
describe('Firestore Security Rules', () => {
  it('denies unauthenticated reads on /lessons', async () => { ... });
  it('denies reads from a non-owner authenticated user', async () => { ... });
  it('allows reads from the owner', async () => { ... });
  it('denies direct writes from the owner (all collections)', async () => { ... });
  it('allows backend (service account) to write lessons', async () => { ... });
});
```

**Import atomico:**
```typescript
describe('commitImport atomicity', () => {
  it('makes NO lesson visible if commit fails halfway', async () => { ... });
  it('makes ALL selected lessons visible after successful commit', async () => { ... });
  it('does not leave orphaned staging files after commit', async () => { ... });
  it('does not modify questionIndex for invalid lessons', async () => { ... });
});
```

**Pubblicazione Verifica:**
```typescript
describe('publishExam', () => {
  it('freezes exam items and sets status to published', async () => { ... });
  it('rejects publish if any item is missing solution', async () => { ... });
  it('rejects modification of a published exam', async () => { ... });
  it('does NOT update exam items when lesson is replaced', async () => { ... });
  it('does NOT update exam items when lesson is deleted', async () => { ... });
});
```

**Idempotenza import Forms:**
```typescript
describe('importFormResponses idempotency', () => {
  it('creates one submission for one response, even if imported twice', async () => { ... });
  it('quarantines responses without student email match', async () => { ... });
  it('quarantines responses with ambiguous email match', async () => { ... });
});
```

**Calcolo percentuale:**
```typescript
describe('correction percentage calculation', () => {
  it('calculates correct percentage for complete correction', async () => { ... });
  it('marks percentage as non_definitiva when items are missing', async () => { ... });
  it('recalculates percentage on score update', async () => { ... });
  it('preserves previous score in audit on update', async () => { ... });
});
```

**Audit:**
```typescript
describe('audit log', () => {
  it('writes audit event on lesson import', async () => { ... });
  it('writes audit event on exam publication', async () => { ... });
  it('writes audit event on correction update with previous value', async () => { ... });
  it('does NOT include student response text in audit event', async () => { ... });
});
```

---

### 3.4 End-to-end test (Playwright)

**Scopo:** Verificare i flussi completi del Docente nella web app su ambiente `test`.

**Configurazione:**

```typescript
// playwright.config.ts
export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: process.env.TEST_APP_URL,
    storageState: 'e2e/.auth/teacher.json',  // sessione pre-autenticata
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
```

**Suite E2E obbligatorie per gate:**

**G2 — Repository:**
```typescript
test('teacher imports a lesson folder and views it rendered', async ({ page }) => {
  // 1. Login
  // 2. Naviga a Repository > Importa
  // 3. Carica cartella di test con 3 lezioni valide e 1 invalida
  // 4. Verifica piano di import: 3 valide, 1 invalida con errori
  // 5. Conferma le 3 valide
  // 6. Naviga a Lezione
  // 7. Verifica rendering Markdown e immagini
  // 8. Verifica assenza blocchi assessment nel DOM
  // 9. Scarica export ZIP e verifica struttura
});

test('lesson with assessment questions does NOT show them in view mode', async ({ page }) => {
  // Verifica che l'elemento DOM contenente assessment non esista
  const assessmentElements = page.locator('[data-question-kind="assessment"]');
  await expect(assessmentElements).toHaveCount(0);
});
```

**G3 — Verifiche:**
```typescript
test('teacher creates, publishes exam and PDF is correct', async ({ page }) => {
  // 1. Crea verifica da 2 lezioni
  // 2. Seleziona domande, aggiunge soluzioni e rubriche mancanti
  // 3. Pubblica con conferma
  // 4. Verifica stato "pubblicata"
  // 5. Genera PDF prova e verifica contenuto (titolo, domande)
  // 6. Verifica che il PDF non contenga le soluzioni
  // 7. Sostituisce la lezione sorgente
  // 8. Verifica che la verifica pubblicata abbia ancora le domande originali
});
```

**G4 — Archivio:**
```typescript
test('teacher archives a submission with Drive link', async ({ page }) => {
  // 1. Assegna verifica a classe
  // 2. Inserisce manualmente una consegna per uno studente
  // 3. Registra un link Drive fittizio
  // 4. Verifica che lo storico mostri la consegna in stato "da_correggere"
  // 5. Verifica che lo studente non sia accessibile dalla web app senza login docente
});
```

**G5 — Correzione:**
```typescript
test('teacher corrects a submission and sees percentage', async ({ page }) => {
  // 1. Naviga alla consegna da correggere
  // 2. Assegna punteggio a ogni item
  // 3. Verifica percentuale calcolata
  // 4. Rettifica un punteggio
  // 5. Verifica che il valore precedente sia visibile nell'audit trail
});
```

**Accessibilità (smoke test per ogni milestone):**
```typescript
test('main views are keyboard-navigable', async ({ page }) => {
  // Naviga per tab nelle viste principali senza mouse
  // Verifica focus visible e skip links
});
```

---

### 3.5 Test manuali (checklist)

I seguenti test richiedono account reali Google Workspace for Education e non sono automatizzabili in CI. Vengono eseguiti prima di ogni gate che riguardi integrazioni Google.

**Checklist pre-G3 (Google Forms):**
- [ ] Creare un Form da una verifica pubblicata con account Education test
- [ ] Verificare che il Form abbia tutte le domande compatibili
- [ ] Verificare che incompatibilità di tipo vengano segnalate correttamente
- [ ] Verificare che il Form richieda autenticazione Google per la compilazione
- [ ] Compilare il Form con account studente test
- [ ] Importare le risposte e verificare che vengano attribuite correttamente
- [ ] Compilare il Form una seconda volta con lo stesso account e verificare idempotenza
- [ ] Revocare il token OAuth e verificare che il percorso PDF manuale rimanga funzionale

**Checklist pre-G4 (Roster Google Education):**
- [ ] Collegare l'API Google Education con account test
- [ ] Verificare che l'anteprima roster mostri correttamente classi e studenti
- [ ] Confermare l'importazione di un sottoinsieme e verificare che il resto non venga toccato
- [ ] Rimuovere uno studente dalla sorgente e verificare che l'import proponga archiviazione, non eliminazione
- [ ] Verificare che le consegne già archiviate di uno studente archiviato rimangano nello storico

**Checklist pre-G5-AI (Provider AI):**
- [ ] Configurare il provider AI con account sandbox
- [ ] Generare domande da 1 lezione e verificare che non includano contenuti da altre lezioni
- [ ] Verificare che il log di audit contenga hash del contesto e modello
- [ ] Inviare una risposta di studente per la correzione assistita
- [ ] Verificare che il punteggio proposto non superi il massimo della rubrica
- [ ] Rifiutare una proposta AI e verificare che resti in stato "rifiutata" dopo bulk approve
- [ ] Verificare che la correzione AI sia distinguibile da quella manuale nello storico

---

## 4. Testing del parser Markdown (`lesson-contract`)

Il parser è il componente più critico del sistema: un bug qui compromette importazione, indice delle domande, composizione delle verifiche e rendering. Deve avere copertura al 100% dei branch.

### 4.1 Casi limite da coprire obbligatoriamente

**Front matter:**
- `schoolforge: 2` (versione non supportata) → errore esplicito con istruzione di migrazione
- `id` con caratteri speciali o spazi → errore con riga
- `id` uguale a quello di una lezione già presente → segnalato come conflitto (non errore parser)
- `objectives` come stringa invece di lista → errore
- `program_id` presente ma `uda_id` assente → errore

**Corpo:**
- Sezioni nell'ordine sbagliato (`## Domande di verifica` prima di `## Contenuto`) → errore
- Sezione `## Contenuto` duplicata → errore
- Sezioni `## Autoverifica` e `## Domande di verifica` assenti → valido (opzionali)
- Immagine con URL `file://` → errore di sicurezza
- Immagine con URL `javascript:` → errore di sicurezza
- HTML inline (`<script>`) → parsing senza esecuzione (il renderer è responsabile della sanitizzazione; il parser lo segnala come warning)

**Blocchi `schoolforge-question`:**
- YAML malformato (indentazione errata) → errore con riga
- `id` duplicato nella stessa lezione → errore
- `kind` non in `['self_check', 'assessment']` → errore
- `type: closed_single` senza `options` → errore
- `correct_option_ids` che riferisce un id non in `options` → errore
- `rubric.max_score` diverso dalla somma di `criteria.max_score` → errore
- Domanda con campi extra non dichiarati → warning (permissivo per estensibilità futura)
- `difficulty` mancante su domanda `assessment` → errore

### 4.2 Strategia di golden file test

```typescript
// Per ogni fixture valida, lo snapshot viene creato al primo run e committato.
// Le modifiche allo snapshot richiedono review esplicita.
it('parses full-assessment-closed.md to expected AST', async () => {
  const input = readFileSync('__fixtures__/valid/full-assessment-closed.md', 'utf8');
  const result = parseLessonMarkdown(input);
  expect(result).toMatchSnapshot();
});
```

---

## 5. Testing delle Firebase Security Rules

Le Security Rules vengono testate con `@firebase/rules-unit-testing` contro l'emulatore Firestore e Storage.

### 5.1 Pattern di test

```typescript
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

describe('Firestore rules - lessons collection', () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'schoolforge-test',
      firestore: { rules: readFileSync('firestore.rules', 'utf8') },
    });
  });

  it('owner can read a lesson', async () => {
    const db = testEnv.authenticatedContext('owner-uid', {
      schoolforge_owner: true,
    }).firestore();
    await assertSucceeds(db.collection('lessons').doc('lesson-1').get());
  });

  it('non-owner cannot read a lesson', async () => {
    const db = testEnv.authenticatedContext('other-uid', {
      schoolforge_owner: false,
    }).firestore();
    await assertFails(db.collection('lessons').doc('lesson-1').get());
  });

  it('owner cannot write directly to lessons', async () => {
    const db = testEnv.authenticatedContext('owner-uid', {
      schoolforge_owner: true,
    }).firestore();
    await assertFails(db.collection('lessons').doc('new').set({ title: 'test' }));
  });

  it('unauthenticated user cannot read anything', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(db.collection('lessons').doc('lesson-1').get());
  });
});
```

### 5.2 Copertura minima delle rules

Per ogni collezione Firestore devono essere presenti almeno:
- test "owner può leggere"
- test "non autenticato non può leggere"
- test "autenticato non-owner non può leggere"
- test "owner non può scrivere direttamente"
- test "unauthenticated non può scrivere"

---

## 6. Gestione dei dati di test

### 6.1 Fixture statiche

Le fixture sono file commessi nel repository sotto `__fixtures__/` o `test/fixtures/`. Non contengono dati personali reali. Nomi di studenti e email nelle fixture usano il formato `studente-N@test.schoolforge.example`.

### 6.2 Factory functions

Per i test di integrazione che richiedono dati in Firestore, si usano factory functions tipizzate:

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
    storagePath: 'repository/current/lessons/lesson-test/source.md',
    ...overrides,
  };
}
```

### 6.3 Seed e cleanup

I test di integrazione che usano l'emulatore devono:
1. usare progetti Firestore distinti per suite parallele (`projectId: 'test-${uuid}'`);
2. ripulire i dati dopo ogni test (o usare `clearFirestore()` in `afterEach`);
3. non assumere uno stato pre-esistente dell'emulatore.

---

## 7. CI pipeline e test

```yaml
# Schema della pipeline CI (GitHub Actions / equivalente)

on: [push, pull_request]

jobs:
  unit-and-contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm run typecheck          # tsc --noEmit su tutti i package
      - run: pnpm run lint               # ESLint con plugin security
      - run: pnpm run test:unit          # Vitest unit + contract
      - run: pnpm run test:coverage      # verifica soglie di coverage
      - run: pnpm audit                  # vulnerabilità dipendenze

  integration:
    runs-on: ubuntu-latest
    needs: unit-and-contract
    services:
      # Firebase Emulator avviato come step, non come service Docker
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: npm install -g firebase-tools
      - run: firebase emulators:exec --only firestore,storage,auth,functions "pnpm run test:integration"
        env:
          FIREBASE_TOKEN: ${{ secrets.FIREBASE_TOKEN }}

  e2e:
    runs-on: ubuntu-latest
    needs: integration
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
      - run: pnpm run test:e2e
        env:
          TEST_APP_URL: ${{ secrets.TEST_APP_URL }}
          # usa ambiente 'test' con dati sintetici, non prod
```

**Regole di merge:**
- PR bloccata se `unit-and-contract` non è verde
- PR bloccata se `integration` non è verde
- `e2e` è richiesto prima dei gate di fase (G2, G3, G4, G5)
- Un test che fallisce non può essere skippato senza issue tracciata

---

## 8. Coverage minima per gate

| Gate | Package | Coverage minima linee |
|---|---|---|
| G2 | `lesson-contract` | 100% branch |
| G2 | `domain/repository` | 90% |
| G2 | `firestore.rules`, `storage.rules` | 100% casi elencati in §5.2 |
| G3 | `domain/exams` | 90% |
| G3 | `services/pdf` | 80% |
| G4 | `domain/archive` | 90% |
| G4 | `domain/students` | 85% |
| G5 | `domain/corrections` | 95% |
| G5-AI | `integrations/ai-gateway` | 90% |

---

## 9. Test dei casi negativi obbligatori

I seguenti casi negativi devono essere presenti come test espliciti prima del gate corrispondente. Non possono essere sostituiti da "funziona nel percorso felice".

| Caso negativo | Gate | Tipo di test |
|---|---|---|
| Account non autorizzato riceve 403 su ogni endpoint | G2 | Integration |
| Markdown invalido non entra nel repository | G2 | Integration |
| Asset mancante non blocca l'import delle lezioni valide | G2 | Integration |
| Blocchi `assessment` assenti nel modello di visualizzazione | G2 | Unit + E2E |
| Doppia importazione Forms non crea due consegne | G3 | Integration |
| Risposta non mappabile finisce in quarantena, non nello storico | G4 | Integration |
| Tentativo di modificare verifica pubblicata → rifiuto | G3 | Integration |
| Proposta AI incompleta esclusa dall'approvazione massiva | G5-AI | Integration |
| Token integrazione revocato → percorso manuale rimane funzionale | G4 | Integration |
| Punteggio AI > massimo → rifiuto dal gateway | G5-AI | Unit |
| Percentuale con item senza punteggio → `non_definitiva` | G5 | Unit |
| Rettifica punteggio → valore precedente conservato in audit | G5 | Integration |
| Verifica `annullata` non può ricevere nuove assegnazioni | G3 | Unit |
| Eliminazione studente → consegne storiche invariate | G4 | Integration |
