import { describe, expect, it } from 'vitest';
import { renderTeacherLessonPdfBytes } from './teacherLessonPdfCore.js';

describe('packaged Chromium PDF runtime', () => {
  it.skipIf(process.platform !== 'linux')(
    'prints a complete PDF without external resources',
    async () => {
      const bytes = await renderTeacherLessonPdfBytes(
        '<!doctype html><html><head><style>body{color:#123456}</style></head><body><h1>SchoolForge PDF</h1><p>Testo selezionabile.</p></body></html>',
      );
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
      expect(bytes.length).toBeGreaterThan(500);
      expect(bytes.subarray(-20).toString()).toContain('%%EOF');
    },
    60_000,
  );
});
