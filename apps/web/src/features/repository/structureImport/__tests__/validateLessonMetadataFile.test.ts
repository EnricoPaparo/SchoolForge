import { describe, expect, it } from 'vitest';
import { validateLessonMetadataFile } from '../validateLessonMetadataFile.js';
import { STRUCTURE_IMPORT_LIMITS } from '../limits.js';

/**
 * L'API pubblica è byte-first: i test passano sempre dai byte, così il percorso
 * esercitato è esattamente quello che userà la UI.
 */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * STRUCTURE-IMPORT-01 — contratto chiuso del file lezioni
 * (structure-metadata-import-roadmap.md §4). L'accento è sul divieto assoluto
 * di contenuto: una lezione importata nasce sempre con il corpo vuoto, quindi
 * un `body:` scritto dal docente deve essere un errore esplicito, mai un campo
 * ignorato in silenzio.
 */

const VALID = `schema: schoolforge-lesson-metadata/v1
lessons:
  - titolo: Che cos'è una rete
    sottotitolo: Dispositivi e comunicazione
    difficolta: introduttiva
    concettiChiave:
      - nodo
      - protocollo
    obiettivi:
      - Definire correttamente una rete informatica
`;

function codeOf(text: string, existingTitles: string[] = []): string {
  const result = validateLessonMetadataFile(utf8(text), { existingTitles });
  expect(result.ok).toBe(false);
  return result.ok ? 'ok' : result.error.code;
}

describe('file valido', () => {
  it('accetta il formato canonico e normalizza', () => {
    const result = validateLessonMetadataFile(utf8(VALID), { filename: 'schoolforge-lezioni.yml' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        titolo: "Che cos'è una rete",
        sottotitolo: 'Dispositivi e comunicazione',
        difficolta: 'introduttiva',
        concettiChiave: ['nodo', 'protocollo'],
        obiettivi: ['Definire correttamente una rete informatica'],
      },
    ]);
  });

  it('il sottotitolo assente diventa null', () => {
    const result = validateLessonMetadataFile(
      utf8(VALID.replace('    sottotitolo: Dispositivi e comunicazione\n', '')),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.sottotitolo).toBeNull();
  });

  it('il sottotitolo presente ma vuoto diventa null, come l’assenza', () => {
    const result = validateLessonMetadataFile(
      utf8(VALID.replace('Dispositivi e comunicazione', '"   "')),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.sottotitolo).toBeNull();
  });

  it('conserva l’ordine del file', () => {
    const text = `schema: schoolforge-lesson-metadata/v1
lessons:
${['Gamma', 'Alfa', 'Beta']
  .map(
    (titolo) =>
      `  - titolo: ${titolo}\n    difficolta: base\n    concettiChiave:\n      - c\n    obiettivi:\n      - o\n`,
  )
  .join('')}`;
    const result = validateLessonMetadataFile(utf8(text));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((l) => l.titolo)).toEqual(['Gamma', 'Alfa', 'Beta']);
  });

  it('accetta esattamente 40 lezioni e rifiuta la quarantunesima', () => {
    const build = (count: number) =>
      `schema: schoolforge-lesson-metadata/v1\nlessons:\n${Array.from(
        { length: count },
        (_, i) =>
          `  - titolo: L${i}\n    difficolta: base\n    concettiChiave:\n      - c\n    obiettivi:\n      - o\n`,
      ).join('')}`;
    expect(validateLessonMetadataFile(utf8(build(STRUCTURE_IMPORT_LIMITS.MAX_LESSONS))).ok).toBe(
      true,
    );
    expect(codeOf(build(STRUCTURE_IMPORT_LIMITS.MAX_LESSONS + 1))).toBe('too_many_items');
  });
});

describe('schema e radice', () => {
  it('rifiuta schema mancante, sconosciuto o del file UDA', () => {
    expect(codeOf(VALID.replace('schema: schoolforge-lesson-metadata/v1\n', ''))).toBe(
      'missing_schema',
    );
    expect(codeOf(VALID.replace('/v1', '/v9'))).toBe('unknown_schema');
    expect(
      codeOf(VALID.replace('schoolforge-lesson-metadata/v1', 'schoolforge-uda-metadata/v1')),
    ).toBe('unknown_schema');
  });

  it('rifiuta una chiave extra alla radice e l’elenco mancante', () => {
    expect(codeOf(`${VALID}udas: []\n`)).toBe('unknown_property');
    expect(codeOf('schema: schoolforge-lesson-metadata/v1\n')).toBe('missing_field');
    expect(codeOf('schema: schoolforge-lesson-metadata/v1\nlessons: []\n')).toBe('too_few_items');
  });
});

describe('campi vietati', () => {
  it('rifiuta esplicitamente contenuto, pool, soluzioni e riferimenti tecnici', () => {
    for (const key of [
      'body',
      'content',
      'contenuto',
      'markdown',
      'html',
      'pool',
      'domande',
      'soluzione',
      'id',
      'lessonId',
      'publicLessonId',
      'udaId',
      'order',
      'filename',
      'path',
      'storageRef',
      'poolStatus',
      'questionCount',
    ]) {
      const text = VALID.replace('    difficolta:', `    ${key}: x\n    difficolta:`);
      const result = validateLessonMetadataFile(utf8(text));
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('forbidden_property');
        expect(result.error.field).toBe(key);
        expect(result.error.index).toBe(0);
      }
    }
  });

  it('il messaggio di un campo vietato spiega che il file contiene solo metadati', () => {
    const result = validateLessonMetadataFile(
      utf8(VALID.replace('    difficolta:', '    body: "# Titolo"\n    difficolta:')),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('solo metadati');
  });

  it('rifiuta comunque una proprietà semplicemente sconosciuta', () => {
    expect(codeOf(VALID.replace('    difficolta:', '    durataMinuti: 50\n    difficolta:'))).toBe(
      'unknown_property',
    );
  });
});

describe('campi della voce', () => {
  it('rifiuta il titolo mancante o troppo lungo', () => {
    const senzaTitolo = `schema: schoolforge-lesson-metadata/v1
lessons:
  - difficolta: base
    concettiChiave:
      - c
    obiettivi:
      - o
`;
    expect(codeOf(senzaTitolo)).toBe('missing_field');
    expect(
      codeOf(
        VALID.replace(
          "Che cos'è una rete",
          'x'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_TEXT_LENGTH + 1),
        ),
      ),
    ).toBe('value_too_long');
  });

  it('rifiuta la difficoltà mancante, vuota o oltre 120 caratteri', () => {
    expect(codeOf(VALID.replace('    difficolta: introduttiva\n', ''))).toBe('missing_field');
    expect(codeOf(VALID.replace('introduttiva', '"  "'))).toBe('empty_value');
    expect(
      codeOf(
        VALID.replace(
          'introduttiva',
          'x'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_DIFFICULTY_LENGTH + 1),
        ),
      ),
    ).toBe('value_too_long');
    expect(
      validateLessonMetadataFile(
        utf8(
          VALID.replace('introduttiva', 'x'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_DIFFICULTY_LENGTH)),
        ),
      ).ok,
    ).toBe(true);
  });

  it('rifiuta concettiChiave e obiettivi mancanti, vuoti o troppo numerosi', () => {
    expect(codeOf(VALID.replace(/ {4}concettiChiave:\n {6}- nodo\n {6}- protocollo\n/, ''))).toBe(
      'missing_field',
    );
    expect(
      codeOf(
        VALID.replace(
          / {4}concettiChiave:\n {6}- nodo\n {6}- protocollo\n/,
          '    concettiChiave: []\n',
        ),
      ),
    ).toBe('too_few_items');
    const many = VALID.replace(
      / {4}obiettivi:\n {6}- .*\n/,
      `    obiettivi:\n${Array.from({ length: STRUCTURE_IMPORT_LIMITS.MAX_LIST_ITEMS + 1 }, (_, i) => `      - o${i}\n`).join('')}`,
    );
    expect(codeOf(many)).toBe('too_many_items');
  });

  it('rifiuta valori non stringa senza coercizione', () => {
    expect(codeOf(VALID.replace('difficolta: introduttiva', 'difficolta: 3'))).toBe('invalid_type');
    expect(
      codeOf(VALID.replace('sottotitolo: Dispositivi e comunicazione', 'sottotitolo: [a]')),
    ).toBe('invalid_type');
  });
});

describe('duplicati semantici', () => {
  const twice = (a: string, b: string) => `schema: schoolforge-lesson-metadata/v1
lessons:
  - titolo: ${a}
    difficolta: base
    concettiChiave:
      - c
    obiettivi:
      - o
  - titolo: ${b}
    difficolta: base
    concettiChiave:
      - c
    obiettivi:
      - o
`;

  it('rifiuta due titoli uguali a meno di maiuscole e spazi esterni', () => {
    expect(codeOf(twice('La rete', '"  la RETE  "'))).toBe('duplicate_title');
  });

  it('due titoli che differiscono negli spazi interni restano distinti', () => {
    // Il confronto normalizza solo il trim esterno: non tocca il testo scritto
    // dal docente, quindi «La  rete» e «La rete» sono due titoli diversi.
    expect(validateLessonMetadataFile(utf8(twice('La rete', '"La  rete"'))).ok).toBe(true);
  });

  it('rifiuta un titolo già presente nella UDA di destinazione', () => {
    const result = validateLessonMetadataFile(utf8(VALID), {
      existingTitles: ["CHE COS'È UNA RETE"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_title_in_destination');
  });

  it('accetta titoli diversi', () => {
    expect(validateLessonMetadataFile(utf8(twice('La rete', 'Il protocollo'))).ok).toBe(true);
  });
});
