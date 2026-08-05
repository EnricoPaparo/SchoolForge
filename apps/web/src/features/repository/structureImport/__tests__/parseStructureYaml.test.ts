import { describe, expect, it } from 'vitest';
import { hasAcceptedExtension, parseStructureYaml } from '../parseStructureYaml.js';
import { STRUCTURE_IMPORT_LIMITS } from '../limits.js';

/**
 * STRUCTURE-IMPORT-01 — the fail-closed YAML reader. Every YAML feature that
 * could make a small file mean something surprising is rejected here, before
 * any format-specific rule runs.
 */

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

  it('blocca il file prima di leggerlo quando il nome non è ammesso', () => {
    const result = parseStructureYaml('schema: x\n', { ...opts, filename: 'udas.json' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_extension');
  });
});

describe('limiti di dimensione', () => {
  it('accetta un file entro il limite', () => {
    const result = parseStructureYaml('schema: x\n', { ...opts, filename: 'a.yml' });
    expect(result.ok).toBe(true);
  });

  it('rifiuta un file oltre 256.000 byte UTF-8', () => {
    // Caratteri multibyte: il limite è in byte, non in caratteri.
    const oversized = `note: ${'à'.repeat(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES / 2)}\n`;
    const result = parseStructureYaml(oversized, opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('file_too_large');
  });

  it('rifiuta un file vuoto o composto di soli spazi', () => {
    for (const text of ['', '   ', '\n\n\t\n']) {
      const result = parseStructureYaml(text, opts);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('empty_file');
    }
  });

  it('rifiuta un documento senza contenuto', () => {
    const result = parseStructureYaml('---\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('empty_file');
  });
});

describe('YAML ambiguo o pericoloso', () => {
  it('rifiuta YAML malformato', () => {
    const result = parseStructureYaml('schema: [\n  - a\n b\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('malformed_yaml');
  });

  it('rifiuta più documenti nello stesso file', () => {
    const result = parseStructureYaml('schema: a\n---\nschema: b\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('multiple_documents');
  });

  it('rifiuta le chiavi duplicate invece di tenere l’ultima', () => {
    const result = parseStructureYaml('schema: a\nschema: b\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_key');
  });

  it('rifiuta ancore e alias', () => {
    const result = parseStructureYaml('udas: &ancora\n  - titolo: A\nfoo: *ancora\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('alias_or_anchor');
  });

  it('rifiuta un’ancora anche senza alias che la usi', () => {
    const result = parseStructureYaml('udas: &ancora\n  - titolo: A\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('alias_or_anchor');
  });

  it('rifiuta i tag custom', () => {
    const result = parseStructureYaml('schema: !mio x\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('custom_tag');
  });

  it('rifiuta anche i tag standard espliciti', () => {
    // Nulla di legittimo, in questi due formati, ha bisogno di forzare un tipo.
    const result = parseStructureYaml('schema: !!str x\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('custom_tag');
  });
});

describe('radice', () => {
  it('rifiuta una radice scalare', () => {
    const result = parseStructureYaml('solo testo\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_root');
  });

  it('rifiuta una radice array', () => {
    const result = parseStructureYaml('- titolo: A\n', opts);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('invalid_root');
  });

  it('accetta una radice oggetto e restituisce il contenuto', () => {
    const result = parseStructureYaml('schema: x\nudas:\n  - titolo: À più\n', opts);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ schema: 'x', udas: [{ titolo: 'À più' }] });
    }
  });
});

describe('forma dell’errore', () => {
  it('riporta codice, messaggio italiano e tipo file, senza YAML né stack', () => {
    const result = parseStructureYaml('- a\n', { fileKind: 'lesson' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('invalid_root');
    expect(result.error.fileKind).toBe('lesson');
    expect(result.error.message.length).toBeGreaterThan(10);
    expect(result.error.message).not.toContain('- a');
    expect(result.error.message).not.toMatch(/at .*\.ts:/);
  });
});
