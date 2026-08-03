import { useMemo } from 'react';
import { parseLessonMarkdown } from './lessonManualMarkdown.js';

/**
 * Corpo della lezione nella variante «manuale digitale».
 *
 * Nessuna lettura, nessun listener Firebase e nessuno stato persistito: la
 * resa è derivata esclusivamente dal Markdown già in memoria. L'indice
 * «In questa lezione» è stato rimosso dopo la review visiva in DEV; il corpo
 * editoriale resta identico nelle viste docente e studente.
 */
export function LessonManualBody({ markdown }: { markdown: string }) {
  const { html } = useMemo(() => parseLessonMarkdown(markdown), [markdown]);

  return (
    <div className="lesson-manual-scope">
      <div className="lesson-manual">
        <div className="lesson-manual__body">
          {/*
           * Unico `dangerouslySetInnerHTML` ammesso: l'HTML finale restituito da
           * DOMPurify. Nessun markup viene aggiunto dopo la sanificazione.
           */}
          <div className="prose prose--manual" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}
