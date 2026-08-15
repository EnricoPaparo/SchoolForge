import { describe, expect, it } from 'vitest';
import type {
  RandomIntBelow,
  VexSnapshot,
  VexSnapshotQuestion,
} from './verificationVariantCore.js';
import {
  AssignGatewayError,
  decideAssignment,
  parseAssignInput,
  runAssignVariant,
  runResolveStudentPdf,
  submissionIdFor,
  type AssignVariantDeps,
  type ResolveStudentPdfDeps,
  type StudentContext,
  type VerificationContext,
} from './verificationVariantGatewayCore.js';

function q(order: number, over: Partial<VexSnapshotQuestion> = {}): VexSnapshotQuestion {
  return { order, tipo: 'aperta', maxPoints: 3, difficolta: 3, testo: `t${order}`, ...over };
}

function pdfHarness(over: Partial<ResolveStudentPdfDeps> = {}) {
  let orders: number[] | null = null;
  let writes = 0;
  const deps: ResolveStudentPdfDeps = {
    callerUid: STUDENT,
    portalEnabled: async () => true,
    loadVerification: async () => verification(),
    loadStudent: async () => student(),
    randomIntBelow: rngSeq(0, 0),
    persistPdfAssignment: async (input) => {
      if (orders) return { assignedQuestionOrders: [...orders], writes: 0 };
      orders = decideAssignment(
        { exists: false },
        input.snapshot,
        input.studentUid,
        input.randomIntBelow,
      ).assignedQuestionOrders;
      writes += 1;
      return { assignedQuestionOrders: [...orders], writes: 1 };
    },
    ...over,
  };
  return { deps, writesTotal: () => writes };
}

function snapshot(): VexSnapshot {
  return {
    distributionMode: 'equivalent_variants',
    questions: [q(0), q(1), q(2), q(3), q(4)],
    commonQuestionOrders: [0],
    equivalentGroups: [
      { id: 'g1', alternativeOrders: [1, 2] },
      { id: 'g2', alternativeOrders: [3, 4] },
    ],
  };
}

function rngSeq(...values: number[]): RandomIntBelow {
  let i = 0;
  return () => values[i++ % values.length]!;
}

const OWNER = 'owner-1';
const STUDENT = 'student-1';
const VID = 'ver-1';

function verification(over: Partial<VerificationContext> = {}): VerificationContext {
  return {
    ownerUid: OWNER,
    status: 'active',
    onlineEnabled: true,
    studentPdfEnabled: true,
    visibility: 'public',
    classId: 'class-a',
    title: 'Verifica',
    className: 'Classe A',
    teacherSnapshotRaw: snapshot(),
    ...over,
  };
}

function student(over: Partial<StudentContext> = {}): StudentContext {
  return { ownerUid: OWNER, status: 'approved', classId: 'class-a', ...over };
}

interface Harness {
  deps: AssignVariantDeps;
  writesTotal(): number;
  store: Map<string, { assignedQuestionOrders?: number[] }>;
}

function harness(over: Partial<AssignVariantDeps> = {}, seed?: { invalid?: boolean }): Harness {
  const store = new Map<string, { assignedQuestionOrders?: number[] }>();
  if (seed) {
    store.set(submissionIdFor(VID, STUDENT), {
      assignedQuestionOrders: seed.invalid ? [1, 2, 3] : [0, 1, 3],
    });
  }
  let writes = 0;
  const deps: AssignVariantDeps = {
    callerUid: STUDENT,
    portalEnabled: async () => true,
    loadVerification: async () => verification(),
    loadStudent: async () => student(),
    randomIntBelow: rngSeq(0, 0),
    persistAssignment: async (input) => {
      const id = input.submissionId;
      const cur = store.get(id);
      const existing = cur
        ? { exists: true as const, assignedQuestionOrders: cur.assignedQuestionOrders }
        : { exists: false as const };
      const decision = decideAssignment(
        existing,
        input.snapshot,
        input.studentUid,
        input.randomIntBelow,
      );
      if (decision.kind === 'reuse') {
        return { assignedQuestionOrders: decision.assignedQuestionOrders, writes: 0 };
      }
      store.set(id, { assignedQuestionOrders: decision.assignedQuestionOrders });
      writes += 1;
      return { assignedQuestionOrders: decision.assignedQuestionOrders, writes: 1 };
    },
    ...over,
  };
  return { deps, writesTotal: () => writes, store };
}

async function codeOf(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
    return 'NO_THROW';
  } catch (e) {
    return e instanceof AssignGatewayError ? e.code : `OTHER:${(e as Error).name}`;
  }
}

describe('parseAssignInput (closed input)', () => {
  it('accepts exactly { verificationId }', () => {
    expect(parseAssignInput({ verificationId: 'v1' })).toEqual({ verificationId: 'v1' });
  });
  it('rejects extra properties', () => {
    expect(() => parseAssignInput({ verificationId: 'v1', extra: 1 })).toThrow(/chiavi/);
  });
  it('rejects non plain-object', () => {
    expect(() => parseAssignInput(null)).toThrow(AssignGatewayError);
    expect(() => parseAssignInput(['v1'])).toThrow(AssignGatewayError);
    expect(() => parseAssignInput('v1')).toThrow(AssignGatewayError);
  });
  it('rejects empty/malformed Firestore segments', () => {
    expect(() => parseAssignInput({ verificationId: '' })).toThrow(/verificationId/);
    expect(() => parseAssignInput({ verificationId: 'a/b' })).toThrow(/verificationId/);
    expect(() => parseAssignInput({ verificationId: '..' })).toThrow(/verificationId/);
    expect(() => parseAssignInput({ verificationId: 42 })).toThrow(/verificationId/);
  });
});

describe('runAssignVariant — authorization (fail-closed)', () => {
  it('rejects when unauthenticated', async () => {
    const h = harness({ callerUid: null });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'unauthenticated',
    );
  });
  it('rejects when the portal is disabled', async () => {
    const h = harness({ portalEnabled: async () => false });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'failed_precondition',
    );
  });
  it('rejects a missing verification', async () => {
    const h = harness({ loadVerification: async () => null });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe('not_found');
  });
  it('rejects a non-approved / unknown student', async () => {
    expect(
      await codeOf(() =>
        runAssignVariant({ verificationId: VID }, harness({ loadStudent: async () => null }).deps),
      ),
    ).toBe('permission_denied');
    expect(
      await codeOf(() =>
        runAssignVariant(
          { verificationId: VID },
          harness({ loadStudent: async () => student({ status: 'pending' }) }).deps,
        ),
      ),
    ).toBe('permission_denied');
  });
  it('rejects a student of a different owner', async () => {
    const h = harness({ loadStudent: async () => student({ ownerUid: 'other' }) });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'permission_denied',
    );
  });
  it('rejects a class mismatch', async () => {
    const h = harness({ loadStudent: async () => student({ classId: 'class-z' }) });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'permission_denied',
    );
  });
  it('rejects a verification that is not active', async () => {
    const h = harness({ loadVerification: async () => verification({ status: 'closed' }) });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'failed_precondition',
    );
  });
  it('rejects when online is disabled', async () => {
    const h = harness({ loadVerification: async () => verification({ onlineEnabled: false }) });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'failed_precondition',
    );
  });
  it('rejects a verification that needs no server assignment, with no writes', async () => {
    const h = harness({
      loadVerification: async () =>
        verification({ teacherSnapshotRaw: { distributionMode: 'same_questions' } }),
    });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'failed_precondition',
    );
    expect(h.writesTotal()).toBe(0);
  });
  it('rejects a malformed VEX snapshot', async () => {
    const h = harness({
      loadVerification: async () =>
        verification({ teacherSnapshotRaw: { distributionMode: 'equivalent_variants' } }),
    });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'failed_precondition',
    );
  });
});

describe('runAssignVariant — assignment result', () => {
  it('returns all common + one per group, sanitized, no solutions', async () => {
    const h = harness();
    const res = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(res.assignmentMode).toBe('server_resolved');
    expect(res.assignedQuestionOrders).toEqual([0, 1, 3]);
    expect(res.questions.map((q) => q.order)).toEqual([0, 1, 3]);
    for (const q of res.questions) expect('soluzione' in q).toBe(false);
  });
  it('never includes an unassigned alternative in the response', async () => {
    const h = harness();
    const res = await runAssignVariant({ verificationId: VID }, h.deps);
    const orders = new Set(res.assignedQuestionOrders);
    expect(orders.has(2)).toBe(false); // the other g1 alternative
    expect(orders.has(4)).toBe(false); // the other g2 alternative
  });
});

describe('runAssignVariant — idempotency & concurrency', () => {
  it('first start persists exactly one write', async () => {
    const h = harness();
    await runAssignVariant({ verificationId: VID }, h.deps);
    expect(h.writesTotal()).toBe(1);
  });
  it('refresh/retry performs zero further writes and returns the same variant', async () => {
    const h = harness();
    const first = await runAssignVariant({ verificationId: VID }, h.deps);
    const second = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(h.writesTotal()).toBe(1);
    expect(second.assignedQuestionOrders).toEqual(first.assignedQuestionOrders);
  });
  it('two sequential tabs converge on a single persisted assignment', async () => {
    // A different RNG on the second call must not matter: the persisted value wins.
    const h = harness();
    const a = await runAssignVariant(
      { verificationId: VID },
      {
        ...h.deps,
        randomIntBelow: rngSeq(0, 0),
      },
    );
    const b = await runAssignVariant(
      { verificationId: VID },
      {
        ...h.deps,
        randomIntBelow: rngSeq(1, 1),
      },
    );
    expect(h.writesTotal()).toBe(1);
    expect(b.assignedQuestionOrders).toEqual(a.assignedQuestionOrders);
  });
  it('an existing but INVALID assignment fails closed (no silent regeneration)', async () => {
    const h = harness({}, { invalid: true });
    expect(await codeOf(() => runAssignVariant({ verificationId: VID }, h.deps))).toBe(
      'failed_precondition',
    );
    expect(h.writesTotal()).toBe(0);
    // The bad value is left untouched — never silently overwritten.
    expect(h.store.get(submissionIdFor(VID, STUDENT))?.assignedQuestionOrders).toEqual([1, 2, 3]);
  });
  it('zero-group verification (all common) assigns and stays stable', async () => {
    const allCommon: VexSnapshot = {
      distributionMode: 'equivalent_variants',
      questions: [q(0), q(1)],
      commonQuestionOrders: [0, 1],
      equivalentGroups: [],
    };
    const h = harness({
      loadVerification: async () => verification({ teacherSnapshotRaw: allCommon }),
    });
    const res = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(res.assignedQuestionOrders).toEqual([0, 1]);
    await runAssignVariant({ verificationId: VID }, h.deps);
    expect(h.writesTotal()).toBe(1);
  });
});

describe('runResolveStudentPdf — PDF personale server-resolved', () => {
  it('funziona anche a verifica chiusa e online disabilitato, se PDF e visibilità sono attivi', async () => {
    const h = pdfHarness({
      loadVerification: async () =>
        verification({ status: 'closed', onlineEnabled: false, studentPdfEnabled: true }),
    });
    const result = await runResolveStudentPdf({ verificationId: VID }, h.deps);
    expect(result.assignedQuestionOrders).toEqual([0, 1, 3]);
    expect(result.questions.map((question) => question.order)).toEqual([0, 1, 3]);
  });

  it.each([
    ['PDF disabilitato', { studentPdfEnabled: false }],
    ['verifica nascosta', { visibility: 'hidden' }],
    ['verifica in bozza', { status: 'draft' }],
  ])('rifiuta %s prima di persistere', async (_name, override) => {
    const h = pdfHarness({
      loadVerification: async () => verification(override),
    });
    expect(await codeOf(() => runResolveStudentPdf({ verificationId: VID }, h.deps))).toBe(
      'failed_precondition',
    );
    expect(h.writesTotal()).toBe(0);
  });

  it('è idempotente: più download riusano lo stesso insieme', async () => {
    const h = pdfHarness();
    const first = await runResolveStudentPdf({ verificationId: VID }, h.deps);
    const second = await runResolveStudentPdf({ verificationId: VID }, h.deps);
    expect(h.writesTotal()).toBe(1);
    expect(second.assignedQuestionOrders).toEqual(first.assignedQuestionOrders);
  });

  it('non restituisce soluzioni né alternative non assegnate', async () => {
    const result = await runResolveStudentPdf({ verificationId: VID }, pdfHarness().deps);
    expect(result.questions.map((question) => question.order)).toEqual([0, 1, 3]);
    expect(JSON.stringify(result)).not.toContain('soluzione');
    expect(result.questions.map((question) => question.order)).not.toContain(2);
    expect(result.questions.map((question) => question.order)).not.toContain(4);
  });
});
