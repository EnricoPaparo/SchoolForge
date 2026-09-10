/**
 * CONCEPT-MAP-01 — contratto completo dell'artefatto «mappa concettuale»:
 * validazione dei tre campi del provider, composizione **deterministica** del
 * Markdown canonico e **validazione del documento persistito** riusata dal
 * parser del run.
 *
 * Le tre cose stanno nello stesso modulo perché sono un contratto solo. I campi
 * del modello non sono un documento e lo diventano unicamente attraverso
 * `composeConceptMapMarkdown`; il documento persistito, a sua volta, è valido
 * solo se è **esattamente** ciò che quella composizione avrebbe prodotto.
 * Separarli inviterebbe a comporre senza validare, o ad accettare in replay un
 * documento che nessuna composizione avrebbe mai generato.
 *
 * **Perché la struttura non è affidata al prompt.** Un prompt può chiedere
 * quattro sezioni nell'ordine giusto; non può garantirle. Qui il modello
 * fornisce solo i contenuti e il server decide intestazioni, ordine, fence del
 * diagramma e avvertenza: presenza e sequenza delle quattro parti diventano
 * proprietà del codice, non esiti probabili di una generazione.
 *
 * **Quasi nessun aggiustamento silenzioso.** Non si tronca, non si corregge il
 * contenuto: un output non conforme resta rifiutato per intero. L'unica
 * eccezione, deliberatamente stretta, è `normalizeDiagramField`: ripara due
 * deviazioni **puramente formali** del campo `diagram` (un fence accidentale
 * attorno all'intero diagramma, una riga oltre il limite ripiegabile su uno
 * spazio) prima della validazione piena, senza mai riscrivere il contenuto
 * semantico né rilassare un vincolo. Ogni altra deviazione — HTML, front
 * matter, campi extra, una riga senza spazi su cui spezzare — resta rifiutata
 * esattamente come prima.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firestore.
 */

import { AiContentError, AI_CONTENT_LIMITS, utf8ByteLength } from './aiContentCore.js';

/**
 * Larghezza massima di una riga del diagramma, in **code point**. Vive qui e non
 * nel prompt perché è un vincolo di contratto: il prompt la dichiara al modello,
 * il validator la fa rispettare. Se vivesse nel prompt, il contratto dipenderebbe
 * dal testo con cui lo si chiede.
 */
export const CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS = 80;

/**
 * Avvertenza finale: **costante SchoolForge**, mai testo generato. Il modello
 * non deve poterla riformulare, ammorbidire o dimenticare — è la riga che
 * impedisce alla mappa di essere scambiata per la lezione.
 */
export const CONCEPT_MAP_DISCLAIMER =
  'Questa mappa è un supporto al ripasso e non sostituisce lo studio della lezione.';

/**
 * Intestazioni canoniche. `outline` **non è più prodotta** (CONCEPT-MAP-05): resta
 * dichiarata perché il parser deve continuare a riconoscere le mappe v1 già
 * salvate, che la contengono. Rimuoverla renderebbe illeggibile ciò che è già
 * su disco.
 */
export const CONCEPT_MAP_HEADINGS = {
  outline: '## Ossatura della lezione',
  summary: '## Sintesi',
  diagram: '## Diagramma',
} as const;

/** Marcatore del callout dell'avvertenza. */
export const CONCEPT_MAP_CALLOUT_MARKER = '> [!IMPORTANT]';

/** Apertura della fence del diagramma. */
export const CONCEPT_MAP_DIAGRAM_FENCE = '```text';

/**
 * I due campi dello Structured Output **v2**, validati.
 *
 * CONCEPT-MAP-05 ha rimosso `outlineMarkdown`: nelle generazioni reali l'ossatura
 * si era rivelata quasi sempre un indice della lezione, e duplicava il ruolo
 * strutturale del diagramma senza aggiungere ragionamento. Restano le due parti
 * che fanno lavori diversi — la sintesi spiega, il diagramma mostra.
 */
export interface ValidatedConceptMapProposal {
  summaryMarkdown: string;
  diagram: string;
}

/** Sezioni di una mappa **v1** già salvata: solo lettura, mai più prodotte. */
export interface LegacyConceptMapSections extends ValidatedConceptMapProposal {
  outlineMarkdown: string;
}

/** Esito completo: i campi validati e il Markdown canonico già composto. */
export interface ComposedConceptMap extends ValidatedConceptMapProposal {
  conceptMapMarkdown: string;
}

const ALLOWED_PROPOSAL_KEYS = ['summaryMarkdown', 'diagram'] as const;

// ─── Vincoli comuni ai tre campi ──────────────────────────────────────────────

const FRONT_MATTER_RE = /^\uFEFF?\s*---\s*\n/;
/**
 * Tre backtick ovunque nel campo. Il diagramma viene inserito dal server dentro
 * un blocco ```text: una fence prodotta dal modello lo chiuderebbe a metà e il
 * resto del documento verrebbe interpretato come Markdown normale — un output
 * che *sembra* valido e non lo è. Vale per tutti e tre i campi, perché tutti
 * finiscono nello stesso documento composto.
 */
const FENCE_RE = /```/;
/** Heading ATX (`#` … `######`), con l'indentazione tollerata da CommonMark. */
const ATX_HEADING_RE = /^ {0,3}#{1,6}(\s|$)/;
/** Riga di sottolineatura di un heading Setext (`===` o `---`). */
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)\s*$/;
/**
 * Tag HTML **reale**: `<` seguito immediatamente da una lettera (o da `/`), un
 * nome di tag e una chiusura `>`. Volutamente non generico su `<`, altrimenti un
 * confronto matematico come «a < b» o «x <= y» diventerebbe HTML: il vincolo
 * serve a fermare markup, non aritmetica.
 */
const HTML_TAG_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/;
/** Commenti, doctype e sezioni CDATA: non sono tag ma sono comunque markup. */
const HTML_META_RE = /<!--|<!\[CDATA\[|<!\s*doctype/i;
/** Voce di elenco puntato: marker `-`, `*` o `+`, con indentazione libera. */
const LIST_ITEM_RE = /^\s*[-*+]\s+\S/;
/**
 * Voce di elenco **ordinato** Markdown: `1. testo` o `2) testo`, con
 * indentazione libera. Lo spazio dopo il marcatore è **obbligatorio**, ed è ciò
 * che distingue un elenco da un numero in mezzo alla prosa: «2026 è stato…» e
 * «3.14 è approssimato» restano prosa, perché dopo il punto non c'è uno spazio.
 */
const ORDERED_LIST_ITEM_RE = /^\s*\d{1,9}[.)]\s+\S/;

function invalidOutput(message: string): never {
  throw new AiContentError('provider_invalid_output', message);
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidOutput(message);
  }
  return value as Record<string, unknown>;
}

/**
 * Normalizza esclusivamente gli spazi esterni dei campi generati dal provider.
 * È un confine controllato: nessun contenuto interno viene riscritto, troncato o
 * corretto. Il documento composto e persistito resta canonico byte per byte.
 */
function requiredField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string') {
    invalidOutput('La mappa generata è incompleta.');
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    invalidOutput('La mappa generata è incompleta.');
  }
  return normalized;
}

/** Vincoli che valgono per tutti e tre i campi. */
function assertCommonFieldRules(value: string, label: string): void {
  if (FENCE_RE.test(value)) {
    invalidOutput(`${label}: i blocchi di codice non sono ammessi.`);
  }
  if (FRONT_MATTER_RE.test(value)) {
    invalidOutput(`${label}: il front matter non è ammesso.`);
  }
  if (HTML_TAG_RE.test(value) || HTML_META_RE.test(value)) {
    invalidOutput(`${label}: l'HTML non è ammesso.`);
  }
  const lines = value.split('\n');
  lines.forEach((line, index) => {
    if (ATX_HEADING_RE.test(line)) {
      // Le intestazioni le decide il server: una prodotta dal modello
      // spezzerebbe la struttura canonica di quattro sezioni.
      invalidOutput(`${label}: le intestazioni non sono ammesse.`);
    }
    if (index > 0 && SETEXT_UNDERLINE_RE.test(line)) {
      const previous = lines[index - 1] ?? '';
      if (previous.trim().length > 0 && !SETEXT_UNDERLINE_RE.test(previous)) {
        invalidOutput(`${label}: le intestazioni non sono ammesse.`);
      }
    }
  });
}

/**
 * L'ossatura deve iniziare con una vera voce di elenco. Le righe fisiche
 * successive possono essere continuazioni Markdown della voce precedente:
 * CommonMark ammette sia le continuazioni indentate sia quelle "lazy" senza
 * marker. Dopo una riga vuota, invece, una continuazione deve essere
 * indentata; altrimenti sarebbe un nuovo paragrafo di prosa fuori elenco.
 */
function assertOutlineShape(value: string): void {
  const lines = value.split('\n');
  let hasListItem = false;
  let followsBlankLine = false;

  for (const line of lines) {
    if (line.trim().length === 0) {
      followsBlankLine = hasListItem;
      continue;
    }
    if (LIST_ITEM_RE.test(line)) {
      hasListItem = true;
      followsBlankLine = false;
      continue;
    }
    if (!hasListItem || (followsBlankLine && !/^\s{2,}\S/.test(line))) {
      invalidOutput('Ossatura: il testo deve appartenere a una voce di elenco.');
    }
    followsBlankLine = false;
  }

  if (!hasListItem) {
    invalidOutput('Ossatura: serve almeno una voce di elenco.');
  }
}

/**
 * La sintesi deve essere prosa. Con l'ossatura rimossa (CONCEPT-MAP-05) la
 * sintesi è diventata la sola parte discorsiva dell'artefatto: un elenco qui la
 * farebbe ricadere in ciò che l'ossatura già faceva male, cioè un indice. Il
 * rifiuto è su qualunque riga di elenco — **puntata o numerata** — e non solo su
 * un elenco integrale, perché una sintesi «mezza a punti» è già quel fallimento
 * a metà.
 *
 * Non esiste alcun limite di lunghezza pedagogico: la sintesi deve essere
 * proporzionata alla complessità del contenuto, e l'unico tetto è quello tecnico
 * sul documento composto.
 */
function assertSummaryShape(value: string): void {
  const nonEmpty = value.split('\n').filter((line) => line.trim().length > 0);
  if (nonEmpty.length === 0) {
    invalidOutput('Sintesi: il testo non può essere vuoto.');
  }
  for (const line of nonEmpty) {
    if (LIST_ITEM_RE.test(line) || ORDERED_LIST_ITEM_RE.test(line)) {
      invalidOutput('Sintesi: deve essere prosa, non un elenco.');
    }
  }
}

/** Larghezza in **code point**: i caratteri di disegno non contano doppio. */
function assertDiagramShape(value: string): void {
  for (const line of value.split('\n')) {
    if ([...line].length > CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS) {
      invalidOutput(`Diagramma: una riga supera ${CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS} caratteri.`);
    }
  }
}

/**
 * Ripara un fence ``` accidentale che avvolge l'**intero** diagramma: invitato
 * a produrre testo puro, il provider a volte lo restituisce già dentro un
 * blocco di codice — la stessa forma in cui il server lo inserirà comunque in
 * `composeConceptMapMarkdown`. Riconosciuta **solo** quando la prima e
 * l'ultima riga sono l'apertura e la chiusura del fence e non resta nessuna
 * altra tripletta di backtick nel contenuto interno: un fence spaiato, o una
 * seconda coppia altrove, non è questa deviazione e viene lasciata invariata
 * — resterà rifiutata da `assertCommonFieldRules` come prima.
 */
function stripAccidentalOuterFence(value: string): string {
  const trimmed = value.trim();
  const lines = trimmed.split('\n');
  if (lines.length < 3) return value;
  const first = lines[0]!.trim();
  const last = lines[lines.length - 1]!.trim();
  if (!/^```[\w-]*$/.test(first) || last !== '```') return value;
  const inner = lines.slice(1, -1).join('\n');
  if (inner.includes('```')) return value;
  return inner;
}

/**
 * Ripiega una riga del diagramma oltre `CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS`
 * code point, spezzando **solo** su uno spazio — mai a metà parola — e
 * ripetendo l'indentazione iniziale della riga (più due spazi) sulle righe di
 * continuazione, così la gerarchia visiva dell'albero resta leggibile invece
 * di sembrare un nuovo elemento di pari livello. Se anche una sola parola
 * supera lo spazio disponibile, o non c'è alcuno spazio su cui spezzare, la
 * riga è restituita **invariata**: non è una deviazione formale recuperabile
 * e resterà rifiutata da `assertDiagramShape`.
 */
function wrapDiagramLine(line: string): string {
  if ([...line].length <= CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS) return line;

  const indent = /^[ \t]*/.exec(line)![0];
  const continuationIndent = `${indent}  `;
  const budget = CONCEPT_MAP_DIAGRAM_MAX_LINE_CHARS;
  if ([...continuationIndent].length >= budget) return line;

  const wrapped: string[] = [];
  let remaining = [...line];
  const continuation = [...continuationIndent];
  while (remaining.length > budget) {
    let splitAt = Math.min(budget - 1, remaining.length - 1);
    const minimum = wrapped.length === 0 ? [...indent].length : continuation.length;
    while (splitAt >= minimum && !/\s/u.test(remaining[splitAt]!)) splitAt--;
    if (splitAt < minimum) return line;

    // Sostituisce soltanto il singolo whitespace scelto con newline +
    // indentazione. Gli altri spazi (anche multipli) restano byte per byte.
    wrapped.push(remaining.slice(0, splitAt).join(''));
    remaining = [...continuation, ...remaining.slice(splitAt + 1)];
  }
  wrapped.push(remaining.join(''));
  return wrapped.join('\n');
}

/**
 * Rimuove le righe vuote iniziali e finali — residuo tipico di un fence
 * appena tolto (`` ```text\n\nRADICE\n\n``` ``) — senza toccare l'indentazione
 * della prima riga di contenuto vero: quella indentazione può essere la
 * gerarchia del diagramma, non spazio da scartare. Un `.trim()` ordinario la
 * cancellerebbe insieme al resto.
 */
function trimBlankEdgeLines(value: string): string {
  const lines = value.split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim().length === 0) start++;
  while (end > start && lines[end - 1]!.trim().length === 0) end--;
  return lines.slice(start, end).join('\n');
}

/**
 * Normalizzazione deterministica del solo campo `diagram`, applicata PRIMA
 * della validazione piena — vedi `validateConceptMapProposal`. Compone le due
 * riparazioni sopra, in quest'ordine: prima il fence accidentale (una
 * deviazione sull'intero campo), poi il ripiegamento riga per riga (una
 * deviazione locale). Non è una seconda generazione — nessuna chiamata
 * provider, nessun costo — ed è idempotente: un campo già conforme attraversa
 * entrambe le funzioni invariato.
 */
function normalizeDiagramField(value: string): string {
  const unfenced = trimBlankEdgeLines(stripAccidentalOuterFence(value));
  return unfenced
    .split('\n')
    .map((line) => wrapDiagramLine(line))
    .join('\n');
}

/**
 * Valida i tre campi restituiti dal provider. Fail-closed; gli unici
 * adattamenti ammessi sono il trim esterno documentato da `requiredField` e la
 * normalizzazione strettamente delimitata di `normalizeDiagramField`.
 */
export function validateConceptMapProposal(output: unknown): ValidatedConceptMapProposal {
  const root = asObject(output, 'Struttura della mappa non valida.');
  for (const key of Object.keys(root)) {
    if (!ALLOWED_PROPOSAL_KEYS.includes(key as (typeof ALLOWED_PROPOSAL_KEYS)[number])) {
      invalidOutput('La mappa generata contiene campi non ammessi.');
    }
  }

  const summaryMarkdown = requiredField(root, 'summaryMarkdown');
  const diagram = normalizeDiagramField(requiredField(root, 'diagram'));

  assertCommonFieldRules(summaryMarkdown, 'Sintesi');
  assertCommonFieldRules(diagram, 'Diagramma');

  assertSummaryShape(summaryMarkdown);
  assertDiagramShape(diagram);

  return { summaryMarkdown, diagram };
}

/**
 * Valida le sezioni estratte da una mappa **v1** già salvata. Non è la
 * validazione di una proposta del provider — quella forma non è più producibile
 * — ma il contratto che un documento legacy deve comunque rispettare per essere
 * accettato in replay.
 */
function validateLegacySections(parts: LegacyConceptMapSections): void {
  assertCommonFieldRules(parts.outlineMarkdown, 'Ossatura');
  assertOutlineShape(parts.outlineMarkdown);
  validateConceptMapProposal({
    summaryMarkdown: parts.summaryMarkdown,
    diagram: parts.diagram,
  });
}

/**
 * Compone il Markdown canonico **v2**. Ordine e intestazioni sono fissi;
 * l'avvertenza è una costante. È l'unico punto in cui la mappa diventa un
 * documento, ed è l'unica forma che le nuove generazioni possono assumere.
 */
export function composeConceptMapMarkdown(parts: ValidatedConceptMapProposal): string {
  return [
    CONCEPT_MAP_HEADINGS.summary,
    '',
    parts.summaryMarkdown,
    '',
    CONCEPT_MAP_HEADINGS.diagram,
    '',
    CONCEPT_MAP_DIAGRAM_FENCE,
    parts.diagram,
    '```',
    '',
    CONCEPT_MAP_CALLOUT_MARKER,
    `> ${CONCEPT_MAP_DISCLAIMER}`,
    '',
  ].join('\n');
}

/**
 * Valida e compone in un passaggio solo, applicando il cap dimensionale
 * **sul documento composto** e non sui campi grezzi: è il documento che verrà
 * persistito e proiettato, quindi è quello che deve stare nel limite.
 */
export function validateAndComposeConceptMap(output: unknown): ComposedConceptMap {
  const parts = validateConceptMapProposal(output);
  const conceptMapMarkdown = composeConceptMapMarkdown(parts);
  if (utf8ByteLength(conceptMapMarkdown) > AI_CONTENT_LIMITS.MAX_CONCEPT_MAP_OUTPUT_BYTES) {
    throw new AiContentError('output_too_large', 'La mappa generata supera il limite.');
  }
  return { ...parts, conceptMapMarkdown };
}

/**
 * Compone una mappa **v1**. Non è più raggiungibile da una generazione: esiste
 * soltanto come **oracolo di uguaglianza** del parser legacy, che accetta un
 * documento salvato solo se è byte per byte ciò che la composizione v1 avrebbe
 * prodotto dalle sue stesse sezioni.
 */
function composeLegacyConceptMapMarkdown(parts: LegacyConceptMapSections): string {
  return [
    CONCEPT_MAP_HEADINGS.outline,
    '',
    parts.outlineMarkdown,
    '',
    CONCEPT_MAP_HEADINGS.summary,
    '',
    parts.summaryMarkdown,
    '',
    CONCEPT_MAP_HEADINGS.diagram,
    '',
    CONCEPT_MAP_DIAGRAM_FENCE,
    parts.diagram,
    '```',
    '',
    CONCEPT_MAP_CALLOUT_MARKER,
    `> ${CONCEPT_MAP_DISCLAIMER}`,
    '',
  ].join('\n');
}

// ─── Validazione del documento persistito (replay) ────────────────────────────

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Coda comune alle due forme: diagramma in fence, avvertenza, newline finale. */
const CANONICAL_TAIL = [
  escapeForRegExp(CONCEPT_MAP_HEADINGS.diagram),
  '\\n\\n',
  escapeForRegExp(CONCEPT_MAP_DIAGRAM_FENCE),
  '\\n([\\s\\S]*?)\\n```\\n\\n',
  escapeForRegExp(CONCEPT_MAP_CALLOUT_MARKER),
  '\\n> ',
  escapeForRegExp(CONCEPT_MAP_DISCLAIMER),
  '\\n$',
].join('');

/**
 * Scheletro canonico **v2**: Sintesi + Diagramma + avvertenza. È l'unica forma
 * che una generazione può produrre da CONCEPT-MAP-05 in poi.
 */
const CANONICAL_V2_RE = new RegExp(
  [
    '^',
    escapeForRegExp(CONCEPT_MAP_HEADINGS.summary),
    '\\n\\n([\\s\\S]*?)\\n\\n',
    CANONICAL_TAIL,
  ].join(''),
);

/**
 * Scheletro canonico **v1**: Ossatura + Sintesi + Diagramma + avvertenza.
 * Riconosciuto in sola lettura, per le mappe già salvate. Nessuna conversione:
 * un documento v1 resta v1.
 */
const CANONICAL_V1_RE = new RegExp(
  [
    '^',
    escapeForRegExp(CONCEPT_MAP_HEADINGS.outline),
    '\\n\\n([\\s\\S]*?)\\n\\n',
    escapeForRegExp(CONCEPT_MAP_HEADINGS.summary),
    '\\n\\n([\\s\\S]*?)\\n\\n',
    CANONICAL_TAIL,
  ].join(''),
);

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

/**
 * Valida il Markdown **persistito** e lo restituisce **identico**, in entrambe
 * le forme canoniche: **v2** (Sintesi + Diagramma) e **v1** legacy (Ossatura +
 * Sintesi + Diagramma). Riconoscere solo la v2 renderebbe irreplayabili — e in
 * prospettiva illeggibili — le mappe già salvate, che non vengono migrate.
 *
 * Il replay non ricompone nulla: la ricomposizione è usata soltanto come oracolo
 * di uguaglianza — se il documento non è byte per byte ciò che il compositore
 * avrebbe prodotto dalle sue stesse sezioni, non è canonico e viene rifiutato.
 * È il controllo più stretto possibile e il più semplice da leggere: rende
 * impossibile che un documento accettato in lettura differisca da uno prodotto
 * in scrittura.
 */
export function parseCanonicalConceptMapMarkdown(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    invalidOutput('La mappa persistita è mancante o vuota.');
  }
  if (utf8ByteLength(value) > AI_CONTENT_LIMITS.MAX_CONCEPT_MAP_OUTPUT_BYTES) {
    throw new AiContentError('output_too_large', 'La mappa persistita supera il limite.');
  }

  // La versione si riconosce dalla presenza dell'intestazione dell'ossatura, che
  // solo le mappe v1 hanno. Non è un'euristica sul contenuto: è un'ancora
  // canonica che il compositore v2 non produce mai.
  const legacy = countOccurrences(value, CONCEPT_MAP_HEADINGS.outline) > 0;

  // Unicità delle ancore: lo scheletro impone l'ordine, il conteggio impone che
  // non ce ne siano altre altrove (una seconda fence, un secondo disclaimer).
  const anchors: readonly (readonly [string, string])[] = [
    ...(legacy ? ([[CONCEPT_MAP_HEADINGS.outline, "l'intestazione dell'ossatura"]] as const) : []),
    [CONCEPT_MAP_HEADINGS.summary, "l'intestazione della sintesi"],
    [CONCEPT_MAP_HEADINGS.diagram, "l'intestazione del diagramma"],
    [CONCEPT_MAP_CALLOUT_MARKER, "il marcatore dell'avvertenza"],
    [CONCEPT_MAP_DISCLAIMER, "l'avvertenza"],
  ];
  for (const [needle, label] of anchors) {
    if (countOccurrences(value, needle) !== 1) {
      invalidOutput(`La mappa persistita deve contenere ${label} esattamente una volta.`);
    }
  }
  // Esattamente una fence aperta e una chiusa: nessuna, doppia o non chiusa.
  if (countOccurrences(value, '```') !== 2) {
    invalidOutput('La mappa persistita deve contenere un solo blocco di diagramma.');
  }

  if (legacy) {
    const match = CANONICAL_V1_RE.exec(value);
    if (!match) {
      invalidOutput('La mappa persistita non rispetta la struttura canonica.');
    }
    const parts: LegacyConceptMapSections = {
      outlineMarkdown: match[1] ?? '',
      summaryMarkdown: match[2] ?? '',
      diagram: match[3] ?? '',
    };
    validateLegacySections(parts);
    if (composeLegacyConceptMapMarkdown(parts) !== value) {
      invalidOutput('La mappa persistita non rispetta la struttura canonica.');
    }
    // Identico all'input: una v1 resta v1, non viene convertita in v2.
    return value;
  }

  const match = CANONICAL_V2_RE.exec(value);
  if (!match) {
    invalidOutput('La mappa persistita non rispetta la struttura canonica.');
  }
  const parts: ValidatedConceptMapProposal = {
    summaryMarkdown: match[1] ?? '',
    diagram: match[2] ?? '',
  };

  // Le sezioni estratte devono soddisfare gli **stessi** contratti dei campi
  // generati: nessun heading interno, nessun HTML, sintesi in prosa, diagramma
  // entro la larghezza massima.
  validateConceptMapProposal(parts);

  if (composeConceptMapMarkdown(parts) !== value) {
    invalidOutput('La mappa persistita non rispetta la struttura canonica.');
  }
  // Identico all'input: nessuna ricomposizione restituita al chiamante.
  return value;
}

/**
 * Forma dell'`output` di un run `concept_map` completato: **esattamente** una
 * chiave, il cui valore è un Markdown canonico. Usato dal parser del documento
 * run, che non deve conoscere la struttura dell'artefatto.
 */
export function validateStoredConceptMapOutput(output: unknown): { conceptMapMarkdown: string } {
  const root = asObject(output, 'Output della mappa non valido.');
  const keys = Object.keys(root);
  if (keys.length !== 1 || keys[0] !== 'conceptMapMarkdown') {
    invalidOutput('Output della mappa non valido.');
  }
  return { conceptMapMarkdown: parseCanonicalConceptMapMarkdown(root.conceptMapMarkdown) };
}

/** Predicato senza eccezioni, per i parser fail-closed che restituiscono `null`. */
export function isValidStoredConceptMapOutput(output: unknown): boolean {
  try {
    validateStoredConceptMapOutput(output);
    return true;
  } catch {
    return false;
  }
}
