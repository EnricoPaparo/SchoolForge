/**
 * Pure layout helpers for the student verification PDF.
 * Kept free of any jsPDF dependency so they can be unit tested directly —
 * `verificationPdf.ts` calls these to get coordinates, then replays them
 * against a real jsPDF document.
 */

export type FieldLineLayout = {
  labelX: number;
  labelY: number;
  lineY: number;
  lineStartX: number;
  lineEndX: number;
};

/**
 * Computes the layout for a labeled fill-in line (e.g. "Nome e Cognome:", "Data:").
 * `lineEndX` only depends on margin/pageWidth, never on the label — so stacking
 * several of these fields always yields lines that end flush with each other,
 * regardless of how long each label is.
 */
export function computeFieldLineLayout(params: {
  margin: number;
  pageWidth: number;
  y: number;
  labelWidth: number;
  gapAfterLabel?: number;
}): FieldLineLayout {
  const { margin, pageWidth, y, labelWidth, gapAfterLabel = 2 } = params;
  return {
    labelX: margin,
    labelY: y,
    lineY: y + 1,
    lineStartX: margin + labelWidth + gapAfterLabel,
    lineEndX: pageWidth - margin,
  };
}

export type AnswerAreaKind = 'none' | 'options';

/**
 * `aperta` questions get no ruled answer area on the student PDF — the student
 * writes on a separate sheet. `chiusa_singola`/`chiusa_multipla` get option
 * checkboxes.
 */
export function getAnswerAreaKind(
  tipo: 'aperta' | 'chiusa_singola' | 'chiusa_multipla',
): AnswerAreaKind {
  return tipo === 'aperta' ? 'none' : 'options';
}

export type OptionBoxLayout = {
  boxX: number;
  boxY: number;
  boxSize: number;
  textX: number;
};

/**
 * Computes a small square checkbox layout for each answer option, drawn with
 * jsPDF `rect()` primitives instead of text glyphs (○/☐ characters render
 * inconsistently depending on font/platform).
 */
export function computeOptionBoxLayouts(params: {
  count: number;
  margin: number;
  startY: number;
  rowHeightMm: number;
  boxSize?: number;
  indent?: number;
}): OptionBoxLayout[] {
  const { count, margin, startY, rowHeightMm, boxSize = 3.5, indent = 6 } = params;
  const boxX = margin + indent;
  return Array.from({ length: count }, (_, i) => {
    const rowY = startY + i * rowHeightMm;
    return {
      boxX,
      boxY: rowY - boxSize,
      boxSize,
      textX: boxX + boxSize + 2,
    };
  });
}
