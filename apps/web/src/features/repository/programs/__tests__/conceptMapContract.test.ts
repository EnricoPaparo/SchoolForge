import { describe, expect, it } from 'vitest';
import {
  CONCEPT_MAP_RULES_MAX_CHARS,
  ConceptMapValidationError,
  MAX_CONCEPT_MAP_BYTES,
  assertValidConceptMap,
  isValidConceptMap,
  readPrivateConceptMap,
  readPublicConceptMap,
} from '../conceptMapContract.js';

/**
 * CONCEPT-MAP-02 — il contratto puro. Due cose vanno difese qui, perché tutto
 * il resto ci si appoggia: che il testo non venga **mai** modificato, e che una
 * mappa pubblica non sia leggibile quando la lezione non è svolta, nemmeno se
 * un documento malformato la contenesse.
 */

const VALID = '## Ossatura della lezione\n\n- densità\n';

describe('validazione', () => {
  it('accetta una mappa valida e la restituisce identica', () => {
    expect(assertValidConceptMap(VALID)).toBe(VALID);
  });

  it('non modifica spazi, righe vuote o ritorni a capo', () => {
    const spaced = '  testo con spazi esterni  \n\n   e righe vuote\n';
    // Nessun trim: il valore torna indietro byte per byte com'è arrivato.
    expect(assertValidConceptMap(spaced)).toBe(spaced);
  });

  it('rifiuta una mappa vuota o di soli spazi: nessuna cancellazione implicita', () => {
    expect(() => assertValidConceptMap('')).toThrow(ConceptMapValidationError);
    expect(() => assertValidConceptMap('   \n\t ')).toThrow(/non può essere vuota/);
  });

  it('rifiuta i tipi non testuali', () => {
    for (const value of [undefined, null, 42, {}, ['- voce'], true]) {
      expect(() => assertValidConceptMap(value)).toThrow(/deve essere testo/);
    }
  });

  it('applica il cap in byte UTF-8, non in caratteri', () => {
    const asciiAtLimit = 'a'.repeat(MAX_CONCEPT_MAP_BYTES);
    expect(() => assertValidConceptMap(asciiAtLimit)).not.toThrow();
    expect(() => assertValidConceptMap(`${asciiAtLimit}a`)).toThrow(/supera il limite/);

    // 16.001 caratteri accentati = 32.002 byte: sotto il cap in caratteri, sopra
    // in byte. È esattamente lo scarto che il bound delle Rules non può vedere.
    const accented = 'à'.repeat(MAX_CONCEPT_MAP_BYTES / 2 + 1);
    expect(accented.length).toBeLessThan(MAX_CONCEPT_MAP_BYTES);
    expect(() => assertValidConceptMap(accented)).toThrow(/supera il limite/);
  });

  it('il predicato non lancia mai', () => {
    expect(isValidConceptMap(VALID)).toBe(true);
    expect(isValidConceptMap('')).toBe(false);
    expect(isValidConceptMap(undefined)).toBe(false);
  });

  it('il bound delle Rules è dichiarato e allineato in valore', () => {
    // Stesso numero, unità diversa: il commento nelle Rules lo dice, e questo
    // test impedisce che i due valori divergano senza che nessuno se ne accorga.
    expect(CONCEPT_MAP_RULES_MAX_CHARS).toBe(MAX_CONCEPT_MAP_BYTES);
  });
});

describe('lettura fail-closed del campo privato', () => {
  it('restituisce il valore originale quando è valido', () => {
    expect(readPrivateConceptMap({ conceptMapMarkdown: VALID })).toBe(VALID);
  });

  it('restituisce null su assente, malformato o oltre il cap', () => {
    expect(readPrivateConceptMap({})).toBeNull();
    expect(readPrivateConceptMap({ conceptMapMarkdown: '' })).toBeNull();
    expect(readPrivateConceptMap({ conceptMapMarkdown: 42 })).toBeNull();
    expect(
      readPrivateConceptMap({ conceptMapMarkdown: 'x'.repeat(MAX_CONCEPT_MAP_BYTES + 1) }),
    ).toBeNull();
    expect(readPrivateConceptMap(null)).toBeNull();
    expect(readPrivateConceptMap('stringa')).toBeNull();
  });

  it('un documento legacy senza campo è valido e legge null', () => {
    expect(readPrivateConceptMap({ ownerUid: 'o', filename: 'lezione-001.md' })).toBeNull();
  });
});

describe('lettura fail-closed del campo pubblico', () => {
  it('restituisce la mappa solo su una proiezione svolta', () => {
    expect(readPublicConceptMap({ completed: true, conceptMapMarkdown: VALID })).toBe(VALID);
  });

  it('restituisce null quando la lezione non è svolta, anche se il campo esiste', () => {
    // Difesa in profondità: le Rules impediscono di scriverlo, questa lettura
    // impedisce di mostrarlo se ci fosse finito comunque.
    expect(readPublicConceptMap({ completed: false, conceptMapMarkdown: VALID })).toBeNull();
    expect(readPublicConceptMap({ conceptMapMarkdown: VALID })).toBeNull();
    expect(readPublicConceptMap({ completed: 'true', conceptMapMarkdown: VALID })).toBeNull();
  });

  it('restituisce null su mappa malformata anche se la lezione è svolta', () => {
    expect(readPublicConceptMap({ completed: true, conceptMapMarkdown: '  ' })).toBeNull();
    expect(readPublicConceptMap({ completed: true })).toBeNull();
  });
});
