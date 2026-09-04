import { useMemo, type ReactNode } from 'react';
import { parseLessonMarkdown } from './lessonManualMarkdown.js';
import { placeLessonVisuals } from './lessonManualVisual.js';
import { LessonVisualFigure } from './LessonVisualFigure.js';

/**
 * Corpo della lezione nella variante «manuale digitale».
 *
 * Nessuna lettura, nessun listener Firebase e nessuno stato persistito: la
 * resa è derivata esclusivamente dal Markdown già in memoria. L'indice
 * «In questa lezione» è stato rimosso dopo la review visiva in DEV; il corpo
 * editoriale resta identico nelle viste docente e studente.
 *
 * VE-04A aggiunge la figura, e la aggiunge **senza toccare il percorso
 * esistente**: senza `visual` non si lexa niente di diverso, non si divide
 * niente e il DOM prodotto è quello di sempre. La figura vive in un ramo che
 * non esiste per le lezioni che non ne hanno.
 */

export interface LessonVisualRender {
  /** Slug canonico dell'ancora, dal manifest. */
  anchorSlug: string;
  headingText: string;
  altText: string;
  caption: string;
  width: number;
  height: number;
  /** Data URI **già verificato**. `null` mentre i byte non sono disponibili. */
  dataUri: string | null;
  /**
   * Stato della lettura dei byte. La figura viene montata **con il solo
   * manifest**: posizione, avviso e spazio riservato non dipendono dall'arrivo
   * dei byte, che cambiano soltanto il contenuto del frame.
   */
  status: 'ready' | 'loading' | 'unavailable';
}

export function LessonManualBody({
  markdown,
  visual,
  visuals,
  onMissingAnchor,
}: {
  markdown: string;
  /** Assente per la stragrande maggioranza delle lezioni: percorso legacy. */
  visual?: LessonVisualRender | null;
  /** MULTI-VISUAL-04 — ulteriori figure approvate, nell'ordine editoriale. */
  visuals?: LessonVisualRender[];
  /**
   * Notifica alla vista che l'ancora non si risolve più. Serve al solo docente,
   * che può riancorare; lo studente non riceve nulla di tecnico e vede
   * semplicemente la figura in fondo.
   */
  onMissingAnchor?: ReactNode;
}) {
  const additionalVisuals = (visuals ?? []).filter(
    (item) => item.anchorSlug !== visual?.anchorSlug,
  );
  const allVisuals = visual ? [visual, ...additionalVisuals] : additionalVisuals;
  // Only Markdown and ordered anchors affect sanitized fragments. Byte/status,
  // caption and array identity updates must update figures without re-parsing.
  // JSON preserves ordering, duplicates and delimiter-containing slugs exactly.
  const anchorSignature = JSON.stringify(allVisuals.map((item) => item.anchorSlug));
  const rendered = useMemo(() => {
    const anchorSlugs = JSON.parse(anchorSignature) as string[];
    return anchorSlugs.length > 0
      ? { multi: placeLessonVisuals({ markdown, anchorSlugs }), html: null }
      : { multi: null, html: parseLessonMarkdown(markdown).html };
  }, [markdown, anchorSignature]);
  const multiPlacement = rendered.multi;
  const renderFigure = (item: LessonVisualRender, key: string) => (
    <LessonVisualFigure
      key={key}
      src={item.dataUri}
      altText={item.altText}
      caption={item.caption}
      width={item.width}
      height={item.height}
      status={item.status}
    />
  );
  const visualSequence: ReactNode[] | null = multiPlacement
    ? [
        ...multiPlacement.groups.flatMap((group, groupIndex) => [
          <div
            key={`visual-group-${groupIndex}`}
            className="prose prose--manual"
            dangerouslySetInnerHTML={{ __html: group.html }}
          />,
          ...group.visualIndexes.map((index) =>
            renderFigure(allVisuals[index]!, `visual-${index}`),
          ),
        ]),
        ...(multiPlacement.missingVisualIndexes.length > 0 && onMissingAnchor
          ? [<div key="visual-missing-anchor-notice">{onMissingAnchor}</div>]
          : []),
        ...multiPlacement.missingVisualIndexes.map((index) =>
          renderFigure(allVisuals[index]!, `visual-missing-${index}`),
        ),
      ]
    : null;

  return (
    <div className="lesson-manual-scope">
      <div className="lesson-manual">
        <div className="lesson-manual__body">
          {visualSequence ?? (
            /*
             * Unico `dangerouslySetInnerHTML` ammesso: l'HTML finale restituito
             * da DOMPurify. Nessun markup viene aggiunto dopo la sanificazione.
             */
            <div
              className="prose prose--manual"
              dangerouslySetInnerHTML={{ __html: rendered.html ?? '' }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
