import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

import { AiBatchCorrectionDialog } from '../AiBatchCorrectionDialog.js';
import type {
  AiCorrectionCallables,
  AiCorrectionRequest,
  AiPreviewResult,
  AiRunResult,
} from '../../repository/corrections/aiCorrectionClient.js';

/**
 * M5-03/M5-05 — test del dialog batch «Correggi con IA» (mock e OpenAI).
 *
 * Verifica: payload chiuso (solo i tre ID), preview→conferma→run con lo **stesso**
 * requestId, annulla senza run, singola chiamata a `run` con protezione
 * anti-doppio-click, gestione di completed/partial/failed/running/replay,
 * tokensActual e costo reale 0 in mock.
 */

const VERIFICATION_ID = 'ver1';
const SUBMISSION_IDS = ['ver1_s1', 'ver1_s2'];

function makePreview(overrides: Partial<AiPreviewResult> = {}): AiPreviewResult {
  return {
    mode: 'mock',
    phase: 'preview',
    requestId: 'placeholder',
    verificationId: VERIFICATION_ID,
    counts: {
      selected: 2,
      eligible: 2,
      excluded: 0,
      closedToGrade: 3,
      openToGrade: 4,
      closedOnlySubmissions: 0,
      alreadyGradedIgnored: 1,
    },
    tokensEstimated: 1234,
    costEstimated: 0,
    excluded: [],
    ...overrides,
  };
}

function makeRun(overrides: Partial<AiRunResult> = {}): AiRunResult {
  return {
    mode: 'mock',
    phase: 'run',
    requestId: 'placeholder',
    verificationId: VERIFICATION_ID,
    status: 'completed',
    idempotentReplay: false,
    counts: {
      selected: 2,
      eligible: 2,
      excluded: 0,
      closedToGrade: 3,
      openToGrade: 4,
      closedOnlySubmissions: 0,
      alreadyGradedIgnored: 1,
      succeeded: 2,
      partial: 0,
      failed: 0,
    },
    tokensEstimated: 1234,
    tokensActual: 0,
    costActual: 0,
    results: [
      {
        submissionId: 'ver1_s1',
        outcome: 'succeeded',
        closedGraded: 2,
        openGraded: 2,
        openSkipped: 0,
        alreadyIgnored: 0,
      },
      {
        submissionId: 'ver1_s2',
        outcome: 'succeeded',
        closedGraded: 1,
        openGraded: 2,
        openSkipped: 0,
        alreadyIgnored: 1,
      },
    ],
    ...overrides,
  };
}

function makeCallables(
  preview: () => Promise<AiPreviewResult>,
  run: () => Promise<AiRunResult>,
): {
  callables: AiCorrectionCallables;
  previewSpy: Mock<[AiCorrectionRequest], Promise<AiPreviewResult>>;
  runSpy: Mock<[AiCorrectionRequest], Promise<AiRunResult>>;
} {
  const previewSpy: Mock<[AiCorrectionRequest], Promise<AiPreviewResult>> = vi.fn(
    (_req: AiCorrectionRequest) => preview(),
  );
  const runSpy: Mock<[AiCorrectionRequest], Promise<AiRunResult>> = vi.fn(
    (_req: AiCorrectionRequest) => run(),
  );
  return {
    callables: { preview: previewSpy, run: runSpy },
    previewSpy,
    runSpy,
  };
}

async function calculatePreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
  await screen.findByText(/Elaborabili:/);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AiBatchCorrectionDialog (M5-03)', () => {
  it('sends only the three closed IDs to preview and shows the mock banner', async () => {
    const { callables, previewSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    expect(previewSpy).toHaveBeenCalledTimes(1);
    const payload = previewSpy.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual([
      'gradingMode',
      'modelProfile',
      'requestId',
      'submissionIds',
      'verificationId',
    ]);
    expect(payload.verificationId).toBe(VERIFICATION_ID);
    expect(payload.submissionIds).toEqual(SUBMISSION_IDS);
    expect(payload.gradingMode).toBe('balanced'); // default
    expect(payload.modelProfile).toBe('quality'); // TWU-02 default profile
    // The client never sends a raw model id or price list.
    expect('model' in payload).toBe(false);
    expect('priceListVersion' in payload).toBe(false);
    expect(typeof payload.requestId).toBe('string');
    expect(payload.requestId.length).toBeGreaterThan(0);
    expect(screen.getByText('Modalità mock — costo reale 0')).toBeTruthy();
  });

  it('shows the real OpenAI mode and USD estimate without a mock label', async () => {
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview({ mode: 'openai', costEstimated: 0.000676 })),
      () => Promise.resolve(makeRun({ mode: 'openai' })),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    expect(
      screen.getByText('Modalità OpenAI — il costo reale sarà registrato dopo l’esecuzione'),
    ).toBeTruthy();
    expect(screen.getByText('Costo stimato: 0.000676 USD')).toBeTruthy();
    expect(screen.queryByText('Modalità mock — costo reale 0')).toBeNull();
  });

  it('renders edit and confirm inside a shared .dialog-actions row', async () => {
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await calculatePreview();
    const primary = await screen.findByRole('button', { name: 'Conferma correzione' });
    const edit = screen.getByRole('button', { name: 'Modifica impostazioni' });
    const actions = edit.closest('.dialog-actions');
    expect(actions).not.toBeNull();
    expect(actions).toBe(primary.closest('.dialog-actions'));
  });

  it('confirms with a single run call using the same requestId, showing tokensActual/cost 0', async () => {
    const { callables, previewSpy, runSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    const onApplied = vi.fn();
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={onApplied}
      />,
    );

    await calculatePreview();
    const confirm = await screen.findByRole('button', { name: 'Conferma correzione' });
    fireEvent.click(confirm);

    await screen.findByText('Correzione completata.');
    expect(runSpy).toHaveBeenCalledTimes(1);
    // Stesso requestId di preview.
    expect(runSpy.mock.calls[0][0].requestId).toBe(previewSpy.mock.calls[0][0].requestId);
    expect(screen.getByText('Token reali: 0 (mock)')).toBeTruthy();
    expect(screen.getByText('Costo reale: 0 (mock)')).toBeTruthy();
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('uses the same teacher guidance for preview/run and invalidates the request when it changes', async () => {
    const { callables, previewSpy, runSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    const guidance = screen.getByLabelText('Indicazioni aggiuntive per la correzione');
    fireEvent.change(guidance, { target: { value: 'Premia soprattutto il ragionamento.' } });
    await calculatePreview();
    const firstRequestId = previewSpy.mock.calls[0][0].requestId;

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Premia soprattutto il ragionamento.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Modifica impostazioni' }));
    const editableGuidance = screen.getByLabelText('Indicazioni aggiuntive per la correzione');
    fireEvent.change(editableGuidance, {
      target: { value: 'Premia soprattutto gli esempi pertinenti.' },
    });
    expect(screen.getByRole('button', { name: 'Calcola stima' })).toBeTruthy();
    await calculatePreview();
    expect(previewSpy).toHaveBeenCalledTimes(2);
    const previewRequest = previewSpy.mock.calls[1][0];
    expect(previewRequest.requestId).not.toBe(firstRequestId);
    expect(previewRequest.teacherGuidance).toBe('Premia soprattutto gli esempi pertinenti.');

    fireEvent.click(screen.getByRole('button', { name: 'Conferma correzione' }));
    await screen.findByText('Correzione completata.');
    expect(runSpy.mock.calls[0][0]).toMatchObject({
      requestId: previewRequest.requestId,
      teacherGuidance: previewRequest.teacherGuidance,
    });
  });

  it('M5-QUALITY-01 — defaults to Equilibrato and shows the matching description', () => {
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    const select = screen.getByLabelText('Stile di valutazione') as HTMLSelectElement;
    expect(select.value).toBe('balanced');
    expect(screen.getByText(/È il comportamento predefinito\./)).toBeTruthy();
    // Selected-count and 0/500 counter are present.
    expect(screen.getByText(/Consegne selezionate:/)).toBeTruthy();
    expect(screen.getByText('0/500 caratteri')).toBeTruthy();
  });

  it('M5-QUALITY-01 — each style shows its dynamic description', () => {
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    const select = screen.getByLabelText('Stile di valutazione');
    fireEvent.change(select, { target: { value: 'compassionate' } });
    expect(screen.getByText(/Valorizza la comprensione sostanziale/)).toBeTruthy();
    fireEvent.change(select, { target: { value: 'rigorous' } });
    expect(screen.getByText(/Richiede più nettamente gli elementi domandati/)).toBeTruthy();
  });

  it('M5-QUALITY-01 — sends the selected gradingMode; run reuses it; a change invalidates the request', async () => {
    const { callables, previewSpy, runSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('Stile di valutazione'), {
      target: { value: 'rigorous' },
    });
    await calculatePreview();
    const first = previewSpy.mock.calls[0][0];
    expect(first.gradingMode).toBe('rigorous');
    // Read-only style shown in the estimate screen (no editable select there).
    expect(screen.getByText('Rigoroso')).toBeTruthy();

    // Changing the style after a preview forces a fresh preview + new requestId.
    fireEvent.click(screen.getByRole('button', { name: 'Modifica impostazioni' }));
    fireEvent.change(screen.getByLabelText('Stile di valutazione'), {
      target: { value: 'compassionate' },
    });
    await calculatePreview();
    const second = previewSpy.mock.calls[1][0];
    expect(second.gradingMode).toBe('compassionate');
    expect(second.requestId).not.toBe(first.requestId);

    fireEvent.click(screen.getByRole('button', { name: 'Conferma correzione' }));
    await screen.findByText('Correzione completata.');
    expect(runSpy.mock.calls[0][0]).toMatchObject({
      requestId: second.requestId,
      gradingMode: 'compassionate',
    });
  });

  it('shows empty guidance read-only after preview', async () => {
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    await calculatePreview();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Indicazioni applicate')).toBeTruthy();
    expect(screen.getByText('Nessuna indicazione aggiuntiva')).toBeTruthy();
  });

  it('shows an accessible sober loader while the preview is pending (no fake %)', async () => {
    let resolvePreview!: (result: AiPreviewResult) => void;
    const { callables } = makeCallables(
      () => new Promise<AiPreviewResult>((resolve) => (resolvePreview = resolve)),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.getAttribute('aria-busy')).toBe('true');
    expect(status.textContent).toContain('Calcolo della stima…');
    expect(status.textContent).not.toMatch(/\d+%/);

    resolvePreview(makePreview());
    await screen.findByText(/Elaborabili:/);
    // Loader gone once the confirm summary is shown.
    expect(screen.queryByText('Calcolo della stima…')).toBeNull();
  });

  it('shows an accessible indeterminate spinner while the confirmed run is pending', async () => {
    let resolveRun!: (result: AiRunResult) => void;
    const { callables, runSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => new Promise<AiRunResult>((resolve) => (resolveRun = resolve)),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    fireEvent.click(screen.getByRole('button', { name: 'Conferma correzione' }));
    const status = screen.getByRole('status');
    expect(status.textContent).toContain('Correzione in corso');
    expect(status.textContent).toContain('Sto elaborando 2 consegne');
    expect(status.textContent).not.toMatch(/\d+%/);
    expect(screen.queryByRole('button')).toBeNull();
    expect(runSpy).toHaveBeenCalledTimes(1);

    resolveRun(makeRun());
    await screen.findByText('Correzione completata.');
    expect(screen.queryByText(/Correzione in corso/)).toBeNull();
  });

  it('cancels without ever calling run', async () => {
    const onClose = vi.fn();
    const { callables, runSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={onClose}
        onApplied={() => {}}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Annulla' }));
    expect(runSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('protects against a double click generating two run calls', async () => {
    let resolveRun!: (r: AiRunResult) => void;
    const { callables, runSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => new Promise<AiRunResult>((r) => (resolveRun = r)),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    const confirm = await screen.findByRole('button', { name: 'Conferma correzione' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    resolveRun(makeRun());
    await screen.findByText('Correzione completata.');
    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it('shows a partial result with per-submission reasons', async () => {
    const partial = makeRun({
      status: 'partial',
      counts: {
        selected: 2,
        eligible: 2,
        excluded: 0,
        closedToGrade: 3,
        openToGrade: 4,
        closedOnlySubmissions: 0,
        alreadyGradedIgnored: 0,
        succeeded: 1,
        partial: 0,
        failed: 1,
      },
      results: [
        {
          submissionId: 'ver1_s1',
          outcome: 'succeeded',
          closedGraded: 2,
          openGraded: 2,
          openSkipped: 0,
          alreadyIgnored: 0,
        },
        {
          submissionId: 'ver1_s2',
          outcome: 'failed',
          closedGraded: 0,
          openGraded: 0,
          openSkipped: 0,
          alreadyIgnored: 0,
          reason: 'write_error',
        },
      ],
    });
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(partial),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    fireEvent.click(await screen.findByRole('button', { name: 'Conferma correzione' }));
    await screen.findByText('Riuscite: 1');
    expect(screen.getByText('Fallite: 1')).toBeTruthy();
    const details = screen.getByText('Dettaglio consegne non elaborate');
    fireEvent.click(details);
    expect(screen.getByText('Errore di scrittura')).toBeTruthy();
  });

  it('reports an already-running operation without starting a new one', async () => {
    const running = makeRun({ status: 'running' });
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(running),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    fireEvent.click(await screen.findByRole('button', { name: 'Conferma correzione' }));
    await screen.findByText(/è già in corso/);
  });

  it('reports an idempotent replay', async () => {
    const replay = makeRun({ idempotentReplay: true });
    const { callables } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(replay),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    fireEvent.click(await screen.findByRole('button', { name: 'Conferma correzione' }));
    await screen.findByText('Operazione già eseguita: risultato ripristinato.');
  });

  it('shows a readable error when preview fails, without run', async () => {
    const { callables, runSpy } = makeCallables(
      () => Promise.reject({ code: 'functions/permission-denied' }),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Operazione riservata al docente proprietario.');
    expect(runSpy).not.toHaveBeenCalled();
  });

  it('disables confirm when nothing is eligible and lists exclusions', async () => {
    const preview = makePreview({
      counts: {
        selected: 1,
        eligible: 0,
        excluded: 1,
        closedToGrade: 0,
        openToGrade: 0,
        closedOnlySubmissions: 0,
        alreadyGradedIgnored: 0,
      },
      excluded: [{ submissionId: 'ver1_s1', reason: 'not_submitted' }],
    });
    const { callables } = makeCallables(
      () => Promise.resolve(preview),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={['ver1_s1']}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );

    await calculatePreview();
    const confirm = await screen.findByRole('button', { name: 'Conferma correzione' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    const exclusions = screen.getByText('Consegne escluse (1)');
    fireEvent.click(exclusions);
    expect(within(screen.getByRole('dialog')).getByText('Non ancora consegnata')).toBeTruthy();
  });
});

describe('AiBatchCorrectionDialog — TWU-02 model profile + preferences prefill', () => {
  it('prefills the three criteria from the teacher defaults and sends modelProfile in the payload', async () => {
    const { callables, previewSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
        defaults={{
          modelProfile: 'economy',
          gradingMode: 'rigorous',
          teacherGuidance: 'Sii severo.',
        }}
      />,
    );
    // The shared fields reflect the defaults.
    expect((screen.getByLabelText('Profilo modello') as HTMLSelectElement).value).toBe('economy');
    expect((screen.getByLabelText('Stile di valutazione') as HTMLSelectElement).value).toBe(
      'rigorous',
    );

    await calculatePreview();
    const payload = previewSpy.mock.calls[0][0];
    expect(payload.modelProfile).toBe('economy');
    expect(payload.gradingMode).toBe('rigorous');
    expect(payload.teacherGuidance).toBe('Sii severo.');
    // No raw model id or price list ever leaves the client.
    expect('model' in payload).toBe(false);
    expect('priceListVersion' in payload).toBe(false);
  });

  it('changing the model profile after a preview invalidates it and mints a new requestId', async () => {
    const { callables, previewSpy } = makeCallables(
      () => Promise.resolve(makePreview()),
      () => Promise.resolve(makeRun()),
    );
    render(
      <AiBatchCorrectionDialog
        verificationId={VERIFICATION_ID}
        submissionIds={SUBMISSION_IDS}
        callables={callables}
        onClose={() => {}}
        onApplied={() => {}}
      />,
    );
    await calculatePreview();
    const firstRequestId = previewSpy.mock.calls[0][0].requestId;
    expect(previewSpy.mock.calls[0][0].modelProfile).toBe('quality'); // default
    // After the estimate the criteria are frozen; editing requires "Modifica
    // impostazioni", which returns to configure and mints a new requestId.
    fireEvent.click(screen.getByRole('button', { name: 'Modifica impostazioni' }));
    fireEvent.change(screen.getByLabelText('Profilo modello'), { target: { value: 'economy' } });

    await calculatePreview();
    const secondPayload = previewSpy.mock.calls[1][0];
    expect(secondPayload.modelProfile).toBe('economy');
    // A new requestId: same requestId with a different profile could never be reused.
    expect(secondPayload.requestId).not.toBe(firstRequestId);
  });
});
