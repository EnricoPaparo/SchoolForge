import { randomUUID } from 'node:crypto';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildPlanDeps } from './aiCorrectionGateway.js';
import type { CorrectionPlan, PlanPorts } from './aiCorrectionPlan.js';

const emulatorDescribe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
function plan(id: string): CorrectionPlan {
  return {
    version: 1,
    ownerUid: 'owner',
    verificationId: 'v1',
    planId: id,
    expiresAtMs: Date.now() + 86400000,
    configHash: 'a'.repeat(64),
    selectionHash: id,
    consented: false,
    settings: { modelProfile: 'economy', gradingMode: 'balanced', advancedReview: false },
    preview: {
      mode: 'mock',
      phase: 'preview',
      requestId: id,
      verificationId: 'v1',
      maximumCostMicroUsd: 0,
      advancedReview: false,
      counts: {
        selected: 2,
        eligible: 2,
        excluded: 0,
        closedToGrade: 0,
        openToGrade: 2,
        closedOnlySubmissions: 0,
        alreadyGradedIgnored: 0,
      },
      tokensEstimated: 0,
      costEstimated: 0,
      inputTokensEstimated: 0,
      outputTokensEstimated: 0,
      totalTokensEstimated: 0,
      costEstimatedMicroUsd: 0,
      excluded: [],
    },
    groups: [0, 1].map((n) => ({
      request: {
        verificationId: 'v1',
        requestId: `${id}-group-${n}`,
        submissionIds: [`v1_s${n}`],
        gradingMode: 'balanced',
        modelProfile: 'economy',
        advancedReview: false,
      },
      sourceHash: 'b'.repeat(64),
      maximumCostMicroUsd: 0,
      tokensEstimated: 0,
      state: 'pending',
    })),
  };
}
emulatorDescribe('correction plan Admin transactions', () => {
  let app: App;
  let db: Firestore;
  let ports: PlanPorts;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-schoolforge-correction-plan' }, randomUUID());
    db = getFirestore(app);
    ports = buildPlanDeps({ auth: { uid: 'owner' } } as CallableRequest, db).plans;
  });
  beforeEach(async () => {
    for (const name of ['aiCorrectionPlans', 'aiCorrectionPlanHeads']) {
      const refs = await db.collection(name).listDocuments();
      await Promise.all(refs.map((ref) => ref.delete()));
    }
  });
  afterAll(async () => {
    await deleteApp(app);
  });
  it('serializes a head replacement racing a group start so exactly one may proceed', async () => {
    await ports.save(plan('plan-original'));
    const outcomes = await Promise.allSettled([
      ports.update('plan-original', (current) => {
        current.consented = true;
        current.groups[0]!.state = 'running';
        return current;
      }),
      ports.save(plan('plan-replacement')),
    ]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const head = await ports.load('owner', 'v1');
    if (head?.planId === 'plan-original') expect(head.groups[0]!.state).toBe('running');
    else
      expect((await ports.load('owner', 'v1', 'plan-original'))?.groups[0]!.state).toBe('pending');
  });
  it('blocks new heads while any group has an unknown outcome, including disjoint selections, and allows terminal recovery', async () => {
    await ports.save(plan('plan-original'));
    await ports.update('plan-original', (p) => {
      p.groups[0]!.state = 'running';
      return p;
    });
    const replacement = plan('plan-disjoint');
    replacement.groups.forEach((g) => {
      g.request.submissionIds = ['v1_other'];
    });
    await expect(ports.save(replacement)).rejects.toMatchObject({ code: 'plan_ambiguous' });
    await ports.update('plan-original', (p) => {
      p.groups[0]!.state = 'completed';
      return p;
    });
    await ports.save(replacement);
    await expect(
      ports.update('plan-original', (p) => {
        p.groups[1]!.state = 'running';
        return p;
      }),
    ).rejects.toMatchObject({ code: 'plan_changed' });
    expect(await ports.load('other-owner', 'v1', replacement.planId)).toBeNull();
  });
  it('rejects conflicting reuse of a plan ID and returns an identical saved plan for a harmless retry', async () => {
    const original = plan('plan-original');
    await ports.save(original);
    expect((await ports.save(original)).selectionHash).toBe(original.selectionHash);
    await expect(ports.save({ ...original, selectionHash: 'changed' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
    await expect(ports.save({ ...original, ownerUid: 'other' })).rejects.toMatchObject({
      code: 'invalid_input',
    });
  });
});
