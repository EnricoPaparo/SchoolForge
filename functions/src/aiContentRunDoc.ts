/**
 * AIGEN-01 — (de)serializzazione **rigorosa** del documento tecnico
 * `aiContentRuns/{opaqueRunId}`. Il core puro lavora in millisecondi; qui
 * l'adapter Firestore serializza `expireAt`/`createdAt`/`updatedAt`/
 * `leaseExpiresAt` come `Timestamp` (campo TTL reale `expireAt`) e il parser
 * **fail-closed** valida ogni proprietà rilevante, rifiutando run legacy,
 * malformati o incoerenti (mai replay di output non validato).
 *
 * La policy TTL Firestore su `expireAt` verrà **configurata soltanto al rollout**
 * (Rules + smoke DEV): qui si scrive il campo, non si attiva la policy.
 */

import { Timestamp } from 'firebase-admin/firestore';
import {
  AI_CONTENT_CONTRACT_VERSION,
  AI_CONTENT_LIMITS,
  timestampToMillis,
  utf8ByteLength,
} from './aiContentCore.js';
import { isValidStoredConceptMapOutput } from './aiContentConceptMap.js';
import { isValidStoredVisualProposalOutput } from './aiContentVisualProposal.js';
import type { StoredAiContentRun } from './aiContentEngine.js';

const RUN_KINDS = new Set(['pool', 'lesson', 'concept_map', 'visual_proposal']);
const RUN_STATUSES = new Set(['running', 'completed', 'failed']);

/** Serializza il run con i quattro istanti come `Timestamp` Firestore. */
export function serializeRun(run: StoredAiContentRun): Record<string, unknown> {
  return {
    contractVersion: run.contractVersion,
    kind: run.kind,
    status: run.status,
    inputHash: run.inputHash,
    modelProfile: run.modelProfile,
    model: run.model,
    priceListVersion: run.priceListVersion,
    estimatedInputTokens: run.estimatedInputTokens,
    maxOutputTokens: run.maxOutputTokens,
    actualInputTokens: run.actualInputTokens,
    actualOutputTokens: run.actualOutputTokens,
    estimatedCostMicroUsd: run.estimatedCostMicroUsd,
    reservedCostMicroUsd: run.reservedCostMicroUsd,
    settledCostMicroUsd: run.settledCostMicroUsd,
    actualCostMicroUsd: run.actualCostMicroUsd,
    leaseExecutionId: run.leaseExecutionId,
    leaseExpiresAt: Timestamp.fromMillis(run.leaseExpiresAtMs),
    output: run.output,
    createdAt: Timestamp.fromMillis(run.createdAtMs),
    updatedAt: Timestamp.fromMillis(run.updatedAtMs),
    // Campo TTL Firestore. La policy verrà configurata solo al rollout.
    expireAt: Timestamp.fromMillis(run.expireAtMs),
  };
}

function isNonNegInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
function isNonNegIntOrNull(v: unknown): v is number | null {
  return v === null || isNonNegInt(v);
}
/**
 * Duck-typing del `Timestamp`. Delega all'helper condiviso di `aiContentCore`,
 * che invoca `toMillis()` in modo protetto: la copia locale precedente lasciava
 * propagare l'eccezione di un `toMillis()` che lancia, e un parser fail-closed
 * non deve poter esplodere su un input malformato.
 */
const tsToMillis = timestampToMillis;

/**
 * Parser **fail-closed** del documento tecnico (AIGEN-01-REVIEW-FIX §9): valida
 * contractVersion, kind, status, inputHash, modello/listino, costi/token interi
 * ≥ 0, lease/executionId/timestamp, expireAt e la coerenza output↔stato
 * (completed richiede output oggetto non nullo). Legacy/malformato/incoerente ⇒
 * `null`.
 */
function isCoherentCompletedOutput(kind: StoredAiContentRun['kind'], output: unknown): boolean {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return false;
  const o = output as Record<string, unknown>;
  if (kind === 'lesson') {
    if ('questions' in o || 'conceptMapMarkdown' in o) return false;
    const body = o.body;
    if (typeof body !== 'string' || body.trim().length === 0) return false;
    return utf8ByteLength(body) <= AI_CONTENT_LIMITS.MAX_LESSON_OUTPUT_BYTES;
  }
  // CONCEPT-MAP-01 — il run della mappa persiste il Markdown **canonico**
  // composto dal server, mai i tre campi grezzi. Il controllo non si limita a
  // «stringa non vuota entro il cap»: verifica l'intera struttura (quattro parti
  // nell'ordine giusto, fence singola e chiusa, avvertenza esatta, nessun
  // contenuto dopo). Un documento accettato in replay è così, per costruzione,
  // indistinguibile da uno appena prodotto.
  if (kind === 'concept_map') return isValidStoredConceptMapOutput(o);
  // VISUAL-ENRICHMENT-01 — un run `visual_proposal` completato deve portare un
  // esito valido dell'union chiusa, non un output di un altro kind.
  if (kind === 'visual_proposal') return isValidStoredVisualProposalOutput(o);
  // kind === 'pool'
  if ('body' in o || 'conceptMapMarkdown' in o) return false;
  return Array.isArray(o.questions) && o.questions.length > 0;
}

export function parseStoredRunDocument(data: unknown): StoredAiContentRun | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (d.contractVersion !== AI_CONTENT_CONTRACT_VERSION) return null;
  if (typeof d.kind !== 'string' || !RUN_KINDS.has(d.kind)) return null;
  if (typeof d.status !== 'string' || !RUN_STATUSES.has(d.status)) return null;
  if (typeof d.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(d.inputHash)) return null;
  if (typeof d.modelProfile !== 'string' || d.modelProfile.length === 0) return null;
  if (typeof d.model !== 'string' || d.model.length === 0) return null;
  if (typeof d.priceListVersion !== 'string' || d.priceListVersion.length === 0) return null;
  if (
    !isNonNegInt(d.estimatedInputTokens) ||
    !isNonNegInt(d.maxOutputTokens) ||
    !isNonNegIntOrNull(d.actualInputTokens) ||
    !isNonNegIntOrNull(d.actualOutputTokens) ||
    !isNonNegInt(d.estimatedCostMicroUsd) ||
    !isNonNegInt(d.reservedCostMicroUsd) ||
    !isNonNegIntOrNull(d.settledCostMicroUsd) ||
    !isNonNegIntOrNull(d.actualCostMicroUsd)
  ) {
    return null;
  }
  if (typeof d.leaseExecutionId !== 'string' || d.leaseExecutionId.length === 0) return null;
  const leaseExpiresAtMs = tsToMillis(d.leaseExpiresAt);
  const createdAtMs = tsToMillis(d.createdAt);
  const updatedAtMs = tsToMillis(d.updatedAt);
  const expireAtMs = tsToMillis(d.expireAt);
  if (
    leaseExpiresAtMs === null ||
    createdAtMs === null ||
    updatedAtMs === null ||
    expireAtMs === null
  ) {
    return null;
  }
  const status = d.status as StoredAiContentRun['status'];
  const kind = d.kind as StoredAiContentRun['kind'];
  const output = d.output ?? null;
  // Coerenza output↔stato↔kind (AIGEN-01-REVIEW-FIX-2 §5): un run `completed` deve
  // avere un output **chiuso e coerente col kind**, altrimenti è rifiutato (mai
  // replay di output non validato). `running`/`failed` non vincolano l'output.
  if (status === 'completed' && !isCoherentCompletedOutput(kind, output)) return null;
  return {
    contractVersion: AI_CONTENT_CONTRACT_VERSION,
    kind,
    status,
    inputHash: d.inputHash,
    modelProfile: d.modelProfile,
    model: d.model,
    priceListVersion: d.priceListVersion,
    estimatedInputTokens: d.estimatedInputTokens,
    maxOutputTokens: d.maxOutputTokens,
    actualInputTokens: d.actualInputTokens as number | null,
    actualOutputTokens: d.actualOutputTokens as number | null,
    estimatedCostMicroUsd: d.estimatedCostMicroUsd,
    reservedCostMicroUsd: d.reservedCostMicroUsd,
    settledCostMicroUsd: d.settledCostMicroUsd as number | null,
    actualCostMicroUsd: d.actualCostMicroUsd as number | null,
    leaseExecutionId: d.leaseExecutionId,
    leaseExpiresAtMs,
    output,
    createdAtMs,
    updatedAtMs,
    expireAtMs,
  };
}
