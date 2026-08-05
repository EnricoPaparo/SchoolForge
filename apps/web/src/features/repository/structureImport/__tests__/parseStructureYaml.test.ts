import { describe, expect, it } from 'vitest';
import { parseStructureYaml, parseStructureYamlText } from '../parseStructureYaml.js';
import { decodeStructureImportFile, hasAcceptedExtension } from '../decodeStructureImportFile.js';
import { STRUCTURE_IMPORT_LIMITS } from '../limits.js';

/**
 * STRUCTURE-IMPORT-01 — lettura fail-closed.
 *
 * Il percorso autorevole parte dai **byte originali**: estensione, limite
 * dimensionale e decodifica UTF-8 fatale precedono qualunque parsing. Ogni
 * caratteristica dello YAML che potrebbe far significare a un file piccolo
 * qualcosa di inatteso è rifiutata prima delle regole di formato.
 */

const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const opts = { fileKind: 'uda' } as const;

describe('estensione ammessa', () => {
  it('accetta .yaml e .yml, anche maiuscoli', () => {
    expect(hasAcceptedExtension('schoolforge-udas.yaml')).toBe(true);
    expect(hasAcceptedExtension('schoolforge-udas.yml')).toBe(true);
    expect(hasAcceptedExtension('SCHOOLFORGE-UDAS.YAML')).toBe(true);
  });

  it('rifiuta ogni altra estensione', () => {
    for (const name of ['udas.json', 'udas.txt', 'udas.zip', 'udas.yaml.txt', 'udas']) {
      expect(hasAcceptedExtension(name)).toBe(false);
    }
  });

  it('blocca il file prima di decodificarlo quando il nome non è ammesso', () => {
    const result = parseStructureYaml(utf8('schema: x\n'), { ...opts, filename: 'udas.json' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_extension');
  });
});

describe('codifica UTF-8: nessuna riparazione silenziosa', () => {
  it('accetta ASCII valido', () => {
    const result = decodeStructureImportFile(utf8('schema: x\n'), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('schema: x\n');
  });

  it('accetta accenti e apostrofi italiani, byte per byte', () => {
    const text = "titolo: Perché è così, l'unità\n";
    const result = decodeStructureImportFile(utf8(text), opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(text);
  });

  it('rifiuta una sequenza malformata invece di sostituirla con U+FFFD', () => {
    // `C3 28`: byte iniziale a due byte seguito da un byte non di continuazione.
    const bytes = new Uint8Array([0x74, 0x3a, 0x20, 0xc3, 0x28, 0x0a]);
    const result = decodeStructureImportFile(bytes, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_encoding');
    // Il punto della verifica: una lettura permissiva avrebbe prodotto testo.
    expect(new TextDecoder('utf-8').decode(bytes)).toContain('�');
  });

  it('rifiuta una sequenza troncata a fine file', () => {
    // `è` è `C3 A8`: qui manca il byte di continuazione finale.
    const bytes = new Uint8Array([0x74, 0x3a, 0x20, 0xc3]);
    const result = decodeStructureImportFile(bytes, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_encoding');
  });

  it('rifiuta un byte di continuazione isolato', () => {
    const result = decodeStructureImportFile(new Uint8Array([0xa8, 0x0a]), opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_encoding');
  });

  it('un file mal codificato non arriva mai al parser', () => {
    const result = parseStructureYaml(new Uint8Array([0xc3, 0x28]), opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_encoding');
  });

  it('rimuove il BOM UTF-8, che altrimenti diventerebbe parte della prima chiave', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('schema: x\n')]);
    const result = parseStructureYaml(bytes, opts);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Object.keys(result.value)).toEqual(['schema']);
  });

  it('accetta indifferentemente Uint8Array e ArrayBuffer', () => {
    const view = utf8('schema: x\n');
    const buffer = new ArrayBuffer(view.byteLength);
    new Uint8Array(buffer).set(view);
    expect(parseStructureYaml(view, opts).ok).toBe(true);
    expect(parseStructureYaml(buffer, opts).ok).toBe(true);
  });
});

describe('limite di dimensione, misurato sui byte originali', () => {
  it('accetta un file entro il limite', () => {
    expect(parseStructureYaml(utf8('schema: x\n'), { ...opts, filename: 'a.yml' }).ok).toBe(true);
  });

  it('rifiuta un file oltre 256.000 byte, contati sui byte e non sui caratteri', () => {
    // Metà dei caratteri del limite, ma due byte ciascuno: supera comunque.
    const oversized = utf8(`note: ${'à'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES / 2)}\n`);
    expect(oversized.byteLength).toBeGreaterThan(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES);
    const result = parseStructureYaml(oversized, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('file_too_large');
  });

  it('accetta esattamente il limite', () => {
    const exact = new Uint8Array(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES);
    exact.fill(0x20);
    exact.set(utf8('schema: x'), 0);
    expect(decodeStructureImportFile(exact, opts).ok).toBe(true);
  });

  it('rifiuta un file vuoto o composto di soli spazi', () => {
    for (const text of ['', '   ', '\n\n\t\n']) {
      const result = parseStructureYaml(utf8(text), opts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('empty_file');
    }
  });

  it('rifiuta un documento senza contenuto', () => {
    const result = parseStructureYaml(utf8('---\n'), opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty_file');
  });
});

describe('YAML ambiguo o pericoloso', () => {
  const codeOf = (text: string): string => {
    const result = parseStructureYamlText(text, 'uda');
    expect(result.ok).toBe(false);
    return result.ok ? 'ok' : result.error.code;
  };

  it('rifiuta YAML malformato', () => {
    expect(codeOf('schema: [\n  - a\n b\n')).toBe('malformed_yaml');
  });

  it('rifiuta più documenti nello stesso file', () => {
    expect(codeOf('schema: a\n---\nschema: b\n')).toBe('multiple_documents');
  });

  it('rifiuta le chiavi duplicate invece di tenere l’ultima', () => {
    expect(codeOf('schema: a\nschema: b\n')).toBe('duplicate_key');
  });

  it('rifiuta ancore e alias', () => {
    expect(codeOf('udas: &ancora\n  - titolo: A\nfoo: *ancora\n')).toBe('alias_or_anchor');
  });

  it('rifiuta un’ancora anche senza alias che la usi', () => {
    expect(codeOf('udas: &ancora\n  - titolo: A\n')).toBe('alias_or_anchor');
  });

  it('rifiuta i tag custom', () => {
    expect(codeOf('schema: !mio x\n')).toBe('custom_tag');
  });

  it('rifiuta anche i tag standard espliciti', () => {
    // Nulla di legittimo, in questi due formati, ha bisogno di forzare un tipo.
    expect(codeOf('schema: !!str x\n')).toBe('custom_tag');
  });
});

describe('radice', () => {
  it('rifiuta una radice scalare', () => {
    const result = parseStructureYaml(utf8('solo testo\n'), opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_root');
  });

  it('rifiuta una radice array', () => {
    const result = parseStructureYaml(utf8('- titolo: A\n'), opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_root');
  });

  it('accetta una radice oggetto e restituisce il contenuto', () => {
    const result = parseStructureYaml(utf8('schema: x\nudas:\n  - titolo: À più\n'), opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ schema: 'x', udas: [{ titolo: 'À più' }] });
    }
  });
});

describe('forma dell’errore', () => {
  it('riporta codice, messaggio italiano e tipo file, senza YAML né stack', () => {
    const result = parseStructureYaml(utf8('- a\n'), { fileKind: 'lesson' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_root');
    expect(result.error.fileKind).toBe('lesson');
    expect(result.error.message.length).toBeGreaterThan(10);
    expect(result.error.message).not.toContain('- a');
    expect(result.error.message).not.toMatch(/at .*\.ts:/);
  });
});
