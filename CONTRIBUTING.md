# Guida allo sviluppo — SchoolForge

Questa guida è applicabile dopo il pacchetto `F-01 — Workspace e CI`. Finché il repository contiene solo documentazione, comandi e file di configurazione citati qui sono target di implementazione, non strumenti già disponibili.

## Regola principale

Un contributo corrisponde a un solo pacchetto del [piano](documentazione/piano-implementazione.md). Prima di modificare file, leggere brief, requisiti, architettura, api-contract e piano.

## Prerequisiti previsti

- Node.js LTS e pnpm;
- Firebase CLI e Java per Emulator Suite;
- Git;
- accesso al progetto Firebase `dev` solo quando autorizzato dal Docente.

Non usare mai il progetto `prod` in sviluppo locale. Non creare risorse, attivare billing o modificare backup senza l'autorizzazione esplicita del Docente owner.

## Struttura target

```text
apps/web/src/
  routes/teacher/     # sezione docente (/teacher/*)
  routes/exam/        # portale pubblico (/exam/:token)
  features/           # repository, verifiche, portale, correzione, export
  renderers/          # @react-pdf/renderer, Markdown, CSV
  lib/                # firebase client, tipi condivisi
functions/src/
  startDigitalAttempt.ts
  continueDigitalAttempt.ts
  ai/                 # M5 (V2): AiGateway e endpoint AI
packages/
  lesson-contract/    # parser e validatore pool v1 (package interno del workspace, non pubblicato su npm)
firestore.rules
storage.rules
firestore.indexes.json
firebase.json
pnpm-workspace.yaml
```

Il monorepo usa **pnpm workspaces** (`pnpm-workspace.yaml`). Non usare npm o yarn. I package interni (`packages/lesson-contract`) sono referenziati via `workspace:*` da `apps/web` e `functions/` e non vengono pubblicati su npm. Il Modulo 5 (correzione AI) è fuori scope V1 / pianificato per V2.

## Vincoli architetturali

- Una sola SPA su Firebase Hosting; nessun deployment separato per il portale.
- Cloud Functions solo per il gateway M3 `startDigitalAttempt`/`continueDigitalAttempt` e AI (M5). Qualsiasi Function aggiuntiva richiede approvazione esplicita.
- PDF e documenti generati nel browser con `@react-pdf/renderer`; nessun documento generato server-side.
- Il client docente scrive direttamente su Firestore e Storage entro le Security Rules; il Portale non scrive mai direttamente tentativi, risposte o snapshot.
- Nessun invio email agli studenti.

## Regole tecniche

- TypeScript strict, validazione runtime dei payload, Security Rules come perimetro principale.
- I pool non sono mai esposti nel rendering lezione o nella proiezione portale.
- Nessun segreto in Git, Markdown, client o log. Secret Manager solo da M5.
- Nessun PDF o documento di export persistito in Storage o Firestore.
- Nessun account studente, Google Workspace obbligatorio, Google Drive API, Forms o generazione AI di domande.
- Nessun lock basato su email: l'unicità della consegna digitale è garantita dal lock `verifica + nome + cognome` normalizzati. Lo studente dichiara nome e cognome (auto-dichiarati, non verificati); ogni accesso digitale è registrato con nome+IP+timestamp+user-agent come audit trail consultabile dal docente (visibilità, non enforcement).
- Il canale cartaceo è puramente fisico: nessun record di tentativo né log di accesso; al più un contatore atomico `downloadCount`.
- Sviluppo e test usano Emulator Suite e fixture sintetiche.

## Workflow Git

- `main` contiene solo codice revisionato e pipeline verde.
- Ogni pacchetto usa `feat/<package-id>-<slug>` o `fix/<package-id>-<slug>` (es. `feat/F-01-workspace-ci`).
- Una PR non unisce refactor non correlati, nuove feature e modifiche di deployment.
- Il merge richiede test dichiarati, review e DoD del pacchetto.
- Il deploy `prod` richiede il gate del modulo e l'azione manuale del Docente.

## Verifica prima della PR

Eseguire i comandi introdotti da F-01: format, lint, typecheck, unit test e gli eventuali test Emulator/E2E del pacchetto. La PR deve riportare requisito coperto, file modificati, test eseguiti, rischi e gate interessato.

## Handoff dell'agente

Al termine, consegnare: ID del pacchetto, risultato, test/evidenze, confini rispettati, rischi residui e dipendenze sbloccate. Un pacchetto senza handoff non è completato.
