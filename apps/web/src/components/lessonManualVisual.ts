import DOMPurify from 'dompurify';
import type { Tokens, TokensList } from 'marked';
import {
  canonicalLessonHeadingText,
  lessonHeadingSlug,
  nextLessonHeadingSlug,
} from '@schoolforge/lesson-contract';
import {
  SANITIZE_CONFIG,
  injectHeadingIds,
  lessonMarked,
  type LessonHeading,
} from './lessonManualMarkdown.js';

/**
 * VISUAL-ENRICHMENT-04A — inserimento della figura **dentro** la lezione.
 *
 * **Il Markdown non viene mai toccato.** Non si inietta un `![](…)`, non si
 * normalizza, non si riscrive: è la stessa garanzia di
 * `lesson-manual-contract.md` §8, e qui vale con la stessa forza. La figura non
 * entra nel testo, entra nell'**albero React**.
 *
 * Pipeline, che è il contratto di questo modulo:
 *
 *     Markdown
 *       → istanza `Marked` isolata già esistente (mai `marked.use()` globale)
 *       → token stream
 *       → individuazione dell'heading tramite lo slug canonico
 *       → split dei token in due gruppi
 *       → HTML A e HTML B
 *       → DOMPurify.sanitize(A) e DOMPurify.sanitize(B)
 *       → React: frammento A + <figure> + frammento B
 *
 * Le due metà sono sanificate **separatamente e per intero**: nessuna stringa
 * viene concatenata dopo `sanitize`, e nessun markup nasce dopo di esso. La
 * figura non è HTML: è un componente React con `caption` e `altText` passati
 * come testo, quindi non c'è alcun punto in cui un contenuto del docente possa
 * diventare markup.
 *
 * **Senza manifest questo modulo non viene nemmeno chiamato**: la vista usa il
 * percorso legacy invariato, e il DOM resta identico a quello di oggi.
 */

/** Esito strutturato: la vista deve poter distinguere questi quattro casi. */
export type LessonVisualPlacement =
  /** Heading trovato: la figura sta subito dopo quella sezione. */
  | { status: 'anchored'; before: string; after: string }
  /**
   * Il manifest c'è ma l'heading non esiste più nel corpo: la figura va in
   * fondo, e il docente va avvisato. Non è un errore — il docente ha
   * legittimamente riscritto la lezione — ma non è nemmeno il caso normale.
   */
  | { status: 'missing_anchor'; before: string; after: string }
  /** Nessun manifest: percorso legacy, nessuna figura. */
  | { status: 'absent'; html: string }
  /**
   * Manifest o byte non conformi. **Fail-closed**: si rende la lezione senza
   * figura, mai una figura parziale o un'immagine rotta.
   */
  | { status: 'malformed'; html: string; reason: string };

/**
 * Un token list di marked porta con sé i riferimenti dei link (`[testo][rif]`)
 * raccolti in fase di lex. Affettare l'array li perderebbe, e un link
 * referenziato dopo lo split smetterebbe di risolversi: la stessa lezione
 * renderizzata con e senza figura darebbe due risultati diversi.
 */
function sliceTokens(tokens: TokensList, start: number, end: number): TokensList {
  const slice = tokens.slice(start, end) as unknown as TokensList;
  slice.links = tokens.links;
  return slice;
}

/**
 * Percorre i token assegnando gli `id` **come il renderer intero**, cioè con un
 * unico contatore di duplicati su tutto il documento. Contare per metà
 * produrrebbe `reti` due volte invece di `reti` e `reti-2`.
 */
function collectHeadings(tokens: TokensList): LessonHeading[] {
  const headings: LessonHeading[] = [];
  const occurrences = new Map<string, number>();
  for (const token of tokens) {
    if (token.type !== 'heading') continue;
    const heading = token as Tokens.Heading;
    if (heading.depth !== 2 && heading.depth !== 3) continue;
    const text = canonicalLessonHeadingText(heading.text);
    if (!text) continue;
    headings.push({
      id: nextLessonHeadingSlug(lessonHeadingSlug(text), occurrences),
      level: heading.depth === 2 ? 2 : 3,
      text,
    });
  }
  return headings;
}

/**
 * Trova l'indice del token heading il cui `id` è lo slug cercato.
 *
 * Il confronto è sullo **slug canonico**, non sul testo: è lo slug che il
 * server ha memorizzato nel manifest, ed è lo stesso che questo renderer
 * assegna agli `id` (tabella condivisa, vedi `lessonHeadingSlug.test.ts`).
 */
function findAnchorTokenIndex(tokens: TokensList, slug: string): number {
  const occurrences = new Map<string, number>();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token.type !== 'heading') continue;
    const heading = token as Tokens.Heading;
    if (heading.depth !== 2 && heading.depth !== 3) continue;
    const text = canonicalLessonHeadingText(heading.text);
    if (!text) continue;
    if (nextLessonHeadingSlug(lessonHeadingSlug(text), occurrences) === slug) return i;
  }
  return -1;
}

/** Rende un gruppo di token in HTML **già sanificato**, con gli id corretti. */
function renderGroup(
  tokens: TokensList,
  headings: LessonHeading[],
  startIndex: number,
): { html: string; nextIndex: number } {
  if (tokens.length === 0) return { html: '', nextIndex: startIndex };
  const raw = lessonMarked.parser(tokens);
  const { html, nextIndex } = injectHeadingIds(raw, headings, startIndex);
  return { html: DOMPurify.sanitize(html, SANITIZE_CONFIG), nextIndex };
}

/**
 * Calcola dove va la figura e produce le due metà sanificate.
 *
 * `anchorSlug` assente ⇒ `absent`: la vista rende il percorso legacy e non
 * chiama nemmeno questo modulo, ma il caso è gestito lo stesso perché un
 * chiamante distratto non deve poter ottenere una figura senza manifest.
 */
export function placeLessonVisual(params: {
  markdown: string;
  anchorSlug: string | null;
}): LessonVisualPlacement {
  const { markdown, anchorSlug } = params;

  const tokens = lessonMarked.lexer(markdown);
  const headings = collectHeadings(tokens);

  if (anchorSlug === null) {
    const { html } = renderGroup(tokens, headings, 0);
    return { status: 'absent', html };
  }

  const anchorIndex = findAnchorTokenIndex(tokens, anchorSlug);

  if (anchorIndex === -1) {
    // L'ancora non esiste più: tutto il corpo prima, figura in fondo. Non si
    // indovina una sezione «vicina»: sarebbe una scelta editoriale che il
    // renderer non ha titolo per fare.
    const { html } = renderGroup(tokens, headings, 0);
    return { status: 'missing_anchor', before: html, after: '' };
  }

  // Lo split cade **dopo** il token dell'heading: `placement: 'after-heading'`
  // è l'unico valore ammesso dal manifest, e significa esattamente questo.
  const splitAt = anchorIndex + 1;
  const first = renderGroup(sliceTokens(tokens, 0, splitAt), headings, 0);
  const second = renderGroup(
    sliceTokens(tokens, splitAt, tokens.length),
    headings,
    first.nextIndex,
  );

  return { status: 'anchored', before: first.html, after: second.html };
}
