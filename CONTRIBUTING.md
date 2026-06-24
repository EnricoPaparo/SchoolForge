# Guida allo sviluppo — SchoolForge

Questa guida è applicabile dopo il pacchetto `F-01 — Workspace e CI`. Finché il repository contiene solo documentazione, comandi, script e file di configurazione citati qui sono target di implementazione, non strumenti già disponibili.

## Regola principale

Un contributo corrisponde a un solo pacchetto del [piano](documentazione/piano-implementazione.md). Prima di modificare file, leggere brief, requisiti, architettura, piano e documenti direttamente coinvolti.

## Prerequisiti previsti

- Node.js LTS e pnpm;
- Firebase CLI e Java per Emulator Suite;
- Git;
- accesso al progetto Firebase `dev` solo quando autorizzato dal Docente.

Non usare mai il progetto `prod` in sviluppo locale. Non creare risorse, attivare billing, configurare mittenti email o modificare backup senza l'autorizzazione esplicita del Docente owner.

## Struttura target

```text
apps/teacher-web/       # pannello docente
apps/exam-portal/       # Portale Verifiche
functions/src/          # Cloud Functions e moduli di dominio
packages/lesson-contract/
documentazione/
firestore.rules
storage.rules
firestore.indexes.json
firebase.json
```

## Workflow Git

- `main` contiene solo codice revisionato e pipeline verde.
- Ogni pacchetto usa `feat/<id>-<slug>` o `fix/<id>-<slug>`.
- Una PR non unisce refactor non correlati, nuove feature e modifiche di deployment.
- Il merge richiede test dichiarati, review e DoD del pacchetto.
- Il deploy `prod` richiede anche il gate del modulo e l'azione manuale del Docente.

## Regole tecniche

- TypeScript strict, validazione runtime dei payload, backend autorevole.
- Il client non scrive direttamente dati di dominio in Firestore.
- Nessun segreto in Git, Markdown, client o log.
- Nessun PDF persistente in Storage o Firestore.
- Nessun account studente, Google Workspace obbligatorio, Google Drive API, Forms o generazione AI di domande.
- Sviluppo e test usano Emulator Suite e fixture sintetiche.

## Verifica prima della PR

Eseguire i comandi introdotti da F-01: format, lint, typecheck, unit test e gli eventuali test Emulator/E2E del pacchetto. La PR deve riportare requisito coperto, file modificati, test eseguiti, rischi e gate interessato.

## Handoff dell'agente

Al termine, consegnare: ID del pacchetto, risultato, test/evidenze, confini rispettati, rischi residui e dipendenze sbloccate. Un pacchetto senza handoff non è completato.
