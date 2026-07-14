// Cloud Functions entry point.
// - startDigitalAttempt/continueDigitalAttempt: superati dal modello M3-full client-only.
// - repositoryGateway (SGW-01): gateway HTTPS same-origin per gli accessi Storage del docente.
export { repositoryGateway } from './repositoryGateway.js';
