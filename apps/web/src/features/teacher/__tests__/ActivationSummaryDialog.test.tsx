import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivationSummaryDialog } from '../ActivationSummaryDialog.js';
import { DialogShell } from '../../../components/DialogShell.js';
import type { ActivationSummary } from '../../repository/verifications/activationSummary.js';

afterEach(cleanup);

/**
 * VDIF-04-REVIEW-FIX — i tre blocker del dialog di attivazione.
 *
 * 1. la guardia anti doppio click attende l'attivazione **reale**, non il
 *    ritorno sincrono della chiamata;
 * 2. la conferma è impossibile senza un piano valido: un errore di preflight non
 *    lascia un pulsante che sembra funzionare ed è inerte;
 * 3. il dialog si apre dall'inizio, non già scorso sul footer.
 */

function summary(over: Partial<ActivationSummary> = {}): ActivationSummary {
  return {
    baseStudents: 4,
    differentiatedStudents: 2,
    unlabelledStudents: 4,
    labelCount: 1,
    substitutions: 1,
    omissions: 0,
    blockers: [],
    rows: [
      {
        labelId: null,
        labelName: 'Nessuna etichetta',
        studentCount: 4,
        questionCount: 5,
        maxPoints: 10,
        substitutions: 0,
        omissions: 0,
        blocker: null,
      },
      {
        labelId: 'L1',
        labelName: 'Percorso A',
        studentCount: 2,
        questionCount: 5,
        maxPoints: 9,
        substitutions: 1,
        omissions: 0,
        blocker: null,
      },
    ],
    ...over,
  };
}

const BLOCKED = summary({
  blockers: ['Percorso A: non riceverebbe alcuna domanda.'],
  rows: [
    {
      labelId: null,
      labelName: 'Nessuna etichetta',
      studentCount: 4,
      questionCount: 5,
      maxPoints: 10,
      substitutions: 0,
      omissions: 0,
      blocker: null,
    },
    {
      labelId: 'L1',
      labelName: 'Percorso A',
      studentCount: 2,
      questionCount: 0,
      maxPoints: 0,
      substitutions: 0,
      omissions: 5,
      blocker: 'Percorso A: non riceverebbe alcuna domanda.',
    },
  ],
});

type Props = Partial<Parameters<typeof ActivationSummaryDialog>[0]>;

function renderDialog(over: Props = {}) {
  const onConfirm = over.onConfirm ?? vi.fn(async () => undefined);
  const onCancel = over.onCancel ?? vi.fn();
  const result = render(
    <ActivationSummaryDialog
      summary={over.summary === undefined ? summary() : over.summary}
      questionCount={over.questionCount ?? 5}
      canConfirm={over.canConfirm ?? true}
      busy={over.busy ?? false}
      error={over.error ?? null}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />,
  );
  return { ...result, onConfirm, onCancel };
}

/**
 * Il pulsante di conferma per **posizione** e non per nome: quando
 * l'attivazione è in corso il suo testo diventa «Attivazione…», e cercarlo per
 * nome lo perderebbe proprio nello stato che più interessa verificare.
 */
function confirmButton(): HTMLButtonElement {
  const dialog = screen.getByRole('alertdialog');
  return within(dialog).getAllByRole('button')[0] as HTMLButtonElement;
}

// ── 1. Guardia asincrona reale ────────────────────────────────────────────────

describe('guardia anti doppio click — asincrona', () => {
  it('due click sincroni producono UNA sola attivazione', async () => {
    let release!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderDialog({ onConfirm });

    const button = confirmButton();
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);

    expect(onConfirm).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('la guardia resta alzata finché la Promise è pending', async () => {
    let release!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    renderDialog({ onConfirm });

    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Un secondo click **dopo** che il microtask della prima chiamata è già
    // passato: senza attendere davvero la Promise, la guardia sarebbe caduta
    // qui e questa sarebbe una seconda attivazione.
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('dopo il resolve la guardia è rilasciata e un nuovo click riparte', async () => {
    const onConfirm = vi.fn(async () => undefined);
    renderDialog({ onConfirm });

    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it('dopo un reject la guardia è rilasciata: il dialog non resta bloccato', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('Attivazione fallita');
    });
    renderDialog({ onConfirm });

    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it('un reject non lascia una unhandled rejection né rompe la chiusura', async () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn(async () => {
      throw new Error('Attivazione fallita');
    });
    renderDialog({ onConfirm, onCancel });

    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('nessun aggiornamento dopo lo smontaggio: la Promise che risolve dopo non lancia', async () => {
    let release!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { unmount } = renderDialog({ onConfirm });

    fireEvent.click(confirmButton());
    unmount();
    release();
    // Se il `finally` toccasse stato dopo lo smontaggio, React lo segnalerebbe
    // qui: il test fallirebbe sul warning trattato come errore dal setup.
    await Promise.resolve();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

// ── 2. Conferma impossibile senza piano valido ────────────────────────────────

describe('canConfirm — contratto esplicito del chiamante', () => {
  it('piano assente (canConfirm false) ⇒ conferma disabilitata e nessuna chiamata', () => {
    const onConfirm = vi.fn(async () => undefined);
    renderDialog({ canConfirm: false, summary: null, onConfirm });

    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('errore di preflight ⇒ conferma disabilitata, ma l’errore è visibile', () => {
    renderDialog({ canConfirm: false, summary: null, error: 'Verifica non trovata' });

    expect(confirmButton().disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Verifica non trovata');
  });

  it('blocker nel riepilogo ⇒ conferma disabilitata anche con canConfirm true', () => {
    const onConfirm = vi.fn(async () => undefined);
    renderDialog({ canConfirm: true, summary: BLOCKED, onConfirm });

    expect(confirmButton().disabled).toBe(true);
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirmButton().getAttribute('aria-describedby')).toBe('activation-blocked-reason');
  });

  it('busy ⇒ conferma disabilitata', () => {
    renderDialog({ busy: true });
    expect(confirmButton().disabled).toBe(true);
  });

  it('verifica normale (summary null) con piano valido ⇒ conferma ABILITATA', async () => {
    const onConfirm = vi.fn(async () => undefined);
    renderDialog({ summary: null, canConfirm: true, onConfirm });

    expect(confirmButton().disabled).toBe(false);
    expect(screen.getByText(/5 domande verranno congelate/)).toBeTruthy();
    fireEvent.click(confirmButton());
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it('riepilogo senza blocker e piano valido ⇒ conferma abilitata', () => {
    renderDialog();
    expect(confirmButton().disabled).toBe(false);
  });
});

// ── 3. Apertura dall'inizio ───────────────────────────────────────────────────

describe('focus iniziale e apertura del dialog', () => {
  it('il focus va sull’introduzione, non sul primo pulsante', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    const intro = within(dialog).getByText(/non sarà più modificabile/);
    expect(document.activeElement).toBe(intro);
    expect(document.activeElement).not.toBe(confirmButton());
  });

  it('l’introduzione è focalizzabile a programma ma NON nell’ordine di Tab', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    const intro = within(dialog).getByText(/non sarà più modificabile/);
    expect(intro.getAttribute('tabindex')).toBe('-1');
  });

  it('il dialog si apre a scrollTop 0', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.scrollTop).toBe(0);
  });

  it('il footer resta nel DOM e raggiungibile: è dentro il contenitore che scorre', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.contains(confirmButton())).toBe(true);
    expect(dialog.contains(screen.getByRole('button', { name: 'Annulla' }))).toBe(true);
  });

  it('il focus trap continua a ciclare fra i soli elementi focalizzabili', () => {
    renderDialog();
    const dialog = screen.getByRole('alertdialog');
    const [confirm, cancel] = within(dialog).getAllByRole('button') as HTMLButtonElement[];

    // Tab dall'ultimo torna al primo, Shift+Tab dal primo va all'ultimo: il
    // ciclo è quello di sempre, e l'introduzione non ne fa parte.
    cancel!.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(confirm);

    confirm!.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
  });

  it('Escape chiude, come su ogni altro dialog', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Escape non chiude mentre l’attivazione è in corso', () => {
    const { onCancel } = renderDialog({ busy: true });
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ── Regressione: gli altri dialog restano invariati ───────────────────────────

describe('DialogShell — initialFocusRef è opzionale e retrocompatibile', () => {
  it('senza la prop il focus resta sul primo elemento focalizzabile', () => {
    render(
      <DialogShell title="Dialog semplice" onCancel={vi.fn()}>
        <p>Testo</p>
        <button type="button">Primo</button>
        <button type="button">Secondo</button>
      </DialogShell>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Primo' }));
  });

  it('senza la prop il ripristino del focus sul trigger è invariato', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <DialogShell title="Dialog semplice" onCancel={vi.fn()}>
        <button type="button">Primo</button>
      </DialogShell>,
    );
    expect(document.activeElement).not.toBe(trigger);
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('con la prop il focus va sull’elemento richiesto, senza toccare l’ordine di Tab', () => {
    function Harness() {
      const ref = { current: null } as { current: HTMLParagraphElement | null };
      return (
        <DialogShell title="Dialog lungo" onCancel={vi.fn()} initialFocusRef={ref}>
          <p
            tabIndex={-1}
            ref={(node) => {
              ref.current = node;
            }}
          >
            Introduzione
          </p>
          <button type="button">Primo</button>
        </DialogShell>
      );
    }
    render(<Harness />);
    expect((document.activeElement as HTMLElement).textContent).toBe('Introduzione');
    expect((document.activeElement as HTMLElement).getAttribute('tabindex')).toBe('-1');
  });
});
