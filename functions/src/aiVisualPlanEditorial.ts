/**
 * MULTI-VISUAL-04 — revisione gratuita di uno slot ancora proposto (§8.4).
 * Contratti puri: payload chiuso, hash idempotente e transizione che non può
 * creare tentativi, byte, promozioni o consuntivi.
 */
import { createHash } from 'node:crypto';
import { timestampToMillis } from './aiContentCore.js';
import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_CAPTION_CHARS,
  assertProposalField,
  assertValidVisualSubject,
} from './aiContentVisualProposal.js';
import { isValidDocumentIdInput } from './firestoreDocumentId.js';
import {
  AiVisualMultiError,
  asRecord,
  assertExactKeys,
  isSha256Hex,
  isUuidV4,
} from './aiVisualMultiCore.js';
import { validateVisualAnchorSelector, type VisualAnchorSelector } from './aiVisualMultiAnchor.js';
import {
  deriveVisualPlanTerminalStatus,
  validateVisualPlanDiversity,
  validateVisualPlanRun,
  type VisualPlanRun,
  type VisualPlanSlot,
} from './aiVisualMultiPlan.js';

interface EditIdentity {
  requestId: string;
  editRequestId: string;
  programId: string;
  importId: string;
  lessonId: string;
  slotIndex: number;
}

export type VisualPlanEditSlotInput =
  | (EditIdentity & {
      abandon: false;
      subject: string;
      caption: string;
      altText: string;
      anchorHeadingIndex: number;
      anchorHeadingText: string;
    })
  | (EditIdentity & { abandon: true });

const IDENTITY_KEYS = [
  'requestId',
  'editRequestId',
  'programId',
  'importId',
  'lessonId',
  'slotIndex',
] as const;
const UPDATE_KEYS = [
  ...IDENTITY_KEYS,
  'abandon',
  'subject',
  'caption',
  'altText',
  'anchorHeadingIndex',
  'anchorHeadingText',
] as const;
const ABANDON_KEYS = [...IDENTITY_KEYS, 'abandon'] as const;

function invalid(message: string): never {
  throw new AiVisualMultiError('invalid_input', message);
}

function parseIdentity(root: Record<string, unknown>): EditIdentity {
  if (!isUuidV4(root.requestId)) invalid('requestId del piano non valido.');
  if (!isUuidV4(root.editRequestId)) invalid('editRequestId non valido.');
  if (!isValidDocumentIdInput(root.programId)) invalid('programId non valido.');
  if (!isValidDocumentIdInput(root.importId)) invalid('importId non valido.');
  if (!isValidDocumentIdInput(root.lessonId)) invalid('lessonId non valido.');
  if (
    typeof root.slotIndex !== 'number' ||
    !Number.isInteger(root.slotIndex) ||
    root.slotIndex < 0 ||
    root.slotIndex > 2
  ) {
    invalid('slotIndex non valido.');
  }
  return {
    requestId: root.requestId,
    editRequestId: root.editRequestId,
    programId: root.programId,
    importId: root.importId,
    lessonId: root.lessonId,
    slotIndex: root.slotIndex,
  } as EditIdentity;
}

export function validateVisualPlanEditSlotInput(value: unknown): VisualPlanEditSlotInput {
  const root = asRecord(value, 'Richiesta di revisione dello slot non valida.');
  if (root.abandon === true) {
    assertExactKeys(root, ABANDON_KEYS, 'Richiesta di abbandono dello slot');
    return { ...parseIdentity(root), abandon: true };
  }
  if (root.abandon !== false) invalid('abandon deve essere booleano.');
  assertExactKeys(root, UPDATE_KEYS, 'Richiesta di modifica dello slot');
  const identity = parseIdentity(root);
  let subject: string;
  let caption: string;
  let altText: string;
  try {
    subject = assertValidVisualSubject(root.subject);
    caption = assertProposalField(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS);
    altText = assertProposalField(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS);
  } catch {
    invalid('Campi editoriali dello slot non validi.');
  }
  const anchor = validateVisualAnchorSelector({
    anchorHeadingIndex: root.anchorHeadingIndex,
    anchorHeadingText: root.anchorHeadingText,
  });
  return {
    ...identity,
    abandon: false,
    subject,
    caption,
    altText,
    ...anchor,
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Documento tecnico opaco: lo stesso editRequestId ha un solo significato globale per owner. */
export function visualPlanSlotEditId(ownerUid: string, editRequestId: string): string {
  return sha256(`${ownerUid}\0${editRequestId}`);
}

export function visualPlanSlotEditInputHash(input: VisualPlanEditSlotInput): string {
  return sha256(JSON.stringify(input));
}

export interface StoredVisualPlanSlotEdit {
  contractVersion: 'visual-plan-slot-edit/v1';
  ownerUid: string;
  opaquePlanId: string;
  planHash: string;
  slotIndex: number;
  editRequestId: string;
  inputHash: string;
  outcome: 'updated' | 'abandoned';
  createdAt: unknown;
}

const STORED_EDIT_KEYS = [
  'contractVersion',
  'ownerUid',
  'opaquePlanId',
  'planHash',
  'slotIndex',
  'editRequestId',
  'inputHash',
  'outcome',
  'createdAt',
] as const;

export function validateStoredVisualPlanSlotEdit(value: unknown): StoredVisualPlanSlotEdit {
  const root = asRecord(value, 'Record di revisione dello slot non valido.', 'corrupted_state');
  assertExactKeys(root, STORED_EDIT_KEYS, 'Record di revisione dello slot', 'corrupted_state');
  if (
    root.contractVersion !== 'visual-plan-slot-edit/v1' ||
    !isValidDocumentIdInput(root.ownerUid) ||
    !isSha256Hex(root.opaquePlanId) ||
    !isSha256Hex(root.planHash) ||
    typeof root.slotIndex !== 'number' ||
    !Number.isInteger(root.slotIndex) ||
    root.slotIndex < 0 ||
    root.slotIndex > 2 ||
    !isUuidV4(root.editRequestId) ||
    !isSha256Hex(root.inputHash) ||
    (root.outcome !== 'updated' && root.outcome !== 'abandoned') ||
    timestampToMillis(root.createdAt) === null
  ) {
    throw new AiVisualMultiError('corrupted_state', 'Record di revisione dello slot corrotto.');
  }
  return root as unknown as StoredVisualPlanSlotEdit;
}

/** Applica solo a uno slot image/pending; non muta rationale, attempts o settlement. */
export function applyVisualPlanSlotEdit(
  plan: VisualPlanRun,
  input: VisualPlanEditSlotInput,
): VisualPlanRun {
  if (plan.status !== 'proposed') {
    throw new AiVisualMultiError(
      'visual_plan_slot_not_generatable',
      'Il piano non è più nella fase di revisione gratuita.',
    );
  }
  const current = plan.slots.find((slot) => slot.slotIndex === input.slotIndex);
  if (!current || current.decision !== 'image' || current.state !== 'pending') {
    throw new AiVisualMultiError(
      'visual_plan_slot_not_generatable',
      'Lo slot non è più una proposta modificabile.',
    );
  }
  let edited: VisualPlanSlot;
  if (input.abandon) {
    edited = { ...current, state: 'abandoned' };
  } else {
    const anchor: VisualAnchorSelector = {
      anchorHeadingIndex: input.anchorHeadingIndex,
      anchorHeadingText: input.anchorHeadingText,
    };
    edited = {
      ...current,
      subject: input.subject,
      caption: input.caption,
      altText: input.altText,
      anchor,
    };
  }
  const slots = plan.slots.map((slot) => (slot.slotIndex === input.slotIndex ? edited : slot));
  try {
    validateVisualPlanDiversity(slots);
  } catch {
    invalid('La modifica duplica il soggetto o l’utilità didattica di un altro slot.');
  }
  const hasPending = slots.some((slot) => slot.decision === 'image' && slot.state === 'pending');
  const status = hasPending ? 'proposed' : deriveVisualPlanTerminalStatus(slots);
  return validateVisualPlanRun({ ...plan, status, slots });
}
