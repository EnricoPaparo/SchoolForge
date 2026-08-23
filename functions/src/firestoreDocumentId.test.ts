import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_ID_BYTES,
  isValidDocumentId,
  isValidDocumentIdInput,
  utf8ByteLength,
} from './firestoreDocumentId.js';
import { isValidDocumentId as forceSubmitIsValid } from './forceSubmitCore.js';

/**
 * Semantica canonica dell'id documento, in un modulo neutro.
 *
 * Il motivo per cui esiste: VE-03C ne aveva bisogno e stava per riscriverla a
 * mano. La versione riscritta era già più debole dell'originale — mancavano la
 * forma riservata `__…__` e i caratteri di controllo — e sarebbe divergita
 * ancora. Questi test congelano la definizione unica.
 */

describe('utf8ByteLength', () => {
  /**
   * Il limite Firestore è in **byte**, non in caratteri: contare le UTF-16 code
   * unit sottostima e lascerebbe passare id che Firestore rifiuta.
   */
  it('conta i byte reali, non i caratteri', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('€')).toBe(3);
    expect(utf8ByteLength('🌱')).toBe(4);
    expect(utf8ByteLength('')).toBe(0);
  });

  it('un carattere non-ASCII pesa più di una code unit', () => {
    const emoji = '🌱'.repeat(400);
    expect(emoji.length).toBe(800); // UTF-16
    expect(utf8ByteLength(emoji)).toBe(1600); // byte reali
  });
});

describe('isValidDocumentId — il limite in byte', () => {
  it('accetta esattamente 1500 byte e rifiuta 1501', () => {
    expect(MAX_DOCUMENT_ID_BYTES).toBe(1500);
    expect(isValidDocumentId('a'.repeat(1500))).toBe(true);
    expect(isValidDocumentId('a'.repeat(1501))).toBe(false);
  });

  /** 750 emoji sono 3000 byte: il conteggio per caratteri le farebbe passare. */
  it('applica il limite ai byte anche per testo multibyte', () => {
    expect(utf8ByteLength('🌱'.repeat(375))).toBe(1500);
    expect(isValidDocumentId('🌱'.repeat(375))).toBe(true);
    expect(isValidDocumentId('🌱'.repeat(376))).toBe(false);
  });
});

describe('isValidDocumentId — forme rifiutate', () => {
  it('rifiuta la stringa vuota', () => {
    expect(isValidDocumentId('')).toBe(false);
  });

  /** `/` cambierebbe il documento indirizzato, non solo il suo nome. */
  it('rifiuta gli slash ovunque compaiano', () => {
    for (const bad of ['a/b', '/a', 'a/', '/', 'a/b/c']) {
      expect(isValidDocumentId(bad)).toBe(false);
    }
  });

  it('rifiuta i riferimenti relativi', () => {
    expect(isValidDocumentId('.')).toBe(false);
    expect(isValidDocumentId('..')).toBe(false);
  });

  /** `__…__` è lo spazio dei nomi riservato di Firestore. */
  it('rifiuta la forma riservata __…__', () => {
    for (const bad of ['__riservato__', '____', '__x__']) {
      expect(isValidDocumentId(bad)).toBe(false);
    }
  });

  it('accetta i doppi underscore che non racchiudono l’id', () => {
    expect(isValidDocumentId('__inizio')).toBe(true);
    expect(isValidDocumentId('fine__')).toBe(true);
    expect(isValidDocumentId('a__b')).toBe(true);
  });

  /** Un carattere di controllo rende illeggibile un log e ambiguo un id. */
  it('rifiuta i caratteri di controllo', () => {
    for (const code of [0x00, 0x07, 0x09, 0x0a, 0x0d, 0x1f, 0x7f]) {
      expect(isValidDocumentId(`a${String.fromCharCode(code)}b`)).toBe(false);
    }
  });

  it('accetta identificatori ordinari', () => {
    for (const good of ['lesson-1', 'imp-1_lesson-1', 'uda-01-reti', 'a', 'Città']) {
      expect(isValidDocumentId(good)).toBe(true);
    }
  });

  /**
   * Tre punti sono un id legittimo: la regola vieta `.` e `..`, non il punto.
   * Vietarlo sarebbe una restrizione inventata.
   */
  it('non vieta il punto in sé', () => {
    expect(isValidDocumentId('...')).toBe(true);
    expect(isValidDocumentId('a.b')).toBe(true);
  });
});

describe('isValidDocumentIdInput — tipo e spazi ai bordi', () => {
  it('rifiuta ciò che non è una stringa', () => {
    for (const bad of [null, undefined, 42, {}, [], true]) {
      expect(isValidDocumentIdInput(bad)).toBe(false);
    }
  });

  /**
   * Il trim esterno non è vietato da Firestore, ma è quasi sempre il sintomo di
   * un input incollato male: accettarlo creerebbe due documenti indistinguibili
   * a occhio nudo.
   */
  it('rifiuta gli spazi ai bordi', () => {
    for (const bad of [' lesson-1', 'lesson-1 ', ' lesson-1 ', '  ', '\tlesson']) {
      expect(isValidDocumentIdInput(bad)).toBe(false);
    }
  });

  it('accetta una stringa valida e la restringe di tipo', () => {
    const value: unknown = 'lesson-1';
    expect(isValidDocumentIdInput(value)).toBe(true);
    if (isValidDocumentIdInput(value)) {
      expect(value.toUpperCase()).toBe('LESSON-1');
    }
  });
});

describe('una sola definizione autorevole', () => {
  /**
   * FORCE-SUBMIT continua a esporre la stessa funzione: è un re-export, non una
   * copia. Se qualcuno ne reintroducesse una seconda versione, questo test se
   * ne accorgerebbe al primo caso divergente.
   */
  it('FORCE-SUBMIT riusa esattamente questa implementazione', () => {
    expect(forceSubmitIsValid).toBe(isValidDocumentId);
  });
});
