import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalizeManifest, MANIFEST_CANONICAL_VERSION } from '../structureManifestCanonical.js';
import { planUdaMetadataAppend } from '../planUdaMetadataAppend.js';
import { planLessonMetadataAppend } from '../planLessonMetadataAppend.js';
import type { NormalizedLessonMetadata, NormalizedUdaMetadata } from '../types.js';

/**
 * STRUCTURE-IMPORT-01 — la serializzazione canonica.
 *
 * Attenzione a cosa questi test affermano e a cosa **non** affermano. La
 * proprietà dimostrata qui è: *manifest uguali ⇒ serializzazioni uguali*, e
 * *manifest diversi ⇒ serializzazioni diverse*. Nessun test afferma che «ogni
 * modifica produce sicuramente un hash diverso»: l'identità autorevole è
 * `SHA-256(manifestCanonical)` e la calcola l'adapter di 02A/02B, non questo
 * strato. Una serializzazione iniettiva è la premessa che rende sensata quella
 * garanzia; l'assenza di collisioni è responsabilità di SHA-256.
 */

const BASE = { ownerUid: 'owner-1', programId: 'prog-1', importId: 'imp-1' };

function uda(
  titolo: string,
  overrides: Partial<NormalizedUdaMetadata> = {},
): NormalizedUdaMetadata {
  return { titolo, descrizione: null, competenze: ['c'], obiettivi: ['o'], ...overrides };
}

function lesson(
  titolo: string,
  overrides: Partial<NormalizedLessonMetadata> = {},
): NormalizedLessonMetadata {
  return {
    titolo,
    sottotitolo: null,
    difficolta: 'base',
    concettiChiave: ['c'],
    obiettivi: ['o'],
    ...overrides,
  };
}

function udaCanonical(udas: NormalizedUdaMetadata[], overrides: Partial<typeof BASE> = {}): string {
  const result = planUdaMetadataAppend({ ...BASE, ...overrides, udas, existingUdas: [] });
  if (!result.ok) throw new Error(result.error.code);
  return result.value.manifestCanonical;
}

describe('stabilità', () => {
  it('a parità di input la serializzazione è identica', () => {
    expect(udaCanonical([uda('Le reti'), uda('I protocolli')])).toBe(
      udaCanonical([uda('Le reti'), uda('I protocolli')]),
    );
  });

  it('porta la versione del formato, così un cambio di regole non passa inosservato', () => {
    expect(udaCanonical([uda('Le reti')]).startsWith(MANIFEST_CANONICAL_VERSION)).toBe(true);
  });

  it('non contiene sé stessa: la serializzazione è del corpo del manifest', () => {
    const result = planUdaMetadataAppend({ ...BASE, udas: [uda('A')], existingUdas: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manifestCanonical).not.toContain('manifestCanonical');
  });
});

describe('indipendenza dall’ordine non semantico delle proprietà', () => {
  it('due oggetti con le stesse coppie in ordine diverso serializzano uguale', () => {
    expect(canonicalizeManifest({ a: 1, b: 2, c: [1, 2] })).toBe(
      canonicalizeManifest({ c: [1, 2], b: 2, a: 1 }),
    );
  });

  it('anche in profondità', () => {
    expect(canonicalizeManifest({ x: { p: 'v', q: [{ m: 1, n: 2 }] } })).toBe(
      canonicalizeManifest({ x: { q: [{ n: 2, m: 1 }], p: 'v' } }),
    );
  });

  it('una proprietà `undefined` equivale alla sua assenza', () => {
    expect(canonicalizeManifest({ a: 1, b: undefined })).toBe(canonicalizeManifest({ a: 1 }));
  });

  it('l’ordine degli array è invece semantico e viene conservato', () => {
    expect(canonicalizeManifest({ a: [1, 2] })).not.toBe(canonicalizeManifest({ a: [2, 1] }));
  });
});

describe('iniettività: manifest diversi, serializzazioni diverse', () => {
  it('cambia per ogni campo rilevante del manifest UDA', () => {
    const base = udaCanonical([uda('Le reti')]);
    expect(udaCanonical([uda('Le reti')], { programId: 'prog-2' })).not.toBe(base);
    expect(udaCanonical([uda('Le reti')], { importId: 'imp-2' })).not.toBe(base);
    expect(udaCanonical([uda('Le reti')], { ownerUid: 'owner-2' })).not.toBe(base);
    expect(udaCanonical([uda('Le altre reti')])).not.toBe(base);
    expect(udaCanonical([uda('Le reti', { descrizione: 'Nuova.' })])).not.toBe(base);
    expect(udaCanonical([uda('Le reti', { competenze: ['c2'] })])).not.toBe(base);
    expect(udaCanonical([uda('Le reti', { obiettivi: ['o2'] })])).not.toBe(base);
    expect(udaCanonical([uda('Le reti'), uda('Altre')])).not.toBe(base);
  });

  it('cambia se cambia l’ordine delle voci nel file', () => {
    expect(udaCanonical([uda('Alfa'), uda('Beta')])).not.toBe(
      udaCanonical([uda('Beta'), uda('Alfa')]),
    );
  });

  it('cambia per ogni campo rilevante del manifest lezioni', () => {
    const plan = (
      lessons: NormalizedLessonMetadata[],
      overrides: Record<string, string> = {},
    ): string => {
      const result = planLessonMetadataAppend({
        ...BASE,
        udaId: 'uda-01-reti',
        udaDir: 'uda-01-reti',
        ...overrides,
        lessons,
        existingLessons: [],
      });
      if (!result.ok) throw new Error(result.error.code);
      return result.value.manifestCanonical;
    };
    const base = plan([lesson('A')]);
    expect(plan([lesson('A')], { udaId: 'uda-02-altro' })).not.toBe(base);
    expect(plan([lesson('A')], { udaDir: 'uda-02-altro' })).not.toBe(base);
    expect(plan([lesson('A', { difficolta: 'avanzata' })])).not.toBe(base);
    expect(plan([lesson('A', { sottotitolo: 'S' })])).not.toBe(base);
    expect(plan([lesson('A', { concettiChiave: ['x'] })])).not.toBe(base);
    expect(plan([lesson('A'), lesson('B')])).not.toBe(base);
  });

  it('distingue tipi che JSON confonderebbe', () => {
    expect(canonicalizeManifest({ a: 1 })).not.toBe(canonicalizeManifest({ a: '1' }));
    expect(canonicalizeManifest({ a: null })).not.toBe(canonicalizeManifest({ a: 'z' }));
    expect(canonicalizeManifest({ a: true })).not.toBe(canonicalizeManifest({ a: 'b1' }));
  });

  it('nessuna combinazione di separatori nei dati può imitare un confine', () => {
    // Chiavi con lunghezza prefissata e stringhe con escape JSON: due strutture
    // diverse non possono produrre la stessa riga.
    expect(canonicalizeManifest({ 'a=1,b': '2' })).not.toBe(canonicalizeManifest({ a: '1,b=2' }));
    expect(canonicalizeManifest({ a: 'x"},{"y' })).not.toBe(
      canonicalizeManifest({ a: 'x', y: '' }),
    );
  });

  it('rifiuta un numero non finito invece di serializzarlo in modo ambiguo', () => {
    expect(() => canonicalizeManifest({ a: Number.NaN })).toThrow(/non finito/);
    expect(() => canonicalizeManifest({ a: Number.POSITIVE_INFINITY })).toThrow(/non finito/);
  });
});

describe('FNV non è sul percorso autorevole', () => {
  const moduleDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(full);
      return entry.name.endsWith('.ts') ? [full] : [];
    });
  }

  it('nessun modulo STRUCTURE-IMPORT usa fnv1a o il vecchio manifestHash', () => {
    for (const file of sourceFiles(moduleDir)) {
      // Solo il codice: i commenti citano legittimamente il vecchio flusso per
      // spiegare perché non viene riusato.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code).not.toContain('fnv1a');
      expect(code).not.toContain('manifestHash');
    }
  });

  it('i manifest non espongono più un campo `manifestHash`', () => {
    const result = planUdaMetadataAppend({ ...BASE, udas: [uda('A')], existingUdas: [] });
    expect(result.ok).toBe(true);
    if (result.ok) expect('manifestHash' in result.value).toBe(false);
  });
});
