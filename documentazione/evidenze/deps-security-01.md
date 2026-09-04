# DEPS-SECURITY-01 — evidenza tecnica

## Obiettivo

Ridurre l'esposizione nota delle dipendenze installate senza modificare UI,
configurazione runtime, modello dati o comportamento dei provider.

## Esito audit

L'audit iniziale del lockfile riportava 94 advisory, inclusi 4 `critical` e 43
`high`. Dopo l'aggiornamento delle dipendenze dirette e gli override mirati:

- `pnpm audit --audit-level high` termina con codice 0;
- non restano advisory `critical` o `high`;
- restano 5 advisory `moderate`, fuori dal gate di questo intervento e senza
  override forzati a rischio di incompatibilità.

Gli override sono limitati alle versioni correttive di `brace-expansion`,
`browserslist`, `fast-uri`, `fast-xml-parser`, `js-yaml`, `nanoid`, `postcss`,
`tar` e `undici`. I selettori restano confinati alle linee major presenti;
non sono stati mantenuti override generici, inutilizzati o sovrapposti.

## Aggiornamenti diretti

- web: Firebase 12.18, DOMPurify 3.4.14, Vite 6.4 e Vitest 3.2;
- test Rules: `@firebase/rules-unit-testing` 5.0.2;
- Functions: Firebase Admin 14.3, Firebase Functions 7.3.2 e Sharp 0.35.4;
- tooling: Firebase CLI 15.29 e Vitest 3.2 in tutti i workspace.

Il pacchetto deprecato `@types/dompurify` è stato rimosso perché DOMPurify
fornisce già le proprie dichiarazioni TypeScript.

## Compatibilità verificata

Gli adeguamenti ai test riguardano soltanto i tipi dei mock di Vitest 3, due
timeout espliciti da 10 secondi per l'avvio dell'emulatore e asserzioni basate
sulla variazione del numero di eventi, indipendenti dall'ordine dei file.

Sono passati unit test, build, typecheck e l'intero gate emulatori: 210 test di
integrazione Functions e 712 test Rules web. `firebase --version` si avvia
correttamente con la nuova CLI.

## Impatto e rollback

Non cambiano interfaccia, regole Firestore, schema, variabili, provider, limiti
o budget. Il rollout DEV richiede Hosting per il bundle web. Poiché
`firebase-admin` e `firebase-functions` sono dipendenze condivise dal singolo
pacchetto server, tutte le Functions esportate da `functions/src/index.ts`
vengono ridistribuite con target nominati esplicitamente: in questo modo DEV
non conserva revisioni eterogenee del runtime. Nessuna chiamata provider reale
fa parte dello smoke.

I target Functions sono: `repositoryGateway`, `aiCorrectionPreview`,
`aiCorrectionRun`, `aiContentPreview`, `aiContentGenerate`, `aiVisualPreview`,
`aiVisualGenerate`, `aiVisualBindCandidate`, `aiVisualPromote`,
`setLessonCompleted`, `aiVisualRemove`, `aiVisualAbandon`,
`aiVisualCleanupForDelete`, `aiVisualExportBatch`, `aiVisualReanchor`,
`visualRunCleanup`, `aiVisualUploadAccept`, `aiVisualUploadAbandon`,
`aiVisualUploadPromote`, `aiVisualPlanAuthorize`, `aiVisualPlanGenerateSlot`,
`aiVisualPlanPromoteSlot`, `aiVisualPlanEditSlot`, `aiVisualMultiReorder`,
`aiVisualMultiRemove`, `cleanupProgramLessonNotes`,
`assignVerificationVariant`, `resolveStudentVerificationPdf`,
`scheduleForceCloseSubmissions` e `runScheduledForceClose`.

Il rollback consiste nel revert della PR, nuova installazione frozen e
ridistribuzione degli stessi target DEV.
