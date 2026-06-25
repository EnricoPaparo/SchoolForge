import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadKitZip, downloadTemplate, TEMPLATES } from '../templateKit.js';

// Mock jszip
vi.mock('jszip', () => {
  const instance = {
    file: vi.fn(),
    generateAsync: vi.fn().mockResolvedValue(new Blob(['zip-content'])),
  };
  return { default: vi.fn(() => instance) };
});

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

describe('downloadKitZip', () => {
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

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ text: vi.fn().mockResolvedValue('file-content') }),
    );
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:url'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetches all templates and triggers download', async () => {
    await downloadKitZip();
    expect(fetch).toHaveBeenCalledTimes(TEMPLATES.length);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
