import { useMemo, type ReactNode } from 'react';
import { parseLessonMarkdown } from './lessonManualMarkdown.js';
import { placeLessonVisual, type LessonVisualPlacement } from './lessonManualVisual.js';
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
  onMissingAnchor,
}: {
  markdown: string;
  /** Assente per la stragrande maggioranza delle lezioni: percorso legacy. */
  visual?: LessonVisualRender | null;
  /**
   * Notifica alla vista che l'ancora non si risolve più. Serve al solo docente,
   * che può riancorare; lo studente non riceve nulla di tecnico e vede
   * semplicemente la figura in fondo.
   */
  onMissingAnchor?: ReactNode;
}) {
  const legacy = useMemo(
    // Il percorso legacy resta l'unico attivo finché non c'è davvero una
    // figura da mostrare: `dataUri` nullo significa «byte non ancora letti» o
    // «byte rifiutati», e in entrambi i casi la lezione si legge com'era.
    () => (visual ? null : parseLessonMarkdown(markdown)),
    [markdown, visual],
  );

  const placement: LessonVisualPlacement | null = useMemo(
    () => (visual ? placeLessonVisual({ markdown, anchorSlug: visual.anchorSlug }) : null),
    [markdown, visual],
  );

  const figure =
    visual && placement && placement.status !== 'absent' ? (
      <LessonVisualFigure
        src={visual.dataUri}
        altText={visual.altText}
        caption={visual.caption}
        width={visual.width}
        height={visual.height}
        status={visual.status}
      />
    ) : null;

  /**
   * `absent` e `malformed` producono la stessa cosa — la lezione senza figura —
   * ma per motivi diversi, ed è il chiamante a doverli distinguere se vuole
   * registrarli. Qui entrambi confluiscono nel percorso a un solo frammento:
   * fail-closed significa proprio che un manifest non conforme non produce
   * un'immagine parziale, produce la lezione di prima.
   */
  const split =
    placement !== null && (placement.status === 'anchored' || placement.status === 'missing_anchor')
      ? placement
      : null;

  const singleHtml =
    legacy?.html ??
    (placement !== null && split === null ? (placement as { html: string }).html : null);

  return (
    <div className="lesson-manual-scope">
      <div className="lesson-manual">
        <div className="lesson-manual__body">
          {split === null ? (
            /*
             * Unico `dangerouslySetInnerHTML` ammesso: l'HTML finale restituito
             * da DOMPurify. Nessun markup viene aggiunto dopo la sanificazione.
             */
            <div
              className="prose prose--manual"
              dangerouslySetInnerHTML={{ __html: singleHtml ?? '' }}
            />
          ) : (
            <>
              {/*
               * Due frammenti sanificati **separatamente**, con la figura in
               * mezzo come nodo React. Nessuna concatenazione di stringhe dopo
               * `sanitize`: le due metà non si toccano mai.
               */}
              <div
                className="prose prose--manual"
                dangerouslySetInnerHTML={{ __html: split.before }}
              />
              {split.status === 'missing_anchor' && onMissingAnchor}
              {figure}
              {split.after !== '' && (
                <div
                  className="prose prose--manual"
                  dangerouslySetInnerHTML={{ __html: split.after }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
