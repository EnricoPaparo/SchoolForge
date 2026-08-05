import { describe, expect, it } from 'vitest';
import { isEmptySkeleton } from '../studentLessonsService.js';

/**
 * STRUCTURE-IMPORT-02B — filtro degli scheletri vuoti nel portale studente.
 *
 * Una lezione importata come scheletro ha corpo vuoto: mostrarla produrrebbe
 * una card che non porta nulla. Il confine è sottile e va difeso in entrambe le
 * direzioni: una proiezione **legacy** priva del campo `content` (pre M3F-08)
 * arriva qui come `null` e non deve sparire, perché la UI la gestisce già a
 * parte; e una lezione con contenuto reale non deve mai essere filtrata.
 *
 * Non è un confine di sicurezza: la proiezione resta tecnicamente leggibile
 * secondo le Rules correnti. È un filtro di prodotto.
 */

describe('isEmptySkeleton', () => {
  it('riconosce lo scheletro: stringa vuota o soli spazi', () => {
    for (const content of ['', ' ', '   ', '\n', '\t\n ', '\r\n']) {
      expect(isEmptySkeleton(content)).toBe(true);
    }
  });

  it('non filtra una proiezione legacy senza campo `content`', () => {
    // `null` significa «proiezione priva del campo», non «lezione vuota»: la
    // vista studente la gestisce già con un messaggio dedicato.
    expect(isEmptySkeleton(null)).toBe(false);
  });

  it('non filtra contenuto reale, nemmeno minimo', () => {
    for (const content of ['#', 'a', '# Titolo', '  testo con spazi  ', '---\ntitolo: x\n---\n#']) {
      expect(isEmptySkeleton(content)).toBe(false);
    }
  });

  it('il primo salvataggio di un corpo reale rende di nuovo visibile la lezione', () => {
    // Il salvataggio canonico (`updateLessonMarkdownBody`) aggiorna
    // `publicLessons.content`: non serve un secondo percorso di pubblicazione.
    const beforeSave = '';
    const afterSave = '# Che cos’è una rete\n\nUna rete è…';
    expect(isEmptySkeleton(beforeSave)).toBe(true);
    expect(isEmptySkeleton(afterSave)).toBe(false);
  });
});
