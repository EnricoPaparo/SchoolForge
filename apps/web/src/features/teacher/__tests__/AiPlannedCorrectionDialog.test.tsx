import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
import { AiBatchCorrectionDialog } from '../AiBatchCorrectionDialog.js';
import type {
  AiCorrectionCallables,
  AiCorrectionPlanView,
  AiPlanGroupAction,
  AiRunResult,
} from '../../repository/corrections/aiCorrectionClient.js';

afterEach(cleanup);
function planFixture(): AiCorrectionPlanView {
  return {
    planId: 'plan-original-id',
    verificationId: 'v1',
    expiresAtMs: Date.now() + 86400000,
    consented: false,
    settings: {
      modelProfile: 'quality',
      gradingMode: 'rigorous',
      teacherGuidance: 'Guidance originale',
      advancedReview: true,
    },
    preview: {
      mode: 'openai',
      phase: 'preview',
      requestId: 'plan-original-id',
      verificationId: 'v1',
      counts: {
        selected: 7,
        eligible: 7,
        excluded: 0,
        openToGrade: 7,
        closedToGrade: 0,
        closedOnlySubmissions: 0,
        alreadyGradedIgnored: 2,
      },
      tokensEstimated: 700,
      costEstimated: 0.07,
      maximumCostMicroUsd: 700000,
      excluded: [],
    },
    groups: [[1, 2, 3], [4, 5, 6], [7]].map((students, i) => ({
      requestId: `child-stable-${i}`,
      submissionIds: students.map((n) => `v1_s${n}`),
      maximumCostMicroUsd: students.length * 100000,
      state: 'pending',
    })),
  };
}
function harness(initial: AiCorrectionPlanView | null = null) {
  let saved = initial ? structuredClone(initial) : null;
  const preview = vi.fn<NonNullable<AiCorrectionCallables['planPreview']>>(async (request) => {
    saved = planFixture();
    saved.planId = request.requestId;
    saved.settings = {
      modelProfile: request.modelProfile,
      gradingMode: request.gradingMode,
      teacherGuidance: request.teacherGuidance,
      advancedReview: request.advancedReview,
    };
    return structuredClone(saved);
  });
  const status = vi.fn<NonNullable<AiCorrectionCallables['planStatus']>>(async () =>
    structuredClone(saved),
  );
  function complete(action: AiPlanGroupAction) {
    saved!.consented = true;
    const group = saved!.groups[action.groupIndex]!;
    group.state = 'completed';
    group.result = {
      mode: 'openai',
      phase: 'run',
      requestId: group.requestId,
      verificationId: 'v1',
      status: 'completed',
      idempotentReplay: false,
      counts: {
        ...saved!.preview.counts,
        selected: group.submissionIds.length,
        eligible: group.submissionIds.length,
        succeeded: group.submissionIds.length,
        partial: 0,
        failed: 0,
      },
      tokensEstimated: 300,
      tokensActual: 200,
      costActual: 0.01,
      costSettledMicroUsd: 10000,
      results: group.submissionIds.map((id) => ({
        submissionId: id,
        outcome: 'succeeded',
        openGraded: 1,
        closedGraded: 0,
        openSkipped: 0,
        alreadyIgnored: 0,
      })),
    };
    return structuredClone(saved!);
  }
  const runGroup = vi.fn<NonNullable<AiCorrectionCallables['planRunGroup']>>(async (action) =>
    complete(action),
  );
  const callables: AiCorrectionCallables = {
    preview: vi.fn(),
    run: vi.fn(),
    planPreview: preview,
    planStatus: status,
    planRunGroup: runGroup,
  };
  const props = {
    verificationId: 'v1',
    ownerUid: 'owner',
    submissionIds: planFixture().groups.flatMap((g) => g.submissionIds),
    submissionLabels: { v1_s1: 'Studente Uno' },
    callables,
    onClose: vi.fn(),
    onApplied: vi.fn<(result: AiRunResult) => void>(),
  };
  return { props, preview, status, runGroup, complete, getSaved: () => saved };
}

describe('planned correction UI', () => {
  it('keeps edited criteria open on backdrop and Escape while explicit cancel still works', async () => {
    const h = harness();
    render(<AiBatchCorrectionDialog {...h.props} />);
    const guidance = await screen.findByLabelText('Indicazioni aggiuntive per la correzione');
    fireEvent.change(guidance, { target: { value: 'Criteri da non perdere.' } });
    const dialog = screen.getByRole('dialog', { name: 'Correggi con IA' });
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(h.props.onClose).not.toHaveBeenCalled();
    expect((guidance as HTMLTextAreaElement).value).toBe('Criteri da non perdere.');
    expect(h.preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
  });

  it('does not interrupt server groups on outside click or Escape while running', async () => {
    const p = planFixture();
    p.consented = true;
    const h = harness(p);
    let resolve!: (plan: AiCorrectionPlanView) => void;
    h.runGroup.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    render(<AiBatchCorrectionDialog {...h.props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprendi correzione' }));
    await waitFor(() => expect(h.runGroup).toHaveBeenCalledTimes(1));
    const dialog = screen.getByRole('dialog', { name: 'Correggi con IA' });
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(h.props.onClose).not.toHaveBeenCalled();
    await act(async () => resolve(h.complete(h.runGroup.mock.calls[0]![0])));
    await screen.findByText('Correzione completata.');
    expect(h.runGroup.mock.calls.map(([action]) => action.groupIndex)).toEqual([0, 1, 2]);
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(h.props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
  });

  it('allows explicit cancellation from the confirmation without starting a group', async () => {
    const h = harness();
    render(<AiBatchCorrectionDialog {...h.props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Calcola stima' }));
    await screen.findByRole('button', { name: 'Conferma correzione' });
    const dialog = screen.getByRole('dialog', { name: 'Correggi con IA' });
    fireEvent.click(dialog.parentElement!);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(h.props.onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(h.props.onClose).toHaveBeenCalledTimes(1);
    expect(h.runGroup).not.toHaveBeenCalled();
  });

  it('confirms the total and each server group once, shows student progress and accounts completed groups', async () => {
    const h = harness();
    render(<AiBatchCorrectionDialog {...h.props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Calcola stima' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Conferma correzione' }));
    await screen.findByText('Correzione completata.');
    expect(h.preview).toHaveBeenCalledTimes(1);
    expect(
      h.runGroup.mock.calls.map(([a]) => [
        a.planId,
        a.groupIndex,
        a.maximumCostMicroUsd,
        a.groupMaximumCostMicroUsd,
      ]),
    ).toEqual([
      [h.getSaved()!.planId, 0, 700000, 300000],
      [h.getSaved()!.planId, 1, 700000, 300000],
      [h.getSaved()!.planId, 2, 700000, 100000],
    ]);
    expect(screen.getByText('Studente Uno: corretta')).toBeTruthy();
    expect(screen.getByText(/Consegne elaborate: 7 di 7/)).toBeTruthy();
    expect(h.props.onApplied).toHaveBeenCalledTimes(3);
  });
  it('recovers a lost response after close/reopen without a new preview, preserving child identity and original criteria', async () => {
    const original = planFixture();
    original.consented = true;
    const h = harness(original);
    h.runGroup.mockImplementationOnce(async (action) => {
      h.complete(action);
      throw new Error('lost response');
    });
    const view = render(<AiBatchCorrectionDialog {...h.props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprendi correzione' }));
    await screen.findByRole('alert');
    expect(screen.getByText(/Consegne elaborate: 3 di 7/)).toBeTruthy();
    view.unmount();
    render(<AiBatchCorrectionDialog {...h.props} />);
    expect(await screen.findByText(/Qualità · Rigoroso · Revisione avanzata attiva/)).toBeTruthy();
    expect(screen.getByText('Guidance originale')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Riprendi correzione' }));
    await screen.findByText('Correzione completata.');
    expect(h.preview).not.toHaveBeenCalled();
    expect(h.runGroup.mock.calls.map(([a]) => a.groupIndex)).toEqual([0, 1, 2]);
    expect(h.getSaved()!.groups.map((g) => g.requestId)).toEqual(
      original.groups.map((g) => g.requestId),
    );
  });
  it('stops after the in-flight group and resumes only on an explicit action', async () => {
    const p = planFixture();
    p.consented = true;
    const h = harness(p);
    let resolve!: (plan: AiCorrectionPlanView) => void;
    h.runGroup.mockImplementationOnce(
      (action) =>
        new Promise((r) => {
          resolve = r;
          h.getSaved()!.groups[action.groupIndex]!.state = 'running';
        }),
    );
    render(<AiBatchCorrectionDialog {...h.props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprendi correzione' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ferma dopo il gruppo corrente' }));
    await act(async () => resolve(h.complete(h.runGroup.mock.calls[0]![0])));
    await screen.findByRole('button', { name: 'Riprendi correzione' });
    expect(h.runGroup).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Consegne elaborate: 3 di 7/)).toBeTruthy();
  });
  it('disables the full confirmation when budget is insufficient and prepares the explicit compatible subset with fresh consent', async () => {
    const plan = planFixture();
    plan.budget = {
      reason: 'daily_budget_exceeded',
      availableMicroUsd: 300000,
      compatibleSubmissionIds: ['v1_s1', 'v1_s2', 'v1_s3'],
    };
    const h = harness(plan);
    render(<AiBatchCorrectionDialog {...h.props} />);
    expect(
      ((await screen.findByRole('button', { name: 'Conferma correzione' })) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText(/Il budget giornaliero disponibile non basta per l’intera selezione/),
    ).toBeTruthy();
    expect(screen.queryByText(/Riprova domani/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Prepara piano per 3 consegne' }));
    await waitFor(() => expect(h.preview).toHaveBeenCalledTimes(1));
    expect(h.preview.mock.calls[0]![0].submissionIds).toEqual(plan.budget.compatibleSubmissionIds);
    expect(h.preview.mock.calls[0]![0].requestId).not.toBe(plan.planId);
    expect(h.runGroup).not.toHaveBeenCalled();
  });
  it('does not continue an in-flight plan when the authenticated owner changes', async () => {
    const plan = planFixture();
    plan.consented = true;
    const h = harness(plan);
    let resolve!: (plan: AiCorrectionPlanView) => void;
    h.runGroup.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = render(<AiBatchCorrectionDialog {...h.props} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Riprendi correzione' }));
    await waitFor(() => expect(h.runGroup).toHaveBeenCalledTimes(1));
    h.status.mockResolvedValueOnce(null);
    view.rerender(<AiBatchCorrectionDialog {...h.props} ownerUid="different-owner" />);
    await screen.findByRole('button', { name: 'Calcola stima' });
    await act(async () => resolve(h.complete(h.runGroup.mock.calls[0]![0])));
    expect(h.runGroup).toHaveBeenCalledTimes(1);
    expect(h.props.onApplied).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Calcola stima' })).toBeTruthy();
  });
});
