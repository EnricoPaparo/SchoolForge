// Cloud Functions entry point.
// - startDigitalAttempt/continueDigitalAttempt: superati dal modello M3-full client-only.
// - repositoryGateway (SGW-01): gateway HTTPS same-origin per gli accessi Storage del docente.
// - aiCorrectionPreview/aiCorrectionRun (M5-01): gateway onCall della correzione
//   assistita da IA in modalità mock deterministica (nessun provider reale,
//   nessuna scrittura Firestore, zero token).
export { repositoryGateway } from './repositoryGateway.js';
export { aiCorrectionPreview, aiCorrectionRun } from './aiCorrectionGateway.js';
// ANNOT-CLEANUP-01 — owner-only cleanup of a program's student lesson notes
// (indexed collection-group delete), invoked by deleteProgram before removing
// the program document.
export { cleanupProgramLessonNotes } from './programNotesCleanup.js';
// VEX-01B — callable di assegnazione idempotente delle varianti equivalenti
// (server-side, isolamento delle alternative). Vedi documentazione/vex-contract.md.
export { assignVerificationVariant } from './verificationVariantGateway.js';
