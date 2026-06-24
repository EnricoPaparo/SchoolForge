# SchoolForge — Toolchain e ambiente di sviluppo

**Versione:** 1.0
**Stato:** riferimento operativo per gli agenti di coding e il Docente
**Input vincolanti:** `architettura.md`, `piano-implementazione.md`

---

## 1. Scopo

Questo documento fissa le versioni degli strumenti, la struttura del monorepo, i comandi di bootstrap, le variabili d'ambiente e le porte degli emulatori. È il riferimento per chiunque debba avviare, costruire o testare SchoolForge. Le versioni qui dichiarate sono vincolanti per la V1; modifiche richiedono una decisione documentata.

---

## 2. Versioni degli strumenti

| Strumento | Versione | Note |
|---|---|---|
| Node.js | 20 LTS | Runtime di build, test e Cloud Functions. |
| pnpm | 9.x | Gestore pacchetti e workspace del monorepo. |
| Firebase CLI (`firebase-tools`) | latest | Deploy, emulatori, gestione progetti. |
| React | 18 | Libreria UI della SPA unica. |
| Vite | 5 | Bundler e dev server della SPA. |
| TypeScript | 5.x | Linguaggio per SPA, Functions e package condivisi. |
| Vitest | 1.x | Unit e contract test. |
| Playwright | 1.x | Test end-to-end nel browser. |
| `@react-pdf/renderer` | 3.x | Generazione PDF nel browser, nessun server. |
| Zod | 3.x | Schema e validazione di `lesson-contract`. |
| Firebase SDK | 10.x | Client Firestore, Storage, Auth e Functions. |

---

## 3. Struttura del monorepo

```text
SchoolForge/
├─ apps/
│  └─ web/                       # SPA unica (React + Vite) — /teacher/* e /exam/:token
├─ packages/
│  └─ lesson-contract/           # package interno (NON pubblicato su npm)
│     └─ src/index.ts            # schemi Zod e parser pool v1
├─ functions/                    # Cloud Functions v2 (TypeScript)
│  └─ src/
│     ├─ index.ts                # entry point
│     ├─ startDigitalAttempt.ts  # avvio digitale M3
│     └─ continueDigitalAttempt.ts # ripresa, bozza e consegna M3
├─ firestore.rules
├─ storage.rules
├─ firestore.indexes.json
├─ firebase.json
├─ pnpm-workspace.yaml
└─ package.json
```

`packages/lesson-contract` è un package interno del workspace pnpm: è referenziato da `apps/web` e da `functions/` tramite workspace reference (`workspace:*`) e non viene mai pubblicato sul registry npm. Lo schema Zod del contratto lezione vive anche, in forma condivisa, in `apps/web/src/contracts/lesson.ts`, che riesporta dal package del workspace per comodità di import nel codice SPA.

---

## 4. Comandi di bootstrap

```bash
# 1. Installa tutte le dipendenze del workspace
pnpm install

# 2. Autenticazione Firebase
firebase login

# 3. Associa i progetti Firebase (dev/prod) come alias
firebase use --add
```

Dopo il bootstrap, gli emulatori si avviano con `firebase emulators:start`. Lo sviluppo e i test usano emulatori e fixture sintetiche; nessun dato reale negli ambienti `dev`/`test`.

---

## 5. Variabili d'ambiente

### 5.1 SPA (Vite)

Le variabili esposte al client devono avere prefisso `VITE_`:

| Variabile | Scopo |
|---|---|
| `VITE_FIREBASE_API_KEY` | Configurazione client Firebase. |
| `VITE_FIREBASE_AUTH_DOMAIN` | Dominio di autenticazione. |
| `VITE_FIREBASE_PROJECT_ID` | ID progetto Firebase. |
| `VITE_FIREBASE_STORAGE_BUCKET` | Bucket Cloud Storage. |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | Sender ID. |
| `VITE_FIREBASE_APP_ID` | App ID Firebase. |

### 5.2 Cloud Functions

La chiave API del provider AI è richiesta **solo in V2 (M5)** ed è gestita tramite Firebase Functions config / Secret Manager, mai esposta al client né committata su Git. Nei Moduli 1–4 non sono necessari segreti applicativi: il gateway M3 usa un token di sessione opaco, hashato in Firestore e consegnato esclusivamente come cookie HttpOnly.

---

## 6. Porte degli emulatori

| Servizio | Porta |
|---|---|
| Auth | 9099 |
| Firestore | 8080 |
| Storage | 9199 |
| Functions | 5001 |
| Hosting | 5000 |

Queste porte sono dichiarate in `firebase.json` e usate dai test di integrazione (Vitest contro l'Emulator Suite) e dagli E2E Playwright.
