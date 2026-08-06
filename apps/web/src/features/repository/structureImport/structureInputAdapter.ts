import { decodeStructureImportFile } from './decodeStructureImportFile.js';
import type { StructureImportBytes } from './decodeStructureImportFile.js';
import {
  classifyLine,
  labelKey,
  normalizeNewlines,
  stripOuterFence,
} from './simpleStructureLines.js';
import { parseSimpleLessonStructure, parseSimpleUdaStructure } from './parseSimpleStructure.js';
import { validateUdaMetadataFileText } from './validateUdaMetadataFile.js';
import { validateLessonMetadataFileText } from './validateLessonMetadataFile.js';
import type {
  NormalizedLessonMetadata,
  NormalizedUdaMetadata,
  StructureImportFileKind,
  StructureImportResult,
} from './types.js';

/**
 * STRUCTURE-IMPORT-SIMPLE-01 — unico ingresso byte-first dell'importazione
 * strutturale.
 *
 * Esistono due sintassi — il formato semplice, che il docente incolla, e lo YAML
 * storico, che resta supportato — ma **una sola porta**. Il riconoscimento è
 * deterministico e guarda la prima riga significativa: niente «prova YAML, poi
 * prova semplice», perché un fallback silenzioso trasformerebbe l'errore di un
 * formato nell'errore dell'altro e il docente si vedrebbe spiegare il problema
 * sbagliato.
 *
 * Ordine vincolante, identico a prima per lo YAML:
 *
 * 1. limite sui byte originali;
 * 2. decodifica UTF-8 **fatale**;
 * 3. rimozione del BOM;
 * 4. prima riga significativa → formato;
 * 5. parser corrispondente → normalizzatori condivisi → stessi DTO.
 *
 * Modulo puro: nessun React, nessun Firebase, nessuna API del browser oltre a
 * `TextDecoder`, che è una primitiva di piattaforma.
 */

export type StructureInputFormat = 'yaml' | 'simple-uda' | 'simple-lesson';

/**
 * Formato del testo, dedotto dalla prima riga significativa: righe vuote,
 * separatori e un eventuale blocco di codice esterno non contano.
 */
export function detectStructureFormat(text: string): StructureInputFormat | null {
  const lines = normalizeNewlines(text).split('\n');
  // Il fence, se c'è, avvolge tutto: va tolto prima di guardare dentro. Un fence
  // malformato non viene deciso qui — lo segnala il parser, con la riga.
  const fence = stripOuterFence(lines, 'uda');
  const inner = fence.ok ? fence.value.lines : lines;

  for (const rawLine of inner) {
    const parsed = classifyLine(rawLine);
    if (parsed.kind === 'skip') continue;
    if (parsed.kind !== 'label') return null;
    const key = labelKey(parsed.label);
    if (key === 'schema') return 'yaml';
    if (key === 'uda') return 'simple-uda';
    if (key === 'lezione') return 'simple-lesson';
    return null;
  }
  return null;
}

export interface ParseStructureInputOptions {
  /** Titoli già presenti nella destinazione, per il controllo di collisione. */
  existingTitles?: readonly string[];
  /** Nome file originale, quando esiste: solo la sua estensione viene verificata. */
  filename?: string;
}

function unknownFormat(fileKind: StructureImportFileKind) {
  return {
    ok: false as const,
    error: {
      code: 'unknown_format' as const,
      message:
        fileKind === 'uda'
          ? 'Testo non riconosciuto: deve cominciare con «UDA:» (formato semplice) oppure con «schema:» (YAML).'
          : 'Testo non riconosciuto: deve cominciare con «LEZIONE:» (formato semplice) oppure con «schema:» (YAML).',
      fileKind,
    },
  };
}

function wrongKind(fileKind: StructureImportFileKind) {
  return {
    ok: false as const,
    error: {
      code: 'wrong_structure_kind' as const,
      message:
        fileKind === 'uda'
          ? 'Questo è un elenco di lezioni: aprilo da «Azioni UDA → Importa lezioni». Qui serve una struttura che comincia con «UDA:».'
          : 'Questo è un elenco di UDA: aprilo da «Azioni corso → Importa struttura UDA». Qui serve una struttura che comincia con «LEZIONE:».',
      fileKind,
    },
  };
}

/**
 * Ingresso UDA: byte → DTO normalizzati, qualunque sia la sintassi.
 *
 * Lo YAML riceve il testo decodificato esattamente come prima, quindi percorre
 * lo stesso parser, produce gli stessi DTO e gli stessi errori: il formato
 * semplice si affianca, non sostituisce.
 */
export function parseUdaStructureInput(
  bytes: StructureImportBytes,
  options: ParseStructureInputOptions = {},
): StructureImportResult<NormalizedUdaMetadata[]> {
  const decoded = decodeStructureImportFile(bytes, {
    fileKind: 'uda',
    ...(options.filename === undefined ? {} : { filename: options.filename }),
  });
  if (!decoded.ok) return decoded;

  const format = detectStructureFormat(decoded.value);
  if (format === null) return unknownFormat('uda');
  if (format === 'simple-lesson') return wrongKind('uda');
  if (format === 'yaml') return validateUdaMetadataFileText(decoded.value, options);
  return parseSimpleUdaStructure(decoded.value, options);
}

/** Ingresso lezioni. Stesse regole, altro bersaglio. */
export function parseLessonStructureInput(
  bytes: StructureImportBytes,
  options: ParseStructureInputOptions = {},
): StructureImportResult<NormalizedLessonMetadata[]> {
  const decoded = decodeStructureImportFile(bytes, {
    fileKind: 'lesson',
    ...(options.filename === undefined ? {} : { filename: options.filename }),
  });
  if (!decoded.ok) return decoded;

  const format = detectStructureFormat(decoded.value);
  if (format === null) return unknownFormat('lesson');
  if (format === 'simple-uda') return wrongKind('lesson');
  if (format === 'yaml') return validateLessonMetadataFileText(decoded.value, options);
  return parseSimpleLessonStructure(decoded.value, options);
}
