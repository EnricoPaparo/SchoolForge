// Cloud Functions entry point.
// - startDigitalAttempt/continueDigitalAttempt: superati dal modello M3-full client-only.
// - repositoryGateway (SGW-01): gateway HTTPS same-origin per gli accessi Storage del docente.
// - aiCorrectionPreview/aiCorrectionRun (M5-01): gateway onCall della correzione
//   assistita da IA in modalità mock deterministica (nessun provider reale,
//   nessuna scrittura Firestore, zero token).
export { repositoryGateway } from './repositoryGateway.js';
export { aiCorrectionPreview, aiCorrectionRun } from './aiCorrectionGateway.js';
// AIGEN-01 — callable server-side della generazione IA di pool e lezioni
// (aiContentPreview/aiContentGenerate). Provider reale disabilitato dal kill
// switch; run server-only in aiContentRuns. Vedi ai-content-generation-roadmap.md.
export { aiContentPreview, aiContentGenerate } from './aiContentGateway.js';
// VISUAL-ENRICHMENT-02 — preview read-only, generazione binaria WebP e cleanup
// idempotente dello staging alla cancellazione TTL dei run tecnici server-only.
export {
  aiVisualPreview,
  aiVisualGenerate,
  aiVisualBindCandidate,
  aiVisualPromote,
  setLessonCompleted,
  aiVisualRemove,
  aiVisualAbandon,
  aiVisualCleanupForDelete,
  aiVisualExportBatch,
  aiVisualReanchor,
  visualRunCleanup,
} from './aiVisualGateway.js';
// MULTI-VISUAL-02 — catena binaria dell'upload docente: accettazione owner-
// only (cap 2 MB, allowlist PNG/JPEG/WebP, normalizzazione Sharp condivisa
// con VE, staging deterministico), abbandono e cleanup TTL. Zero provider,
// zero budget IA, zero secret. Nessuna promozione: resta MULTI-VISUAL-03.
export { aiVisualUploadAccept, aiVisualUploadAbandon } from './aiVisualUploadGateway.js';
// MULTI-VISUAL-03A — autorizzazione owner-only del piano visivo coordinato:
// lease deterministico un-piano-per-lezione, prenotazione unica del tetto
// economico e proposta coordinata (kind: 'visual_plan_proposal') tramite il
// motore AIGEN generico. Nessuna generazione per slot, promozione, upload-
// adoption, riordino/rimozione o cleanup: resta MULTI-VISUAL-03B/03C.
export { aiVisualPlanAuthorize } from './aiVisualPlanGateway.js';
// MULTI-VISUAL-03B — generazione/retry e promozione atomica add/replace
// per singolo slot. Solo la generazione riceve OPENAI_API_KEY.
export {
  aiVisualPlanGenerateSlot,
  aiVisualPlanPromoteSlot,
} from './aiVisualPlanExecutionGateway.js';
// ANNOT-CLEANUP-01 — owner-only cleanup of a program's student lesson notes
// (indexed collection-group delete), invoked by deleteProgram before removing
// the program document.
export { cleanupProgramLessonNotes } from './programNotesCleanup.js';
// VEX-01B — callable di assegnazione idempotente delle varianti equivalenti
// (server-side, isolamento delle alternative). Vedi documentazione/vex-contract.md.
export {
  assignVerificationVariant,
  resolveStudentVerificationPdf,
} from './verificationVariantGateway.js';
// FORCE-SUBMIT-02 — la chiusura forzata è **solo** batch e con preavviso: la
// callable per singola consegna di FORCE-SUBMIT-01 è stata rimossa, perché
// avrebbe permesso di chiudere una verifica senza i 60 secondi promessi allo
// studente. Il suo core transazionale (`forceSubmitCore.ts`) resta ed è riusato
// dalla task `runScheduledForceClose`.
// FORCE-SUBMIT-02 — chiusura multipla con preavviso di 60 secondi:
// `scheduleForceCloseSubmissions` programma (callable owner-only) e
// `runScheduledForceClose` esegue alla scadenza (task queue Cloud Tasks).
// Vedi documentazione/api-contract.md.
export { scheduleForceCloseSubmissions, runScheduledForceClose } from './forceCloseGateway.js';
