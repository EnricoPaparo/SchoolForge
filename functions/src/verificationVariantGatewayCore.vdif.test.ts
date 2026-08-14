import { describe, expect, it } from 'vitest';
import {
  decideAssignment,
  runAssignVariant,
  submissionIdFor,
  type AssignVariantDeps,
  type StudentContext,
  type VerificationContext,
} from './verificationVariantGatewayCore.js';

/**
 * VDIF-04 — la callable `assignVerificationVariant` end-to-end su una verifica
 * differenziata. Idempotenza, replay e retry restano quelli di VEX: cambia il
 * criterio di calcolo, non il contratto di scrittura.
 */

const OWNER = 'owner-1';
const VID = 'ver-1';
const LABELLED = 'stud-etichettato';
const UNLABELLED = 'stud-senza';

function q(order: number) {
  return { order, tipo: 'aperta' as const, maxPoints: 2, difficolta: 2, testo: `t${order}` };
}

/** Q0 comune, Q1 comune differenziata, Q2 alternativa di Q1 per L1. */
function differentiatedSnapshotRaw() {
  return {
    distributionMode: 'same_questions',
    questions: [q(0), q(1), q(2)],
    commonQuestionOrders: [0, 1],
    equivalentGroups: [],
    differentiation: {
      version: 1,
      questions: [{ baseOrder: 1, choices: { L1: { kind: 'alternative', order: 2 } } }],
      labels: [{ labelId: 'L1', labelName: 'Percorso A' }],
      differentiatedAlternativeOrders: [2],
    },
    labelAssignments: { version: 1, byStudentUid: { [LABELLED]: 'L1' } },
  };
}

function verification(over: Partial<VerificationContext> = {}): VerificationContext {
  return {
    ownerUid: OWNER,
    status: 'active',
    onlineEnabled: true,
    visibility: 'public',
    classId: 'class-a',
    title: 'Verifica',
    className: 'Classe A',
    teacherSnapshotRaw: differentiatedSnapshotRaw(),
    ...over,
  };
}

function student(over: Partial<StudentContext> = {}): StudentContext {
  return { ownerUid: OWNER, status: 'approved', classId: 'class-a', ...over };
}

function harness(callerUid: string, seedOrders?: number[]) {
  const store = new Map<string, { assignedQuestionOrders?: number[] }>();
  if (seedOrders) {
    store.set(submissionIdFor(VID, callerUid), { assignedQuestionOrders: seedOrders });
  }
  let writes = 0;
  const deps: AssignVariantDeps = {
    callerUid,
    portalEnabled: async () => true,
    loadVerification: async () => verification(),
    loadStudent: async () => student(),
    randomIntBelow: () => 0,
    persistAssignment: async (input) => {
      const current = store.get(input.submissionId);
      const existing = current
        ? { exists: true as const, assignedQuestionOrders: current.assignedQuestionOrders }
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
      store.set(input.submissionId, { assignedQuestionOrders: decision.assignedQuestionOrders });
      writes += 1;
      return { assignedQuestionOrders: decision.assignedQuestionOrders, writes: 1 };
    },
  };
  return { deps, store, writesTotal: () => writes };
}

describe('assignVerificationVariant — verifica differenziata', () => {
  it('lo studente etichettato riceve l’alternativa, non la base', async () => {
    const h = harness(LABELLED);
    const res = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(res.assignmentMode).toBe('server_resolved');
    expect(res.assignedQuestionOrders).toEqual([0, 2]);
    expect(res.questions.map((question) => question.order)).toEqual([0, 2]);
  });

  it('lo studente senza etichetta riceve la base', async () => {
    const h = harness(UNLABELLED);
    const res = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(res.assignedQuestionOrders).toEqual([0, 1]);
  });

  it('la risposta non contiene mai l’alternativa di un altro percorso', async () => {
    const h = harness(UNLABELLED);
    const res = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(res.questions.map((question) => question.order)).not.toContain(2);
  });

  it('T23 — replay: seconda chiamata, stessa assegnazione, zero scritture', async () => {
    const h = harness(LABELLED);
    const first = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(h.writesTotal()).toBe(1);
    const second = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(second.assignedQuestionOrders).toEqual(first.assignedQuestionOrders);
    expect(h.writesTotal()).toBe(1);
  });

  it('T25 — risposta persa dopo il commit: il retry riusa, non riassegna', async () => {
    // Lo stato persistito esiste già: è indistinguibile da una risposta persa.
    const h = harness(LABELLED, [0, 2]);
    const res = await runAssignVariant({ verificationId: VID }, h.deps);
    expect(res.assignedQuestionOrders).toEqual([0, 2]);
    expect(h.writesTotal()).toBe(0);
  });

  it('un’assegnazione persistita incoerente con l’etichetta è fail-closed, mai rigenerata', async () => {
    // [0, 1] è il percorso base: per uno studente etichettato L1 è incoerente.
    const h = harness(LABELLED, [0, 1]);
    await expect(runAssignVariant({ verificationId: VID }, h.deps)).rejects.toThrow(/non coerente/);
    expect(h.writesTotal()).toBe(0);
  });

  it('due studenti diversi ricevono insiemi diversi dallo stesso snapshot', async () => {
    const labelled = await runAssignVariant({ verificationId: VID }, harness(LABELLED).deps);
    const plain = await runAssignVariant({ verificationId: VID }, harness(UNLABELLED).deps);
    expect(labelled.assignedQuestionOrders).not.toEqual(plain.assignedQuestionOrders);
  });

  it('la risposta non porta alcun termine vietato dal perimetro privacy', async () => {
    const res = await runAssignVariant({ verificationId: VID }, harness(LABELLED).deps);
    const serialized = JSON.stringify(res);
    for (const forbidden of [
      'labelId',
      'labelName',
      'labels',
      'differentiation',
      'differentiated',
      'Percorso A',
      'byStudentUid',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('lo studente di un altro docente resta negato anche con la differenziazione', async () => {
    const h = harness(LABELLED);
    const deps: AssignVariantDeps = {
      ...h.deps,
      loadStudent: async () => student({ ownerUid: 'altro-owner' }),
    };
    await expect(runAssignVariant({ verificationId: VID }, deps)).rejects.toThrow(
      /non autorizzato/,
    );
  });
});
