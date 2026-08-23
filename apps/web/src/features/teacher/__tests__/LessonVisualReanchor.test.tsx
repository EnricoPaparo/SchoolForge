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
  { index: 0, text: 'Reti', slug: 'reti', level: 2 as const },
  { index: 1, text: 'Topologie', slug: 'topologie', level: 2 as const },
  { index: 2, text: 'Dettaglio', slug: 'dettaglio', level: 3 as const },
];

/** Due sezioni omonime: senza indice sarebbero indistinguibili. */
const DUPLICATE_HEADINGS = [
  { index: 0, text: 'Reti', slug: 'reti', level: 2 as const },
  { index: 1, text: 'Reti', slug: 'reti-2', level: 2 as const },
  { index: 2, text: 'Reti', slug: 'reti-3', level: 2 as const },
];

function renderDialog(over: Partial<Parameters<typeof LessonVisualReanchorDialog>[0]> = {}) {
  const onConfirm = vi.fn(async () => {});
  const onCancel = vi.fn();
  const utils = render(
    <LessonVisualReanchorDialog
      headings={HEADINGS}
      currentAnchorSlug="reti"
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
    const current = Array.from(baseElement.querySelectorAll('label')).filter((l) =>
      l.textContent?.includes('ancora attuale'),
    );
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain('Reti');
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

  it('conferma con l’opzione scelta, indice compreso', async () => {
    const { baseElement, onConfirm } = renderDialog();
    fireEvent.click(baseElement.querySelectorAll('input[type="radio"]')[1]!);
    fireEvent.click(
      Array.from(baseElement.querySelectorAll('button')).find((b) => b.textContent === 'Riancora')!,
    );
    expect(onConfirm).toHaveBeenCalledWith(HEADINGS[1]);
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

describe('heading omonimi — identità per indice, non per testo', () => {
  /**
   * Il difetto che questo blocco impedisce: con il testo come chiave, cliccare
   * la seconda «Reti» selezionerebbe **tutte e tre** le radio, e il docente non
   * potrebbe scegliere quale sezione ancorare.
   */
  it('le radio omonime sono indipendenti', () => {
    const { baseElement } = renderDialog({
      headings: DUPLICATE_HEADINGS,
      currentAnchorSlug: 'reti',
    });
    const radios = Array.from(
      baseElement.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );

    fireEvent.click(radios[1]!);

    expect(radios.map((r) => r.checked)).toEqual([false, true, false]);
  });

  it('conferma la seconda occorrenza con il suo indice e il suo slug', () => {
    const { baseElement, onConfirm } = renderDialog({
      headings: DUPLICATE_HEADINGS,
      currentAnchorSlug: 'reti',
    });
    fireEvent.click(baseElement.querySelectorAll('input[type="radio"]')[1]!);
    fireEvent.click(
      Array.from(baseElement.querySelectorAll('button')).find((b) => b.textContent === 'Riancora')!,
    );
    expect(onConfirm).toHaveBeenCalledWith(DUPLICATE_HEADINGS[1]);
  });

  it('distingue le occorrenze in modo leggibile', () => {
    const { baseElement } = renderDialog({
      headings: DUPLICATE_HEADINGS,
      currentAnchorSlug: 'reti',
    });
    const labels = Array.from(baseElement.querySelectorAll('label')).map((l) => l.textContent);
    expect(labels[0]).toContain('prima occorrenza');
    expect(labels[1]).toContain('seconda occorrenza');
    expect(labels[2]).toContain('terza occorrenza');
  });

  /** Un titolo unico non riceve la nota: sarebbe rumore. */
  it('non annota le occorrenze quando il titolo è unico', () => {
    const { baseElement } = renderDialog();
    for (const label of Array.from(baseElement.querySelectorAll('label'))) {
      expect(label.textContent).not.toContain('occorrenza');
    }
  });

  /**
   * `currentAnchorSlug` e non il testo: con due «Reti» il testo indicherebbe
   * entrambe le righe come ancora attuale.
   */
  it('l’ancora attuale è indicata su una sola riga', () => {
    const { baseElement } = renderDialog({
      headings: DUPLICATE_HEADINGS,
      currentAnchorSlug: 'reti-2',
    });
    const marked = Array.from(baseElement.querySelectorAll('label')).filter((l) =>
      l.textContent?.includes('ancora attuale'),
    );
    expect(marked).toHaveLength(1);
    expect(marked[0]?.textContent).toContain('seconda occorrenza');
  });
});
