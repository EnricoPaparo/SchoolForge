// Cloud Functions entry point.
// - startDigitalAttempt/continueDigitalAttempt: superati dal modello M3-full client-only.
// - repositoryGateway (SGW-01): gateway HTTPS same-origin per gli accessi Storage del docente.
// - aiCorrectionPreview/aiCorrectionRun (M5-01): gateway onCall della correzione
//   assistita da IA in modalità mock deterministica (nessun provider reale,
//   nessuna scrittura Firestore, zero token).
export { repositoryGateway } from './repositoryGateway.js';
export { aiCorrectionPreview, aiCorrectionRun } from './aiCorrectionGateway.js';
