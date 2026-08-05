import { describe, expect, it } from 'vitest';
import { validateUdaMetadataFile } from '../validateUdaMetadataFile.js';
import { STRUCTURE_IMPORT_LIMITS } from '../limits.js';

/**
 * L'API pubblica è byte-first: i test passano sempre dai byte, così il percorso
 * esercitato è esattamente quello che userà la UI.
 */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * STRUCTURE-IMPORT-01 — contratto chiuso del file UDA
 * (structure-metadata-import-roadmap.md §3).
 */

const VALID = `schema: schoolforge-uda-metadata/v1
udas:
  - titolo: Introduzione alle reti
    descrizione: Fondamenti della comunicazione tra dispositivi.
    competenze:
      - Comprendere il funzionamento generale di una rete
    obiettivi:
      - Comprendere il ruolo degli indirizzi IP
`;

function codeOf(text: string, existingTitles: string[] = []): string {
  const result = validateUdaMetadataFile(utf8(text), { existingTitles });
  expect(result.ok).toBe(false);
  return result.ok ? 'ok' : result.error.code;
}

describe('file valido', () => {
  it('accetta il formato canonico e normalizza', () => {
    const result = validateUdaMetadataFile(utf8(VALID), { filename: 'schoolforge-udas.yaml' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      {
        titolo: 'Introduzione alle reti',
        descrizione: 'Fondamenti della comunicazione tra dispositivi.',
        competenze: ['Comprendere il funzionamento generale di una rete'],
        obiettivi: ['Comprendere il ruolo degli indirizzi IP'],
      },
    ]);
  });

  it('accetta indifferentemente .yaml e .yml', () => {
    for (const filename of ['a.yaml', 'a.yml']) {
      expect(validateUdaMetadataFile(utf8(VALID), { filename }).ok).toBe(true);
    }
  });

  it('conserva accenti e apostrofi italiani senza alterarli', () => {
    const text = `schema: schoolforge-uda-metadata/v1
udas:
  - titolo: Città, energia e società
    competenze:
      - Valutare l'impatto dell'urbanizzazione
    obiettivi:
      - Comprendere perché la città cresce
`;
    const result = validateUdaMetadataFile(utf8(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.titolo).toBe('Città, energia e società');
    expect(result.value[0]!.competenze[0]).toBe("Valutare l'impatto dell'urbanizzazione");
  });

  it('applica solo il trim esterno, senza toccare gli spazi interni', () => {
    const text = `schema: schoolforge-uda-metadata/v1
udas:
  - titolo: "  Le  reti   locali  "
    competenze:
      - "  una  competenza  "
    obiettivi:
      - "  un  obiettivo  "
`;
    const result = validateUdaMetadataFile(utf8(text));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]!.titolo).toBe('Le  reti   locali');
    expect(result.value[0]!.competenze).toEqual(['una  competenza']);
  });

  it('la descrizione assente diventa null', () => {
    const result = validateUdaMetadataFile(utf8(VALID.replace(/\n {4}descrizione:.*/, '')));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value[0]!.descrizione).toBeNull();
  });

  it('conserva l’ordine del file', () => {
    const text = `schema: schoolforge-uda-metadata/v1
udas:
${['Terza', 'Prima', 'Seconda']
  .map((titolo) => `  - titolo: ${titolo}\n    competenze:\n      - c\n    obiettivi:\n      - o\n`)
  .join('')}`;
    const result = validateUdaMetadataFile(utf8(text));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((u) => u.titolo)).toEqual(['Terza', 'Prima', 'Seconda']);
  });
});

describe('schema e radice', () => {
  it('rifiuta lo schema mancante', () => {
    expect(codeOf(VALID.replace('schema: schoolforge-uda-metadata/v1\n', ''))).toBe(
      'missing_schema',
    );
  });

  it('rifiuta uno schema sconosciuto o di versione diversa', () => {
    expect(codeOf(VALID.replace('/v1', '/v2'))).toBe('unknown_schema');
    expect(codeOf(VALID.replace('schoolforge-uda-metadata/v1', 'altro'))).toBe('unknown_schema');
  });

  it('rifiuta lo schema del file lezioni', () => {
    expect(
      codeOf(VALID.replace('schoolforge-uda-metadata/v1', 'schoolforge-lesson-metadata/v1')),
    ).toBe('unknown_schema');
  });

  it('rifiuta una chiave extra alla radice', () => {
    expect(codeOf(`${VALID}extra: 1\n`)).toBe('unknown_property');
  });

  it('rifiuta l’elenco mancante o di tipo errato', () => {
    expect(codeOf('schema: schoolforge-uda-metadata/v1\n')).toBe('missing_field');
    expect(codeOf('schema: schoolforge-uda-metadata/v1\nudas: testo\n')).toBe('invalid_type');
  });

  it('rifiuta un elenco vuoto e uno oltre 40 elementi', () => {
    expect(codeOf('schema: schoolforge-uda-metadata/v1\nudas: []\n')).toBe('too_few_items');
    const many = `schema: schoolforge-uda-metadata/v1\nudas:\n${Array.from(
      { length: STRUCTURE_IMPORT_LIMITS.MAX_UDAS + 1 },
      (_, i) => `  - titolo: U${i}\n    competenze:\n      - c\n    obiettivi:\n      - o\n`,
    ).join('')}`;
    expect(codeOf(many)).toBe('too_many_items');
  });

  it('accetta esattamente 40 UDA', () => {
    const text = `schema: schoolforge-uda-metadata/v1\nudas:\n${Array.from(
      { length: STRUCTURE_IMPORT_LIMITS.MAX_UDAS },
      (_, i) => `  - titolo: U${i}\n    competenze:\n      - c\n    obiettivi:\n      - o\n`,
    ).join('')}`;
    const result = validateUdaMetadataFile(utf8(text));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(40);
  });

  it('rifiuta una voce che non è un oggetto', () => {
    expect(codeOf('schema: schoolforge-uda-metadata/v1\nudas:\n  - solo testo\n')).toBe(
      'invalid_type',
    );
  });
});

describe('campi della voce', () => {
  it('rifiuta una proprietà sconosciuta', () => {
    expect(codeOf(VALID.replace('    descrizione:', '    durata: 3\n    descrizione:'))).toBe(
      'unknown_property',
    );
  });

  it('rifiuta esplicitamente i campi di contenuto e quelli tecnici', () => {
    for (const key of ['body', 'content', 'lezioni', 'pool', 'id', 'order', 'dir']) {
      const text = VALID.replace('    descrizione:', `    ${key}: x\n    descrizione:`);
      const result = validateUdaMetadataFile(utf8(text));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('forbidden_property');
    }
  });

  it('rifiuta il titolo mancante, vuoto o troppo lungo', () => {
    const senzaTitolo = `schema: schoolforge-uda-metadata/v1
udas:
  - descrizione: Solo la descrizione.
    competenze:
      - c
    obiettivi:
      - o
`;
    expect(codeOf(senzaTitolo)).toBe('missing_field');
    expect(codeOf(VALID.replace('Introduzione alle reti', '"   "'))).toBe('empty_value');
    expect(
      codeOf(
        VALID.replace(
          'Introduzione alle reti',
          'x'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_TEXT_LENGTH + 1),
        ),
      ),
    ).toBe('value_too_long');
  });

  it('accetta esattamente 300 caratteri', () => {
    const text = VALID.replace(
      'Introduzione alle reti',
      'x'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_TEXT_LENGTH),
    );
    expect(validateUdaMetadataFile(utf8(text)).ok).toBe(true);
  });

  it('rifiuta un titolo non stringa: nessuna coercizione silenziosa', () => {
    expect(codeOf(VALID.replace('Introduzione alle reti', '[a, b]'))).toBe('invalid_type');
    expect(codeOf(VALID.replace('titolo: Introduzione alle reti', 'titolo:\n      a: 1'))).toBe(
      'invalid_type',
    );
    expect(codeOf(VALID.replace('Introduzione alle reti', '42'))).toBe('invalid_type');
  });

  it('rifiuta una descrizione presente ma vuota', () => {
    expect(codeOf(VALID.replace('Fondamenti della comunicazione tra dispositivi.', '"  "'))).toBe(
      'empty_value',
    );
  });

  it('rifiuta competenze e obiettivi mancanti, vuoti o troppo lunghi', () => {
    expect(codeOf(VALID.replace(/ {4}competenze:\n {6}- .*\n/, ''))).toBe('missing_field');
    expect(codeOf(VALID.replace(/ {4}competenze:\n {6}- .*\n/, '    competenze: []\n'))).toBe(
      'too_few_items',
    );
    expect(codeOf(VALID.replace(/ {4}obiettivi:\n {6}- .*\n/, '    obiettivi: testo\n'))).toBe(
      'invalid_type',
    );
    const many = VALID.replace(
      / {4}obiettivi:\n {6}- .*\n/,
      `    obiettivi:\n${Array.from({ length: STRUCTURE_IMPORT_LIMITS.MAX_LIST_ITEMS + 1 }, (_, i) => `      - o${i}\n`).join('')}`,
    );
    expect(codeOf(many)).toBe('too_many_items');
  });

  it('rifiuta un elemento di lista vuoto, non stringa o troppo lungo, indicandone la posizione', () => {
    const text = VALID.replace(
      / {4}obiettivi:\n {6}- .*\n/,
      '    obiettivi:\n      - primo\n      - "  "\n',
    );
    const result = validateUdaMetadataFile(utf8(text));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('empty_value');
    expect(result.error.field).toBe('obiettivi[1]');
    expect(result.error.index).toBe(0);

    expect(
      codeOf(VALID.replace(/ {4}obiettivi:\n {6}- .*\n/, '    obiettivi:\n      - 42\n')),
    ).toBe('invalid_type');
    expect(
      codeOf(
        VALID.replace(
          / {4}obiettivi:\n {6}- .*\n/,
          `    obiettivi:\n      - ${'x'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_TEXT_LENGTH + 1)}\n`,
        ),
      ),
    ).toBe('value_too_long');
  });
});

describe('duplicati semantici', () => {
  const twice = (a: string, b: string) => `schema: schoolforge-uda-metadata/v1
udas:
  - titolo: ${a}
    competenze:
      - c
    obiettivi:
      - o
  - titolo: ${b}
    competenze:
      - c
    obiettivi:
      - o
`;

  it('rifiuta due titoli uguali nello stesso file, senza distinzione di maiuscole né spazi', () => {
    expect(codeOf(twice('Le reti', 'le reti'))).toBe('duplicate_title');
    expect(codeOf(twice('Le reti', '"  LE RETI  "'))).toBe('duplicate_title');
  });

  it('rifiuta un titolo già presente nella destinazione', () => {
    const result = validateUdaMetadataFile(utf8(VALID), {
      existingTitles: ['  introduzione ALLE reti '],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('duplicate_title_in_destination');
      expect(result.error.index).toBe(0);
      expect(result.error.field).toBe('titolo');
    }
  });

  it('accetta titoli diversi', () => {
    expect(validateUdaMetadataFile(utf8(twice('Le reti', 'I protocolli'))).ok).toBe(true);
  });
});
