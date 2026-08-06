import { describe, expect, it } from 'vitest';
import {
  LESSON_METADATA_TEMPLATE,
  LESSON_SIMPLE_TEMPLATE,
  UDA_SIMPLE_TEMPLATE,
  LESSON_TEMPLATE_FILENAME,
  STRUCTURE_IMPORT_TEMPLATES,
  UDA_METADATA_TEMPLATE,
  UDA_TEMPLATE_FILENAME,
} from '../structureImportTemplates.js';
import { parseSimpleLessonStructure, parseSimpleUdaStructure } from '../parseSimpleStructure.js';
import { validateUdaMetadataFile } from '../validateUdaMetadataFile.js';
import { validateLessonMetadataFile } from '../validateLessonMetadataFile.js';
import { planUdaMetadataAppend } from '../planUdaMetadataAppend.js';
import { planLessonMetadataAppend } from '../planLessonMetadataAppend.js';
import { utf8ByteLength, STRUCTURE_IMPORT_LIMITS } from '../limits.js';

/** I modelli sono testi costanti: il percorso reale li riceverà come byte. */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * STRUCTURE-IMPORT-01 — i due modelli canonici. Il round-trip è il punto: un
 * modello che il validatore rifiuterebbe insegnerebbe un formato sbagliato al
 * docente, e nessuno se ne accorgerebbe finché non prova a importarlo.
 *
 * STRUCTURE-TEMPLATE-GENERIC-01 — da quando lo YAML si incolla, il modello deve
 * anche essere **immediatamente utilizzabile**: niente commenti da cancellare,
 * niente esempio disciplinare da riscrivere. Le prove qui sotto difendono le due
 * cose insieme, perché sono in tensione: un modello si può ripulire fino a
 * romperlo.
 */

describe('round-trip: i modelli sono accettati dai parser reali', () => {
  it('il modello UDA è valido e normalizza come atteso', () => {
    const result = validateUdaMetadataFile(utf8(UDA_METADATA_TEMPLATE), {
      filename: UDA_TEMPLATE_FILENAME,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    // Ogni campo del formato è rappresentato: il modello mostra la forma
    // completa, non una versione minima da indovinare.
    expect(result.value[0]).toEqual({
      titolo: 'Titolo della prima UDA',
      descrizione: 'Breve descrizione della prima UDA',
      competenze: [
        'Prima competenza sviluppata dalla UDA',
        'Seconda competenza sviluppata dalla UDA',
      ],
      obiettivi: ['Primo obiettivo didattico della UDA', 'Secondo obiettivo didattico della UDA'],
    });
    expect(result.value[1]!.titolo).toBe('Titolo della seconda UDA');
    expect(result.value[1]!.descrizione).toBe('Breve descrizione della seconda UDA');
  });

  it('il modello lezioni è valido e normalizza come atteso', () => {
    const result = validateLessonMetadataFile(utf8(LESSON_METADATA_TEMPLATE), {
      filename: LESSON_TEMPLATE_FILENAME,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toEqual({
      titolo: 'Titolo della prima lezione',
      sottotitolo: 'Breve sottotitolo della prima lezione',
      difficolta: 'Livello di difficoltà della prima lezione',
      concettiChiave: [
        'Primo concetto chiave della lezione',
        'Secondo concetto chiave della lezione',
      ],
      obiettivi: [
        'Primo obiettivo didattico della lezione',
        'Secondo obiettivo didattico della lezione',
      ],
    });
    expect(result.value[1]!.titolo).toBe('Titolo della seconda lezione');
    expect(result.value[1]!.sottotitolo).toBe('Breve sottotitolo della seconda lezione');
  });

  it('ogni modello attraversa anche il planner senza errori', () => {
    const udas = validateUdaMetadataFile(utf8(UDA_METADATA_TEMPLATE));
    expect(udas.ok).toBe(true);
    if (!udas.ok) return;
    const udaPlan = planUdaMetadataAppend({
      ownerUid: 'owner-1',
      programId: 'prog-1',
      importId: 'imp-1',
      udas: udas.value,
      existingUdas: [],
    });
    expect(udaPlan.ok).toBe(true);
    if (udaPlan.ok) {
      expect(udaPlan.value.udas.map((u) => u.dir)).toEqual([
        'uda-01-titolo-della-prima-uda',
        'uda-02-titolo-della-seconda-uda',
      ]);
    }

    const lessons = validateLessonMetadataFile(utf8(LESSON_METADATA_TEMPLATE));
    expect(lessons.ok).toBe(true);
    if (!lessons.ok) return;
    const lessonPlan = planLessonMetadataAppend({
      ownerUid: 'owner-1',
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01-reti',
      udaDir: 'uda-01-reti',
      lessons: lessons.value,
      existingLessons: [],
    });
    expect(lessonPlan.ok).toBe(true);
    if (lessonPlan.ok) {
      expect(lessonPlan.value.lessons.every((l) => l.doc.poolStatus === 'absent')).toBe(true);
    }
  });

  it('il modello UDA non è accettato come file lezioni, e viceversa', () => {
    expect(validateLessonMetadataFile(utf8(UDA_METADATA_TEMPLATE)).ok).toBe(false);
    expect(validateUdaMetadataFile(utf8(LESSON_METADATA_TEMPLATE)).ok).toBe(false);
  });
});

describe('forma dei modelli', () => {
  it('usano gli schemi definitivi', () => {
    expect(UDA_METADATA_TEMPLATE).toContain('schema: schoolforge-uda-metadata/v1');
    expect(LESSON_METADATA_TEMPLATE).toContain('schema: schoolforge-lesson-metadata/v1');
  });

  it('non contengono id tecnici, corpo o pool', () => {
    for (const template of [UDA_METADATA_TEMPLATE, LESSON_METADATA_TEMPLATE]) {
      for (const forbidden of [
        'body:',
        'content:',
        'id:',
        'path:',
        'filename:',
        'order:',
        'pool',
        'storageRef',
      ]) {
        expect(template).not.toContain(forbidden);
      }
    }
  });

  it('terminano in modo deterministico con un solo a capo finale', () => {
    for (const template of [UDA_METADATA_TEMPLATE, LESSON_METADATA_TEMPLATE]) {
      expect(template.endsWith('\n')).toBe(true);
      expect(template.endsWith('\n\n')).toBe(false);
    }
  });

  it('restano ampiamente entro il limite di dimensione', () => {
    for (const { content } of STRUCTURE_IMPORT_TEMPLATES) {
      expect(utf8ByteLength(content)).toBeLessThan(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES / 10);
    }
  });

  it('sono esposti con i nomi file canonici', () => {
    expect(STRUCTURE_IMPORT_TEMPLATES.map((t) => t.filename)).toEqual([
      'schoolforge-udas.yaml',
      'schoolforge-lezioni.yaml',
    ]);
  });
});

/**
 * STRUCTURE-TEMPLATE-GENERIC-01 — il modello è pronto all'uso.
 *
 * Il criterio è netto: quello che il docente copia deve poter essere incollato e
 * importato senza cancellare una sola riga. Ogni cosa che va tolta prima
 * dell'uso — un commento, un esempio di rete, un `...` — è lavoro scaricato
 * sull'utente e viene bloccata qui.
 */
describe('modelli generici e pronti all’uso', () => {
  const templates = [
    ['UDA', UDA_METADATA_TEMPLATE, 'schema: schoolforge-uda-metadata/v1'],
    ['lezioni', LESSON_METADATA_TEMPLATE, 'schema: schoolforge-lesson-metadata/v1'],
  ] as const;

  it('iniziano con la propria proprietà `schema`, che resta obbligatoria', () => {
    for (const [, template, schema] of templates) {
      // Prima riga, non una riga qualsiasi: è ciò che il validatore cerca per
      // riconoscere il formato, e l'unica riga che il docente non deve toccare.
      expect(template.split('\n')[0]).toBe(schema);
    }
  });

  it('non contengono alcuna riga di commento YAML', () => {
    for (const [nome, template] of templates) {
      const commenti = template.split('\n').filter((riga) => riga.trimStart().startsWith('#'));
      expect(commenti, `modello ${nome}`).toEqual([]);
      expect(template).not.toContain('#');
    }
  });

  it('non usano puntini di sospensione o segnaposto da sostituire a mano', () => {
    for (const [, template] of templates) {
      expect(template).not.toContain('...');
      expect(template).not.toContain('…');
      expect(template).not.toMatch(/<[^>]*inserisci[^>]*>/i);
      expect(template).not.toContain('TODO');
    }
  });

  it('non contengono più gli esempi disciplinari concreti', () => {
    for (const [, template] of templates) {
      for (const concreto of [
        'rete',
        'reti',
        'TCP',
        'UDP',
        'indirizzo IP',
        'router',
        'protocollo',
        'pacchetto',
        'instradamento',
        'nodo',
        'dispositiv',
      ]) {
        expect(template.toLowerCase()).not.toContain(concreto.toLowerCase());
      }
    }
  });

  it('non contengono spiegazioni sul funzionamento dell’importazione', () => {
    for (const [, template] of templates) {
      for (const spiegazione of ['Modello SchoolForge', 'in coda', 'editor', 'IA', 'importa']) {
        expect(template).not.toContain(spiegazione);
      }
    }
  });

  it('usano segnaposto generici che dicono implicitamente cosa inserire', () => {
    expect(UDA_METADATA_TEMPLATE).toContain('titolo: Titolo della prima UDA');
    expect(UDA_METADATA_TEMPLATE).toContain('- Primo obiettivo didattico della UDA');
    expect(LESSON_METADATA_TEMPLATE).toContain('titolo: Titolo della prima lezione');
    expect(LESSON_METADATA_TEMPLATE).toContain('- Primo concetto chiave della lezione');
    // «obiettivo», mai «obbiettivo».
    for (const [, template] of templates) {
      expect(template).not.toContain('obbiettiv');
      expect(template).toContain('obiettiv');
    }
  });

  it('mostrano due voci complete, con tutti i campi del formato', () => {
    const uda = validateUdaMetadataFile(utf8(UDA_METADATA_TEMPLATE));
    expect(uda.ok).toBe(true);
    if (uda.ok) {
      expect(uda.value).toHaveLength(2);
      for (const voce of uda.value) {
        expect(voce.titolo.length).toBeGreaterThan(0);
        expect(voce.descrizione).not.toBeNull();
        expect(voce.competenze).toHaveLength(2);
        expect(voce.obiettivi).toHaveLength(2);
      }
    }

    const lezioni = validateLessonMetadataFile(utf8(LESSON_METADATA_TEMPLATE));
    expect(lezioni.ok).toBe(true);
    if (lezioni.ok) {
      expect(lezioni.value).toHaveLength(2);
      for (const voce of lezioni.value) {
        expect(voce.titolo.length).toBeGreaterThan(0);
        expect(voce.sottotitolo).not.toBeNull();
        expect(voce.difficolta.length).toBeGreaterThan(0);
        expect(voce.concettiChiave).toHaveLength(2);
        expect(voce.obiettivi).toHaveLength(2);
      }
    }
  });

  it('non contengono id, order, path, corpo Markdown, pool o dati studente', () => {
    for (const [, template] of templates) {
      for (const tecnico of [
        'id:',
        'udaId',
        'lessonId',
        'order',
        'ordine',
        'path',
        'dir:',
        'slug',
        'storage',
        'body',
        'content',
        'markdown',
        '##',
        'pool',
        'domande',
        'soluzion',
        'studente',
        'classe',
        'firebase',
        'firestore',
      ]) {
        expect(template.toLowerCase()).not.toContain(tecnico.toLowerCase());
      }
    }
  });
});

/**
 * STRUCTURE-TEMPLATE-GENERIC-01 — testo definitivo, byte per byte.
 *
 * Le prove precedenti descrivono proprietà («nessun commento», «due voci»); qui
 * si fissa il contenuto esatto. Serve perché ciò che il docente copia è il testo
 * letterale: una riga in più, un'indentazione diversa o una newline finale
 * doppia sono differenze che nessuna prova per proprietà noterebbe.
 */
describe('contenuto definitivo dei modelli', () => {
  it('il modello UDA è esattamente questo', () => {
    expect(UDA_METADATA_TEMPLATE).toBe(
      [
        'schema: schoolforge-uda-metadata/v1',
        '',
        'udas:',
        '  - titolo: Titolo della prima UDA',
        '    descrizione: Breve descrizione della prima UDA',
        '    competenze:',
        '      - Prima competenza sviluppata dalla UDA',
        '      - Seconda competenza sviluppata dalla UDA',
        '    obiettivi:',
        '      - Primo obiettivo didattico della UDA',
        '      - Secondo obiettivo didattico della UDA',
        '',
        '  - titolo: Titolo della seconda UDA',
        '    descrizione: Breve descrizione della seconda UDA',
        '    competenze:',
        '      - Prima competenza sviluppata dalla UDA',
        '      - Seconda competenza sviluppata dalla UDA',
        '    obiettivi:',
        '      - Primo obiettivo didattico della UDA',
        '      - Secondo obiettivo didattico della UDA',
        '',
      ].join('\n'),
    );
  });

  it('il modello lezioni è esattamente questo', () => {
    expect(LESSON_METADATA_TEMPLATE).toBe(
      [
        'schema: schoolforge-lesson-metadata/v1',
        '',
        'lessons:',
        '  - titolo: Titolo della prima lezione',
        '    sottotitolo: Breve sottotitolo della prima lezione',
        '    difficolta: Livello di difficoltà della prima lezione',
        '    concettiChiave:',
        '      - Primo concetto chiave della lezione',
        '      - Secondo concetto chiave della lezione',
        '    obiettivi:',
        '      - Primo obiettivo didattico della lezione',
        '      - Secondo obiettivo didattico della lezione',
        '',
        '  - titolo: Titolo della seconda lezione',
        '    sottotitolo: Breve sottotitolo della seconda lezione',
        '    difficolta: Livello di difficoltà della seconda lezione',
        '    concettiChiave:',
        '      - Primo concetto chiave della lezione',
        '      - Secondo concetto chiave della lezione',
        '    obiettivi:',
        '      - Primo obiettivo didattico della lezione',
        '      - Secondo obiettivo didattico della lezione',
        '',
      ].join('\n'),
    );
  });

  it('sono UTF-8 valido e sopravvivono al giro byte → testo', () => {
    for (const template of [UDA_METADATA_TEMPLATE, LESSON_METADATA_TEMPLATE]) {
      const bytes = utf8(template);
      expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(template);
    }
    // «difficoltà» ha un carattere multibyte: se la codifica si rompesse, si
    // romperebbe qui.
    expect(LESSON_METADATA_TEMPLATE).toContain('difficoltà');
  });
});

/**
 * STRUCTURE-TEMPLATE-GENERIC-01 + STRUCTURE-IMPORT-SIMPLE-01 — i modelli che la
 * sezione Template mostra e copia.
 *
 * Sono la prima cosa che un docente vede del formato, quindi *sono* la
 * documentazione: se contenessero una riga che l'importazione poi rifiuta,
 * insegnerebbero un errore. Il round-trip con i parser reali è la difesa, il
 * testo esatto è il contratto.
 */
describe('modelli semplici della sezione Template', () => {
  const semplici = [
    ['UDA', UDA_SIMPLE_TEMPLATE],
    ['lezioni', LESSON_SIMPLE_TEMPLATE],
  ] as const;

  it('il modello UDA è esattamente questo', () => {
    expect(UDA_SIMPLE_TEMPLATE).toBe(
      [
        'UDA: Titolo della prima UDA',
        'Descrizione: Breve descrizione della prima UDA',
        'Competenze:',
        '- Prima competenza sviluppata dalla UDA',
        '- Seconda competenza sviluppata dalla UDA',
        'Obiettivi:',
        '- Primo obiettivo didattico della UDA',
        '- Secondo obiettivo didattico della UDA',
        'UDA: Titolo della seconda UDA',
        'Descrizione: Breve descrizione della seconda UDA',
        'Competenze:',
        '- Prima competenza sviluppata dalla UDA',
        '- Seconda competenza sviluppata dalla UDA',
        'Obiettivi:',
        '- Primo obiettivo didattico della UDA',
        '- Secondo obiettivo didattico della UDA',
        '',
      ].join('\n'),
    );
  });

  it('il modello lezioni è esattamente questo', () => {
    expect(LESSON_SIMPLE_TEMPLATE).toBe(
      [
        'LEZIONE: Titolo della prima lezione',
        'Sottotitolo: Breve sottotitolo della prima lezione',
        'Difficoltà: Livello di difficoltà della prima lezione',
        'Concetti chiave:',
        '- Primo concetto chiave della lezione',
        '- Secondo concetto chiave della lezione',
        'Obiettivi:',
        '- Primo obiettivo didattico della lezione',
        '- Secondo obiettivo didattico della lezione',
        'LEZIONE: Titolo della seconda lezione',
        'Sottotitolo: Breve sottotitolo della seconda lezione',
        'Difficoltà: Livello di difficoltà della seconda lezione',
        'Concetti chiave:',
        '- Primo concetto chiave della lezione',
        '- Secondo concetto chiave della lezione',
        'Obiettivi:',
        '- Primo obiettivo didattico della lezione',
        '- Secondo obiettivo didattico della lezione',
        '',
      ].join('\n'),
    );
  });

  it('nessuna traccia di YAML: né schema, né rientri, né righe vuote', () => {
    for (const [nome, template] of semplici) {
      expect(template, nome).not.toContain('schema:');
      expect(template).not.toContain('---');
      const righe = template.split('\n').slice(0, -1);
      // Nessun rientro: ogni riga comincia a colonna zero.
      expect(righe.filter((riga) => /^\s/.test(riga))).toEqual([]);
      // Nessuna riga vuota in mezzo.
      expect(righe.filter((riga) => riga.trim() === '')).toEqual([]);
      // Nessun commento, nessun segnaposto da sostituire a mano.
      expect(template).not.toContain('#');
      expect(template).not.toContain('...');
      expect(template).not.toMatch(/<[^>]*inserisci[^>]*>/i);
    }
  });

  it('terminano con una sola newline', () => {
    for (const [, template] of semplici) {
      expect(template.endsWith('\n')).toBe(true);
      expect(template.endsWith('\n\n')).toBe(false);
    }
  });

  it('nessun esempio disciplinare, nessun dato tecnico', () => {
    for (const [, template] of semplici) {
      for (const vietato of [
        'rete',
        'reti',
        'TCP',
        'UDP',
        'router',
        'protocollo',
        'id:',
        'order',
        'path',
        'storage',
        'body',
        'markdown',
        '##',
        'pool',
        'domande',
        'studente',
        'firebase',
      ]) {
        expect(template.toLowerCase()).not.toContain(vietato.toLowerCase());
      }
    }
  });

  it('usa «obiettivo», mai «obbiettivo»', () => {
    for (const [, template] of semplici) {
      expect(template).not.toContain('obbiettiv');
      expect(template).toContain('obiettiv');
    }
  });

  it('round-trip con i parser reali: due voci complete per ciascuno', () => {
    const uda = parseSimpleUdaStructure(UDA_SIMPLE_TEMPLATE);
    expect(uda.ok).toBe(true);
    if (uda.ok) {
      expect(uda.value).toHaveLength(2);
      for (const voce of uda.value) {
        expect(voce.titolo.length).toBeGreaterThan(0);
        expect(voce.descrizione).not.toBeNull();
        expect(voce.competenze).toHaveLength(2);
        expect(voce.obiettivi).toHaveLength(2);
      }
    }

    const lezioni = parseSimpleLessonStructure(LESSON_SIMPLE_TEMPLATE);
    expect(lezioni.ok).toBe(true);
    if (lezioni.ok) {
      expect(lezioni.value).toHaveLength(2);
      for (const voce of lezioni.value) {
        expect(voce.sottotitolo).not.toBeNull();
        expect(voce.difficolta.length).toBeGreaterThan(0);
        expect(voce.concettiChiave).toHaveLength(2);
        expect(voce.obiettivi).toHaveLength(2);
      }
    }
  });

  it('il modello UDA non è accettato come lezioni, e viceversa', () => {
    expect(parseSimpleLessonStructure(UDA_SIMPLE_TEMPLATE).ok).toBe(false);
    expect(parseSimpleUdaStructure(LESSON_SIMPLE_TEMPLATE).ok).toBe(false);
  });

  it('i modelli YAML restano esportati per compatibilità', () => {
    // Non sono più mostrati, ma restano importabili: chi ne ha uno salvato non
    // deve riscriverlo.
    expect(UDA_METADATA_TEMPLATE).toContain('schema: schoolforge-uda-metadata/v1');
    expect(LESSON_METADATA_TEMPLATE).toContain('schema: schoolforge-lesson-metadata/v1');
  });
});
