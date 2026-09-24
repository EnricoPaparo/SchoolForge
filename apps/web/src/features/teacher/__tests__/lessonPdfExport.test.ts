import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import {
  buildLessonPdfZip,
  buildUdaPdfZipFilename,
  loadSavedLessonPdf,
  pdfFileName,
  renderLessonPdf,
  udaPositionInOrderedTree,
} from '../lessonPdfExport.js';
import type { LessonItem } from '../../repository/programs/programsService.js';

const mocks = vi.hoisted(() => ({
  projected: vi.fn(),
  storage: vi.fn(),
  multi: vi.fn(),
  single: vi.fn(),
}));
vi.mock('../lessonContent.js', () => ({
  fetchPublicLessonContent: mocks.projected,
  fetchLessonContent: mocks.storage,
}));
vi.mock('../../repository/programs/multiVisualReadClients.js', () => ({
  createTeacherMultiVisualReader: () => mocks.multi,
}));
vi.mock('../../repository/programs/visualReadClients.js', () => ({
  createTeacherVisualReader: () => mocks.single,
}));
const lesson = {
  id: 'l1',
  filename: '01-test.md',
  titolo: 'Titolo salvato',
  storageRef: 'saved.md',
} as LessonItem;
const manifest = {
  assetId: 'a',
  anchor: { headingSlug: 'sezione', headingText: 'Sezione' },
  caption: 'Didascalia',
  altText: 'Immagine',
  width: 100,
  height: 100,
};
const params = {
  lesson,
  programId: 'p',
  importId: 'i',
  ownerUid: 'o',
  db: {} as never,
  storage: {} as never,
  functions: {} as never,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.projected.mockResolvedValue('Testo salvato');
});

describe('saved teacher PDF data', () => {
  it('uses the saved import-scoped projection identity', async () => {
    await loadSavedLessonPdf({ ...params, lesson: { ...lesson, publicLessonId: 'i_l1' } });
    expect(mocks.projected).toHaveBeenCalledWith(
      { lessonId: 'i_l1', programId: 'p', importId: 'i', ownerUid: 'o' },
      params.db,
    );
  });
  it('loads saved body and every visual without active-tab state', async () => {
    mocks.multi.mockResolvedValue([
      { assetId: 'a', dataUri: 'data:image/webp;base64,bytes' },
      { assetId: 'b', dataUri: 'data:image/webp;base64,other' },
    ]);
    const result = await loadSavedLessonPdf({
      ...params,
      lesson: {
        ...lesson,
        visuals: {
          contractVersion: 'lesson-visuals/v1',
          items: [
            manifest,
            {
              ...manifest,
              assetId: 'b',
              anchor: { headingSlug: 'seconda', headingText: 'Seconda' },
            },
          ],
        },
      } as never,
    });
    expect(result.markdown).toBe('Testo salvato');
    expect(result.visuals.map((v) => v.dataUri)).toEqual([
      'data:image/webp;base64,bytes',
      'data:image/webp;base64,other',
    ]);
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('strips metadata in legacy fallback, but never hides read errors', async () => {
    mocks.projected.mockResolvedValue(null);
    mocks.storage.mockResolvedValue('---\ntitolo: Titolo\n---\n\nCorpo');
    expect((await loadSavedLessonPdf(params)).markdown.trim()).toBe('Corpo');
    mocks.storage.mockClear();
    mocks.projected.mockRejectedValue(new Error('offline'));
    await expect(loadSavedLessonPdf(params)).rejects.toThrow('offline');
    expect(mocks.storage).not.toHaveBeenCalled();
  });
  it('fails explicitly when a declared legacy image is missing', async () => {
    mocks.single.mockResolvedValue(null);
    await expect(
      loadSavedLessonPdf({ ...params, lesson: { ...lesson, visual: manifest } as never }),
    ).rejects.toThrow('Immagine salvata non disponibile');
  });
  it('rejects incomplete image data before starting the PDF engine', async () => {
    await expect(
      renderLessonPdf({
        title: 'X',
        markdown: 'Body',
        visuals: [{ status: 'unavailable', dataUri: null } as never],
      }),
    ).rejects.toThrow('Immagini incomplete');
  });
});

function readBlob(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}
const render = vi.fn(
  async (content: { title: string }) =>
    ({ arrayBuffer: async () => new TextEncoder().encode(content.title).buffer }) as Blob,
);

describe('complete ordered PDF ZIP', () => {
  it('keeps supplied UDA order and protects duplicate, unsafe titles', async () => {
    const blob = await buildLessonPdfZip(
      ['same/name', 'same/name', 'CON'],
      async (title) => ({ title, markdown: '', visuals: [] }),
      render,
    );
    const zip = await JSZip.loadAsync(await readBlob(blob));
    expect(Object.keys(zip.files)).toEqual([
      '01-same_name.pdf',
      '02-same_name.pdf',
      '03-lezione-CON.pdf',
    ]);
    expect(await zip.file('02-same_name.pdf')!.async('string')).toBe('same/name');
  });
  it('rejects the entire archive if any lesson fails', async () => {
    const load = vi.fn(async (title: string) => {
      if (title === 'second') throw new Error('missing saved content');
      return { title, markdown: '', visuals: [] };
    });
    await expect(buildLessonPdfZip(['first', 'second', 'third'], load, render)).rejects.toThrow(
      'missing saved content',
    );
    expect(load).toHaveBeenCalledTimes(2);
  });
  it('rejects empty UDA and sanitizes path/control characters', async () => {
    await expect(buildLessonPdfZip([], vi.fn(), render)).rejects.toThrow('non contiene lezioni');
    expect(pdfFileName('../lezione\\test?: .')).toBe('.._lezione_test__');
  });
});

describe('UDA PDF ZIP filename', () => {
  it('derives the position from the current ordered array, including after reorder', () => {
    const firstOrder = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const reordered = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    expect(udaPositionInOrderedTree(firstOrder, 'c')).toBe(3);
    expect(udaPositionInOrderedTree(reordered, 'c')).toBe(1);
    expect(() => udaPositionInOrderedTree(reordered, 'missing')).toThrow('Posizione UDA');
  });

  it('uses the current one-based UDA position with at least two digits', () => {
    expect(
      buildUdaPdfZipFilename({
        programTitle: 'Sistemi e reti',
        udaTitle: 'Modello OSI',
        udaPosition: 1,
      }),
    ).toBe('Sistemi-e-reti_UDA01_Modello-OSI.zip');
    expect(
      buildUdaPdfZipFilename({
        programTitle: 'Sistemi e reti',
        udaTitle: 'Modello OSI',
        udaPosition: 100,
      }),
    ).toBe('Sistemi-e-reti_UDA100_Modello-OSI.zip');
  });

  it('preserves Unicode while collapsing whitespace and forbidden separators', () => {
    expect(
      buildUdaPdfZipFilename({
        programTitle: '  Storia dell’arte / città  ',
        udaTitle: 'Ètica:\u0000 società\\futuro? ',
        udaPosition: 7,
      }),
    ).toBe('Storia-dell’arte-città_UDA07_Ètica-società-futuro.zip');
  });

  it('avoids empty and Windows device-name segments and strips trailing dots', () => {
    expect(buildUdaPdfZipFilename({ programTitle: '***', udaTitle: 'CON.', udaPosition: 0 })).toBe(
      'Programma_UDA01_UDA-CON.zip',
    );
    expect(
      buildUdaPdfZipFilename({ programTitle: 'Corso... ', udaTitle: 'Titolo. ', udaPosition: 2 }),
    ).toBe('Corso_UDA02_Titolo.zip');
  });
});
