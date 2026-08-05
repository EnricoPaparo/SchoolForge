import { describe, expect, it } from 'vitest';
import {
  importStoragePath,
  lessonFileName,
  lessonFrontMatterFields,
  lessonOrderFromFilename,
  maxLessonNumber,
  maxLessonOrder,
  maxUdaNumber,
  maxUdaOrder,
  slugify,
  toDocId,
  udaDirName,
  udaFrontMatterFields,
  udaOrderFromDir,
  udaStorageBasePath,
} from '../canonicalNaming.js';
import { toDocId as toDocIdFromImportPayload } from '../import/buildImportPayload.js';

/**
 * STRUCTURE-IMPORT-01 — test di regressione sugli helper canonici estratti da
 * `buildImportPayload` e da `repositoryEditorService` perché il nuovo planner
 * potesse riusarli invece di ri-derivarli.
 *
 * L'estrazione doveva essere a comportamento invariato: qui è fissato ogni caso
 * limite che i servizi già gestivano — buchi di numerazione, `order` legacy
 * assente, slug degenere, caratteri accentati — così una futura «pulizia» che
 * cambiasse una regressione la farebbe fallire.
 */

describe('toDocId', () => {
  it('sostituisce con `_` tutto ciò che non è [A-Za-z0-9_-]', () => {
    expect(toDocId('uda-01-reti')).toBe('uda-01-reti');
    expect(toDocId('uda 01/reti.md')).toBe('uda_01_reti_md');
    expect(toDocId('città')).toBe('citt_');
  });

  it('resta lo stesso simbolo esportato dal percorso storico', () => {
    // I chiamanti esistenti importano ancora da `buildImportPayload`: se
    // l'estrazione avesse duplicato la funzione, gli id divergerebbero senza
    // che nulla lo segnali.
    expect(toDocIdFromImportPayload).toBe(toDocId);
  });
});

describe('slugify', () => {
  it('minuscolo, senza diacritici, separatori collassati', () => {
    expect(slugify('Introduzione alle reti')).toBe('introduzione-alle-reti');
    expect(slugify('Città, energia & società')).toBe('citta-energia-societa');
    expect(slugify("Perché l'IP?")).toBe('perche-l-ip');
    expect(slugify('  spazi   multipli  ')).toBe('spazi-multipli');
  });

  it('non produce mai una stringa vuota', () => {
    expect(slugify('***')).toBe('lezione');
    expect(slugify('')).toBe('lezione');
    expect(slugify('---')).toBe('lezione');
  });
});

describe('order legacy dai nomi tecnici', () => {
  it('legge il prefisso uda-XX, zero-based', () => {
    expect(udaOrderFromDir('uda-01-reti')).toBe(0);
    expect(udaOrderFromDir('uda-07')).toBe(6);
    expect(udaOrderFromDir('reti')).toBeNull();
    expect(udaOrderFromDir(undefined)).toBeNull();
  });

  it('legge il prefisso lezione-XXX, zero-based', () => {
    expect(lessonOrderFromFilename('lezione-001-http.md')).toBe(0);
    expect(lessonOrderFromFilename('lezione-012.md')).toBe(11);
    expect(lessonOrderFromFilename('altro.md')).toBeNull();
    expect(lessonOrderFromFilename(undefined)).toBeNull();
  });
});

describe('numerazione e ordine successivi', () => {
  it('la numerazione UDA parte dal massimo e non riempie i buchi', () => {
    expect(maxUdaNumber([])).toBe(0);
    expect(maxUdaNumber([{ dir: 'uda-01-a' }, { dir: 'uda-09-b' }])).toBe(9);
    // Una dir senza suffisso non conta: è il comportamento storico di createUda.
    expect(maxUdaNumber([{ dir: 'uda-09' }])).toBe(0);
  });

  it('l’order UDA ricade sul prefisso quando manca', () => {
    expect(maxUdaOrder([])).toBe(-1);
    expect(maxUdaOrder([{ dir: 'uda-01-a', order: 5 }])).toBe(5);
    expect(maxUdaOrder([{ dir: 'uda-04-a' }])).toBe(3);
    expect(maxUdaOrder([{ dir: 'senza-prefisso' }])).toBe(-1);
  });

  it('la numerazione lezioni parte dal massimo', () => {
    expect(maxLessonNumber([])).toBe(0);
    expect(
      maxLessonNumber([{ filename: 'lezione-001-a.md' }, { filename: 'lezione-014-b.md' }]),
    ).toBe(14);
  });

  it('l’order lezioni riproduce createLesson per impostazione predefinita', () => {
    // createLesson non ha mai usato il filename come fallback: una lezione
    // senza `order` vale -1.
    expect(maxLessonOrder([{ filename: 'lezione-004-a.md' }])).toBe(-1);
    expect(maxLessonOrder([{ filename: 'lezione-004-a.md', order: 3 }])).toBe(3);
  });

  it('il fallback legacy è esplicito e opzionale', () => {
    expect(
      maxLessonOrder([{ filename: 'lezione-004-a.md' }], { legacyFilenameFallback: true }),
    ).toBe(3);
    expect(maxLessonOrder([{ filename: 'altro.md' }], { legacyFilenameFallback: true })).toBe(-1);
  });
});

describe('nomi e path canonici', () => {
  it('compone dir, filename e path come i servizi esistenti', () => {
    expect(udaDirName(1, 'Le reti')).toBe('uda-01-le-reti');
    expect(udaDirName(12, 'Le reti')).toBe('uda-12-le-reti');
    expect(lessonFileName(1, 'Le reti')).toBe('lezione-001-le-reti.md');
    expect(lessonFileName(140, 'Le reti')).toBe('lezione-140-le-reti.md');
    expect(udaStorageBasePath('u1', 'i1', 'uda-01-le-reti')).toBe(
      'repository/u1/imports/i1/uda-01-le-reti',
    );
    expect(importStoragePath('u1', 'i1', 'uda-01/lezione-001.md')).toBe(
      'repository/u1/imports/i1/uda-01/lezione-001.md',
    );
  });
});

describe('mappatura del front matter', () => {
  it('la lezione usa le chiavi su disco, con concetti_chiave in snake_case', () => {
    expect(
      lessonFrontMatterFields({
        titolo: 'T',
        sottotitolo: 'S',
        difficolta: 'base',
        concettiChiave: ['a'],
        obiettivi: ['b'],
      }),
    ).toEqual({
      titolo: 'T',
      sottotitolo: 'S',
      difficolta: 'base',
      concetti_chiave: ['a'],
      obiettivi: ['b'],
    });
  });

  it('la UDA riceve il titolo canonico, che vince su quello dei metadati', () => {
    expect(
      udaFrontMatterFields('Canonico', {
        titolo: 'Ignorato',
        descrizione: null,
        competenze: ['c'],
        obiettivi: ['o'],
      }),
    ).toEqual({
      titolo: 'Canonico',
      descrizione: null,
      competenze: ['c'],
      obiettivi: ['o'],
    });
  });
});
