import { describe, expect, it } from 'vitest';
import type {
  VerificationTeacherQuestionSnapshot,
  VerificationTeacherSnapshot,
} from '../../../../types/firestore.js';
import { AssignedVariantError, resolveAssignedQuestions } from '../assignedVariant.js';

function q(
  order: number,
  over: Partial<VerificationTeacherQuestionSnapshot> = {},
): VerificationTeacherQuestionSnapshot {
  return {
    order,
    tipo: 'aperta',
    maxPoints: 3,
    difficolta: 3,
    testo: `t${order}`,
    soluzione: `s${order}`,
    ...over,
  };
}

type Snap = Pick<
  VerificationTeacherSnapshot,
  'distributionMode' | 'questions' | 'commonQuestionOrders' | 'equivalentGroups'
>;

/** common [0], g1 [1,2], g2 [3,4]. */
function vexSnap(): Snap {
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

describe('resolveAssignedQuestions', () => {
  it('same_questions → all snapshot questions in canonical order', () => {
    const snap: Snap = { distributionMode: 'same_questions', questions: [q(2), q(0), q(1)] };
    const out = resolveAssignedQuestions(snap, {});
    expect(out.map((x) => x.order)).toEqual([0, 1, 2]);
  });

  it('legacy (no mode) behaves as same_questions', () => {
    const snap: Snap = { distributionMode: undefined, questions: [q(0), q(1)] };
    expect(resolveAssignedQuestions(snap, {}).map((x) => x.order)).toEqual([0, 1]);
  });

  it('VEX valid → common + one per group, sorted', () => {
    const out = resolveAssignedQuestions(vexSnap(), {
      assignedQuestionOrders: [0, 2, 3],
      assignedAnswerKeys: ['0', '2', '3'],
    });
    expect(out.map((x) => x.order)).toEqual([0, 2, 3]);
  });

  it('rejects a duplicate order', () => {
    expect(() =>
      resolveAssignedQuestions(vexSnap(), { assignedQuestionOrders: [0, 1, 1] }),
    ).toThrow(AssignedVariantError);
  });

  it('rejects a non-existent order', () => {
    expect(() =>
      resolveAssignedQuestions(vexSnap(), { assignedQuestionOrders: [0, 1, 99] }),
    ).toThrow(/inesistente/);
  });

  it('rejects a missing common question', () => {
    expect(() => resolveAssignedQuestions(vexSnap(), { assignedQuestionOrders: [1, 3] })).toThrow(
      /comune/,
    );
  });

  it('rejects two alternatives from the same group', () => {
    expect(() =>
      resolveAssignedQuestions(vexSnap(), { assignedQuestionOrders: [0, 1, 2, 3] }),
    ).toThrow(/gruppo/);
  });

  it('rejects a group with no assigned alternative', () => {
    // only g1 picked, g2 missing → group g2 has 0 assigned
    expect(() => resolveAssignedQuestions(vexSnap(), { assignedQuestionOrders: [0, 1] })).toThrow(
      /gruppo/,
    );
  });

  it('rejects an extraneous order (valid but not common nor a group pick shape)', () => {
    // 0 common, 1 (g1), 3 (g2), plus 4 (also g2) already covered by group check;
    // craft an extraneous by making a snapshot where order 5 exists but unused.
    const snap = vexSnap();
    snap.questions = [...snap.questions!, q(5)];
    expect(() => resolveAssignedQuestions(snap, { assignedQuestionOrders: [0, 1, 3, 5] })).toThrow(
      /estranei|gruppo/,
    );
  });

  it('rejects an incoherent assignedAnswerKeys', () => {
    expect(() =>
      resolveAssignedQuestions(vexSnap(), {
        assignedQuestionOrders: [0, 1, 3],
        assignedAnswerKeys: ['0', '1'],
      }),
    ).toThrow(/assignedAnswerKeys/);
  });

  it('accepts a coherent assignedAnswerKeys', () => {
    const out = resolveAssignedQuestions(vexSnap(), {
      assignedQuestionOrders: [0, 1, 3],
      assignedAnswerKeys: ['0', '1', '3'],
    });
    expect(out.map((x) => x.order)).toEqual([0, 1, 3]);
  });

  it('accepts alternatives with different maxCharacters (kept, not a criterion)', () => {
    const snap = vexSnap();
    snap.questions![1] = q(1, { maxCharacters: 500 });
    snap.questions![2] = q(2, { maxCharacters: 1200 });
    const out = resolveAssignedQuestions(snap, {
      assignedQuestionOrders: [0, 2, 3],
      assignedAnswerKeys: ['0', '2', '3'],
    });
    expect(out.find((x) => x.order === 2)?.maxCharacters).toBe(1200);
  });

  it('rejects a missing assignment for VEX (fail-closed, no fallback to full snapshot)', () => {
    expect(() => resolveAssignedQuestions(vexSnap(), {})).toThrow(AssignedVariantError);
  });

  it('rejects an empty VEX assignment when questions exist', () => {
    expect(() =>
      resolveAssignedQuestions(vexSnap(), {
        assignedQuestionOrders: [],
        assignedAnswerKeys: [],
      }),
    ).toThrow(/vuota/);
  });

  it.each([null, '', 'future_mode'])(
    'rejects malformed or unknown distributionMode %p',
    (distributionMode) => {
      const snapshot = { ...vexSnap(), distributionMode } as unknown as Snap;
      expect(() =>
        resolveAssignedQuestions(snapshot, {
          assignedQuestionOrders: [0, 1, 3],
          assignedAnswerKeys: ['0', '1', '3'],
        }),
      ).toThrow(/modalit/i);
    },
  );

  it('does not reinterpret same_questions as VEX when assignment fields are present', () => {
    const snapshot: Snap = {
      distributionMode: 'same_questions',
      questions: [q(2), q(0), q(1)],
    };
    expect(
      resolveAssignedQuestions(snapshot, {
        assignedQuestionOrders: [0],
        assignedAnswerKeys: ['0'],
      }).map((question) => question.order),
    ).toEqual([0, 1, 2]);
  });

  it('requires assignedAnswerKeys for VEX', () => {
    expect(() =>
      resolveAssignedQuestions(vexSnap(), { assignedQuestionOrders: [0, 1, 3] }),
    ).toThrow(/assignedAnswerKeys/);
  });

  it('rejects a snapshot where one question is outside common/groups', () => {
    const snapshot = vexSnap();
    snapshot.questions = [...snapshot.questions!, q(5)];
    expect(() =>
      resolveAssignedQuestions(snapshot, {
        assignedQuestionOrders: [0, 1, 3],
        assignedAnswerKeys: ['0', '1', '3'],
      }),
    ).toThrow(/estranee/);
  });
});
