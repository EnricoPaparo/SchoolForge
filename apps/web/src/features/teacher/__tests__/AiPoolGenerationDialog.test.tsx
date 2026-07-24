import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
  functions: {},
}));

import type { ParsedPool } from '@schoolforge/lesson-contract';
import { AiPoolGenerationDialog } from '../AiPoolGenerationDialog.js';
import type {
  AiContentCallables,
  AiPoolContentRequest,
  AiPoolGenerateResult,
  AiPoolPreviewResult,
} from '../../repository/pools/aiContentClient.js';

afterEach(cleanup);

function previewResult(): AiPoolPreviewResult {
  return {
    kind: 'pool',
    modelProfile: 'gpt-5.6-luna',
    estimatedInputTokens: 900,
    maxOutputTokens: 1320,
    estimatedCostMicroUsd: 1200,
    reservationCostMicroUsd: 5000,
    requestedTotal: 6,
  };
}

function generateResult(over: Partial<AiPoolGenerateResult> = {}): AiPoolGenerateResult {
  return {
    status: 'completed',
    kind: 'pool',
    modelProfile: 'gpt-5.6-luna',
    output: {
      questions: [
        { order: 0, tipo: 'aperta', testo: 'Spiega TCP', difficolta: 3, soluzione: 'Affidabile' },
        {
          order: 1,
          tipo: 'chiusa_singola',
          testo: 'Quale?',
          difficolta: 2,
          opzioni: ['TCP', 'UDP'],
          soluzioneIndici: [0],
        },
      ],
    },
    actualCostMicroUsd: 1100,
    replayed: false,
    ...over,
  };
}

function makeCallables(over: Partial<AiContentCallables> = {}): {
  callables: AiContentCallables;
  previewReqs: AiPoolContentRequest[];
  generateReqs: AiPoolContentRequest[];
} {
  const previewReqs: AiPoolContentRequest[] = [];
  const generateReqs: AiPoolContentRequest[] = [];
  const callables: AiContentCallables = {
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

async function goToReview(
  callables: AiContentCallables,
  onApply: (pool: ParsedPool) => Promise<void> = vi.fn(async (_pool: ParsedPool) => {}),
) {
  render(
    <AiPoolGenerationDialog
      lessonSource="Le reti collegano dispositivi."
      existingPool={null}
      callables={callables}
      onApply={onApply}
      onClose={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
  await screen.findByText(/Costo stimato/);
  fireEvent.click(screen.getByRole('button', { name: 'Genera pool' }));
  await screen.findByRole('button', { name: 'Annulla proposta' });
}

describe('AiPoolGenerationDialog', () => {
  it('runs config → estimate → generate, reusing the same requestId and payload', async () => {
    const { callables, previewReqs, generateReqs } = makeCallables();
    await goToReview(callables);
    expect(previewReqs).toHaveLength(1);
    expect(generateReqs).toHaveLength(1);
    expect(generateReqs[0]).toEqual(previewReqs[0]); // same requestId + same normalized payload
    expect(previewReqs[0].kind).toBe('pool');
    expect(previewReqs[0].counts).toEqual({ aperta: 3, chiusa_singola: 3, chiusa_multipla: 0 });
    expect('ownerUid' in previewReqs[0]).toBe(false);
  });

  it('shows estimate and the conservative reservation cap, no cost yet', async () => {
    const { callables } = makeCallables();
    render(
      <AiPoolGenerationDialog
        lessonSource="Reti"
        existingPool={null}
        callables={callables}
        onApply={vi.fn(async () => {})}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    expect(screen.getByText(/Tetto massimo prenotabile/)).toBeTruthy();
  });

  it('a config change invalidates the estimate and yields a new requestId', async () => {
    const { callables, previewReqs } = makeCallables();
    render(
      <AiPoolGenerationDialog
        lessonSource="Reti"
        existingPool={null}
        callables={callables}
        onApply={vi.fn(async () => {})}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    // Back to configure by clicking the style option changes config.
    fireEvent.click(screen.getByRole('button', { name: 'Modifica configurazione' }));
    fireEvent.click(screen.getByRole('radio', { name: /Rigoroso/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    expect(previewReqs).toHaveLength(2);
    expect(previewReqs[0].requestId).not.toBe(previewReqs[1].requestId);
    expect(previewReqs[1].level).toBe('advanced');
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

  it('shows a replay notice for a replayed generation', async () => {
    const { callables } = makeCallables({
      generate: async () => generateResult({ replayed: true }),
    });
    await goToReview(callables);
    expect(screen.getByText(/Proposta già generata: ripristinata/)).toBeTruthy();
  });

  it('lets the teacher delete a proposed question locally', async () => {
    const { callables } = makeCallables();
    await goToReview(callables);
    expect(screen.getByText('Spiega TCP')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Elimina domanda 1' }));
    await waitFor(() => expect(screen.queryByText('Spiega TCP')).toBeNull());
  });

  it('applies once through the canonical save and shows success feedback', async () => {
    const onApply = vi.fn(async (_pool: ParsedPool) => {});
    const { callables } = makeCallables();
    await goToReview(callables, onApply);
    fireEvent.click(screen.getByRole('button', { name: 'Crea pool' }));
    // Light confirm.
    expect(screen.getByText(/Verrà creato un pool con 2 domande/)).toBeTruthy();
    const confirmBtn = screen.getAllByRole('button', { name: 'Crea pool' }).at(-1)!;
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn); // double-click guard
    await screen.findByText(/Pool creato con 2 domande/);
    expect(onApply).toHaveBeenCalledTimes(1);
    // The applied argument is a canonical ParsedPool.
    const pool = onApply.mock.calls[0]![0] as unknown as { schema: string; questions: unknown[] };
    expect(pool.schema).toBe('schoolforge-pool/v2');
    expect(pool.questions).toHaveLength(2);
  });

  it('keeps the local proposal when the canonical save fails', async () => {
    const onApply = vi.fn(async (_pool: ParsedPool) => {
      void _pool;
      throw new Error('storage down');
    });
    const { callables } = makeCallables();
    await goToReview(callables, onApply);
    fireEvent.click(screen.getByRole('button', { name: 'Crea pool' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Crea pool' }).at(-1)!);
    await screen.findByText(/storage down/);
    // Proposal still there, editable.
    expect(screen.getByText('Spiega TCP')).toBeTruthy();
  });

  it('surfaces a sanitized error on preview failure and offers retry', async () => {
    const { callables } = makeCallables({
      preview: async () => {
        throw { details: { code: 'budget_exceeded' } };
      },
    });
    render(
      <AiPoolGenerationDialog
        lessonSource="Reti"
        existingPool={null}
        callables={callables}
        onApply={vi.fn(async () => {})}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Budget mensile insufficiente/);
    expect(screen.getByRole('button', { name: 'Riprova stima' })).toBeTruthy();
  });

  it('disables generate until a successful preview (estimate gate)', () => {
    const { callables } = makeCallables();
    render(
      <AiPoolGenerationDialog
        lessonSource="Reti"
        existingPool={null}
        callables={callables}
        onApply={vi.fn(async () => {})}
        onClose={() => {}}
      />,
    );
    // In configure there is no "Genera pool" button yet.
    expect(screen.queryByRole('button', { name: 'Genera pool' })).toBeNull();
  });
});

// ─── AIGEN-UI-01 — UI refinements ────────────────────────────────────────────
describe('AiPoolGenerationDialog — AIGEN-UI-01 UI', () => {
  function renderConfigure() {
    const { callables, previewReqs } = makeCallables();
    render(
      <AiPoolGenerationDialog
        lessonSource="Le reti collegano dispositivi."
        existingPool={null}
        callables={callables}
        onApply={vi.fn(async () => {})}
        onClose={() => {}}
      />,
    );
    return { previewReqs };
  }

  it('uses the wide-scroll DialogShell variant', () => {
    renderConfigure();
    expect(screen.getByRole('dialog').className).toMatch(/dialogWideScroll/);
  });

  it('no longer shows the pool intro paragraph', () => {
    renderConfigure();
    expect(screen.queryByText(/propone domande a partire dal testo della lezione/i)).toBeNull();
  });

  it('gives the guidance textarea the non-resizable AIGEN class, keeping maxLength and aria-describedby', () => {
    renderConfigure();
    const ta = screen.getByLabelText('Indicazioni aggiuntive (facoltative)') as HTMLTextAreaElement;
    expect(ta.className).toMatch(/guidanceTextarea/);
    expect(ta.maxLength).toBe(500);
    expect(ta.getAttribute('aria-describedby')).toBe('ai-pool-guidance-counter');
  });

  it('renders the three steppers with their initial values and specific aria-labels', () => {
    renderConfigure();
    expect((screen.getByLabelText('Aperte') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Risposta singola') as HTMLInputElement).value).toBe('3');
    expect((screen.getByLabelText('Risposta multipla') as HTMLInputElement).value).toBe('0');
    for (const name of [
      'Diminuisci domande aperte',
      'Aumenta domande aperte',
      'Diminuisci domande a risposta singola',
      'Aumenta domande a risposta singola',
      'Diminuisci domande a risposta multipla',
      'Aumenta domande a risposta multipla',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    // No native number spinbuttons for the counts.
    expect(screen.queryByRole('spinbutton', { name: 'Aperte' })).toBeNull();
  });

  it('increments and decrements the correct type and updates the requested total', () => {
    renderConfigure();
    expect(screen.getByText(/Totale richiesto: 6/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aumenta domande aperte' }));
    expect((screen.getByLabelText('Aperte') as HTMLInputElement).value).toBe('4');
    expect(screen.getByText(/Totale richiesto: 7/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Diminuisci domande aperte' }));
    expect((screen.getByLabelText('Aperte') as HTMLInputElement).value).toBe('3');
    expect(screen.getByText(/Totale richiesto: 6/)).toBeTruthy();
  });

  it('disables «−» at 0 and never goes below 0', () => {
    renderConfigure();
    const dec = screen.getByRole('button', {
      name: 'Diminuisci domande a risposta multipla',
    }) as HTMLButtonElement;
    expect(dec.disabled).toBe(true);
    fireEvent.click(dec); // no-op
    expect((screen.getByLabelText('Risposta multipla') as HTMLInputElement).value).toBe('0');
  });

  it('disables every «+» once the total reaches the maximum, without silently correcting manual over-max input', () => {
    renderConfigure();
    fireEvent.change(screen.getByLabelText('Aperte'), { target: { value: '30' } });
    // Manual over-max is preserved (no silent clamp) and flagged by validation.
    expect((screen.getByLabelText('Aperte') as HTMLInputElement).value).toBe('30');
    expect(screen.getByText(/massimo 30/)).toBeTruthy();
    for (const name of [
      'Aumenta domande aperte',
      'Aumenta domande a risposta singola',
      'Aumenta domande a risposta multipla',
    ]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('keeps direct keyboard input working and invalidates the config when empty/malformed', () => {
    renderConfigure();
    const aperte = screen.getByLabelText('Aperte') as HTMLInputElement;
    fireEvent.change(aperte, { target: { value: '5' } });
    expect(aperte.value).toBe('5');
    expect(aperte.getAttribute('aria-invalid')).toBe('false');
    fireEvent.change(aperte, { target: { value: '' } });
    expect(aperte.getAttribute('aria-invalid')).toBe('true');
    expect(
      (screen.getByRole('button', { name: 'Calcola stima' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('sends the same counts to preview as before (contract unchanged)', async () => {
    const { previewReqs } = renderConfigure();
    fireEvent.click(screen.getByRole('button', { name: 'Aumenta domande a risposta multipla' }));
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    expect(previewReqs).toHaveLength(1);
    expect(previewReqs[0].counts).toEqual({ aperta: 3, chiusa_singola: 3, chiusa_multipla: 1 });
  });
});

// ─── AIGEN-UI-02 — rifinitura revisione bozza ────────────────────────────────
describe('AiPoolGenerationDialog — AIGEN-UI-02 review card', () => {
  it('no longer shows the "Nessun costo è stato ancora generato" note', async () => {
    const { callables } = makeCallables();
    render(
      <AiPoolGenerationDialog
        lessonSource="Reti"
        existingPool={null}
        callables={callables}
        onApply={vi.fn(async () => {})}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Calcola stima' }));
    await screen.findByText(/Costo stimato/);
    expect(screen.queryByText(/Nessun costo è stato ancora generato/)).toBeNull();
    // Le informazioni operative utili restano.
    expect(screen.getByText(/Token stimati/)).toBeTruthy();
    expect(screen.getByText(/Tetto massimo prenotabile/)).toBeTruthy();
  });

  it('keeps the review list scrollable with a visually hidden scrollbar', async () => {
    const { callables } = makeCallables();
    await goToReview(callables);
    const list = document.querySelector('[class*="reviewList"]') as HTMLElement;
    expect(list).toBeTruthy();
    // La classe scrollabile è applicata: overflow non è disabilitato.
    expect(list.className).toMatch(/reviewList/);
  });

  it('renders the difficulty stepper (1–5) instead of a native number spinner', async () => {
    const { callables } = makeCallables();
    await goToReview(callables);
    const diff = screen.getByLabelText('Difficoltà domanda 1') as HTMLInputElement;
    expect(diff.getAttribute('type')).toBe('text');
    expect(diff.getAttribute('inputmode')).toBe('numeric');
    expect(diff.value).toBe('3');
    expect(screen.queryByRole('spinbutton', { name: 'Difficoltà domanda 1' })).toBeNull();
  });

  it('clamps the difficulty stepper at 1 and 5 (disabled at the bounds)', async () => {
    const { callables } = makeCallables();
    await goToReview(callables);
    const dec = () =>
      screen.getByRole('button', { name: 'Diminuisci difficoltà domanda 1' }) as HTMLButtonElement;
    const inc = () =>
      screen.getByRole('button', { name: 'Aumenta difficoltà domanda 1' }) as HTMLButtonElement;
    const value = () => (screen.getByLabelText('Difficoltà domanda 1') as HTMLInputElement).value;
    // 3 → 1
    fireEvent.click(dec());
    fireEvent.click(dec());
    expect(value()).toBe('1');
    expect(dec().disabled).toBe(true);
    // 1 → 5
    for (let i = 0; i < 4; i += 1) fireEvent.click(inc());
    expect(value()).toBe('5');
    expect(inc().disabled).toBe(true);
  });

  it('renders the "Caratteri max" stepper only for open questions, within canonical bounds', async () => {
    const { callables } = makeCallables();
    await goToReview(callables);
    // Domanda 1 = aperta → stepper presente e derivato dalla difficoltà (3 → 1200).
    const chars = screen.getByLabelText('Caratteri max domanda 1') as HTMLInputElement;
    expect(chars.value).toBe('1200');
    expect(chars.getAttribute('type')).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: 'Aumenta caratteri max domanda 1' }));
    expect((screen.getByLabelText('Caratteri max domanda 1') as HTMLInputElement).value).toBe(
      '1300',
    );
    // Domanda 2 = chiusa singola → nessun controllo caratteri.
    expect(screen.queryByLabelText('Caratteri max domanda 2')).toBeNull();
  });

  it('does not silently correct a manual out-of-range difficulty (validation blocks apply)', async () => {
    const { callables } = makeCallables();
    await goToReview(callables);
    fireEvent.change(screen.getByLabelText('Difficoltà domanda 1'), { target: { value: '9' } });
    // Nessuna correzione silenziosa: il valore digitato resta.
    expect((screen.getByLabelText('Difficoltà domanda 1') as HTMLInputElement).value).toBe('9');
    fireEvent.click(screen.getByRole('button', { name: 'Crea pool' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Crea pool' }).at(-1)!);
    await screen.findByText(/la difficoltà deve essere un intero da 1 a 5/i);
  });

  it('shows the delete button beside the metadata controls, deleting only the local draft', async () => {
    const onApply = vi.fn(async () => {});
    const { callables } = makeCallables();
    await goToReview(callables, onApply);
    const del = screen.getByRole('button', { name: 'Elimina domanda 1' });
    const diff = screen.getByLabelText('Difficoltà domanda 1');
    // Stessa riga metadati: condividono il contenitore dei controlli.
    const controls = del.closest('[class*="reviewHeadControls"]') as HTMLElement;
    expect(controls).toBeTruthy();
    expect(controls.contains(diff)).toBe(true);
    fireEvent.click(del);
    await waitFor(() => expect(screen.queryByText('Spiega TCP')).toBeNull());
    // Nessuna scrittura del pool: la cancellazione tocca solo la bozza locale.
    expect(onApply).not.toHaveBeenCalled();
  });

  it('gives the three type badges distinct colour classes (no white background)', async () => {
    const { callables } = makeCallables({
      generate: async () =>
        generateResult({
          output: {
            questions: [
              {
                order: 0,
                tipo: 'aperta',
                testo: 'Spiega TCP',
                difficolta: 3,
                soluzione: 'Affidabile',
              },
              {
                order: 1,
                tipo: 'chiusa_singola',
                testo: 'Quale?',
                difficolta: 2,
                opzioni: ['TCP', 'UDP'],
                soluzioneIndici: [0],
              },
              {
                order: 2,
                tipo: 'chiusa_multipla',
                testo: 'Quali?',
                difficolta: 4,
                opzioni: ['TCP', 'UDP', 'RAM'],
                soluzioneIndici: [0, 1],
              },
            ],
          },
        }),
    });
    await goToReview(callables);
    const cls = (text: string) => screen.getByText(text).className;
    expect(cls('Aperta')).toMatch(/badgeAperta/);
    expect(cls('Chiusa (singola)')).toMatch(/badgeSingola/);
    expect(cls('Chiusa (multipla)')).toMatch(/badgeMultipla/);
    // Tre classi cromatiche distinte.
    expect(new Set([cls('Aperta'), cls('Chiusa (singola)'), cls('Chiusa (multipla)')]).size).toBe(
      3,
    );
  });

  it('applies a pool whose maxPoints matches the edited difficolta', async () => {
    const onApply = vi.fn(async (_pool: ParsedPool) => {});
    const { callables } = makeCallables();
    await goToReview(callables, onApply);
    fireEvent.click(screen.getByRole('button', { name: 'Aumenta difficoltà domanda 1' })); // 3 → 4
    fireEvent.click(screen.getByRole('button', { name: 'Crea pool' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Crea pool' }).at(-1)!);
    await screen.findByText(/Pool creato con 2 domande/);
    const pool = onApply.mock.calls[0]![0];
    const aperta = pool.questions.find((q) => q.tipo === 'aperta')!;
    expect(aperta.difficolta).toBe(4);
    expect(aperta.maxPoints).toBe(aperta.difficolta);
  });
});
