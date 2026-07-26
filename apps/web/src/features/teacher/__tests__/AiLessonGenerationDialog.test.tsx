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
  difficolta: 'intermedia',
  udaTitle: 'UDA 1',
  concettiChiave: ['TCP', 'IP'],
  obiettivi: ['capire i livelli'],
  // AIGEN-CONTEXT-01: indice UDA compatto (dall'albero già in memoria).
  udaContext: {
    title: 'UDA 1',
    currentLessonPosition: 2,
    lessons: [
      { position: 1, titolo: 'Introduzione', sottotitolo: null },
      { position: 2, titolo: 'Le reti', sottotitolo: null },
      { position: 3, titolo: 'Il routing', sottotitolo: null },
    ],
  },
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

  it('no longer shows the "Nessun costo è stato ancora generato" note, keeping the useful estimate info', async () => {
    renderDialog(makeCallables().callables);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    expect(screen.queryByText(/Nessun costo è stato ancora generato/)).toBeNull();
    expect(screen.getByText(/Token stimati/)).toBeTruthy();
    expect(screen.getByText(/Tetto massimo prenotabile/)).toBeTruthy();
  });
});

// ─── AIGEN-CONTEXT-01 — preflight dei metadati obbligatori ───────────────────
describe('AiLessonGenerationDialog — AIGEN-CONTEXT-01 preflight', () => {
  /** Rende il dialog con un contesto incompleto e prova a chiedere la stima. */
  function renderIncomplete(over: Partial<LessonAiContext>) {
    const c = makeCallables();
    renderDialog(c.callables, vi.fn(), { ...CONTEXT, ...over });
    return c;
  }

  const CASES: Array<[string, Partial<LessonAiContext>, string]> = [
    ['titolo', { titolo: '  ' }, 'titolo'],
    ['difficoltà', { difficolta: null }, 'difficoltà'],
    ['concetti chiave', { concettiChiave: [] }, 'concetti chiave'],
    ['obiettivi', { obiettivi: ['   '] }, 'obiettivi'],
    ['titolo UDA', { udaTitle: null }, 'titolo UDA'],
    ['indice UDA', { udaContext: null }, 'indice della UDA'],
  ];

  for (const [label, over, expectedField] of CASES) {
    it(`does not call preview when ${label} is missing, and names the field`, () => {
      const c = renderIncomplete(over);
      const btn = screen.getByRole('button', { name: 'Calcola stima' }) as HTMLButtonElement;
      // Pulsante disabilitato + alert accessibile con il campo mancante.
      expect(btn.disabled).toBe(true);
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toContain('Completa prima le informazioni fondamentali');
      expect(alert.textContent).toContain(expectedField);
      // Nessuna callable: nessun run, nessuna prenotazione, nessun costo.
      fireEvent.click(btn);
      expect(c.previewReqs).toHaveLength(0);
      expect(c.generateReqs).toHaveLength(0);
      // Il dialog resta aperto.
      expect(screen.getByRole('dialog')).toBeTruthy();
    });
  }

  it('lists every missing field at once', () => {
    renderIncomplete({ titolo: '', difficolta: '', obiettivi: [] });
    const alert = screen.getByRole('alert');
    for (const field of ['titolo', 'difficoltà', 'obiettivi']) {
      expect(alert.textContent).toContain(field);
    }
  });

  it('allows generation when only the optional sottotitolo is missing', async () => {
    const c = makeCallables();
    renderDialog(c.callables, vi.fn(), { ...CONTEXT, sottotitolo: null });
    expect(screen.queryByRole('alert')).toBeNull();
    const btn = screen.getByRole('button', { name: 'Calcola stima' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await screen.findByText(/Costo stimato/);
    expect(c.previewReqs).toHaveLength(1);
    expect('sottotitolo' in c.previewReqs[0]).toBe(false);
  });

  it('sends difficolta and the UDA outline, identical between preview and generate', async () => {
    const c = makeCallables();
    await goToReview(c.callables);
    expect(c.previewReqs[0].difficolta).toBe('intermedia');
    expect(c.previewReqs[0].udaContext).toEqual({
      title: 'UDA 1',
      currentLessonPosition: 2,
      lessons: [
        { position: 1, titolo: 'Introduzione', sottotitolo: null },
        { position: 2, titolo: 'Le reti', sottotitolo: null },
        { position: 3, titolo: 'Il routing', sottotitolo: null },
      ],
    });
    // Stesso payload esatto (idempotenza server-side invariata).
    expect(c.generateReqs[0]).toEqual(c.previewReqs[0]);
  });

  it('never sends technical identifiers in the payload', async () => {
    const c = makeCallables();
    await goToReview(c.callables);
    const serialized = JSON.stringify(c.previewReqs[0]);
    for (const forbidden of [
      'lessonId',
      'udaId',
      'udaDir',
      'filename',
      'storageRef',
      'publicLessonId',
      'ownerUid',
      'modelId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

// ─── AIGEN-UI-03-FOLLOW-UP — la bozza non si perde per un click fuori ────────
describe('AiLessonGenerationDialog — explicit-dismiss during/after generation', () => {
  function backdrop() {
    return screen.getByRole('dialog').parentElement as HTMLElement;
  }

  function renderWith(onClose: () => void, over: Partial<AiLessonCallables> = {}) {
    const c = makeCallables(over);
    render(
      <AiLessonGenerationDialog
        context={CONTEXT}
        callables={c.callables}
        onUseDraft={vi.fn()}
        onClose={onClose}
      />,
    );
    return c;
  }

  it('closes on backdrop and Escape in the phases before generation', () => {
    const onClose = vi.fn();
    renderWith(onClose);
    fireEvent.click(backdrop());
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('ignores backdrop and Escape during review, keeping the draft intact', async () => {
    const onClose = vi.fn();
    renderWith(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
    await screen.findByRole('button', { name: 'Usa questa bozza' });

    fireEvent.click(backdrop());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Usa questa bozza' })).toBeTruthy();
  });

  it('ignores backdrop and Escape while generating', async () => {
    const onClose = vi.fn();
    let release!: () => void;
    renderWith(onClose, {
      generate: () =>
        new Promise((resolve) => {
          release = () => resolve(generateResult());
        }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
    await screen.findByText(/Generazione della bozza in corso/);

    fireEvent.click(backdrop());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    release();
    await screen.findByRole('button', { name: 'Usa questa bozza' });
  });

  it('«Annulla» during review opens the abandon confirmation instead of closing', async () => {
    const onClose = vi.fn();
    renderWith(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
    await screen.findByRole('button', { name: 'Usa questa bozza' });

    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(
      screen.getByText(/Abbandonare la proposta generata\? Le modifiche non applicate/),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('«Continua la revisione» keeps the generated draft', async () => {
    const onClose = vi.fn();
    renderWith(onClose);
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
    await screen.findByRole('button', { name: 'Usa questa bozza' });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continua la revisione' }));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Usa questa bozza' })).toBeTruthy();
    expect(screen.queryByText(/Abbandonare la proposta generata/)).toBeNull();
  });

  it('«Abbandona proposta» closes once and never applies the draft', async () => {
    const onClose = vi.fn();
    const onUseDraft = vi.fn();
    const c = makeCallables();
    render(
      <AiLessonGenerationDialog
        context={CONTEXT}
        callables={c.callables}
        onUseDraft={onUseDraft}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
    await screen.findByRole('button', { name: 'Usa questa bozza' });

    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    const abandon = screen.getByRole('button', { name: 'Abbandona proposta' });
    fireEvent.click(abandon);
    fireEvent.click(abandon); // doppio click protetto
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onUseDraft).not.toHaveBeenCalled();
  });

  it('exposes the abandon confirmation to the keyboard', async () => {
    renderWith(vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    fireEvent.click(screen.getByRole('button', { name: 'Genera bozza' }));
    await screen.findByRole('button', { name: 'Usa questa bozza' });
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Abbandonare la proposta generata?');
    const keep = screen.getByRole('button', { name: 'Continua la revisione' });
    keep.focus();
    expect(document.activeElement).toBe(keep);
  });
});
