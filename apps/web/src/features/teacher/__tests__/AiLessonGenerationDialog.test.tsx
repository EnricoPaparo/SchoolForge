import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
  functions: {},
}));

import { AiLessonGenerationDialog } from '../AiLessonGenerationDialog.js';
import type {
  AiLessonCallables,
  AiLessonContentRequest,
  AiLessonGenerateResult,
  AiLessonPreviewResult,
  LessonAiContext,
} from '../../repository/pools/aiContentClient.js';

afterEach(cleanup);

const CONTEXT: LessonAiContext = {
  titolo: 'Le reti',
  sottotitolo: null,
  udaTitle: 'UDA 1',
  concettiChiave: ['TCP', 'IP'],
  obiettivi: ['capire i livelli'],
  currentBody: '',
};

function previewResult(): AiLessonPreviewResult {
  return {
    kind: 'lesson',
    modelProfile: 'gpt-5.6-luna',
    estimatedInputTokens: 900,
    maxOutputTokens: 3500,
    estimatedCostMicroUsd: 4000,
    reservationCostMicroUsd: 9000,
    requestedTotal: null,
  };
}

function generateResult(over: Partial<AiLessonGenerateResult> = {}): AiLessonGenerateResult {
  return {
    status: 'completed',
    kind: 'lesson',
    modelProfile: 'gpt-5.6-luna',
    output: { body: '## Reti\n\nBozza generata dal modello.' },
    actualCostMicroUsd: 3800,
    replayed: false,
    ...over,
  };
}

function makeCallables(over: Partial<AiLessonCallables> = {}): {
  callables: AiLessonCallables;
  previewReqs: AiLessonContentRequest[];
  generateReqs: AiLessonContentRequest[];
} {
  const previewReqs: AiLessonContentRequest[] = [];
  const generateReqs: AiLessonContentRequest[] = [];
  const callables: AiLessonCallables = {
    preview: async (req) => {
      previewReqs.push(req);
      return previewResult();
    },
    generate: async (req) => {
      generateReqs.push(req);
      return generateResult();
    },
    ...over,
  };
  return { callables, previewReqs, generateReqs };
}

function renderDialog(
  callables: AiLessonCallables,
  onUseDraft = vi.fn(),
  context: LessonAiContext = CONTEXT,
) {
  return render(
    <AiLessonGenerationDialog
      context={context}
      callables={callables}
      onUseDraft={onUseDraft}
      onClose={() => {}}
    />,
  );
}

async function goToReview(callables: AiLessonCallables, onUseDraft = vi.fn()) {
  renderDialog(callables, onUseDraft);
  fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
  await screen.findByText(/Costo stimato/);
  fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
  await screen.findByRole('button', { name: 'Usa questa bozza' });
}

describe('AiLessonGenerationDialog', () => {
  it('shows the read-only context summary and "Editor vuoto"', () => {
    const { callables } = makeCallables();
    renderDialog(callables);
    expect(screen.getByText(/UDA: UDA 1/)).toBeTruthy();
    expect(screen.getByText(/Editor vuoto/)).toBeTruthy();
  });

  it('config → estimate → generate reuse the same requestId and closed payload', async () => {
    const { callables, previewReqs, generateReqs } = makeCallables();
    await goToReview(callables);
    expect(generateReqs[0]).toEqual(previewReqs[0]);
    expect(previewReqs[0].kind).toBe('lesson');
    expect(previewReqs[0].hasCurrentContent).toBe(false);
    expect('modelId' in previewReqs[0]).toBe(false);
    expect('ownerUid' in previewReqs[0]).toBe(false);
  });

  it('a config change invalidates the estimate and mints a new requestId', async () => {
    const { callables, previewReqs } = makeCallables();
    renderDialog(callables);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Modifica configurazione' }));
    fireEvent.click(screen.getByRole('radio', { name: /Approfondita/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    expect(previewReqs).toHaveLength(2);
    expect(previewReqs[0].requestId).not.toBe(previewReqs[1].requestId);
    expect(previewReqs[1].depth).toBe('in_depth');
  });

  it('review shows the replacement warning and renders via the sanitized Markdown path', async () => {
    const { callables } = makeCallables();
    await goToReview(callables);
    expect(screen.getByText(/La bozza generata sostituirà il testo nell’editor/)).toBeTruthy();
    // Markdown renderer output (## → h2).
    expect(document.querySelector('h2')).toBeTruthy();
  });

  it('«Usa questa bozza» calls onUseDraft with the body (no save service)', async () => {
    const onUseDraft = vi.fn();
    const { callables } = makeCallables();
    await goToReview(callables, onUseDraft);
    fireEvent.click(screen.getByRole('button', { name: 'Usa questa bozza' }));
    expect(onUseDraft).toHaveBeenCalledTimes(1);
    expect(onUseDraft.mock.calls[0][0]).toContain('Bozza generata');
  });

  it('cancel does not call onUseDraft', async () => {
    const onUseDraft = vi.fn();
    const { callables } = makeCallables();
    await goToReview(callables, onUseDraft);
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onUseDraft).not.toHaveBeenCalled();
  });

  it('a malformed output keeps the original text (no onUseDraft, readable error)', async () => {
    const onUseDraft = vi.fn();
    const { callables } = makeCallables({
      generate: async () => generateResult({ output: { body: '   ' } }),
    });
    renderDialog(callables, onUseDraft);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
    await screen.findByText(/La bozza generata è vuota/);
    expect(onUseDraft).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Usa questa bozza' })).toBeNull();
  });

  it('surfaces a sanitized error on preview failure with a retry', async () => {
    const { callables } = makeCallables({
      preview: async () => {
        throw { details: { code: 'feature_disabled' } };
      },
    });
    renderDialog(callables);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/La generazione IA è disattivata/);
    expect(screen.getByRole('button', { name: 'Riprova stima' })).toBeTruthy();
  });

  it('shows the conservative-settlement message when actualCost is null', async () => {
    const { callables } = makeCallables({
      generate: async () => generateResult({ actualCostMicroUsd: null }),
    });
    await goToReview(callables);
    expect(
      screen.getByText(/Consumo esatto non disponibile; è stato contabilizzato prudenzialmente/),
    ).toBeTruthy();
  });

  it('uses the current editor body as context (hasCurrentContent=true)', async () => {
    const { callables, previewReqs } = makeCallables();
    await goToReview(callables, vi.fn());
    await waitFor(() => expect(previewReqs).toHaveLength(1));
    // default CONTEXT has empty body → false; verify the non-empty variant.
    cleanup();
    const nonEmpty = { ...CONTEXT, currentBody: '## Esistente' };
    const c2 = makeCallables();
    renderDialog(c2.callables, vi.fn(), nonEmpty);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    expect(c2.previewReqs[0].hasCurrentContent).toBe(true);
    expect(c2.previewReqs[0].currentBody).toBe('## Esistente');
  });
});

// ─── AIGEN-UI-01 — UI refinements ────────────────────────────────────────────
describe('AiLessonGenerationDialog — AIGEN-UI-01 UI', () => {
  it('uses the wide-scroll DialogShell variant', () => {
    renderDialog(makeCallables().callables);
    expect(screen.getByRole('dialog').className).toMatch(/dialogWideScroll/);
  });

  it('no longer shows the lesson intro paragraph', () => {
    renderDialog(makeCallables().callables);
    expect(screen.queryByText(/propone una bozza completa del corpo Markdown/i)).toBeNull();
  });

  it('gives the guidance textarea the non-resizable AIGEN class, keeping maxLength and aria-describedby', () => {
    renderDialog(makeCallables().callables);
    const ta = screen.getByLabelText('Indicazioni aggiuntive (facoltative)') as HTMLTextAreaElement;
    expect(ta.className).toMatch(/guidanceTextarea/);
    expect(ta.maxLength).toBe(500);
    expect(ta.getAttribute('aria-describedby')).toBe('ai-lesson-guidance-counter');
  });
});
