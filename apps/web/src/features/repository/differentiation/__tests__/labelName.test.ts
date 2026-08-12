import { describe, expect, it } from 'vitest';
import {
  LABEL_NAME_MAX_BYTES,
  LABEL_NAME_MAX_CODE_POINTS,
  LabelNameError,
  buildLabelReservationInput,
  computeNameKey,
  countCodePoints,
  countUtf8Bytes,
  isValidLabelName,
  normalizeLabelName,
} from '../labelName.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof LabelNameError) return error.code;
    return `unexpected:${String(error)}`;
  }
  return 'no-error';
}

describe('normalizeLabelName — forma canonica', () => {
  it('rimuove gli spazi esterni', () => {
    expect(normalizeLabelName('  Percorso A  ')).toBe('Percorso A');
  });

  it('collassa più spazi interni in uno solo', () => {
    expect(normalizeLabelName('Percorso    A')).toBe('Percorso A');
    expect(normalizeLabelName('  Obiettivi   essenziali  ')).toBe('Obiettivi essenziali');
  });

  it('collassa anche gli spazi Unicode non ASCII', () => {
    // U+00A0 (no-break space) e U+2009 (thin space) sono spazi a tutti gli
    // effetti per chi legge, ma byte diversi: senza collasso produrrebbero due
    // etichette visivamente identiche e formalmente distinte.
    expect(normalizeLabelName('Percorso\u00A0A')).toBe('Percorso A');
    expect(normalizeLabelName('Percorso\u2009\u2009A')).toBe('Percorso A');
  });

  it('conserva accenti e apostrofi senza toccarli', () => {
    expect(normalizeLabelName('Però  D’Amico')).toBe('Però D’Amico');
    expect(normalizeLabelName("Gruppo dell'anno")).toBe("Gruppo dell'anno");
  });

  it('non altera maiuscole e minuscole', () => {
    expect(normalizeLabelName('PERCORSO a')).toBe('PERCORSO a');
  });

  it('rifiuta un input non stringa', () => {
    expect(codeOf(() => normalizeLabelName(42))).toBe('not_a_string');
    expect(codeOf(() => normalizeLabelName(null))).toBe('not_a_string');
    expect(codeOf(() => normalizeLabelName(undefined))).toBe('not_a_string');
    expect(codeOf(() => normalizeLabelName({ name: 'x' }))).toBe('not_a_string');
  });

  it('rifiuta il vuoto e il solo spazio', () => {
    expect(codeOf(() => normalizeLabelName(''))).toBe('empty');
    expect(codeOf(() => normalizeLabelName('   '))).toBe('empty');
    expect(codeOf(() => normalizeLabelName('\u00A0\u2009'))).toBe('empty');
  });

  it('rifiuta i caratteri di controllo, incluso il separatore U+0000', () => {
    expect(codeOf(() => normalizeLabelName('Percorso\u0000A'))).toBe('control_characters');
    expect(codeOf(() => normalizeLabelName('Percorso\nA'))).toBe('control_characters');
    expect(codeOf(() => normalizeLabelName('Percorso\tA'))).toBe('control_characters');
    expect(codeOf(() => normalizeLabelName('Percorso\u007FA'))).toBe('control_characters');
    expect(codeOf(() => normalizeLabelName('Percorso\u0085A'))).toBe('control_characters');
  });

  it('accetta esattamente il limite di code point e rifiuta il successivo', () => {
    const atLimit = 'a'.repeat(LABEL_NAME_MAX_CODE_POINTS);
    expect(normalizeLabelName(atLimit)).toBe(atLimit);
    expect(codeOf(() => normalizeLabelName('a'.repeat(LABEL_NAME_MAX_CODE_POINTS + 1)))).toBe(
      'too_many_code_points',
    );
  });

  it('conta le emoji come un solo code point, non due unità UTF-16', () => {
    // 40 emoji fuori dal BMP = 40 code point ma 80 unità UTF-16: contare
    // `.length` le rifiuterebbe pur essendo entro il limite percepito.
    const emoji = '🎯';
    expect(countCodePoints(emoji)).toBe(1);
    expect(emoji.length).toBe(2);
    // 40 emoji superano però il limite in BYTE (4 byte l'una = 160 > 120).
    expect(codeOf(() => normalizeLabelName(emoji.repeat(40)))).toBe('too_many_bytes');
    expect(normalizeLabelName(emoji.repeat(30))).toBe(emoji.repeat(30));
  });

  it('il limite in byte è distinto da quello in caratteri', () => {
    // 40 caratteri accentati: entro il limite di code point. «à» costa 2 byte
    // in UTF-8, quindi 80 byte: dimostra che i due limiti sono indipendenti.
    const accented = 'à'.repeat(40);
    expect(countCodePoints(accented)).toBe(40);
    expect(countUtf8Bytes(accented)).toBe(80);
    expect(normalizeLabelName(accented)).toBe(accented);

    // Un carattere CJK costa 3 byte: 40 caratteri = 120 byte, esattamente al
    // limite; 41 supererebbe prima il limite di code point.
    const cjk = '課'.repeat(40);
    expect(countUtf8Bytes(cjk)).toBe(LABEL_NAME_MAX_BYTES);
    expect(normalizeLabelName(cjk)).toBe(cjk);
  });

  it('isValidLabelName non lancia mai', () => {
    expect(isValidLabelName('Percorso A')).toBe(true);
    expect(isValidLabelName('')).toBe(false);
    expect(isValidLabelName(7)).toBe(false);
  });
});

describe('computeNameKey — chiave di confronto', () => {
  it('è insensibile alle maiuscole', () => {
    expect(computeNameKey('Percorso A')).toBe(computeNameKey('PERCORSO a'));
  });

  it('rende equivalenti i nomi che differiscono solo per spazi', () => {
    const a = computeNameKey(normalizeLabelName('  Percorso   A '));
    const b = computeNameKey(normalizeLabelName('Percorso A'));
    expect(a).toBe(b);
  });

  it('unifica le forme Unicode equivalenti (NFC e NFD)', () => {
    const composed = 'Per\u00F2'; // ò precomposta
    const decomposed = 'Pero\u0300'; // o + accento combinante
    expect(composed).not.toBe(decomposed);
    expect(computeNameKey(composed)).toBe(computeNameKey(decomposed));
  });

  it('applica NFKC alle forme di compatibilità', () => {
    // Le lettere "fullwidth" sono la stessa cosa per chi legge.
    expect(computeNameKey('ＰＥＲＣＯＲＳＯ')).toBe('percorso');
  });

  it('NON rimuove accenti né apostrofi: sono nomi diversi', () => {
    expect(computeNameKey('Però')).not.toBe(computeNameKey('Pero'));
    expect(computeNameKey('Dell’A')).not.toBe(computeNameKey('DellA'));
  });

  it('usa il locale italiano: la I maiuscola resta i', () => {
    // In locale turco «I» diventerebbe «ı» e due docenti vedrebbero unicità
    // diverse sullo stesso nome. Il locale è fissato per non dipendere dal browser.
    expect(computeNameKey('INDIRIZZO')).toBe('indirizzo');
  });
});

describe('buildLabelReservationInput — separatore non ambiguo', () => {
  it('separa owner e chiave con U+0000', () => {
    expect(buildLabelReservationInput('owner', 'chiave')).toBe('owner\u0000chiave');
  });

  it('coppie diverse non collidono per concatenazione', () => {
    // Senza separatore «ab» + «c» e «a» + «bc» produrrebbero la stessa stringa.
    expect(buildLabelReservationInput('ab', 'c')).not.toBe(buildLabelReservationInput('a', 'bc'));
  });

  it('il separatore non può comparire in un nome valido', () => {
    expect(codeOf(() => normalizeLabelName('a\u0000b'))).toBe('control_characters');
  });
});
