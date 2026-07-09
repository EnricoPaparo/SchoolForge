import { describe, expect, it } from 'vitest';
import { buildVerificationPdfFilename } from '../verificationPdfNaming.js';

const DATE = new Date(2026, 6, 9); // 2026-07-09 (local time, no TZ ambiguity)

describe('buildVerificationPdfFilename — docente (no studentName)', () => {
  it('builds aaaammgg-classe-titoloverifica.pdf', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: 'Classe 3A',
      date: DATE,
    });
    expect(name).toBe('20260709-Classe-3A-Verifica-Reti.pdf');
  });

  it('falls back to "senza-classe" when className is null', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: null,
      date: DATE,
    });
    expect(name).toBe('20260709-senza-classe-Verifica-Reti.pdf');
  });

  it('falls back to "senza-classe" when className is an empty/blank string', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: '   ',
      date: DATE,
    });
    expect(name).toBe('20260709-senza-classe-Verifica-Reti.pdf');
  });

  it('sanitizes filesystem-illegal characters from the title', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica: "Reti" / TCP?',
      className: null,
      date: DATE,
    });
    expect(name).toBe('20260709-senza-classe-Verifica-Reti-TCP.pdf');
  });

  it('preserves accented characters (valid on modern filesystems)', () => {
    const name = buildVerificationPdfFilename({
      title: "Verifica sull'Città",
      className: null,
      date: DATE,
    });
    expect(name).toBe("20260709-senza-classe-Verifica-sull'Città.pdf");
  });

  it('does not append a student name segment when studentName is absent', () => {
    const name = buildVerificationPdfFilename({
      title: 'Reti',
      className: 'Classe 3A',
      date: DATE,
    });
    expect(name.endsWith('Reti.pdf')).toBe(true);
  });
});

describe('buildVerificationPdfFilename — studente (with studentName)', () => {
  it('appends NomeStudente-CognomeStudente when the name has two words', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: 'Classe 3A',
      studentName: 'Mario Rossi',
      date: DATE,
    });
    expect(name).toBe('20260709-Classe-3A-Verifica-Reti-Mario-Rossi.pdf');
  });

  it('joins extra words into the cognome segment', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: null,
      studentName: 'Maria Chiara Rossi Bianchi',
      date: DATE,
    });
    expect(name).toBe('20260709-senza-classe-Verifica-Reti-Maria-Chiara-Rossi-Bianchi.pdf');
  });

  it('uses the sanitized name as a single trailing segment when not separable (one word)', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: 'Classe 3A',
      studentName: 'mariorossi123',
      date: DATE,
    });
    expect(name).toBe('20260709-Classe-3A-Verifica-Reti-mariorossi123.pdf');
  });

  it('treats a bare email local-part fallback the same way as an unsplittable name', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: null,
      studentName: 'mario.rossi@gmail.com',
      date: DATE,
    });
    expect(name).toBe('20260709-senza-classe-Verifica-Reti-mario.rossi@gmail.com.pdf');
  });

  it('ignores a blank studentName the same way as an absent one', () => {
    const name = buildVerificationPdfFilename({
      title: 'Verifica Reti',
      className: null,
      studentName: '   ',
      date: DATE,
    });
    expect(name).toBe('20260709-senza-classe-Verifica-Reti.pdf');
  });
});
