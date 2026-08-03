import { useEffect, useMemo, useRef, useState } from 'react';
import { parseLessonMarkdown, shouldShowToc, type LessonHeading } from './lessonManualMarkdown.js';

/**
 * LESSON-MANUAL-01 — corpo della lezione nella variante «manuale digitale».
 *
 * Rende l'HTML **già sanificato** prodotto da `parseLessonMarkdown` e, quando
 * la lezione ha almeno tre heading significativi, l'indice laterale (desktop) e
 * quello compatto (mobile). Nessuna lettura, nessun listener Firebase, nessuno
 * stato persistito: tutto è derivato dal solo Markdown già in memoria.
 */

/**
 * Risolve un id **solo** se appartiene a un heading generato da noi. Un `id`
 * scritto dall'autore dentro il Markdown sopravvive alla sanificazione ed è
 * legittimo, ma non deve poter dirottare le ancore dell'indice: restringere il
 * selettore a `h2`/`h3` rende la collisione impossibile.
 */
function findHeading(root: HTMLElement, id: string): HTMLElement | null {
  // Gli slug generati contengono solo `[a-z0-9-]`, quindi sono già selettori
  // validi; `CSS.escape` resta la via preferita dove esiste (jsdom non lo
  // fornisce), e in sua assenza si rifiuta comunque qualunque forma inattesa.
  if (!/^[a-z0-9-]+$/.test(id)) return null;
  const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  return root.querySelector<HTMLElement>(`h2#${escaped}, h3#${escaped}`);
}

function TocLinks({
  headings,
  currentId,
  onNavigate,
}: {
  headings: LessonHeading[];
  currentId: string | null;
  onNavigate: (id: string) => void;
}) {
  return (
    <ul className="lm-toc__list">
      {headings.map((heading) => (
        <li key={heading.id} data-level={heading.level}>
          <a
            href={`#${heading.id}`}
            {...(currentId === heading.id ? { 'aria-current': 'true' as const } : {})}
            onClick={(event) => {
              /*
               * Navigazione controllata: si porta la sezione in vista e le si
               * sposta il focus, **senza** aggiungere una voce alla cronologia
               * (il default dell'ancora la aggiungerebbe a ogni click).
               */
              event.preventDefault();
              onNavigate(heading.id);
            }}
          >
            {heading.text}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function LessonManualBody({ markdown }: { markdown: string }) {
  // Parsing memoizzato sul solo contenuto: cambia solo quando cambia la lezione.
  const { html, headings } = useMemo(() => parseLessonMarkdown(markdown), [markdown]);
  const showToc = shouldShowToc(headings);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mobileTocRef = useRef<HTMLDetailsElement>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /*
   * **Un solo** IntersectionObserver per vista, ricostruito quando cambiano gli
   * heading e disconnesso sia allo smontaggio sia prima di ogni ricostruzione.
   * Nessun listener per heading, nessuno `scroll`, nessuna scrittura nella
   * cronologia: l'osservatore aggiorna esclusivamente la sezione corrente.
   */
  useEffect(() => {
    if (!showToc) {
      setCurrentId(null);
      return;
    }
    const root = bodyRef.current;
    if (!root || typeof IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!mountedRef.current) return;
        for (const entry of entries) {
          if (entry.isIntersecting) setCurrentId(entry.target.id);
        }
      },
      { rootMargin: '-20% 0px -70% 0px' },
    );
    for (const heading of headings) {
      const node = findHeading(root, heading.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [headings, showToc]);

  /** Porta la sezione in vista e le sposta il focus, senza toccare la history. */
  function navigateTo(id: string) {
    const root = bodyRef.current;
    const target = root ? findHeading(root, id) : null;
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    target.focus({ preventScroll: true });
  }

  /*
   * Il contenitore esterno dichiara il **container query context**: la scelta
   * fra indice laterale e indice compatto dipende dallo spazio realmente
   * disponibile per la lezione, non dalla larghezza del viewport. Nella vista
   * docente la sidebar del corso sottrae ~270 px, e una media query sul
   * viewport avrebbe compresso la colonna di lettura fino a ~51 caratteri.
   */
  return (
    <div className="lesson-manual-scope">
      <div className={`lesson-manual${showToc ? ' lesson-manual--with-toc' : ''}`}>
        <div className="lesson-manual__body" ref={bodyRef}>
          {showToc && (
            <details className="lm-toc-mobile" ref={mobileTocRef}>
              <summary>In questa lezione</summary>
              <nav aria-label="Indice della lezione">
                <TocLinks
                  headings={headings}
                  currentId={currentId}
                  onNavigate={(id) => {
                    navigateTo(id);
                    if (mobileTocRef.current) mobileTocRef.current.open = false;
                  }}
                />
              </nav>
            </details>
          )}
          {/*
           * Unico `dangerouslySetInnerHTML` ammesso: l'HTML finale restituito da
           * DOMPurify. Nessun markup viene aggiunto dopo la sanificazione.
           */}
          <div className="prose prose--manual" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        {showToc && (
          <nav className="lm-toc" aria-label="Indice della lezione">
            <p className="lm-toc__title">In questa lezione</p>
            <TocLinks headings={headings} currentId={currentId} onNavigate={navigateTo} />
          </nav>
        )}
      </div>
    </div>
  );
}
