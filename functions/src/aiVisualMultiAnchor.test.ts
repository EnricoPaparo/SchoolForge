import { describe, expect, it } from 'vitest';
import {
  listMultiVisualAnchorableHeadings,
  resolveVisualAnchorForWrite,
  validateVisualAnchorSelector,
} from './aiVisualMultiAnchor.js';
import { AiVisualMultiError } from './aiVisualMultiCore.js';

/**
 * MULTI-VISUAL-01 — ancoraggio indice+testo (roadmap §7.1–§7.3). Riusa
 * `listAnchorableHeadings`/`resolveAnchorByIndex` di VE: qui si verifica solo
 * il comportamento visto dal contratto multi-immagine (collisioni,
 * mismatch fail-closed, codice d'errore tradotto).
 */

const BODY_TWO_SECTIONS = [
  '## Introduzione',
  '',
  'Testo introduttivo.',
  '',
  '## Reti',
  '',
  'Testo sulle reti locali.',
  '',
  '### Dettaglio tecnico',
  '',
  'Altro testo.',
  '',
].join('\n');

const BODY_COLLISION = [
  '## Reti',
  '',
  'Primo paragrafo.',
  '',
  '## Reti',
  '',
  'Secondo paragrafo.',
  '',
].join('\n');

describe('validateVisualAnchorSelector', () => {
  it('accetta un selettore valido', () => {
    expect(
      validateVisualAnchorSelector({ anchorHeadingIndex: 0, anchorHeadingText: 'Reti' }),
    ).toEqual({
      anchorHeadingIndex: 0,
      anchorHeadingText: 'Reti',
    });
  });

  it('rifiuta un indice negativo', () => {
    expect(() =>
      validateVisualAnchorSelector({ anchorHeadingIndex: -1, anchorHeadingText: 'Reti' }),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta un indice non intero', () => {
    expect(() =>
      validateVisualAnchorSelector({ anchorHeadingIndex: 1.5, anchorHeadingText: 'Reti' }),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta chiavi extra', () => {
    expect(() =>
      validateVisualAnchorSelector({ anchorHeadingIndex: 0, anchorHeadingText: 'Reti', extra: 1 }),
    ).toThrow(AiVisualMultiError);
  });

  it('rifiuta un testo con spazi esterni', () => {
    expect(() =>
      validateVisualAnchorSelector({ anchorHeadingIndex: 0, anchorHeadingText: ' Reti ' }),
    ).toThrow(AiVisualMultiError);
  });
});

describe('listMultiVisualAnchorableHeadings', () => {
  it("enumera solo gli heading H2/H3, per indice, nell'ordine del documento", () => {
    const headings = listMultiVisualAnchorableHeadings(BODY_TWO_SECTIONS);
    expect(headings.map((h) => h.text)).toEqual(['Introduzione', 'Reti', 'Dettaglio tecnico']);
    expect(headings.map((h) => h.index)).toEqual([0, 1, 2]);
  });

  it('due heading omonimi restano due voci distinte, mai deduplicate per testo', () => {
    const headings = listMultiVisualAnchorableHeadings(BODY_COLLISION);
    expect(headings).toHaveLength(2);
    expect(headings[0]?.text).toBe('Reti');
    expect(headings[1]?.text).toBe('Reti');
    expect(headings[0]?.slug).toBe('reti');
    expect(headings[1]?.slug).toBe('reti-2');
  });
});

describe('resolveVisualAnchorForWrite — alla promozione/riancoraggio (§7.2.1)', () => {
  it('risolve indice+testo su un corpo invariato', () => {
    const resolved = resolveVisualAnchorForWrite(
      { anchorHeadingIndex: 1, anchorHeadingText: 'Reti' },
      BODY_TWO_SECTIONS,
    );
    expect(resolved).toEqual({
      headingSlug: 'reti',
      headingText: 'Reti',
      placement: 'after-heading',
    });
  });

  it('due heading omonimi risolvono a slug distinti, indipendentemente da quale sia stato scelto', () => {
    const first = resolveVisualAnchorForWrite(
      { anchorHeadingIndex: 0, anchorHeadingText: 'Reti' },
      BODY_COLLISION,
    );
    const second = resolveVisualAnchorForWrite(
      { anchorHeadingIndex: 1, anchorHeadingText: 'Reti' },
      BODY_COLLISION,
    );
    expect(first.headingSlug).toBe('reti');
    expect(second.headingSlug).toBe('reti-2');
  });

  it('indice fuori range dopo modifica del corpo ⇒ visual_promotion_anchor_stale, fail-closed', () => {
    let thrown: unknown;
    try {
      resolveVisualAnchorForWrite(
        { anchorHeadingIndex: 5, anchorHeadingText: 'Reti' },
        BODY_TWO_SECTIONS,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('visual_promotion_anchor_stale');
  });

  it("testo non corrispondente all'indice dopo riordino ⇒ visual_promotion_anchor_stale", () => {
    let thrown: unknown;
    try {
      resolveVisualAnchorForWrite(
        { anchorHeadingIndex: 1, anchorHeadingText: 'Un testo che non esiste più' },
        BODY_TWO_SECTIONS,
      );
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AiVisualMultiError);
    expect((thrown as AiVisualMultiError).code).toBe('visual_promotion_anchor_stale');
  });

  it("retry con un'ancora aggiornata dopo un fail-closed riesce, zero rigenerazione richiesta", () => {
    // Il docente sceglie di nuovo fra gli heading ATTUALI: stesso selettore,
    // stessa risoluzione pura, nessuno stato residuo da un tentativo fallito.
    const resolved = resolveVisualAnchorForWrite(
      { anchorHeadingIndex: 2, anchorHeadingText: 'Dettaglio tecnico' },
      BODY_TWO_SECTIONS,
    );
    expect(resolved.headingSlug).toBe('dettaglio-tecnico');
  });
});
