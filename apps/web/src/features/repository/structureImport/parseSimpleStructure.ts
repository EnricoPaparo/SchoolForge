import { STRUCTURE_IMPORT_LIMITS } from './limits.js';
import {
  classifyLine,
  labelKey,
  normalizeNewlines,
  stripOuterFence,
  suggestLabel,
  unquote,
} from './simpleStructureLines.js';
import { normalizeUdaEntries } from './validateUdaMetadataFile.js';
import { normalizeLessonEntries } from './validateLessonMetadataFile.js';
import type {
  NormalizedLessonMetadata,
  NormalizedUdaMetadata,
  StructureImportError,
  StructureImportFileKind,
  StructureImportResult,
} from './types.js';

/**
 * STRUCTURE-IMPORT-SIMPLE-01 — le due macchine a stati del formato semplice.
 *
 * Producono voci nella **stessa forma** che il parser YAML consegna ai
 * normalizzatori condivisi (`normalizeUdaEntries`, `normalizeLessonEntries`):
 * da lì in poi il percorso è identico, e con esso limiti, messaggi, DTO,
 * serializzazione canonica, `sourceHash`, planner e runtime. Questo modulo si
 * occupa soltanto di *come è scritto* il testo, mai di cosa sia lecito
 * scriverci.
 *
 * Conseguenza voluta: due testi graficamente diversi ma di identico contenuto
 * — rientri, righe vuote, simboli di elenco, virgolette — producono lo stesso
 * identico piano e la stessa identità del tentativo.
 *
 * Modulo puro: nessun React, nessun Firebase, nessuna API del browser.
 */

/**
 * Sinonimi ammessi. `Obbiettivi` non è una svista da correggere in silenzio: è
 * un refuso talmente diffuso da essere di fatto una seconda grafia, e rifiutarlo
 * insegnerebbe solo che l'importazione è capricciosa.
 */
const ALIASES: Record<string, string> = {
  obbiettivi: 'obiettivi',
  'concetti chiavi': 'concetti chiave',
  'concetti-chiave': 'concetti chiave',
  concettichiave: 'concetti chiave',
  sottotitolo: 'sottotitolo',
  difficolta: 'difficolta',
};

function canonicalLabel(raw: string): string {
  const key = labelKey(raw);
  return ALIASES[key] ?? key;
}

function lineError(
  code: StructureImportError['code'],
  message: string,
  fileKind: StructureImportFileKind,
  line: number,
  field?: string,
): StructureImportError {
  return field === undefined
    ? { code, message, fileKind, line }
    : { code, message, fileKind, line, field };
}

interface Spec {
  fileKind: StructureImportFileKind;
  /** Chiave canonica dell'etichetta che apre una voce (`uda` / `lezione`). */
  entryKey: string;
  entryLabel: string;
  /** Campo → nome della proprietà nella voce grezza. */
  fields: Record<string, string>;
  /** Sezione elenco → nome della proprietà nella voce grezza. */
  lists: Record<string, string>;
  maxEntries: number;
  /** Grafie corrette, per i suggerimenti sui refusi. */
  known: readonly string[];
  /** Intestazione di sezione da citare quando una voce di elenco è orfana. */
  firstListLabel: string;
}

const UDA_SPEC: Spec = {
  fileKind: 'uda',
  entryKey: 'uda',
  entryLabel: 'UDA',
  fields: { descrizione: 'descrizione' },
  lists: { competenze: 'competenze', obiettivi: 'obiettivi' },
  maxEntries: STRUCTURE_IMPORT_LIMITS.MAX_UDAS,
  known: ['UDA', 'Descrizione', 'Competenze', 'Obiettivi'],
  firstListLabel: 'Competenze',
};

const LESSON_SPEC: Spec = {
  fileKind: 'lesson',
  entryKey: 'lezione',
  entryLabel: 'LEZIONE',
  fields: { sottotitolo: 'sottotitolo', difficolta: 'difficolta' },
  lists: { 'concetti chiave': 'concettiChiave', obiettivi: 'obiettivi' },
  maxEntries: STRUCTURE_IMPORT_LIMITS.MAX_LESSONS,
  known: ['LEZIONE', 'Sottotitolo', 'Difficoltà', 'Concetti chiave', 'Obiettivi'],
  firstListLabel: 'Concetti chiave',
};

interface OpenEntry {
  raw: Record<string, unknown>;
  /** Sezioni e campi già visti: un secondo `Obiettivi:` è ambiguo, non additivo. */
  seen: Set<string>;
  line: number;
}

/**
 * Il cuore condiviso. Riceve il testo già decodificato e restituisce le voci
 * grezze, pronte per i normalizzatori condivisi.
 */
function parseEntries(text: string, spec: Spec): StructureImportResult<Record<string, unknown>[]> {
  const all = normalizeNewlines(text).split('\n');
  const fence = stripOuterFence(all, spec.fileKind);
  if (!fence.ok) return fence;
  const { lines, offset } = fence.value;

  const entries: Record<string, unknown>[] = [];
  let current: OpenEntry | null = null;
  let openList: { property: string; items: string[] } | null = null;

  /** Chiude la sezione elenco corrente scrivendola nella voce aperta. */
  const closeList = (): void => {
    if (current !== null && openList !== null) {
      current.raw[openList.property] = openList.items;
    }
    openList = null;
  };

  const closeEntry = (): void => {
    closeList();
    if (current !== null) entries.push(current.raw);
    current = null;
  };

  for (const [index, rawLine] of lines.entries()) {
    const line = index + offset + 1;
    const parsed = classifyLine(rawLine);

    if (parsed.kind === 'skip') continue;

    if (parsed.kind === 'item') {
      if (openList === null) {
        return {
          ok: false,
          error: lineError(
            'orphan_line',
            `Riga ${line}: voce di elenco senza una sezione che la contenga. Aggiungi prima l'intestazione, per esempio «${spec.firstListLabel}:».`,
            spec.fileKind,
            line,
          ),
        };
      }
      if (parsed.value === '') {
        return {
          ok: false,
          error: lineError(
            'empty_value',
            `Riga ${line}: voce di elenco vuota.`,
            spec.fileKind,
            line,
            openList.property,
          ),
        };
      }
      const value = unquote(parsed.value);
      if (!value.ok) {
        return {
          ok: false,
          error: lineError(
            'unbalanced_quotes',
            `Riga ${line}: le virgolette aperte non sono chiuse.`,
            spec.fileKind,
            line,
            openList.property,
          ),
        };
      }
      openList.items.push(value.value);
      continue;
    }

    if (parsed.kind === 'plain') {
      // Senza simbolo di elenco, ma dentro una sezione aperta: è una voce. È il
      // caso di chi incolla un elenco da un documento che i simboli li aveva
      // come formattazione, non come testo.
      if (openList !== null) {
        const value = unquote(parsed.value);
        if (!value.ok) {
          return {
            ok: false,
            error: lineError(
              'unbalanced_quotes',
              `Riga ${line}: le virgolette aperte non sono chiuse.`,
              spec.fileKind,
              line,
              openList.property,
            ),
          };
        }
        openList.items.push(value.value);
        continue;
      }
      return {
        ok: false,
        error: lineError(
          current === null ? 'orphan_line' : 'ambiguous_line',
          current === null
            ? `Riga ${line}: il testo deve cominciare con «${spec.entryLabel}:».`
            : `Riga ${line}: riga non collocabile. Se è una voce di elenco, aggiungi l'intestazione della sezione; se è un campo, scrivilo come «Campo: valore».`,
          spec.fileKind,
          line,
        ),
      };
    }

    // parsed.kind === 'label'
    const key = canonicalLabel(parsed.label);

    if (key === spec.entryKey) {
      closeEntry();
      const titolo = unquote(parsed.inline);
      if (!titolo.ok) {
        return {
          ok: false,
          error: lineError(
            'unbalanced_quotes',
            `Riga ${line}: le virgolette aperte non sono chiuse.`,
            spec.fileKind,
            line,
            'titolo',
          ),
        };
      }
      if (titolo.value === '') {
        return {
          ok: false,
          error: lineError(
            'missing_field',
            `Riga ${line}: «${spec.entryLabel}:» richiede un titolo sulla stessa riga.`,
            spec.fileKind,
            line,
            'titolo',
          ),
        };
      }
      if (entries.length >= spec.maxEntries) {
        return {
          ok: false,
          error: lineError(
            'too_many_items',
            `Il testo supera il limite di ${spec.maxEntries} elementi.`,
            spec.fileKind,
            line,
          ),
        };
      }
      current = { raw: { titolo: titolo.value }, seen: new Set(['titolo']), line };
      continue;
    }

    if (current === null) {
      return {
        ok: false,
        error: lineError(
          'orphan_line',
          `Riga ${line}: il testo deve cominciare con «${spec.entryLabel}:».`,
          spec.fileKind,
          line,
        ),
      };
    }

    const fieldProperty = spec.fields[key];
    if (fieldProperty !== undefined) {
      closeList();
      if (current.seen.has(fieldProperty)) {
        return {
          ok: false,
          error: lineError(
            'duplicate_section',
            `Riga ${line}: il campo «${parsed.label.trim()}» compare due volte nella stessa voce.`,
            spec.fileKind,
            line,
            fieldProperty,
          ),
        };
      }
      const value = unquote(parsed.inline);
      if (!value.ok) {
        return {
          ok: false,
          error: lineError(
            'unbalanced_quotes',
            `Riga ${line}: le virgolette aperte non sono chiuse.`,
            spec.fileKind,
            line,
            fieldProperty,
          ),
        };
      }
      current.seen.add(fieldProperty);
      // Anche vuoto viene registrato: sarà il normalizzatore condiviso a dire
      // se quel campo poteva essere vuoto, con lo stesso messaggio dello YAML.
      current.raw[fieldProperty] = value.value;
      continue;
    }

    const listProperty = spec.lists[key];
    if (listProperty !== undefined) {
      closeList();
      if (current.seen.has(listProperty)) {
        return {
          ok: false,
          error: lineError(
            'duplicate_section',
            `Riga ${line}: la sezione «${parsed.label.trim()}» compare due volte nella stessa voce.`,
            spec.fileKind,
            line,
            listProperty,
          ),
        };
      }
      current.seen.add(listProperty);
      openList = { property: listProperty, items: [] };
      if (parsed.inline !== '') {
        const first = unquote(parsed.inline);
        if (!first.ok) {
          return {
            ok: false,
            error: lineError(
              'unbalanced_quotes',
              `Riga ${line}: le virgolette aperte non sono chiuse.`,
              spec.fileKind,
              line,
              listProperty,
            ),
          };
        }
        openList.items.push(first.value);
      }
      continue;
    }

    const suggestion = suggestLabel(parsed.label, spec.known);
    return {
      ok: false,
      error: lineError(
        'unknown_label',
        suggestion === null
          ? `Riga ${line}: campo «${parsed.label.trim()}» non riconosciuto.`
          : `Riga ${line}: campo «${parsed.label.trim()}» non riconosciuto. Forse intendevi «${suggestion}»?`,
        spec.fileKind,
        line,
        parsed.label.trim(),
      ),
    };
  }

  closeEntry();

  if (entries.length < STRUCTURE_IMPORT_LIMITS.MIN_UDAS) {
    return {
      ok: false,
      error: {
        code: 'too_few_items',
        message: `Il testo deve contenere almeno una voce che inizia con «${spec.entryLabel}:».`,
        fileKind: spec.fileKind,
      },
    };
  }

  return { ok: true, value: entries };
}

export interface ParseSimpleOptions {
  /** Titoli già presenti nella destinazione, per il controllo di collisione. */
  existingTitles?: readonly string[];
}

/** Formato semplice UDA → gli stessi DTO normalizzati del percorso YAML. */
export function parseSimpleUdaStructure(
  text: string,
  options: ParseSimpleOptions = {},
): StructureImportResult<NormalizedUdaMetadata[]> {
  const entries = parseEntries(text, UDA_SPEC);
  if (!entries.ok) return entries;
  return normalizeUdaEntries(entries.value, options);
}

/** Formato semplice lezioni → gli stessi DTO normalizzati del percorso YAML. */
export function parseSimpleLessonStructure(
  text: string,
  options: ParseSimpleOptions = {},
): StructureImportResult<NormalizedLessonMetadata[]> {
  const entries = parseEntries(text, LESSON_SPEC);
  if (!entries.ok) return entries;
  return normalizeLessonEntries(entries.value, options);
}
