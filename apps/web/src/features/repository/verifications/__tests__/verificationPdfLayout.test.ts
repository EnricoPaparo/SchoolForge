import { describe, expect, it } from 'vitest';
import {
  computeFieldLineLayout,
  computeOptionBoxLayouts,
  getAnswerAreaKind,
} from '../verificationPdfLayout.js';

describe('computeFieldLineLayout', () => {
  it('ends both a short and a long label line at the same x regardless of label width', () => {
    const short = computeFieldLineLayout({
      margin: 20,
      pageWidth: 210,
      y: 50,
      labelWidth: 10, // "Data:"
    });
    const long = computeFieldLineLayout({
      margin: 20,
      pageWidth: 210,
      y: 59,
      labelWidth: 35, // "Nome e Cognome:"
    });

    expect(short.lineEndX).toBe(long.lineEndX);
    expect(short.lineEndX).toBe(210 - 20);
  });

  it('starts the line right after the label plus the configured gap', () => {
    const layout = computeFieldLineLayout({
      margin: 20,
      pageWidth: 210,
      y: 50,
      labelWidth: 30,
      gapAfterLabel: 2,
    });
    expect(layout.lineStartX).toBe(20 + 30 + 2);
  });

  it('positions the label and the line on the same row (label y and line y within 1mm)', () => {
    const layout = computeFieldLineLayout({ margin: 20, pageWidth: 210, y: 50, labelWidth: 10 });
    expect(Math.abs(layout.lineY - layout.labelY)).toBeLessThanOrEqual(1);
  });
});

describe('getAnswerAreaKind', () => {
  it('returns "none" for aperta questions — no ruled answer lines', () => {
    expect(getAnswerAreaKind('aperta')).toBe('none');
  });

  it('returns "options" for chiusa_singola and chiusa_multipla', () => {
    expect(getAnswerAreaKind('chiusa_singola')).toBe('options');
    expect(getAnswerAreaKind('chiusa_multipla')).toBe('options');
  });
});

describe('computeOptionBoxLayouts', () => {
  it('returns one layout per option', () => {
    const layouts = computeOptionBoxLayouts({ count: 3, margin: 20, startY: 100, rowHeightMm: 6 });
    expect(layouts).toHaveLength(3);
  });

  it('keeps every box aligned on the same x (boxX constant across options)', () => {
    const layouts = computeOptionBoxLayouts({ count: 4, margin: 20, startY: 100, rowHeightMm: 6 });
    const xs = new Set(layouts.map((l) => l.boxX));
    expect(xs.size).toBe(1);
  });

  it('spaces each box vertically by rowHeightMm', () => {
    const layouts = computeOptionBoxLayouts({ count: 3, margin: 20, startY: 100, rowHeightMm: 6 });
    expect(layouts[1].boxY - layouts[0].boxY).toBe(6);
    expect(layouts[2].boxY - layouts[1].boxY).toBe(6);
  });

  it('places the option text after the box with a small gap, never overlapping it', () => {
    const [layout] = computeOptionBoxLayouts({
      count: 1,
      margin: 20,
      startY: 100,
      rowHeightMm: 6,
      boxSize: 3.5,
    });
    expect(layout.textX).toBe(layout.boxX + layout.boxSize + 2);
  });
});
