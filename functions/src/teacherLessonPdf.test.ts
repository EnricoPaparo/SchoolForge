import { describe, expect, it, vi } from 'vitest';
import type * as TeacherLessonPdfCore from './teacherLessonPdfCore.js';
import {
  isEmbeddedPdfResource,
  validateLessonPdfInput,
  MAX_LESSON_PDF_HTML_BYTES,
} from './teacherLessonPdfCore.js';

describe('teacher PDF payload and resource boundary', () => {
  it('accepts only one bounded HTML field measured in UTF-8 bytes', () => {
    expect(validateLessonPdfInput({ html: '<p>città</p>' })).toBe('<p>città</p>');
    for (const input of [
      null,
      [],
      {},
      { html: '' },
      { html: 1 },
      { html: 'ok', url: 'https://x.test' },
      { html: 'è'.repeat(MAX_LESSON_PDF_HTML_BYTES / 2 + 1) },
    ]) {
      expect(() => validateLessonPdfInput(input)).toThrow();
    }
  });
  it('blocks network, local file, script, frame and SVG data resources', () => {
    for (const url of [
      'https://169.254.169.254/latest/meta-data',
      'http://localhost',
      'file:///etc/passwd',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/svg+xml;base64,PHN2Zz4=',
    ]) {
      expect(isEmbeddedPdfResource(url, 'image')).toBe(false);
    }
    expect(isEmbeddedPdfResource('data:image/webp;base64,abc', 'image')).toBe(true);
    expect(isEmbeddedPdfResource('data:font/ttf;base64,abc', 'font')).toBe(true);
    expect(isEmbeddedPdfResource('data:image/webp;base64,abc', 'document')).toBe(false);
  });
});

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  render: vi.fn(),
  options: {} as Record<string, unknown>,
}));
vi.mock('firebase-admin/app', () => ({ getApps: () => [{}], initializeApp: vi.fn() }));
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: () => ({ get: mocks.get }) }),
}));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class extends Error {
    constructor(
      public code: string,
      message: string,
    ) {
      super(message);
    }
  },
  onCall: (options: Record<string, unknown>, handler: unknown) => {
    mocks.options = options;
    return handler;
  },
}));
vi.mock('./teacherLessonPdfCore.js', async (importOriginal) => ({
  ...(await importOriginal<typeof TeacherLessonPdfCore>()),
  renderTeacherLessonPdfBytes: mocks.render,
}));
import { renderTeacherLessonPdf } from './teacherLessonPdf.js';
const call = renderTeacherLessonPdf as unknown as (request: unknown) => Promise<unknown>;

describe('teacher PDF callable authorization', () => {
  it('rejects unauthenticated and non-owner callers before rendering', async () => {
    mocks.render.mockClear();
    await expect(call({ data: { html: '<p>test</p>' } })).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    mocks.get.mockResolvedValue({ data: () => ({ ownerUid: 'owner' }) });
    await expect(
      call({ auth: { uid: 'student' }, data: { html: '<p>test</p>' } }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mocks.render).not.toHaveBeenCalled();
  });
  it('validates owner requests and returns a complete PDF only', async () => {
    mocks.get.mockResolvedValue({ data: () => ({ ownerUid: 'owner' }) });
    await expect(
      call({ auth: { uid: 'owner' }, data: { url: 'file:///etc/passwd' } }),
    ).rejects.toMatchObject({ code: 'invalid-argument' });
    mocks.render.mockResolvedValue(Buffer.from('%PDF-test'));
    await expect(call({ auth: { uid: 'owner' }, data: { html: '<p>test</p>' } })).resolves.toEqual({
      base64: Buffer.from('%PDF-test').toString('base64'),
    });
    mocks.render.mockRejectedValue(new Error('render failed'));
    await expect(
      call({ auth: { uid: 'owner' }, data: { html: '<p>test</p>' } }),
    ).rejects.toMatchObject({ code: 'internal' });
    expect(mocks.options).toMatchObject({
      concurrency: 1,
      memory: '1GiB',
      timeoutSeconds: 120,
      minInstances: 0,
    });
  });
});
