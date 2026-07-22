import { describe, expect, it, vi } from 'vitest';
import {
  PdfModuleLoadError,
  classifyPdfModuleLoadError,
  loadPdfModule,
} from '../pdfModuleLoader.js';

describe('pdfModuleLoader', () => {
  it('returns the dynamically loaded module unchanged', async () => {
    const module = { jsPDF: vi.fn() };
    await expect(loadPdfModule(async () => module)).resolves.toBe(module);
  });

  it.each([
    'Failed to fetch dynamically imported module: /assets/jspdf-old.js',
    'Loading chunk 123 failed',
    'ChunkLoadError: chunk missing',
    'Failed to load module script',
  ])('classifies stale module/chunk failures without exposing them to the UI: %s', (message) => {
    expect(classifyPdfModuleLoadError(new Error(message))).toBe('stale_chunk');
  });

  it('keeps generic module failures distinct', async () => {
    expect(classifyPdfModuleLoadError(new Error('jsPDF constructor failed'))).toBe('generic');
    await expect(
      loadPdfModule(async () => {
        throw new Error('jsPDF constructor failed');
      }),
    ).rejects.toMatchObject({
      name: 'PdfModuleLoadError',
      category: 'generic',
      message: 'PDF module load failed',
    } satisfies Partial<PdfModuleLoadError>);
  });

  it('wraps a stale import once and never retries automatically', async () => {
    const factory = vi.fn(async () => {
      throw new Error('Failed to fetch dynamically imported module: https://example.test/old.js');
    });
    await expect(loadPdfModule(factory)).rejects.toMatchObject({ category: 'stale_chunk' });
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
