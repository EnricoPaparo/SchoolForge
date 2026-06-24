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
app/src/
  routes/teacher/     # sezione docente (/teacher/*)
  routes/exam/        # portale pubblico (/exam/:token)
  features/           # repository, verifiche, portale, correzione, export
  renderers/          # @react-pdf/renderer, Markdown, CSV
  lib/                # firebase client, tipi condivisi
functions/src/
  startDigitalAttempt.ts
  ai/                 # M5: AiGateway e endpoint AI
packages/
  lesson-contract/    # parser e validatore pool v1
firestore.rules
storage.rules
firestore.indexes.json
firebase.json
```

## Vincoli architetturali

- Una sola SPA su Firebase Hosting; nessun deployment separato per il portale.
- Cloud Functions solo per `startDigitalAttempt` (M3) e AI (M5). Qualsiasi Function aggiuntiva richiede approvazione esplicita.
- PDF e documenti generati nel browser con `@react-pdf/renderer`; nessun documento generato server-side.
- Il client docente scrive direttamente su Firestore e Storage entro le Security Rules.
- Nessun invio email agli studenti.

## Regole tecniche

- TypeScript strict, validazione runtime dei payload, Security Rules come perimetro principale.
- I pool non sono mai esposti nel rendering lezione o nella proiezione portale.
- Nessun segreto in Git, Markdown, client o log. Secret Manager solo da M5.
- Nessun PDF o documento di export persistito in Storage o Firestore.
- Nessun account studente, Google Workspace obbligatorio, Google Drive API, Forms o generazione AI di domande.
- Sviluppo e test usano Emulator Suite e fixture sintetiche.

## Workflow Git

- `main` contiene solo codice revisionato e pipeline verde.
- Ogni pacchetto usa `feat/<id>-<slug>` o `fix/<id>-<slug>`.
- Una PR non unisce refactor non correlati, nuove feature e modifiche di deployment.
- Il merge richiede test dichiarati, review e DoD del pacchetto.
- Il deploy `prod` richiede il gate del modulo e l'azione manuale del Docente.

## Verifica prima della PR

Eseguire i comandi introdotti da F-01: format, lint, typecheck, unit test e gli eventuali test Emulator/E2E del pacchetto. La PR deve riportare requisito coperto, file modificati, test eseguiti, rischi e gate interessato.

## Handoff dell'agente

Al termine, consegnare: ID del pacchetto, risultato, test/evidenze, confini rispettati, rischi residui e dipendenze sbloccate. Un pacchetto senza handoff non è completato.
