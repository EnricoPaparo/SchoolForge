import { describe, expect, it } from 'vitest';
import { parseSimpleLessonStructure, parseSimpleUdaStructure } from '../parseSimpleStructure.js';
import { STRUCTURE_IMPORT_LIMITS } from '../limits.js';
import type { NormalizedUdaMetadata, StructureImportResult } from '../types.js';

/**
 * STRUCTURE-IMPORT-SIMPLE-01 — il parser del formato semplice.
 *
 * La promessa è precisa: **tollerante sulla forma, rigido sul contenuto**. Le
 * due metà vanno provate insieme, perché è facile ottenerne una sola. Un parser
 * troppo indulgente importa cose che nessuno ha scritto; uno troppo severo
 * rifiuta contenuti perfetti perché il trattino era un altro carattere.
 */

const UDA_BASE = `UDA: Prima unità
Descrizione: Una descrizione
Competenze:
- Prima competenza
- Seconda competenza
Obiettivi:
- Primo obiettivo
`;

const LESSON_BASE = `LEZIONE: Prima lezione
Sottotitolo: Un sottotitolo
Difficoltà: intermedia
Concetti chiave:
- Primo concetto
Obiettivi:
- Primo obiettivo
`;

const ok = <T>(result: StructureImportResult<T>): T => {
  if (!result.ok)
    throw new Error(`atteso ok, ricevuto ${result.error.code}: ${result.error.message}`);
  return result.value;
};

const err = <T>(result: StructureImportResult<T>) => {
  if (result.ok) throw new Error('atteso errore, ricevuto ok');
  return result.error;
};

describe('formato canonico', () => {
  it('legge una UDA completa e normalizza come il percorso YAML', () => {
    expect(ok(parseSimpleUdaStructure(UDA_BASE))).toEqual([
      {
        titolo: 'Prima unità',
        descrizione: 'Una descrizione',
        competenze: ['Prima competenza', 'Seconda competenza'],
        obiettivi: ['Primo obiettivo'],
      },
    ]);
  });

  it('legge una lezione completa', () => {
    expect(ok(parseSimpleLessonStructure(LESSON_BASE))).toEqual([
      {
        titolo: 'Prima lezione',
        sottotitolo: 'Un sottotitolo',
        difficolta: 'intermedia',
        concettiChiave: ['Primo concetto'],
        obiettivi: ['Primo obiettivo'],
      },
    ]);
  });

  it('una nuova voce chiude da sola quella precedente, senza separatori', () => {
    const due = ok(
      parseSimpleUdaStructure(`${UDA_BASE}${UDA_BASE.replace('Prima unità', 'Seconda unità')}`),
    );
    expect(due).toHaveLength(2);
    expect(due.map((u) => u.titolo)).toEqual(['Prima unità', 'Seconda unità']);
  });

  it('la descrizione è facoltativa e assente diventa null', () => {
    const senza = `UDA: Solo titolo
Competenze:
- Una competenza
Obiettivi:
- Un obiettivo
`;
    expect(ok(parseSimpleUdaStructure(senza))[0]!.descrizione).toBeNull();
  });

  it('il sottotitolo è facoltativo, la difficoltà no', () => {
    const senzaSottotitolo = LESSON_BASE.replace('Sottotitolo: Un sottotitolo\n', '');
    expect(ok(parseSimpleLessonStructure(senzaSottotitolo))[0]!.sottotitolo).toBeNull();
    const senzaDifficolta = LESSON_BASE.replace('Difficoltà: intermedia\n', '');
    expect(err(parseSimpleLessonStructure(senzaDifficolta)).code).toBe('missing_field');
  });
});

/**
 * Il nucleo del task: venti e più forme grafiche diverse dello **stesso**
 * contenuto. Se una sola divergesse, il docente vedrebbe due UDA diverse a
 * seconda di come ha incollato — e con esse due piani e due identità.
 */
describe('equivalenza delle forme grafiche', () => {
  const atteso: NormalizedUdaMetadata[] = [
    {
      titolo: 'Prima unità',
      descrizione: 'Una descrizione',
      competenze: ['Prima competenza', 'Seconda competenza'],
      obiettivi: ['Primo obiettivo'],
    },
  ];

  const varianti: Array<[string, string]> = [
    ['canonico', UDA_BASE],
    ['rientro a due spazi', UDA_BASE.replace(/^- /gm, '  - ')],
    ['rientro a quattro spazi', UDA_BASE.replace(/^/gm, '    ').replace(/^ {4}$/gm, '')],
    ['rientro con tab', UDA_BASE.replace(/^- /gm, '\t- ')],
    ['CRLF', UDA_BASE.replace(/\n/g, '\r\n')],
    ['CR', UDA_BASE.replace(/\n/g, '\r')],
    ['righe vuote ovunque', UDA_BASE.replace(/\n/g, '\n\n')],
    ['separatori ---', `---\n${UDA_BASE}---\n`],
    [
      'etichette minuscole',
      UDA_BASE.replace('UDA:', 'uda:')
        .replace('Descrizione:', 'descrizione:')
        .replace('Competenze:', 'competenze:')
        .replace('Obiettivi:', 'obiettivi:'),
    ],
    [
      'etichette maiuscole',
      UDA_BASE.replace('Descrizione:', 'DESCRIZIONE:')
        .replace('Competenze:', 'COMPETENZE:')
        .replace('Obiettivi:', 'OBIETTIVI:'),
    ],
    ['refuso Obbiettivi', UDA_BASE.replace('Obiettivi:', 'Obbiettivi:')],
    ['spazi attorno ai due punti', UDA_BASE.replace(/^UDA: /m, 'UDA   :   ')],
    ['bullet *', UDA_BASE.replace(/^- /gm, '* ')],
    ['bullet •', UDA_BASE.replace(/^- /gm, '• ')],
    ['bullet ·', UDA_BASE.replace(/^- /gm, '· ')],
    ['bullet –', UDA_BASE.replace(/^- /gm, '– ')],
    ['bullet —', UDA_BASE.replace(/^- /gm, '— ')],
    [
      'elenco numerato con punto',
      `UDA: Prima unità\nDescrizione: Una descrizione\nCompetenze:\n1. Prima competenza\n2. Seconda competenza\nObiettivi:\n1. Primo obiettivo\n`,
    ],
    [
      'elenco numerato con parentesi',
      `UDA: Prima unità\nDescrizione: Una descrizione\nCompetenze:\n1) Prima competenza\n2) Seconda competenza\nObiettivi:\n1) Primo obiettivo\n`,
    ],
    [
      'voci senza bullet',
      `UDA: Prima unità\nDescrizione: Una descrizione\nCompetenze:\nPrima competenza\nSeconda competenza\nObiettivi:\nPrimo obiettivo\n`,
    ],
    [
      'prima voce sulla riga dell’intestazione',
      `UDA: Prima unità\nDescrizione: Una descrizione\nCompetenze: Prima competenza\n- Seconda competenza\nObiettivi: Primo obiettivo\n`,
    ],
    [
      'virgolette dritte',
      UDA_BASE.replace('Prima unità', '"Prima unità"').replace(
        'Una descrizione',
        '"Una descrizione"',
      ),
    ],
    ['apostrofi dritti', UDA_BASE.replace('Prima unità', "'Prima unità'")],
    ['virgolette curve', UDA_BASE.replace('Prima unità', '“Prima unità”')],
    ['virgolette singole curve', UDA_BASE.replace('Prima unità', '‘Prima unità’')],
    ['caporali', UDA_BASE.replace('Prima unità', '«Prima unità»')],
    ['fence senza linguaggio', '```\n' + UDA_BASE + '```\n'],
    ['fence text', '```text\n' + UDA_BASE + '```\n'],
    ['fence txt', '```txt\n' + UDA_BASE + '```\n'],
    ['fence yaml', '```yaml\n' + UDA_BASE + '```\n'],
    ['fence yml', '```yml\n' + UDA_BASE + '```\n'],
    ['fence con tilde', '~~~\n' + UDA_BASE + '~~~\n'],
    ['spazi in coda alle righe', UDA_BASE.replace(/\n/g, '   \n')],
    [
      'tutto insieme',
      '```text\r\n\r\n   UDA  :  «Prima unità»\r\n\r\n  descrizione :  Una descrizione\r\n\tCOMPETENZE:\r\n\t• Prima competenza\r\n\t• Seconda competenza\r\n\r\nObbiettivi:\r\n1) Primo obiettivo\r\n\r\n```\r\n',
    ],
  ];

  it.each(varianti)('%s', (_nome, testo) => {
    expect(ok(parseSimpleUdaStructure(testo))).toEqual(atteso);
  });

  it('sono almeno venti varianti, e producono tutte lo stesso DTO', () => {
    expect(varianti.length).toBeGreaterThanOrEqual(20);
    const serializzati = new Set(
      varianti.map(([, testo]) => JSON.stringify(ok(parseSimpleUdaStructure(testo)))),
    );
    // Una sola forma normalizzata per tutte: è ciò che rende identici piano,
    // serializzazione canonica e `sourceHash`.
    expect(serializzati.size).toBe(1);
  });
});

describe('il testo interno resta intatto', () => {
  it('due punti nel valore: si divide solo sul primo', () => {
    const testo = `UDA: Reti: fondamenti e protocolli
Descrizione: Perché studiarle: una premessa
Competenze:
- Capire il modello ISO/OSI: i sette livelli
Obiettivi:
- Un obiettivo
`;
    const uda = ok(parseSimpleUdaStructure(testo))[0]!;
    expect(uda.titolo).toBe('Reti: fondamenti e protocolli');
    expect(uda.descrizione).toBe('Perché studiarle: una premessa');
    expect(uda.competenze[0]).toBe('Capire il modello ISO/OSI: i sette livelli');
  });

  it('una riga con bullet è sempre una voce, anche se contiene i due punti', () => {
    const testo = UDA_BASE.replace('- Prima competenza', '- Obiettivo: capire le reti');
    expect(ok(parseSimpleUdaStructure(testo))[0]!.competenze[0]).toBe('Obiettivo: capire le reti');
  });

  it('virgole e punto e virgola non dividono nulla', () => {
    const testo = UDA_BASE.replace('- Prima competenza', '- Leggere, scrivere; contare');
    expect(ok(parseSimpleUdaStructure(testo))[0]!.competenze).toEqual([
      'Leggere, scrivere; contare',
      'Seconda competenza',
    ]);
  });

  it('accenti, apostrofi e trattini lunghi arrivano invariati', () => {
    const testo = `UDA: Perché l’unità è così
Descrizione: Città, però — e un trattino
Competenze:
- L’apostrofo tipografico
Obiettivi:
- Un obiettivo
`;
    const uda = ok(parseSimpleUdaStructure(testo))[0]!;
    expect(uda.titolo).toBe('Perché l’unità è così');
    expect(uda.descrizione).toBe('Città, però — e un trattino');
    expect(uda.competenze[0]).toBe('L’apostrofo tipografico');
  });

  it('un apostrofo iniziale non chiuso è un’elisione, non una virgoletta', () => {
    // «'900», «’800», «'60»: elisioni di secolo e decennio. Rifiutarle come
    // virgolette non chiuse significherebbe respingere titoli di storia
    // perfettamente sensati, senza che il docente possa capire cosa correggere.
    const uda = ok(
      parseSimpleUdaStructure(`UDA: '900 e società di massa
Descrizione: L’Italia del ’900
Competenze:
- '60 e contestazione giovanile
- ’68 e movimenti studenteschi
Obiettivi:
- Un obiettivo
`),
    )[0]!;
    expect(uda.titolo).toBe("'900 e società di massa");
    expect(uda.descrizione).toBe('L’Italia del ’900');
    expect(uda.competenze).toEqual([
      "'60 e contestazione giovanile",
      '’68 e movimenti studenteschi',
    ]);
  });

  it('lo stesso vale per le lezioni', () => {
    const lezione = ok(
      parseSimpleLessonStructure(`LEZIONE: ’800 europeo
Sottotitolo: Dall’Ottocento al '900
Difficoltà: base
Concetti chiave:
- '48 e le rivoluzioni
Obiettivi:
- Un obiettivo
`),
    )[0]!;
    expect(lezione.titolo).toBe('’800 europeo');
    expect(lezione.sottotitolo).toBe("Dall’Ottocento al '900");
    expect(lezione.concettiChiave).toEqual(["'48 e le rivoluzioni"]);
  });

  it('un apostrofo che invece chiude davvero è una coppia, e sparisce', () => {
    for (const [scritto, atteso] of [
      ["'Titolo racchiuso'", 'Titolo racchiuso'],
      ['’Titolo racchiuso’', 'Titolo racchiuso'],
      ['‘Titolo racchiuso’', 'Titolo racchiuso'],
    ] as const) {
      const uda = ok(parseSimpleUdaStructure(UDA_BASE.replace('Prima unità', scritto)))[0]!;
      expect(uda.titolo).toBe(atteso);
    }
  });

  it('le virgolette vere, se aperte e non chiuse, restano un errore', () => {
    // Nessuna parola italiana comincia con una di queste: trovarne una senza
    // chiusura significa che il testo incollato è troncato.
    for (const aperta of ['"Titolo', '“Titolo', '«Titolo', '‘Titolo']) {
      expect(err(parseSimpleUdaStructure(UDA_BASE.replace('Prima unità', aperta))).code).toBe(
        'unbalanced_quotes',
      );
    }
    // Anche dentro un elenco.
    expect(
      err(parseSimpleUdaStructure(UDA_BASE.replace('- Prima competenza', '- "Competenza'))).code,
    ).toBe('unbalanced_quotes');
  });

  it('toglie una sola coppia di virgolette, non quelle interne', () => {
    const testo = UDA_BASE.replace('Prima unità', '"Le reti "locali" in breve"');
    expect(ok(parseSimpleUdaStructure(testo))[0]!.titolo).toBe('Le reti "locali" in breve');
  });
});

describe('rigore: ciò che resta un errore', () => {
  const casi: Array<[string, string, string]> = [
    ['riga prima della prima voce', `Titolo sparso\n${UDA_BASE}`, 'orphan_line'],
    ['titolo mancante', UDA_BASE.replace('UDA: Prima unità', 'UDA:'), 'missing_field'],
    [
      'elenco obbligatorio assente',
      `UDA: Prima unità\nDescrizione: Una descrizione\nObiettivi:\n- Un obiettivo\n`,
      'missing_field',
    ],
    [
      'elenco obbligatorio vuoto',
      `UDA: Prima unità\nCompetenze:\nObiettivi:\n- Un obiettivo\n`,
      'too_few_items',
    ],
    [
      'sezione duplicata',
      `${UDA_BASE}Competenze:\n- Altra\n`.replace('UDA: Prima unità\n', 'UDA: Prima unità\n'),
      'duplicate_section',
    ],
    [
      'campo duplicato',
      `UDA: Prima unità\nDescrizione: Una\nDescrizione: Due\nCompetenze:\n- Una\nObiettivi:\n- Uno\n`,
      'duplicate_section',
    ],
    ['campo sconosciuto', UDA_BASE.replace('Descrizione:', 'Prerequisiti:'), 'unknown_label'],
    ['voce di elenco vuota', UDA_BASE.replace('- Prima competenza', '-'), 'empty_value'],
    [
      'virgolette non corrispondenti',
      UDA_BASE.replace('Prima unità', '"Prima unità'),
      'unbalanced_quotes',
    ],
    ['fence non chiuso', '```\n' + UDA_BASE, 'malformed_fence'],
    ['fence con linguaggio non ammesso', '```json\n' + UDA_BASE + '```\n', 'malformed_fence'],
    ['nessuna voce', 'Competenze:\n- Una\n', 'orphan_line'],
    ['testo vuoto', '   \n\n', 'too_few_items'],
  ];

  it.each(casi)('%s', (_nome, testo, code) => {
    expect(err(parseSimpleUdaStructure(testo)).code).toBe(code);
  });

  it('una voce di elenco senza sezione aperta è orfana, non un titolo', () => {
    const testo = `UDA: Prima unità\n- Una competenza\nCompetenze:\n- Una\nObiettivi:\n- Uno\n`;
    const errore = err(parseSimpleUdaStructure(testo));
    expect(errore.code).toBe('orphan_line');
    expect(errore.line).toBe(2);
  });

  it('titoli duplicati fermano tutto: l’append non rinomina', () => {
    expect(err(parseSimpleUdaStructure(`${UDA_BASE}${UDA_BASE}`)).code).toBe('duplicate_title');
  });

  it('un titolo già presente nella destinazione è una collisione', () => {
    const errore = err(parseSimpleUdaStructure(UDA_BASE, { existingTitles: ['prima UNITÀ'] }));
    expect(errore.code).toBe('duplicate_title_in_destination');
  });

  it('oltre il limite di voci', () => {
    const troppe = Array.from(
      { length: STRUCTURE_IMPORT_LIMITS.MAX_UDAS + 1 },
      (_, i) => `UDA: Unità ${i}\nCompetenze:\n- Una\nObiettivi:\n- Uno\n`,
    ).join('');
    expect(err(parseSimpleUdaStructure(troppe)).code).toBe('too_many_items');
  });

  it('oltre il limite di lunghezza di un valore', () => {
    const lungo = UDA_BASE.replace(
      'Prima unità',
      'x'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_TEXT_LENGTH + 1),
    );
    expect(err(parseSimpleUdaStructure(lungo)).code).toBe('value_too_long');
  });

  it('non ignora righe e non inventa valori', () => {
    // Una riga non collocabile ferma l'import invece di sparire in silenzio.
    const testo = `UDA: Prima unità\nDescrizione: Una descrizione\nnota a margine\nCompetenze:\n- Una\nObiettivi:\n- Uno\n`;
    const errore = err(parseSimpleUdaStructure(testo));
    expect(errore.code).toBe('ambiguous_line');
    expect(errore.line).toBe(3);
  });
});

describe('suggerimenti sui refusi', () => {
  it('«Obietivi» suggerisce «Obiettivi», con il numero di riga', () => {
    const testo = UDA_BASE.replace('Obiettivi:', 'Obietivi:');
    const errore = err(parseSimpleUdaStructure(testo));
    expect(errore.code).toBe('unknown_label');
    expect(errore.message).toContain('Riga 6');
    expect(errore.message).toContain('«Obietivi»');
    expect(errore.message).toContain('Forse intendevi «Obiettivi»?');
  });

  it('suggerisce anche su Competenze e Difficoltà', () => {
    expect(
      err(parseSimpleUdaStructure(UDA_BASE.replace('Competenze:', 'Competenzе:'))).message,
    ).toContain('Competenze');
    expect(
      err(parseSimpleLessonStructure(LESSON_BASE.replace('Difficoltà:', 'Dificoltà:'))).message,
    ).toContain('Difficoltà');
  });

  it('una parola davvero diversa non riceve un suggerimento inventato', () => {
    const errore = err(parseSimpleUdaStructure(UDA_BASE.replace('Descrizione:', 'Bibliografia:')));
    expect(errore.code).toBe('unknown_label');
    expect(errore.message).not.toContain('Forse intendevi');
  });
});

describe('errori leggibili', () => {
  it('portano codice, riga e messaggio in italiano, mai il testo incollato', () => {
    const errore = err(parseSimpleUdaStructure(`Riga sbagliata con un segreto\n${UDA_BASE}`));
    expect(errore.code).toBe('orphan_line');
    expect(errore.line).toBe(1);
    expect(errore.fileKind).toBe('uda');
    expect(errore.message).not.toContain('segreto');
    expect(errore.message).not.toMatch(/at |\.ts:|Error:/);
  });
});
