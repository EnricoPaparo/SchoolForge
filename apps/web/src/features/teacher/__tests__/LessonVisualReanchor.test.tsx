import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonVisualReanchorDialog } from '../LessonVisualReanchorDialog.js';
import { LessonVisualAnchorNotice } from '../LessonVisualAnchorNotice.js';

/**
 * VE-04A — avviso e riancoraggio dal punto di vista del docente.
 *
 * Il vincolo che conta: l'elenco contiene **solo** sezioni che nella lezione
 * esistono davvero, e non c'è modo di digitarne una. Un heading scritto a mano
 * verrebbe rifiutato dal server, e offrire di scriverlo significherebbe
 * invitare a un errore.
 */

// Il dialog vive in un portal, quindi le asserzioni guardano `document.body`:
// senza pulizia esplicita i render dei test precedenti resterebbero montati e
// ogni conteggio diventerebbe la somma di tutti i test.
afterEach(cleanup);

const HEADINGS = [
  { text: 'Reti', level: 2 as const },
  { text: 'Topologie', level: 2 as const },
  { text: 'Dettaglio', level: 3 as const },
];

function renderDialog(over: Partial<Parameters<typeof LessonVisualReanchorDialog>[0]> = {}) {
  const onConfirm = vi.fn(async () => {});
  const onCancel = vi.fn();
  const utils = render(
    <LessonVisualReanchorDialog
      headings={HEADINGS}
      currentHeadingText="Reti"
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...over}
    />,
  );
  return { ...utils, onConfirm, onCancel };
}

describe('LessonVisualAnchorNotice', () => {
  it('dice che cosa è successo e dove è finita l’immagine', () => {
    const { container } = render(
      <LessonVisualAnchorNotice headingText="La fotosintesi" onReanchor={() => {}} />,
    );
    expect(container.textContent).toContain(
      'L’immagine non è più ancorata a «La fotosintesi» ed è mostrata in fondo alla lezione.',
    );
  });

  it('offre l’azione di riancoraggio', () => {
    const onReanchor = vi.fn();
    const { container } = render(
      <LessonVisualAnchorNotice headingText="Reti" onReanchor={onReanchor} />,
    );
    const button = container.querySelector('button')!;
    expect(button.textContent).toBe('Riancora');
    fireEvent.click(button);
    expect(onReanchor).toHaveBeenCalledTimes(1);
  });
});

describe('LessonVisualReanchorDialog', () => {
  it('elenca gli heading reali nell’ordine della lezione', () => {
    const { baseElement } = renderDialog();
    const labels = Array.from(baseElement.querySelectorAll('label')).map((l) =>
      l.textContent?.replace('ancora attuale', '').trim(),
    );
    expect(labels).toEqual(['Reti', 'Topologie', 'Dettaglio']);
  });

  /** Nessun campo libero: non si può inventare una sezione. */
  it('non offre alcun campo di testo', () => {
    const { baseElement } = renderDialog();
    expect(baseElement.querySelector('input[type="text"]')).toBeNull();
    expect(baseElement.querySelector('textarea')).toBeNull();
    expect(baseElement.querySelectorAll('input[type="radio"]')).toHaveLength(3);
  });

  it('segnala qual è l’ancora attuale', () => {
    const { baseElement } = renderDialog();
    const current = Array.from(baseElement.querySelectorAll('label')).find((l) =>
      l.textContent?.includes('ancora attuale'),
    );
    expect(current?.textContent).toContain('Reti');
  });

  /** La selezione è obbligatoria: senza, l'azione non è disponibile. */
  it('«Riancora» è disabilitato finché non si sceglie', () => {
    const { baseElement } = renderDialog();
    const confirm = Array.from(baseElement.querySelectorAll('button')).find(
      (b) => b.textContent === 'Riancora',
    )!;
    expect(confirm.disabled).toBe(true);

    fireEvent.click(baseElement.querySelectorAll('input[type="radio"]')[1]!);
    expect(confirm.disabled).toBe(false);
  });

  it('conferma con il testo esatto dell’heading scelto', async () => {
    const { baseElement, onConfirm } = renderDialog();
    fireEvent.click(baseElement.querySelectorAll('input[type="radio"]')[1]!);
    fireEvent.click(
      Array.from(baseElement.querySelectorAll('button')).find((b) => b.textContent === 'Riancora')!,
    );
    expect(onConfirm).toHaveBeenCalledWith('Topologie');
  });

  it('«Annulla» chiude senza riancorare', () => {
    const { baseElement, onCancel, onConfirm } = renderDialog();
    fireEvent.click(
      Array.from(baseElement.querySelectorAll('button')).find((b) => b.textContent === 'Annulla')!,
    );
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /** L'errore resta dentro il dialog: non si cerca altrove. */
  it('mostra l’errore nel dialog e resta aperto', async () => {
    const onConfirm = vi.fn(async () => {
      throw new Error('Il contenuto è cambiato: riprova.');
    });
    const { baseElement } = renderDialog({ onConfirm });

    fireEvent.click(baseElement.querySelectorAll('input[type="radio"]')[0]!);
    fireEvent.click(
      Array.from(baseElement.querySelectorAll('button')).find((b) => b.textContent === 'Riancora')!,
    );
    await vi.waitFor(() => {
      expect(baseElement.querySelector('[role="alert"]')?.textContent).toBe(
        'Il contenuto è cambiato: riprova.',
      );
    });
    // Il dialog non si chiude su errore.
    expect(baseElement.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('una lezione senza sezioni lo dice invece di mostrare un elenco vuoto', () => {
    const { baseElement } = renderDialog({ headings: [] });
    expect(baseElement.querySelector('[role="status"]')?.textContent).toContain(
      'non ha sezioni a cui ancorare',
    );
    expect(baseElement.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });
});

describe('accessibilità del dialog', () => {
  /**
   * Focus trap, Escape e ripristino del focus non sono implementati qui: li
   * possiede `DialogShell`, che è la primitiva condivisa. Ciò che va verificato
   * è che questo dialog **la usi davvero** invece di reimplementare un modale
   * proprio — che è il modo in cui quelle garanzie si perdono.
   */
  it('il focus entra nel dialog all’apertura', () => {
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { baseElement } = renderDialog();
    const dialog = baseElement.querySelector('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);

    trigger.remove();
  });

  it('Escape chiude il dialog', () => {
    const { baseElement, onCancel } = renderDialog();
    fireEvent.keyDown(baseElement.querySelector('[role="dialog"]')!, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('il gruppo di scelte è annunciato come radiogroup etichettato', () => {
    const { baseElement } = renderDialog();
    const group = baseElement.querySelector('[role="radiogroup"]')!;
    const labelledBy = group.getAttribute('aria-labelledby')!;
    expect(baseElement.querySelector(`[id="${labelledBy}"]`)?.textContent).toBe(
      'Sezioni della lezione',
    );
  });

  it('il dialog ha un titolo accessibile', () => {
    const { baseElement } = renderDialog();
    const dialog = baseElement.querySelector('[role="dialog"]')!;
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(baseElement.querySelector(`[id="${labelledBy}"]`)?.textContent).toBe(
      'Riancora l’immagine',
    );
  });
});
