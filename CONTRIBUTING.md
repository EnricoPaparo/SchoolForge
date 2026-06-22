# Guida allo sviluppo — SchoolForge

Questo documento descrive come configurare l'ambiente di sviluppo, eseguire i test e contribuire al progetto rispettando le convenzioni stabilite.

---

## Prerequisiti

| Strumento | Versione minima | Note |
|---|---|---|
| Node.js | 20.x LTS | Versione attiva LTS raccomandata |
| pnpm | 9.x | Gestore dei package del monorepo |
| Firebase CLI | 13.x | Per emulatori e deploy |
| Java JDK | 11+ | Richiesto da Firebase Emulator Suite |
| Git | 2.40+ | |

Verifica le versioni:
```bash
node --version   # deve essere >= 20.0.0
pnpm --version   # deve essere >= 9.0.0
firebase --version
java --version
```

Per installare pnpm se non presente:
```bash
corepack enable
corepack prepare pnpm@latest --activate
```

---

## Struttura del monorepo

```
SchoolForge/
├─ apps/
│  └─ web/                        # SPA React + TypeScript (Vite)
├─ functions/
│  └─ src/
│     ├─ api/                     # Handler Cloud Functions (sottili)
│     ├─ domain/                  # Logica di business per modulo
│     │  ├─ repository/
│     │  ├─ exams/
│     │  ├─ archive/
│     │  └─ corrections/
│     ├─ integrations/            # Google Forms, roster, Drive, AiGateway
│     ├─ services/                # PDF, audit, autorizzazione, import/export
│     └─ repositories/            # Accesso Firestore e Storage
├─ packages/
│  └─ lesson-contract/            # Parser, validatore e tipi Markdown condivisi
├─ documentazione/                # Documentazione di progetto
├─ firestore.rules
├─ storage.rules
├─ firestore.indexes.json
├─ firebase.json
├─ pnpm-workspace.yaml
└─ package.json                   # Root workspace
```

### Toolchain

| Strumento | Scopo |
|---|---|
| **pnpm workspaces** | Gestione monorepo e dipendenze condivise |
| **TypeScript 5.x** | Linguaggio end-to-end (web, functions, packages) |
| **Vite 5.x** | Build e dev server della web app |
| **ESLint + eslint-plugin-security** | Linting e controlli di sicurezza |
| **Vitest 2.x** | Test unitari e di integrazione |
| **Playwright 1.45.x** | Test end-to-end |
| **Firebase Emulator Suite** | Sviluppo locale senza cloud reale |

---

## Setup iniziale

### 1. Clona il repository

```bash
git clone <repository-url>
cd SchoolForge
```

### 2. Installa le dipendenze

```bash
pnpm install
```

### 3. Configura le variabili d'ambiente

Copia il file di esempio e completa le variabili:

```bash
cp .env.example .env.local
```

Il file `.env.local` NON viene committato (è in `.gitignore`).

**Variabili richieste per lo sviluppo locale:**

```bash
# Progetto Firebase dev (NON usare il progetto prod)
VITE_FIREBASE_PROJECT_ID=schoolforge-dev
VITE_FIREBASE_API_KEY=...           # dalla console Firebase progetto dev
VITE_FIREBASE_AUTH_DOMAIN=schoolforge-dev.firebaseapp.com
VITE_FIREBASE_STORAGE_BUCKET=schoolforge-dev.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

# Indica alla web app di usare gli emulatori locali
VITE_USE_FIREBASE_EMULATOR=true

# URL della web app in ambiente di test (per Playwright)
TEST_APP_URL=http://localhost:5173
```

**Variabili per Cloud Functions (in `functions/.env.local`):**

```bash
FIREBASE_PROJECT_ID=schoolforge-dev
NODE_ENV=development
# Tutte le altre configurazioni vengono lette da Firebase Remote Config o Secret Manager emulato
```

### 4. Configura Firebase CLI

```bash
firebase login
firebase use schoolforge-dev   # imposta il progetto di default
```

---

## Avviare l'ambiente di sviluppo

### Avvia gli emulatori Firebase

Gli emulatori sostituiscono completamente i servizi cloud durante lo sviluppo. **Non usare il progetto prod in sviluppo.**

```bash
pnpm run emulators
```

Questo comando avvia:
- Firestore Emulator (porta 8080)
- Cloud Storage Emulator (porta 9199)
- Firebase Auth Emulator (porta 9099)
- Cloud Functions Emulator (porta 5001)
- Emulator UI (porta 4000) → apri http://localhost:4000 per ispezionare i dati

### Avvia la web app

In un secondo terminale:

```bash
pnpm run dev --filter web
```

La web app è disponibile su http://localhost:5173 e si connette automaticamente agli emulatori.

### Seed dei dati di sviluppo

Per popolare l'emulatore con dati sintetici di test:

```bash
pnpm run seed:dev
```

Questo script crea: programmi, UDA, lezioni di esempio e un Docente proprietario configurato.

---

## Eseguire i test

### Test unitari e contract

```bash
pnpm run test:unit
```

Esegue Vitest in modalità run-once. Per modalità watch durante lo sviluppo:

```bash
pnpm run test:unit --watch
```

### Test di integrazione (richiede emulatori attivi)

```bash
# In un terminale, avvia gli emulatori in modalità exec
pnpm run emulators

# In un secondo terminale
pnpm run test:integration
```

Oppure in un comando unico:

```bash
pnpm run test:integration:ci
# Equivale a: firebase emulators:exec "vitest run --config vitest.integration.config.ts"
```

### Test end-to-end (Playwright)

```bash
# Richiede la web app in esecuzione su TEST_APP_URL
pnpm run test:e2e
```

Per eseguire un singolo test E2E:

```bash
pnpm run test:e2e --grep "teacher imports a lesson"
```

Per eseguire in modalità UI (debug visivo):

```bash
pnpm run test:e2e --ui
```

### Tutti i test (come in CI)

```bash
pnpm run test:all
```

### Coverage

```bash
pnpm run test:coverage
```

Il report HTML viene generato in `coverage/index.html`. Le soglie di coverage sono configurate in `vitest.config.ts` e bloccano la pipeline CI se non rispettate.

---

## Typecheck e lint

```bash
pnpm run typecheck   # tsc --noEmit su tutti i package
pnpm run lint        # ESLint su tutto il codice TypeScript
pnpm run lint:fix    # Applica fix automatici dove possibile
```

---

## Workflow di sviluppo

### Branch

```
main                    → solo codice integrato e verificato; merge tramite PR
feature/<modulo>-<descrizione>   → sviluppo funzionalità
fix/<descrizione>       → correzione bug
```

Esempi:
- `feature/repository-import-preflight`
- `feature/exams-publish-transaction`
- `fix/lesson-parser-rubric-score-validation`

Un branch deve coprire una sola unità verticale piccola. Non mescolare refactor, nuove funzionalità e correzioni bug nello stesso branch.

### Ciclo di sviluppo

1. Crea un branch da `main`
2. Scrivi i test prima o insieme all'implementazione (non dopo)
3. Assicurati che `pnpm run typecheck && pnpm run lint && pnpm run test:unit` siano verdi prima di aprire la PR
4. Apri la PR descrivendo: requisito coperto, test eseguiti, rischi e modifiche ai dati
5. Aspetta CI verde e review prima del merge

### Commit

I commit devono essere piccoli e intenzionali. Usa il formato:

```
<tipo>(<scope>): <descrizione breve>

[corpo opzionale con perché, non cosa]
```

Tipi: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

Esempi:
- `feat(lesson-contract): add validation for rubric.max_score mismatch`
- `fix(exams): reject publish when solution is missing for open question`
- `test(security-rules): add negative test for non-owner lesson write`

---

## Deploy

Il deploy avviene tramite CI dopo il merge su `main`. Non eseguire deploy manuali in produzione senza autorizzazione e gate superato.

```bash
# Deploy solo in ambiente dev (non prod)
pnpm run deploy:dev
```

Per il deploy in produzione, la CI usa le variabili protette configurate nel sistema CI. Non sono disponibili localmente.

---

## Aggiornare la documentazione

Le modifiche ai requisiti aggiornano i documenti in questo ordine:

1. `documentazione/analisi-requisiti.md`
2. `documentazione/architettura.md`
3. `documentazione/piano-implementazione.md`
4. `documentazione/api-contract.md` (se l'API cambia)

Le modifiche al formato Markdown aggiornano:

1. `documentazione/analisi-requisiti.md` sezione 8 (contratto)
2. Fixture in `packages/lesson-contract/src/__fixtures__/`
3. `documentazione/glossario.md` se viene introdotto un nuovo termine

Non si aggiorna solo il codice lasciando i documenti obsoleti.

---

## Problemi comuni

### "Firebase emulator non si avvia"

Verifica che Java sia installato e che la porta 8080 non sia occupata:
```bash
java --version
lsof -i :8080
```

### "Errore CORS durante lo sviluppo"

Assicurati che `VITE_USE_FIREBASE_EMULATOR=true` sia in `.env.local` e che la web app sia stata riavviata dopo la modifica.

### "Test di integrazione falliscono con 'permission denied'"

Gli emulatori devono essere avviati prima dei test di integrazione. Verifica che siano attivi su http://localhost:4000.

### "TypeScript non trova tipi di `lesson-contract`"

Esegui `pnpm install` dalla root del monorepo per ricostruire i link dei package. Se il problema persiste:
```bash
pnpm run build --filter lesson-contract
```

### "Seed fallisce su Firestore emulatore"

Pulisci i dati dell'emulatore e riprova:
```bash
firebase emulators:start --import=./emulator-data --export-on-exit
# oppure usa l'Emulator UI su http://localhost:4000 per cancellare i dati manualmente
```

---

## Sicurezza

- Non committare mai file `.env`, `.env.local`, chiavi API, token OAuth o credenziali
- Non usare il progetto Firebase di produzione in sviluppo locale
- Se sospetti di aver esposto un segreto, segnalalo immediatamente e ruota il segreto in Secret Manager

Il file `.gitignore` esclude già i file sensibili più comuni, ma la responsabilità finale è dello sviluppatore.
