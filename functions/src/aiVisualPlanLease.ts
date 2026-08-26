/**
 * MULTI-VISUAL-03A — lease deterministico «un solo piano attivo per lezione»
 * (roadmap `multi-visual-roadmap.md` §10.3).
 *
 * Percorso deterministico `visualPlanLeases/{leaseId}`, `leaseId =
 * SHA-256(canonical(['visual-plan-lease/v1', ownerUid, lessonId]))` — derivato
 * da `(ownerUid, lessonId)`, MAI dal `requestId`: due richieste con due
 * `requestId` diversi per la stessa lezione calcolano lo stesso `leaseId` e
 * contendono sullo stesso documento Firestore, dove la transazione fornisce
 * la serializzazione che una query non potrebbe dare.
 *
 * Validatore puro: nessuna lettura, nessuna transazione — quelle sono
 * competenza di `aiVisualPlanGateway.ts`. Un lease presente ma
 * strutturalmente divergente è sempre `corrupted_state`, mai un'assenza
 * silenziosa (stessa disciplina di `VisualPlanRun`, §5.5).
 */

import { timestampToMillis } from './aiContentCore.js';
import { type VisualTimestampLike } from './aiContentVisualProposal.js';
import { canonicalTuple, sha256Hex } from './aiVisualCore.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';
import {
  AiVisualMultiError,
  asRecord,
  assertExactKeys,
  isSha256Hex,
  isUuidV4,
} from './aiVisualMultiCore.js';

export const VISUAL_PLAN_LEASE_CONTRACT_VERSION = 'visual-plan-lease/v1' as const;

export interface VisualPlanLease {
  contractVersion: typeof VISUAL_PLAN_LEASE_CONTRACT_VERSION;
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  /** Il piano che detiene attualmente il lease. */
  opaquePlanId: string;
  requestId: string;
  createdAt: VisualTimestampLike;
  updatedAt: VisualTimestampLike;
  expireAt: VisualTimestampLike;
}

/**
 * `leaseId = SHA-256(canonical(['visual-plan-lease/v1', ownerUid, lessonId]))`
 * — deterministico, indipendente dal `requestId` (roadmap §10.3).
 */
export function computeVisualPlanLeaseId(ownerUid: string, lessonId: string): string {
  return sha256Hex(canonicalTuple([VISUAL_PLAN_LEASE_CONTRACT_VERSION, ownerUid, lessonId]));
}

const LEASE_KEYS = [
  'contractVersion',
  'ownerUid',
  'programId',
  'importId',
  'lessonId',
  'opaquePlanId',
  'requestId',
  'createdAt',
  'updatedAt',
  'expireAt',
] as const;

function invalidLease(message: string): never {
  throw new AiVisualMultiError('corrupted_state', message);
}

function assertIdSegment(value: unknown, label: string): string {
  if (!isValidDocumentIdInput(value)) invalidLease(`${label} del lease non valido.`);
  return value;
}

function assertTimestampLike(value: unknown, label: string): VisualTimestampLike {
  if (timestampToMillis(value) === null) invalidLease(`${label} del lease non valido.`);
  return value as VisualTimestampLike;
}

/**
 * Valida un `VisualPlanLease` persistito, fail-closed. Non decide se il
 * lease appartiene al piano corrente o a un altro, né se è scaduto — quei
 * giudizi (confronto con `opaquePlanId`/`expireAt` correnti) sono competenza
 * del chiamante, che ha bisogno dell'orologio e dell'identità della
 * richiesta corrente per formularli.
 */
export function validateVisualPlanLease(value: unknown): VisualPlanLease {
  const root = asRecord(value, 'Lease del piano visivo non valido.', 'corrupted_state');
  assertExactKeys(root, LEASE_KEYS, 'Lease del piano visivo', 'corrupted_state');
  if (root.contractVersion !== VISUAL_PLAN_LEASE_CONTRACT_VERSION) {
    invalidLease('contractVersion del lease non valida.');
  }

  const ownerUid = assertIdSegment(root.ownerUid, 'ownerUid');
  const programId = assertIdSegment(root.programId, 'programId');
  const importId = assertIdSegment(root.importId, 'importId');
  const lessonId = assertIdSegment(root.lessonId, 'lessonId');

  const opaquePlanId = root.opaquePlanId;
  if (!isSha256Hex(opaquePlanId)) invalidLease('opaquePlanId del lease non valido.');

  const requestId = root.requestId;
  if (!isUuidV4(requestId)) invalidLease('requestId del lease non valido.');

  const createdAt = assertTimestampLike(root.createdAt, 'createdAt');
  const updatedAt = assertTimestampLike(root.updatedAt, 'updatedAt');
  const expireAt = assertTimestampLike(root.expireAt, 'expireAt');

  const createdMs = timestampToMillis(createdAt);
  const updatedMs = timestampToMillis(updatedAt);
  if (createdMs === null || updatedMs === null || createdMs > updatedMs) {
    invalidLease('Timestamp del lease non coerenti (createdAt > updatedAt).');
  }

  return {
    contractVersion: VISUAL_PLAN_LEASE_CONTRACT_VERSION,
    ownerUid,
    programId,
    importId,
    lessonId,
    opaquePlanId,
    requestId,
    createdAt,
    updatedAt,
    expireAt,
  };
}

/** Predicato senza eccezioni, per i punti che devono solo sapere se un lease è valido. */
export function isValidStoredVisualPlanLease(value: unknown): boolean {
  try {
    validateVisualPlanLease(value);
    return true;
  } catch {
    return false;
  }
}
