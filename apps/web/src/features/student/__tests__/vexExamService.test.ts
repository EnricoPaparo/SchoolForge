import { describe, expect, it, vi } from 'vitest';
import type { SubmissionDoc } from '../../../types/firestore.js';
import type { StudentVerificationItem } from '../../repository/verifications/studentVerificationsService.js';
import type { AssignVariantResponse } from '../verificationVariantClient.js';
import {
  resolveVexExam,
  validateAssignResponse,
  VexExamError,
  type VexExamDeps,
} from '../vexExamService.js';

function item(over: Partial<StudentVerificationItem> = {}): StudentVerificationItem {
  return {
    id: 'v1',
    title: 'V',
    className: 'A',
    activatedAt: null as never,
    questionCount: 1,
    questions: [],
    onlineEnabled: true,
    studentPdfEnabled: false,
    ownerUid: 'owner',
    status: 'active',
    distributionMode: 'equivalent_variants',
    ...over,
  };
}

function goodResponse(): AssignVariantResponse {
  return {
    distributionMode: 'equivalent_variants',
    assignedQuestionOrders: [0, 1, 3],
    questions: [
      { order: 0, tipo: 'aperta', maxPoints: 3, testo: 'Q0' },
      { order: 3, tipo: 'aperta', maxPoints: 3, testo: 'Q3', maxCharacters: 500 },
      {
        order: 1,
        tipo: 'chiusa_singola',
        maxPoints: 2,
        testo: 'Q1',
        opzioni: [{ id: 'a', testo: 'A' }],
      },
    ],
  };
}

const draftSubmission: SubmissionDoc = {
  submissionId: 'v1_s1',
  verificationId: 'v1',
  studentUid: 's1',
  ownerUid: 'owner',
  status: 'draft',
  answers: {},
  flagged: {},
  attentionEvents: [],
  deliveryCode: null,
  verificationTitle: 'V',
  className: 'A',
  startedAt: null as never,
  lastSavedAt: null as never,
  submittedAt: null,
  assignedQuestionOrders: [0, 1, 3],
};

describe('validateAssignResponse (fail-closed)', () => {
  it('accepts a coherent response and returns questions sorted by order', () => {
    const qs = validateAssignResponse(goodResponse());
    expect(qs.map((q) => q.order)).toEqual([0, 1, 3]);
    expect(qs.find((q) => q.order === 3)?.maxCharacters).toBe(500);
  });

  it('rejects the wrong distributionMode', () => {
    expect(() =>
      validateAssignResponse({ ...goodResponse(), distributionMode: 'same_questions' as never }),
    ).toThrow(VexExamError);
  });

  it('rejects a question carrying a solution field', () => {
    const resp = goodResponse();
    (resp.questions[0] as unknown as Record<string, unknown>).soluzione = 'x';
    expect(() => validateAssignResponse(resp)).toThrow(/non ammessi/);
  });

  it('rejects a question whose order is not in assignedQuestionOrders', () => {
    const resp = goodResponse();
    resp.questions[0]!.order = 99;
    expect(() => validateAssignResponse(resp)).toThrow(VexExamError);
  });

  it('rejects when questions do not cover the assignment exactly', () => {
    const resp = goodResponse();
    resp.questions.pop();
    expect(() => validateAssignResponse(resp)).toThrow(/non coincidono/);
  });

  it('rejects an empty assignment', () => {
    expect(() =>
      validateAssignResponse({ ...goodResponse(), assignedQuestionOrders: [], questions: [] }),
    ).toThrow(VexExamError);
  });
});

describe('resolveVexExam', () => {
  it('calls the callable once and uses only the returned variant', async () => {
    const assign = vi.fn(async () => goodResponse());
    const load = vi.fn(async () => draftSubmission);
    const deps: VexExamDeps = { assign, load };
    const resolved = await resolveVexExam(item(), 's1', deps);
    expect(assign).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith('v1');
    expect(resolved.assignedQuestionOrders).toEqual([0, 1, 3]);
    expect(resolved.questions.map((q) => q.order)).toEqual([0, 1, 3]);
    // no solution leaked into UI state
    for (const q of resolved.questions) expect('soluzione' in q).toBe(false);
  });

  it('propagates a fail-closed error on a malformed response (no fallback)', async () => {
    const deps: VexExamDeps = {
      assign: async () => ({ distributionMode: 'same_questions' }) as never,
      load: async () => draftSubmission,
    };
    await expect(resolveVexExam(item(), 's1', deps)).rejects.toBeInstanceOf(VexExamError);
  });

  it('fails when no draft submission is available after assignment', async () => {
    const deps: VexExamDeps = { assign: async () => goodResponse(), load: async () => null };
    await expect(resolveVexExam(item(), 's1', deps)).rejects.toBeInstanceOf(VexExamError);
  });
});
