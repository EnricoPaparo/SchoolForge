import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readZipFile } from '../readZipFile.js';

async function makeZip(entries: Record<string, string>): Promise<File> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'test.zip', { type: 'application/zip' });
}

describe('readZipFile', () => {
  it('returns flat files when ZIP has no wrapping folder', async () => {
    const file = await makeZip({
      'uda-01-reti/uda-01-reti.md': '# Reti',
      'uda-01-reti/lezione-001-http.md': '# HTTP',
    });
    const result = await readZipFile(file);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(['uda-01-reti/lezione-001-http.md', 'uda-01-reti/uda-01-reti.md']);
  });

  it('strips single wrapping folder', async () => {
    const file = await makeZip({
      'my-repo/uda-01-reti/uda-01-reti.md': '# Reti',
      'my-repo/uda-01-reti/lezione-001-http.md': '# HTTP',
      'my-repo/uda-01-reti/lezione-001-http.pool.md': '---\nschema: schoolforge-pool/v1\n',
    });
    const result = await readZipFile(file);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual([
      'uda-01-reti/lezione-001-http.md',
      'uda-01-reti/lezione-001-http.pool.md',
      'uda-01-reti/uda-01-reti.md',
    ]);
  });

  it('strips a wrapping folder that also contains a root-level file (e.g. programma.md)', async () => {
    const file = await makeZip({
      'programma-esempio/programma.md': '---\ntitolo: X\n---\n',
      'programma-esempio/uda-01-reti/uda-01-reti.md': '# Reti',
      'programma-esempio/uda-01-reti/lezione-001-http.md': '# HTTP',
    });
    const result = await readZipFile(file);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual([
      'programma.md',
      'uda-01-reti/lezione-001-http.md',
      'uda-01-reti/uda-01-reti.md',
    ]);
  });

  it('does not strip when the ZIP is a single UDA folder with no program-level wrapper', async () => {
    // All paths would become root files if stripped — this must be treated as
    // "no wrapper", identical to the flat case, not silently dropped.
    const file = await makeZip({
      'uda-01-reti/uda-01-reti.md': '# Reti',
      'uda-01-reti/lezione-001-http.md': '# HTTP',
    });
    const result = await readZipFile(file);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(['uda-01-reti/lezione-001-http.md', 'uda-01-reti/uda-01-reti.md']);
  });

  it('excludes __MACOSX entries', async () => {
    const file = await makeZip({
      'uda-01-reti/lezione-001.md': '# HTTP',
      '__MACOSX/uda-01-reti/._lezione-001.md': 'junk',
    });
    const result = await readZipFile(file);
    expect(result.every((r) => !r.path.includes('__MACOSX'))).toBe(true);
    expect(result.some((r) => r.path === 'uda-01-reti/lezione-001.md')).toBe(true);
  });

  it('excludes .DS_Store files', async () => {
    const file = await makeZip({
      'uda-01-reti/lezione-001.md': '# HTTP',
      'uda-01-reti/.DS_Store': 'junk',
      '.DS_Store': 'root junk',
    });
    const result = await readZipFile(file);
    expect(result.every((r) => !r.path.includes('.DS_Store'))).toBe(true);
    expect(result.some((r) => r.path === 'uda-01-reti/lezione-001.md')).toBe(true);
  });

  it('excludes hidden files (leading dot in any path segment)', async () => {
    const file = await makeZip({
      'uda-01-reti/lezione-001.md': '# HTTP',
      '.hidden-config': 'secret',
      'uda-01-reti/.gitkeep': '',
    });
    const result = await readZipFile(file);
    expect(result.every((r) => !r.path.split('/').some((s) => s.startsWith('.')))).toBe(true);
  });

  it('excludes empty files', async () => {
    const file = await makeZip({
      'uda-01-reti/lezione-001.md': '# HTTP',
      'uda-01-reti/empty.md': '',
    });
    const result = await readZipFile(file);
    expect(result.every((r) => r.content.length > 0)).toBe(true);
    expect(result.some((r) => r.path === 'uda-01-reti/lezione-001.md')).toBe(true);
  });

  it('keeps valid didactic files: uda, lezione, pool', async () => {
    const file = await makeZip({
      'uda-01-reti/uda-01-reti.md': '# UDA',
      'uda-01-reti/lezione-001-http.md': '# Lezione',
      'uda-01-reti/lezione-001-http.pool.md': '---\nschema: schoolforge-pool/v1\n',
    });
    const result = await readZipFile(file);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toContain('uda-01-reti/uda-01-reti.md');
    expect(paths).toContain('uda-01-reti/lezione-001-http.md');
    expect(paths).toContain('uda-01-reti/lezione-001-http.pool.md');
  });

  it('handles wrapped ZIP with __MACOSX artefacts together', async () => {
    const file = await makeZip({
      'corso-reti/uda-01-reti/uda-01-reti.md': '# UDA',
      'corso-reti/uda-01-reti/lezione-001.md': '# Lezione',
      '__MACOSX/corso-reti/uda-01-reti/._uda-01-reti.md': 'junk',
      '__MACOSX/._corso-reti': 'junk',
    });
    const result = await readZipFile(file);
    const paths = result.map((r) => r.path).sort();
    expect(paths).toEqual(['uda-01-reti/lezione-001.md', 'uda-01-reti/uda-01-reti.md']);
  });

  it('preserves the archive physical entry order (RE-06 — required for order-faithful reimport)', async () => {
    // buildImportPayload derives a freshly-imported UDA/lesson's `order` from
    // its position in this array (see buildImportPayload.ts) — decompression
    // must never reorder entries relative to how they were added to the ZIP.
    const file = await makeZip({
      'uda-02-b/uda-02-b.md': '# B',
      'uda-02-b/lezione-001-intro.md': '# B intro',
      'uda-01-a/uda-01-a.md': '# A',
      'uda-01-a/lezione-001-intro.md': '# A intro',
    });
    const result = await readZipFile(file);
    expect(result.map((r) => r.path)).toEqual([
      'uda-02-b/uda-02-b.md',
      'uda-02-b/lezione-001-intro.md',
      'uda-01-a/uda-01-a.md',
      'uda-01-a/lezione-001-intro.md',
    ]);
  });

  it('decodes lesson Markdown content as UTF-8, preserving accented and multi-byte characters', async () => {
    const content =
      '---\ntitolo: "Città e civiltà"\n---\n\n# Città e civiltà\n\nTesto con caratteri à, è, ù, ñ, ö e un\'emoji 📚.';
    const file = await makeZip({
      'uda-01-reti/lezione-001-http.md': content,
    });
    const result = await readZipFile(file);
    expect(result[0].content).toBe(content);
  });
});
