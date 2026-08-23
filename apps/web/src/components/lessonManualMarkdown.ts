import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import type { Tokens } from 'marked';

/**
 * LESSON-MANUAL-01 — parsing della variante «manuale digitale».
 *
 * **Istanza isolata.** Il renderer legacy registra la propria estensione dei
 * link con `marked.use()` sull'istanza globale del modulo, condivisa da tutte
 * le superfici Markdown (incluse le anteprime editor e IA). Questa variante non
 * tocca quell'istanza: costruisce una `Marked` propria, configurata una volta
 * sola. Il legacy resta quindi identico anche dopo che questa variante è stata
 * usata nella stessa sessione — ed è quanto verifica il test
 * `legacy → lesson → legacy`.
 *
 * **Pipeline obbligatoria (contratto §5.1):**
 *
 *     Markdown → parser controllato → HTML → DOMPurify.sanitize() → render
 *
 * Nessun HTML viene mai generato **dopo** la sanificazione: i callout e gli
 * `id` degli heading nascono durante il parsing, quindi il loro markup
 * attraversa DOMPurify come qualunque altro contenuto invece di aggirarlo.
 */

// ── Callout ────────────────────────────────────────────────────────────────────

/** I cinque tipi ammessi dal contratto. Nessun altro marcatore è interpretato. */
export const CALLOUT_TYPES = ['DEFINITION', 'EXAMPLE', 'IMPORTANT', 'WARNING', 'SOLUTION'] as const;

export type CalloutType = (typeof CALLOUT_TYPES)[number];

const CALLOUT_LABELS: Record<CalloutType, string> = {
  DEFINITION: 'Definizione',
  EXAMPLE: 'Esempio',
  IMPORTANT: 'Importante',
  WARNING: 'Attenzione',
  SOLUTION: 'Soluzione',
};

/**
 * Icone del set SchoolForge, in forma di path inline: nessuna emoji, nessun SVG
 * proveniente dal contenuto. Sono costanti del codice, non dati dell'utente.
 */
const CALLOUT_ICON_PATHS: Record<CalloutType, string> = {
  DEFINITION: '<circle cx="12" cy="12" r="9"></circle><path d="M12 16v-4M12 8h.01"></path>',
  EXAMPLE: '<path d="M4 6h16M4 12h10M4 18h7"></path>',
  IMPORTANT: '<path d="M12 3l9 16H3z"></path><path d="M12 10v4M12 17h.01"></path>',
  WARNING:
    '<path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"></path><path d="M12 9v4M12 17h.01"></path>',
  SOLUTION: '<path d="M20 6L9 17l-5-5"></path>',
};

function calloutIcon(type: CalloutType): string {
  return (
    '<svg class="lm-callout__icon" width="15" height="15" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
    CALLOUT_ICON_PATHS[type] +
    '</svg>'
  );
}

/** Riconosce `[!TIPO]` all'inizio di un blockquote, senza interpretare altro. */
const CALLOUT_MARKER = /^\s*\[!([A-Za-z_]+)\]\s*(?:\r?\n|$)/;

export function parseCalloutType(text: string): CalloutType | null {
  const match = CALLOUT_MARKER.exec(text);
  if (!match) return null;
  const candidate = match[1]!.toUpperCase();
  return (CALLOUT_TYPES as readonly string[]).includes(candidate)
    ? (candidate as CalloutType)
    : null;
}

// ── Slug degli heading ─────────────────────────────────────────────────────────

/**
 * Slug **deterministico**: stesso testo ⇒ stesso slug, indipendentemente
 * dall'ordine di rendering e dalla sessione. Gli accenti sono normalizzati in
 * modo stabile (`NFKD` + rimozione dei diacritici + minuscolo con locale `it`),
 * così `Perché`, `perche` e `PERCHÉ` convergono.
 */
export function headingSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('it')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Fallback deterministico per un heading senza testo utile (solo simboli,
  // solo un'immagine, …): mai un identificatore vuoto o casuale.
  return slug || 'sezione';
}

/**
 * Assegna lo slug tenendo conto dei duplicati: il primo non porta suffisso, i
 * successivi ricevono `-2`, `-3`, … nell'ordine del documento.
 */
export function nextHeadingId(base: string, occurrences: Map<string, number>): string {
  const count = (occurrences.get(base) ?? 0) + 1;
  occurrences.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

export interface LessonHeading {
  id: string;
  level: 2 | 3;
  text: string;
}

// ── Istanza isolata ────────────────────────────────────────────────────────────

/** Escape minimale per il testo che il nostro markup inserisce negli attributi. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LessonParseResult {
  /** HTML **già sanificato**, pronto per il render. */
  html: string;
  /** Heading H2/H3 nell'ordine del documento, con gli id assegnati. */
  headings: LessonHeading[];
}

/**
 * Costruisce l'istanza isolata. Viene creata una volta sola (vedi
 * `lessonMarked` più sotto): le estensioni vivono **solo** qui.
 */
function createLessonMarked(): Marked {
  const instance = new Marked();
  instance.use({
    renderer: {
      // Stesso comportamento sicuro del renderer legacy.
      link({ href, title, text }: Tokens.Link): string {
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
      /**
       * Blockquote: se il testo sorgente inizia con un marcatore riconosciuto
       * diventa un callout; in ogni altro caso resta un blockquote ordinario.
       * Un marcatore sconosciuto (`[!TIP]`) non viene interpretato e resta
       * testo letterale, esattamente come oggi.
       */
      blockquote({ tokens, text }: Tokens.Blockquote): string {
        const type = parseCalloutType(text);
        if (!type) return `<blockquote>${this.parser.parse(tokens)}</blockquote>`;

        // Il marcatore è consumato dal token, non dalla stringa HTML: si
        // riparsa il corpo senza la prima riga.
        const body = text.replace(CALLOUT_MARKER, '');
        const inner = this.parser.parse(instance.lexer(body));
        const label = CALLOUT_LABELS[type];
        const title =
          `<span class="lm-callout__title">${calloutIcon(type)}` +
          `<span>${escapeHtml(label)}</span></span>`;

        if (type === 'SOLUTION') {
          // Controllo nativo, chiuso all'inizio, contenuto sempre nel DOM.
          return (
            `<details class="lm-callout lm-callout--solution">` +
            `<summary>${title}<span class="lm-callout__hint">mostra / nascondi</span></summary>` +
            `<div class="lm-callout__body">${inner}</div></details>`
          );
        }
        return (
          `<div class="lm-callout lm-callout--${type.toLowerCase()}">` +
          `${title}<div class="lm-callout__body">${inner}</div></div>`
        );
      },
    },
  });
  return instance;
}

/** Unica istanza della variante. Non tocca mai `marked` globale. */
export const lessonMarked = createLessonMarked();

/**
 * Configurazione di sanificazione della variante: agli allow-list predefiniti
 * di DOMPurify servono soltanto gli attributi già usati dal legacy più quelli
 * del nostro markup controllato. Nessun tag nuovo viene ammesso a mano.
 */
export const SANITIZE_CONFIG = { ADD_ATTR: ['target', 'rel'] };

/**
 * Esegue l'intera pipeline e restituisce HTML sanificato + heading.
 *
 * Gli `id` degli heading sono assegnati **durante il parsing**, quindi fanno
 * parte dell'HTML che passa per DOMPurify. Non vengono mai derivati da HTML
 * non attendibile né da un `id` presente nel sorgente: la sorgente dello slug è
 * il solo testo dell'heading.
 */
export function parseLessonMarkdown(markdown: string): LessonParseResult {
  const headings: LessonHeading[] = [];
  const occurrences = new Map<string, number>();

  const html = lessonMarked.parse(markdown, {
    async: false,
    walkTokens: (token) => {
      if (token.type !== 'heading') return;
      const heading = token as Tokens.Heading;
      if (heading.depth !== 2 && heading.depth !== 3) return;
      /*
       * Lo slug nasce dal **solo testo** dell'heading: si rimuovono prima gli
       * eventuali tag HTML inline (che DOMPurify tratterà comunque a valle) e
       * poi la punteggiatura Markdown. Così un `id` scritto dall'autore dentro
       * l'heading non può mai diventare l'identificatore della sezione.
       */
      const text = heading.text
        .replace(/<[^>]*>/g, ' ')
        .replace(/[#*_`[\]]/g, '')
        .trim();
      if (!text) return;
      const id = nextHeadingId(headingSlug(text), occurrences);
      headings.push({ id, level: heading.depth === 2 ? 2 : 3, text });
    },
  }) as string;

  const { html: withIds } = injectHeadingIds(html, headings, 0);
  return { html: DOMPurify.sanitize(withIds, SANITIZE_CONFIG), headings };
}

/**
 * Inietta gli `id` riscrivendo i tag di apertura degli heading **prima** della
 * sanificazione, nello stesso ordine in cui sono stati raccolti: nessuna
 * manipolazione DOM post-sanitize.
 *
 * `startIndex` esiste per VE-04A: quando il documento viene reso in due metà
 * attorno alla figura, la seconda metà deve continuare la numerazione della
 * prima invece di ricominciare da capo. Con `startIndex = 0` il comportamento è
 * esattamente quello di sempre, ed è il solo usato dal percorso legacy.
 */
export function injectHeadingIds(
  html: string,
  headings: readonly LessonHeading[],
  startIndex: number,
): { html: string; nextIndex: number } {
  let index = startIndex;
  const withIds = html.replace(/<(h2|h3)>/g, (match) => {
    const heading = headings[index];
    if (!heading) return match;
    index += 1;
    return `<${heading.level === 2 ? 'h2' : 'h3'} id="${escapeHtml(heading.id)}" tabindex="-1">`;
  });
  return { html: withIds, nextIndex: index };
}
