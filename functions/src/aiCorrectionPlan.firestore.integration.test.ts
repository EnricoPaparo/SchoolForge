import { randomUUID, createHash } from 'node:crypto';
import { initializeApp, deleteApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildPlanDeps, reviewCheckpoint } from './aiCorrectionGateway.js';
import { computeSelectionHash } from './aiCorrectionEngine.js';
import {
  MAX_PLAN_SUBMISSIONS,
  MAX_PLAN_DOCUMENT_BYTES,
  planStorageUpperBound,
  terminalPlanSizeForecast,
  type CorrectionPlan,
  type PlanPorts,
} from './aiCorrectionPlan.js';

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
  async function recoveryCheckpoint(stage: 'primary' | 'secondary' = 'primary') {
    const id = randomUUID();
    const submissionId = `v1_${id}`;
    const oldRequestId = `source-${id}`;
    const newRequestId = `retry-${id}`;
    const correction = {
      status: 'in_progress',
      evaluations: {},
      generalFeedback: null,
      reopenCount: 0,
    };
    const baseline = createHash('sha256')
      .update(
        JSON.stringify([
          correction.status,
          correction.evaluations,
          correction.generalFeedback,
          correction.reopenCount,
        ]),
      )
      .digest('hex');
    const key = 'a'.repeat(64);
    const sourceRef = db.doc(`aiCorrectionRuns/${oldRequestId}`);
    const old = {
      runContractVersion: 3,
      selectionHash: computeSelectionHash(
        'v1',
        [submissionId],
        'balanced',
        'economy',
        undefined,
        true,
      ),
      status: 'failed',
      mode: 'openai',
      executionId: 'old-execution',
      leaseExpiresAt: 0,
      counts: {
        selected: 1,
        eligible: 1,
        excluded: 0,
        closedToGrade: 0,
        openToGrade: 1,
        closedOnlySubmissions: 0,
        alreadyGradedIgnored: 0,
        succeeded: 0,
        partial: 0,
        failed: 1,
      },
      tokensEstimated: 1000,
      tokensActual: 0,
      cost: 0,
      costSettledMicroUsd: 12345,
      resultOrdinals: [{ ordinal: 0, status: 'failed', reasonCode: 'provider_timeout' }],
      retry: {
        attemptsTotal: 2,
        retriesTotal: 1,
        unknownBillingAttempts: 2,
        retryReasonCodes: ['timeout'],
        retryDelayTotalMs: 250,
      },
      reviewStages: { [key]: { [stage]: { state: 'blocked' } } },
    };
    const primaryOutput = {
      requestId: oldRequestId,
      generalFeedback: 'Saved primary',
      results: [],
      usage: { inputTokens: 1, outputTokens: 1, tokens: 2 },
    };
    await db.doc(`corrections/${submissionId}`).set(correction);
    await sourceRef.set(old);
    const runRef = db.doc(`aiCorrectionRuns/${newRequestId}`);
    await runRef.set({
      status: 'running',
      executionId: 'new-execution',
      leaseExpiresAt: Date.now() + 540000,
    });
    const draftRef = db.doc(`corrections/${submissionId}/aiPendingDrafts/${key}`);
    await draftRef.set({
      baseline,
      requestId: oldRequestId,
      executionId: 'old-execution',
      [`${stage}State`]: 'blocked',
      ...(stage === 'secondary' ? { primaryState: 'completed', primaryOutput } : {}),
    });
    const port = reviewCheckpoint(db, submissionId, newRequestId, 'new-execution', oldRequestId);
    return {
      key,
      old,
      sourceRef,
      runRef,
      draftRef,
      port,
      primaryOutput,
      submissionId,
      oldRequestId,
      newRequestId,
    };
  }
  it('reclaims only the explicitly bound terminal blocked stage and never changes old accounting or lets an old worker finish it', async () => {
    const f = await recoveryCheckpoint();
    expect(
      await ports.terminalResult({
        verificationId: 'v1',
        submissionIds: [f.submissionId],
        requestId: f.oldRequestId,
        gradingMode: 'balanced',
      }),
    ).toMatchObject({
      status: 'failed',
      retry: { unknownBillingAttempts: 2 },
      results: [{ submissionId: f.submissionId, outcome: 'failed', reason: 'provider_timeout' }],
    });
    const implicit = reviewCheckpoint(db, f.submissionId, f.newRequestId, 'new-execution');
    await implicit.load(f.key);
    expect(await implicit.claim(f.key, 'primary')).toBe(false);
    await f.port.load(f.key);
    expect(await f.port.claim(f.key, 'primary')).toBe(true);
    expect(await f.port.claim(f.key, 'primary')).toBe(false);
    const stale = reviewCheckpoint(db, f.submissionId, f.oldRequestId, 'old-execution');
    await expect(stale.finish(f.key, 'primary', null, false)).rejects.toThrow(
      'Lost correction lease',
    );
    await f.port.finish(
      f.key,
      'primary',
      { requestId: f.newRequestId, results: [], generalFeedback: 'New result' },
      false,
    );
    expect((await f.sourceRef.get()).data()).toEqual(f.old);
    expect((await f.draftRef.get()).data()?.primaryState).toBe('completed');
  });
  it('preserves a completed primary output when only the failed secondary stage is retried', async () => {
    const f = await recoveryCheckpoint('secondary');
    expect((await f.port.load(f.key)).primary).toEqual(f.primaryOutput);
    expect(await f.port.claim(f.key, 'primary')).toBe(false);
    expect(await f.port.claim(f.key, 'secondary')).toBe(true);
    expect((await f.draftRef.get()).data()?.primaryOutput).toEqual(f.primaryOutput);
    expect((await f.sourceRef.get()).data()).toEqual(f.old);
  });
  it.each([
    'active',
    'lease',
    'invoked',
    'source',
    'success',
    'stage-crash',
    'baseline',
    'current-terminal',
    'unknown-code',
  ] as const)('refuses unsafe checkpoint recovery: %s', async (kind) => {
    const f = await recoveryCheckpoint();
    await f.port.load(f.key);
    if (kind === 'active') await f.sourceRef.update({ status: 'running' });
    if (kind === 'lease') await f.sourceRef.update({ leaseExpiresAt: Date.now() + 540000 });
    if (kind === 'invoked') await f.draftRef.update({ primaryState: 'invoked' });
    if (kind === 'source') await f.draftRef.update({ requestId: 'unrelated-source' });
    if (kind === 'success')
      await f.sourceRef.update({
        status: 'completed',
        resultOrdinals: [{ ordinal: 0, status: 'succeeded' }],
      });
    if (kind === 'stage-crash')
      await f.sourceRef.update({ [`reviewStages.${f.key}.primary.state`]: 'invoked' });
    if (kind === 'baseline')
      await db.doc(`corrections/${f.submissionId}`).update({ generalFeedback: 'Teacher edit' });
    if (kind === 'current-terminal') await f.runRef.update({ status: 'failed', leaseExpiresAt: 0 });
    if (kind === 'unknown-code')
      await f.sourceRef.update({
        resultOrdinals: [{ ordinal: 0, status: 'failed', reasonCode: 'untrusted-code' }],
      });
    expect(await f.port.claim(f.key, 'primary')).toBe(false);
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
  it('recovers an expanded legacy terminal timeout plan and serializes fresh recovery consent against draft replacement', async () => {
    const original = terminalPlanSizeForecast(plan('plan-timeouts-legacy'));
    for (const group of original.groups) {
      group.result!.status = 'failed';
      group.result!.results[0]!.outcome = 'failed';
      group.result!.results[0]!.reason = 'provider_timeout';
      group.result!.retry.unknownBillingAttempts = 2;
    }
    await ports.save(plan(original.planId));
    // Expanded deployed v1 format: no migration/reset of the original record.
    await db.doc(`aiCorrectionPlans/${original.planId}`).set(original);
    for (const group of original.groups)
      await db.doc(`aiCorrectionRuns/${group.request.requestId}`).set({
        runContractVersion: 3,
        selectionHash: 'c'.repeat(64),
        mode: 'openai',
        status: 'failed',
        leaseExpiresAt: 0,
        counts: group.result!.counts,
        tokensEstimated: 0,
        tokensActual: 0,
        cost: 0,
        resultOrdinals: [{ ordinal: 0, status: 'failed', reasonCode: 'provider_timeout' }],
        retry: group.result!.retry,
        reviewStages: { ['a'.repeat(64)]: { primary: { state: 'blocked' } } },
      });
    const sources = Object.fromEntries(
      original.groups.map((g) => [g.request.submissionIds[0]!, g.request.requestId]),
    );
    const fresh = {
      ...plan('plan-timeout-retry'),
      retryOfPlanId: original.planId,
      retrySources: sources,
    };
    fresh.groups = fresh.groups.slice(0, 1);
    fresh.settings.teacherGuidance = 'Changed recovery criteria create a fresh input hash';
    fresh.groups[0]!.request.teacherGuidance = fresh.settings.teacherGuidance;
    const firstSource = db.doc(`aiCorrectionRuns/${original.groups[0]!.request.requestId}`);
    await firstSource.update({ [`reviewStages.${'a'.repeat(64)}.primary.state`]: 'invoked' });
    await expect(ports.save(fresh)).rejects.toMatchObject({ code: 'plan_ambiguous' });
    await firstSource.update({ [`reviewStages.${'a'.repeat(64)}.primary.state`]: 'blocked' });
    await ports.save(fresh);
    const edited = {
      ...plan('plan-timeout-edited'),
      retryOfPlanId: original.planId,
      retrySources: sources,
    };
    edited.groups = edited.groups.slice(1);
    await expect(
      ports.save({ ...edited, retrySources: { v1_s1: 'forged-source' } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    const outcomes = await Promise.allSettled([
      ports.update(fresh.planId, (current) => {
        current.consented = true;
        current.groups[0]!.state = 'running';
        return current;
      }),
      ports.save(edited),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.doc(`aiCorrectionPlans/${original.planId}`).get()).data()).toEqual(original);
    expect((await ports.load('owner', 'v1'))?.retrySources).toEqual(sources);
    const wrongOwner = { ...edited, planId: 'plan-other-owner', ownerUid: 'other-owner' };
    await expect(ports.save(wrongOwner)).rejects.toMatchObject({ code: 'plan_changed' });
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
  it('persists and reloads the maximum single-student plan through its worst terminal growth below Firestore capacity', async () => {
    const maximum = plan('plan-storage-bound');
    maximum.verificationId = 'v'.repeat(180);
    maximum.settings.teacherGuidance = '😀\\"\n'.repeat(100);
    const ids = Array.from(
      { length: MAX_PLAN_SUBMISSIONS },
      (_, i) => `${maximum.verificationId}_${String(i).padStart(19, '0')}`,
    );
    maximum.groups = ids.map((id, i) => ({
      request: {
        ...maximum.settings,
        verificationId: maximum.verificationId,
        requestId: `child-${String(i).padStart(26, '0')}`,
        gradingMode: 'balanced',
        submissionIds: [id],
      },
      state: 'pending',
      sourceHash: 'b'.repeat(64),
      maximumCostMicroUsd: 0,
      tokensEstimated: 0,
    }));
    maximum.preview.verificationId = maximum.verificationId;
    maximum.preview.counts.selected = MAX_PLAN_SUBMISSIONS;
    maximum.preview.counts.eligible = MAX_PLAN_SUBMISSIONS;
    maximum.budget = {
      reason: 'daily_budget_exceeded',
      availableMicroUsd: 1,
      compatibleSubmissionIds: ids,
    };
    const terminal = terminalPlanSizeForecast(maximum);
    expect(planStorageUpperBound(terminal)).toBeLessThan(MAX_PLAN_DOCUMENT_BYTES);
    await ports.save(maximum);
    await ports.update(maximum.planId, () => terminal);
    expect(await ports.load(maximum.ownerUid, maximum.verificationId)).toEqual(terminal);
    const persisted = (await db.doc(`aiCorrectionPlans/${maximum.planId}`).get()).data()!;
    expect(persisted.storageVersion).toBe(1);
    expect(persisted.groups[0].request).not.toHaveProperty('teacherGuidance');
    expect(persisted.groups[0].result.results[0]).not.toHaveProperty('submissionId');
  });
  it('reads an expanded legacy checkpoint and compacts it on update without shifting child IDs', async () => {
    const legacy = plan('plan-legacy');
    await db.doc(`aiCorrectionPlans/${legacy.planId}`).set(legacy);
    expect(await ports.load('owner', 'v1', legacy.planId)).toEqual(legacy);
    await ports.update(legacy.planId, (current) => {
      current.groups[0]!.state = 'completed';
      return current;
    });
    const loaded = await ports.load('owner', 'v1', legacy.planId);
    expect(loaded?.groups.map((g) => g.request.requestId)).toEqual(
      legacy.groups.map((g) => g.request.requestId),
    );
    expect((await db.doc(`aiCorrectionPlans/${legacy.planId}`).get()).data()?.storageVersion).toBe(
      1,
    );
  });
});
