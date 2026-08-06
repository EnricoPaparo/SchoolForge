import { describe, expect, it } from 'vitest';
import {
  detectStructureFormat,
  parseLessonStructureInput,
  parseUdaStructureInput,
} from '../structureInputAdapter.js';
import { validateUdaMetadataFile } from '../validateUdaMetadataFile.js';
import { validateLessonMetadataFile } from '../validateLessonMetadataFile.js';
import {
  LESSON_METADATA_TEMPLATE,
  LESSON_SIMPLE_TEMPLATE,
  UDA_METADATA_TEMPLATE,
  UDA_SIMPLE_TEMPLATE,
} from '../structureImportTemplates.js';
import { STRUCTURE_IMPORT_LIMITS } from '../limits.js';
import { canonicalizeSource } from '../../structureImportRuntime/structureSourceCanonical.js';

/**
 * STRUCTURE-IMPORT-SIMPLE-01 — l'unica porta dell'importazione.
 *
 * Due cose vanno difese qui, e sono in tensione fra loro. La prima: il
 * riconoscimento del formato deve essere **deterministico**, mai un «prova
 * l'uno, poi prova l'altro» — un fallback trasformerebbe l'errore di un formato
 * nell'errore dell'altro, e il docente si vedrebbe spiegare il problema
 * sbagliato. La seconda: il percorso YAML deve restare **identico** a com'era,
 * fino ai DTO e alla serializzazione canonica, perché è ciò che regge
 * l'idempotenza degli import già avvenuti.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

const ok = <T>(result: { ok: boolean } & Record<string, unknown>): T => {
  if (!result.ok) throw new Error(`atteso ok: ${JSON.stringify(result['error'])}`);
  return result['value'] as T;
};

describe('riconoscimento del formato', () => {
  it('sceglie sulla prima riga significativa', () => {
    expect(detectStructureFormat(UDA_SIMPLE_TEMPLATE)).toBe('simple-uda');
    expect(detectStructureFormat(LESSON_SIMPLE_TEMPLATE)).toBe('simple-lesson');
    expect(detectStructureFormat(UDA_METADATA_TEMPLATE)).toBe('yaml');
    expect(detectStructureFormat(LESSON_METADATA_TEMPLATE)).toBe('yaml');
  });

  it('righe vuote, separatori, rientri e fence non confondono la scelta', () => {
    expect(detectStructureFormat(`\n\n---\n   uda: Prima\n`)).toBe('simple-uda');
    expect(detectStructureFormat('```text\n\nLEZIONE: Prima\n```\n')).toBe('simple-lesson');
    expect(detectStructureFormat('```yaml\nschema: x\n```\n')).toBe('yaml');
  });

  it('un testo che non comincia con nessuna delle tre etichette non è riconosciuto', () => {
    for (const testo of ['Ciao\n', '- solo un elenco\n', 'Titolo: qualcosa\n', '', '   ']) {
      expect(detectStructureFormat(testo)).toBeNull();
    }
  });

  it('non esiste alcun fallback fra i due formati', () => {
    // Un formato semplice con un errore *dentro* resta un errore del formato
    // semplice: non viene riprovato come YAML, altrimenti il messaggio parlerebbe
    // di uno schema che il docente non ha mai scritto.
    const errore = parseUdaStructureInput(utf8('UDA: Prima\nPrerequisiti: x\n'));
    expect(errore.ok).toBe(false);
    if (!errore.ok) {
      expect(errore.error.code).toBe('unknown_label');
      expect(errore.error.message).not.toContain('schema');
    }
  });

  it('un testo non riconosciuto lo dice, indicando entrambe le aperture ammesse', () => {
    const uda = parseUdaStructureInput(utf8('Ciao mondo\n'));
    expect(uda.ok).toBe(false);
    if (!uda.ok) {
      expect(uda.error.code).toBe('unknown_format');
      expect(uda.error.message).toContain('UDA:');
      expect(uda.error.message).toContain('schema:');
    }
    const lezione = parseLessonStructureInput(utf8('Ciao mondo\n'));
    if (!lezione.ok) expect(lezione.error.message).toContain('LEZIONE:');
  });
});

describe('formato giusto, finestra sbagliata', () => {
  it('una struttura lezioni nella finestra UDA', () => {
    const result = parseUdaStructureInput(utf8(LESSON_SIMPLE_TEMPLATE));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('wrong_structure_kind');
      // Il messaggio indica dove aprirla davvero, non solo che è sbagliata.
      expect(result.error.message).toContain('Importa lezioni');
    }
  });

  it('una struttura UDA nella finestra lezioni', () => {
    const result = parseLessonStructureInput(utf8(UDA_SIMPLE_TEMPLATE));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('wrong_structure_kind');
      expect(result.error.message).toContain('Importa struttura UDA');
    }
  });
});

describe('byte-first, come prima', () => {
  it('rifiuta byte UTF-8 non validi invece di ripararli', () => {
    const result = parseUdaStructureInput(new Uint8Array([0x55, 0x44, 0x41, 0x3a, 0xc3, 0x28]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_encoding');
  });

  it('applica il limite sui byte originali, prima di decodificare', () => {
    const result = parseUdaStructureInput(
      new Uint8Array(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES + 1).fill(0x20),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('file_too_large');
  });

  it('assorbe il BOM invece di trasformarlo nella prima etichetta', () => {
    const conBom = utf8(`\uFEFF${UDA_SIMPLE_TEMPLATE}`);
    expect(parseUdaStructureInput(conBom).ok).toBe(true);
  });

  it('controlla l’estensione solo quando un nome file esiste davvero', () => {
    expect(parseUdaStructureInput(utf8(UDA_SIMPLE_TEMPLATE)).ok).toBe(true);
    const conNome = parseUdaStructureInput(utf8(UDA_SIMPLE_TEMPLATE), { filename: 'x.json' });
    expect(conNome.ok).toBe(false);
  });
});

describe('lo YAML resta esattamente com’era', () => {
  it('stessi DTO del validatore YAML chiamato direttamente', () => {
    const daAdapter = parseUdaStructureInput(utf8(UDA_METADATA_TEMPLATE));
    const daValidatore = validateUdaMetadataFile(utf8(UDA_METADATA_TEMPLATE));
    expect(daAdapter).toEqual(daValidatore);

    const lezioniAdapter = parseLessonStructureInput(utf8(LESSON_METADATA_TEMPLATE));
    const lezioniValidatore = validateLessonMetadataFile(utf8(LESSON_METADATA_TEMPLATE));
    expect(lezioniAdapter).toEqual(lezioniValidatore);
  });

  it('stessi errori: schema mancante, sconosciuto, chiavi extra, documenti multipli', () => {
    const casi = [
      'schema: sbagliato\nudas: []\n',
      'schema: schoolforge-uda-metadata/v1\nudas: []\n',
      'schema: schoolforge-uda-metadata/v1\nextra: 1\nudas:\n  - titolo: A\n',
      'schema: schoolforge-uda-metadata/v1\nudas:\n  - titolo: A\n---\nschema: x\n',
    ];
    for (const yaml of casi) {
      expect(parseUdaStructureInput(utf8(yaml))).toEqual(validateUdaMetadataFile(utf8(yaml)));
    }
  });

  it('la collisione con la destinazione funziona su entrambe le sintassi', () => {
    const titoli = ['Titolo della prima UDA'];
    for (const testo of [UDA_SIMPLE_TEMPLATE, UDA_METADATA_TEMPLATE]) {
      const result = parseUdaStructureInput(utf8(testo), { existingTitles: titoli });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('duplicate_title_in_destination');
    }
  });
});

/**
 * L'identità di un tentativo nasce dai DTO, non dal testo: due grafie dello
 * stesso contenuto devono produrre lo stesso `sourceHash`, altrimenti reincollare
 * la stessa struttura con un rientro diverso creerebbe un secondo import invece
 * di essere riconosciuto come replay.
 */
describe('identità del tentativo', () => {
  const sorgente = (udas: unknown) => ({
    kind: 'uda' as const,
    ownerUid: 'owner-1',
    programId: 'prog-1',
    importId: 'imp-1',
    udas: udas as never,
  });

  it('grafie diverse dello stesso contenuto → stessa serializzazione canonica', () => {
    const varianti = [
      UDA_SIMPLE_TEMPLATE,
      UDA_SIMPLE_TEMPLATE.replace(/^- /gm, '  * '),
      UDA_SIMPLE_TEMPLATE.replace(/\n/g, '\r\n'),
      UDA_SIMPLE_TEMPLATE.replace(/\n/g, '\n\n'),
      '```text\n' + UDA_SIMPLE_TEMPLATE + '```\n',
    ];
    const canoniche = new Set(
      varianti.map((testo) =>
        canonicalizeSource(sorgente(ok(parseUdaStructureInput(utf8(testo)) as never))),
      ),
    );
    expect(canoniche.size).toBe(1);
  });

  it('un contenuto diverso resta un tentativo diverso', () => {
    const base = canonicalizeSource(
      sorgente(ok(parseUdaStructureInput(utf8(UDA_SIMPLE_TEMPLATE)) as never)),
    );
    const altro = canonicalizeSource(
      sorgente(
        ok(
          parseUdaStructureInput(
            utf8(UDA_SIMPLE_TEMPLATE.replace('Titolo della prima UDA', 'Un altro titolo')),
          ) as never,
        ),
      ),
    );
    expect(altro).not.toBe(base);
  });

  it('formato semplice e YAML con lo stesso contenuto sono lo stesso tentativo', () => {
    // Non è un dettaglio: un docente che passa dallo YAML al formato semplice
    // senza cambiare una parola non deve creare un secondo import.
    const semplice = `UDA: Introduzione alle reti
Descrizione: Fondamenti
Competenze:
- Una competenza
Obiettivi:
- Un obiettivo
`;
    const yaml = `schema: schoolforge-uda-metadata/v1
udas:
  - titolo: Introduzione alle reti
    descrizione: Fondamenti
    competenze:
      - Una competenza
    obiettivi:
      - Un obiettivo
`;
    expect(canonicalizeSource(sorgente(ok(parseUdaStructureInput(utf8(semplice)) as never)))).toBe(
      canonicalizeSource(sorgente(ok(parseUdaStructureInput(utf8(yaml)) as never))),
    );
  });
});

describe('i modelli della sezione Template', () => {
  it('il modello UDA semplice attraversa l’adapter e produce due voci complete', () => {
    const result = parseUdaStructureInput(utf8(UDA_SIMPLE_TEMPLATE));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toEqual({
      titolo: 'Titolo della prima UDA',
      descrizione: 'Breve descrizione della prima UDA',
      competenze: [
        'Prima competenza sviluppata dalla UDA',
        'Seconda competenza sviluppata dalla UDA',
      ],
      obiettivi: ['Primo obiettivo didattico della UDA', 'Secondo obiettivo didattico della UDA'],
    });
  });

  it('il modello lezioni semplice fa lo stesso', () => {
    const result = parseLessonStructureInput(utf8(LESSON_SIMPLE_TEMPLATE));
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
  });
});
