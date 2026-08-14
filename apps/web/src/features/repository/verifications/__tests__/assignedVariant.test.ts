import { describe, expect, it } from 'vitest';
import type {
  VerificationTeacherQuestionSnapshot,
  VerificationTeacherSnapshot,
} from '../../../../types/firestore.js';
import {
  AssignedVariantError,
  isServerResolvedSnapshot,
  resolveAssignedQuestions,
} from '../assignedVariant.js';

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
      /estranee|gruppo/,
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

/**
 * VDIF-04 — uno snapshot differenziato è **risolto dal server** anche quando
 * `distributionMode` è `same_questions`: restituire tutte le domande sarebbe
 * fail-open, e consegnerebbe a chi corregge un insieme che a quello studente non
 * è mai stato servito.
 */
describe('resolveAssignedQuestions — snapshot differenziato (VDIF-04)', () => {
  const differentiatedSnapshot = {
    distributionMode: 'same_questions' as const,
    questions: [
      {
        order: 0,
        tipo: 'aperta' as const,
        maxPoints: 2,
        difficolta: 2 as const,
        testo: 'Q0',
        soluzione: 'a',
      },
      {
        order: 1,
        tipo: 'aperta' as const,
        maxPoints: 2,
        difficolta: 2 as const,
        testo: 'Q1',
        soluzione: 'b',
      },
      {
        order: 2,
        tipo: 'aperta' as const,
        maxPoints: 2,
        difficolta: 2 as const,
        testo: 'ALT',
        soluzione: 'c',
      },
    ],
    commonQuestionOrders: [0, 1],
    equivalentGroups: [],
    differentiation: {
      version: 1 as const,
      questions: [{ baseOrder: 1, choices: { L1: { kind: 'alternative' as const, order: 2 } } }],
      labels: [{ labelId: 'L1', labelName: 'Percorso A' }],
      differentiatedAlternativeOrders: [2],
    },
  };

  it('restituisce solo le domande assegnate, non tutto lo snapshot', () => {
    const result = resolveAssignedQuestions(differentiatedSnapshot, {
      assignedQuestionOrders: [0, 2],
      assignedAnswerKeys: ['0', '2'],
    });
    expect(result.map((q) => q.order)).toEqual([0, 2]);
  });

  it('lo studente senza etichetta riceve la base, non l’alternativa', () => {
    const result = resolveAssignedQuestions(differentiatedSnapshot, {
      assignedQuestionOrders: [0, 1],
      assignedAnswerKeys: ['0', '1'],
    });
    expect(result.map((q) => q.order)).toEqual([0, 1]);
  });

  it('un’omissione è ammessa: la cardinalità non è più fissa', () => {
    const result = resolveAssignedQuestions(differentiatedSnapshot, {
      assignedQuestionOrders: [0],
      assignedAnswerKeys: ['0'],
    });
    expect(result.map((q) => q.order)).toEqual([0]);
  });

  it('fail-closed: assegnazione mancante su uno snapshot differenziato', () => {
    expect(() =>
      resolveAssignedQuestions(differentiatedSnapshot, {
        assignedQuestionOrders: undefined,
        assignedAnswerKeys: undefined,
      }),
    ).toThrow(AssignedVariantError);
  });

  it('fail-closed: assegnazione vuota', () => {
    expect(() =>
      resolveAssignedQuestions(differentiatedSnapshot, {
        assignedQuestionOrders: [],
        assignedAnswerKeys: [],
      }),
    ).toThrow(AssignedVariantError);
  });

  it('fail-closed: order estraneo a comuni, gruppi e alternative dichiarate', () => {
    const tampered = {
      ...differentiatedSnapshot,
      differentiation: {
        ...differentiatedSnapshot.differentiation,
        differentiatedAlternativeOrders: [],
      },
    };
    expect(() =>
      resolveAssignedQuestions(tampered, {
        assignedQuestionOrders: [0, 2],
        assignedAnswerKeys: ['0', '2'],
      }),
    ).toThrow(AssignedVariantError);
  });

  it('isServerResolvedSnapshot copre VEX, differenziazione ed entrambe', () => {
    expect(isServerResolvedSnapshot(differentiatedSnapshot)).toBe(true);
    expect(
      isServerResolvedSnapshot({
        distributionMode: 'equivalent_variants',
        differentiation: undefined,
      }),
    ).toBe(true);
    expect(
      isServerResolvedSnapshot({ distributionMode: 'same_questions', differentiation: undefined }),
    ).toBe(false);
  });
});
