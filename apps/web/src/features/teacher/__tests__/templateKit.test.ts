import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildKitZip, downloadKitZip, downloadTemplate, TEMPLATES } from '../templateKit.js';
import { readZipFile } from '../../repository/import/readZipFile.js';
import { validateImport } from '../../repository/validation/index.js';

describe('TEMPLATES', () => {
  it('has 4 entries', () => {
    expect(TEMPLATES).toHaveLength(4);
  });

  it('each entry has name, filename, url', () => {
    for (const t of TEMPLATES) {
      expect(t.name).toBeTruthy();
      expect(t.filename).toBeTruthy();
      expect(t.url).toBeTruthy();
    }
  });

  it('pool template filename ends with .pool.md', () => {
    const pool = TEMPLATES.find((t) => t.filename.endsWith('.pool.md'));
    expect(pool).toBeDefined();
  });
});

describe('downloadTemplate', () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    vi.clearAllMocks();
    clickSpy = vi.fn();
    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickSpy } as unknown as HTMLElement;
      }
      return originalCreateElement(tag);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates and clicks an anchor for a known filename', () => {
    downloadTemplate('programma-template.md');
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('does nothing for unknown filename', () => {
    downloadTemplate('unknown.md');
    expect(clickSpy).not.toHaveBeenCalled();
  });
});

describe('buildKitZip', () => {
  it('produces the expected paths under the programma-esempio/ folder', () => {
    const zip = buildKitZip();
    const paths = Object.keys(zip.files)
      .filter((p) => !zip.files[p].dir)
      .sort();
    expect(paths).toEqual([
      'programma-esempio/programma.md',
      'programma-esempio/uda-01-titolo-uda/lezione-001-titolo-lezione.md',
      'programma-esempio/uda-01-titolo-uda/lezione-001-titolo-lezione.pool.md',
      'programma-esempio/uda-01-titolo-uda/uda-01-titolo-uda.md',
    ]);
  });

  it('produces a ZIP that imports successfully with one UDA, one lesson and a valid pool', async () => {
    const zip = buildKitZip();
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'programma-esempio.zip', { type: 'application/zip' });

    const files = await readZipFile(file);
    const validation = validateImport('Programma di esempio', files);

    expect(validation.valid).toBe(true);
    expect(validation.udas).toHaveLength(1);
    expect(validation.udas[0].lessons).toHaveLength(1);
    expect(validation.udas[0].lessons[0].poolStatus).toBe('valid');
  });

  it('exposes the parsed programma.md metadata used to populate the info panel', async () => {
    const zip = buildKitZip();
    const blob = await zip.generateAsync({ type: 'blob' });
    const file = new File([blob], 'programma-esempio.zip', { type: 'application/zip' });

    const files = await readZipFile(file);
    const validation = validateImport('Programma di esempio', files);

    expect(validation.programma).not.toBeNull();
    expect(validation.programma?.docente).toBe('Nome Cognome docente');
  });

  it('uses obvious placeholder content, never real didactic text', async () => {
    const zip = buildKitZip();
    const programmaFile = zip.file('programma-esempio/programma.md');
    const content = await programmaFile?.async('string');
    expect(content).toContain('Titolo del programma');
    expect(content).toContain('Nome Cognome docente');

    const lessonFile = zip.file(
      'programma-esempio/uda-01-titolo-uda/lezione-001-titolo-lezione.md',
    );
    const lessonContent = await lessonFile?.async('string');
    expect(lessonContent).toContain('Testo della lezione');
  });
});

describe('downloadKitZip', () => {
  let clickSpy: ReturnType<typeof vi.fn>;
  let originalCreateElement: typeof document.createElement;

  beforeEach(() => {
    clickSpy = vi.fn();
    originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        return { href: '', download: '', click: clickSpy } as unknown as HTMLElement;
      }
      return originalCreateElement(tag);
    });

    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:url'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('generates the kit ZIP and triggers a download', async () => {
    await downloadKitZip();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
