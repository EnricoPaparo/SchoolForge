import type { StructureImportError, StructureImportFileKind } from './types.js';

/**
 * STRUCTURE-IMPORT-SIMPLE-01 — lettura riga per riga del formato semplice.
 *
 * Il formato semplice esiste perché lo YAML chiede al docente di essere preciso
 * su cose che non hanno alcun significato didattico: quanti spazi di rientro,
 * quale simbolo di elenco, se il valore va fra virgolette. Chi incolla da un
 * documento, da una chat o da un modello AI arriva quasi sempre con una di
 * quelle differenze, e si vede rifiutare un contenuto perfettamente sensato.
 *
 * La regola che governa tutto questo modulo: **tollerante sulla forma, rigido
 * sul contenuto**. Rientri, righe vuote, simboli di elenco e virgolette esterne
 * vengono assorbiti perché non cambiano ciò che il docente ha scritto; una
 * riga che non si sa dove collocare, un'etichetta sconosciuta o un valore vuoto
 * restano errori, perché indovinare significherebbe importare qualcosa che
 * nessuno ha scritto.
 *
 * Modulo puro: nessun React, nessun Firebase, nessuna API del browser, nessun
 * timer, nessun I/O.
 */

// ── Newline, BOM, fence ──────────────────────────────────────────────────────

/** CRLF e CR diventano LF: la provenienza del testo non è un dato didattico. */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, '\n');
}

const FENCE_LANGUAGES = new Set(['', 'text', 'txt', 'yaml', 'yml']);
const FENCE_LINE = /^(`{3,}|~{3,})\s*([A-Za-z]*)\s*$/;

export interface FenceStripResult {
  lines: string[];
  /** Quante righe sono state rimosse in testa: serve a non falsare i numeri di riga. */
  offset: number;
}

/**
 * Rimuove un **unico** blocco di codice che avvolge tutto il testo. È la forma
 * in cui l'esempio arriva quando lo si copia da una chat o da una risposta AI:
 * il docente non ha aggiunto quei backtick, li ha ereditati.
 *
 * Un fence aperto e mai chiuso, o con un linguaggio che non è quello di un
 * blocco di testo, è invece un errore: significa che il testo incollato è
 * incompleto o che dentro c'è dell'altro.
 */
export function stripOuterFence(
  lines: readonly string[],
  fileKind: StructureImportFileKind,
): { ok: true; value: FenceStripResult } | { ok: false; error: StructureImportError } {
  let start = 0;
  let end = lines.length - 1;
  while (start < lines.length && lines[start]!.trim() === '') start += 1;
  while (end >= start && lines[end]!.trim() === '') end -= 1;
  if (start > end) return { ok: true, value: { lines: [...lines], offset: 0 } };

  const opening = FENCE_LINE.exec(lines[start]!.trim());
  if (!opening) {
    // Nessun fence in apertura: un fence di chiusura orfano più in basso
    // resterebbe testo, e verrebbe segnalato dal parser come riga non
    // collocabile. Qui non c'è nulla da rimuovere.
    return { ok: true, value: { lines: [...lines], offset: 0 } };
  }

  const language = opening[2]!.toLowerCase();
  if (!FENCE_LANGUAGES.has(language)) {
    return {
      ok: false,
      error: {
        code: 'malformed_fence',
        message: `Il blocco di codice dichiara il linguaggio «${opening[2]}», che non è ammesso: usa un blocco senza linguaggio, oppure text o yaml.`,
        fileKind,
        line: start + 1,
      },
    };
  }

  const marker = opening[1]![0]!;
  const closing = FENCE_LINE.exec(lines[end]!.trim());
  const closes =
    end > start && closing !== null && closing[1]!.startsWith(marker) && closing[2] === '';
  if (!closes) {
    return {
      ok: false,
      error: {
        code: 'malformed_fence',
        message:
          'Il blocco di codice è aperto ma non chiuso: incolla il testo per intero, oppure senza i backtick.',
        fileKind,
        line: start + 1,
      },
    };
  }

  return { ok: true, value: { lines: lines.slice(start + 1, end), offset: start + 1 } };
}

// ── Etichette ────────────────────────────────────────────────────────────────

/**
 * Forma di confronto di un'etichetta: senza accenti, minuscola, spazi
 * normalizzati. `Difficoltà`, `DIFFICOLTA` e `difficolta` sono la stessa cosa —
 * la differenza sta nella tastiera del docente, non nel suo intento.
 */
export function labelKey(raw: string): string {
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Distanza di edit, limitata: serve solo a distinguere un refuso da un'altra parola. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let previous = Array.from({ length: cols }, (_, index) => index);
  for (let i = 1; i < rows; i += 1) {
    const current = [i, ...Array<number>(cols - 1).fill(0)];
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[cols - 1]!;
}

/**
 * L'etichetta corretta più vicina a un refuso, se abbastanza vicina da essere
 * quasi certamente quella intesa. La soglia cresce con la lunghezza: su
 * «Obiettivi» due caratteri sbagliati sono un refuso, su una parola di quattro
 * lettere sarebbero un'altra parola.
 */
export function suggestLabel(written: string, known: readonly string[]): string | null {
  const key = labelKey(written);
  let best: { label: string; distance: number } | null = null;
  for (const candidate of known) {
    const distance = editDistance(key, labelKey(candidate));
    if (best === null || distance < best.distance) best = { label: candidate, distance };
  }
  if (best === null) return null;
  const tolerance = key.length >= 8 ? 2 : 1;
  return best.distance > 0 && best.distance <= tolerance ? best.label : null;
}

// ── Virgolette ───────────────────────────────────────────────────────────────

/**
 * Coppie che, se aperte, **devono** essere chiuse. Sono virgolette e nient'altro:
 * nessuna parola italiana comincia con `"`, `“`, `‘` o `«`, quindi trovarne una
 * senza la sua chiusura significa che il testo incollato è troncato.
 */
const STRICT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'],
  ['“', '”'],
  ['‘', '’'],
  ['«', '»'],
];

/**
 * Apostrofi. Qui la regola è diversa, e la differenza è tutta italiana:
 * `'900`, `’800`, `'60` sono elisioni di secolo o decennio, non virgolette
 * aperte. Un apostrofo iniziale è una coppia **solo** se il valore finisce con
 * lo stesso carattere; altrimenti è testo, e resta dov'è.
 *
 * Il costo di sbagliare è asimmetrico. Trattare `'900 e società di massa` come
 * virgolette non chiuse rifiuterebbe un titolo perfettamente sensato, e il
 * docente non avrebbe modo di capire cosa correggere. Trattare `'Titolo'` come
 * testo lascerebbe due apostrofi in un titolo — visibile e correggibile.
 */
const APOSTROPHES = new Set(["'", '’']);

const STRICT_OPENERS = new Set(STRICT_PAIRS.map(([open]) => open));

/**
 * Toglie **una sola** coppia completa di virgolette esterne.
 *
 * Un apertura stretta senza la sua chiusura è un errore: importarla
 * significherebbe accettare un titolo che comincia con un carattere che il
 * docente non voleva. Un apostrofo senza chiusura è invece semplicemente un
 * apostrofo.
 */
export function unquote(
  value: string,
): { ok: true; value: string } | { ok: false; reason: 'unbalanced' } {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: trimmed };
  const first = trimmed[0]!;

  if (APOSTROPHES.has(first)) {
    // Stesso carattere in apertura e in chiusura ⇒ coppia; altrimenti elisione.
    return trimmed.length >= 2 && trimmed.endsWith(first)
      ? { ok: true, value: trimmed.slice(1, -1).trim() }
      : { ok: true, value: trimmed };
  }

  if (!STRICT_OPENERS.has(first)) return { ok: true, value: trimmed };
  if (trimmed.length < 2) return { ok: false, reason: 'unbalanced' };
  const closer = STRICT_PAIRS.find(([open]) => open === first)![1];
  if (!trimmed.endsWith(closer)) return { ok: false, reason: 'unbalanced' };
  return { ok: true, value: trimmed.slice(1, -1).trim() };
}

// ── Classificazione delle righe ──────────────────────────────────────────────

export type SimpleLine =
  /** Vuota o separatore `---`: nessun significato, si prosegue. */
  | { kind: 'skip' }
  /** Voce di elenco introdotta da un simbolo o da una numerazione. */
  | { kind: 'item'; value: string; bulleted: true }
  /** Riga con `Etichetta:` — il valore sulla stessa riga può essere vuoto. */
  | { kind: 'label'; label: string; inline: string }
  /** Testo semplice: voce di elenco solo se una sezione è già aperta. */
  | { kind: 'plain'; value: string };

const SEPARATOR = /^(-{3,}|_{3,}|\*{3,}|={3,})$/;
const BULLET = /^([-*•·–—])(\s+(.*))?$/;
const NUMBERED = /^(\d{1,3})[.)](\s+(.*))?$/;

/**
 * Classifica una riga già priva del rientro esterno.
 *
 * L'ordine dei controlli è il contratto: il separatore prima del simbolo di
 * elenco (`---` non è un elenco vuoto), e il simbolo di elenco prima
 * dell'etichetta — una riga con il trattino è **sempre** una voce, anche
 * quando contiene i due punti, altrimenti «- Obiettivo: capire le reti»
 * diventerebbe misteriosamente un campo sconosciuto.
 */
export function classifyLine(rawLine: string): SimpleLine {
  const line = rawLine.trim();
  if (line === '') return { kind: 'skip' };
  if (SEPARATOR.test(line)) return { kind: 'skip' };

  const bullet = BULLET.exec(line);
  if (bullet) return { kind: 'item', value: (bullet[3] ?? '').trim(), bulleted: true };

  const numbered = NUMBERED.exec(line);
  if (numbered) return { kind: 'item', value: (numbered[3] ?? '').trim(), bulleted: true };

  const colon = line.indexOf(':');
  if (colon > 0) {
    return { kind: 'label', label: line.slice(0, colon), inline: line.slice(colon + 1).trim() };
  }

  return { kind: 'plain', value: line };
}
