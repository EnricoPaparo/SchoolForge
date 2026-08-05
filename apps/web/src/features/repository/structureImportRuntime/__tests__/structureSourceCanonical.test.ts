import { describe, expect, it } from 'vitest';
import { canonicalizeSource, SOURCE_CANONICAL_VERSION } from '../structureSourceCanonical.js';
import { classifySourceAttempt } from '../attemptState.js';
import type {
  NormalizedLessonMetadata,
  NormalizedUdaMetadata,
} from '../../structureImport/index.js';

/**
 * STRUCTURE-IMPORT — identità della sorgente.
 *
 * È il livello che rende davvero idempotente un retry dopo un commit la cui
 * risposta si è persa: dipende solo da richiesta, owner autorevole,
 * destinazione e metadati del file, quindi resta uguale anche quando la
 * destinazione è già stata modificata dal commit precedente — il momento in cui
 * il `manifestHash`, che nasce dal planner, non sarebbe più calcolabile allo
 * stesso modo.
 */

const uda = (titolo: string): NormalizedUdaMetadata => ({
  titolo,
  descrizione: null,
  competenze: ['c'],
  obiettivi: ['o'],
});

const lesson = (titolo: string): NormalizedLessonMetadata => ({
  titolo,
  sottotitolo: null,
  difficolta: 'base',
  concettiChiave: ['c'],
  obiettivi: ['o'],
});

const UDA_SOURCE = {
  kind: 'uda' as const,
  ownerUid: 'owner-1',
  programId: 'prog-1',
  importId: 'imp-1',
  udas: [uda('Le reti'), uda('I protocolli')],
};

const LESSON_SOURCE = {
  kind: 'lesson' as const,
  ownerUid: 'owner-1',
  programId: 'prog-1',
  importId: 'imp-1',
  udaId: 'uda-01-reti',
  lessons: [lesson('A'), lesson('B')],
};

describe('stabilità e indipendenza dalla destinazione', () => {
  it('è stabile a parità di richiesta', () => {
    expect(canonicalizeSource(UDA_SOURCE)).toBe(canonicalizeSource({ ...UDA_SOURCE }));
    expect(canonicalizeSource(LESSON_SOURCE)).toBe(canonicalizeSource({ ...LESSON_SOURCE }));
  });

  it('porta il proprio tag di versione, distinto da quello del manifest', () => {
    expect(canonicalizeSource(UDA_SOURCE).startsWith(SOURCE_CANONICAL_VERSION)).toBe(true);
    expect(SOURCE_CANONICAL_VERSION).not.toContain('manifest');
  });

  it('non dipende da id, order o path: è calcolabile prima del planner', () => {
    const serialized = canonicalizeSource(UDA_SOURCE);
    expect(serialized).not.toContain('uda-01-');
    expect(serialized).not.toContain('repository/');
    expect(serialized).not.toContain('order');
  });
});

describe('cosa cambia l’identità della sorgente', () => {
  it('un file diverso', () => {
    expect(canonicalizeSource({ ...UDA_SOURCE, udas: [uda('Altre reti')] })).not.toBe(
      canonicalizeSource(UDA_SOURCE),
    );
  });

  it('l’ordine delle voci, che è semantico', () => {
    expect(
      canonicalizeSource({ ...UDA_SOURCE, udas: [uda('I protocolli'), uda('Le reti')] }),
    ).not.toBe(canonicalizeSource(UDA_SOURCE));
  });

  it('owner, corso, import — e per le lezioni la UDA', () => {
    const base = canonicalizeSource(LESSON_SOURCE);
    expect(canonicalizeSource({ ...LESSON_SOURCE, ownerUid: 'owner-2' })).not.toBe(base);
    expect(canonicalizeSource({ ...LESSON_SOURCE, programId: 'prog-2' })).not.toBe(base);
    expect(canonicalizeSource({ ...LESSON_SOURCE, importId: 'imp-2' })).not.toBe(base);
    expect(canonicalizeSource({ ...LESSON_SOURCE, udaId: 'uda-02-altra' })).not.toBe(base);
  });

  it('il tipo di import: una sorgente UDA non è mai una sorgente lezioni', () => {
    expect(canonicalizeSource(UDA_SOURCE)).not.toBe(canonicalizeSource(LESSON_SOURCE));
  });

  it('ogni metadato che finirà nei documenti', () => {
    const base = canonicalizeSource(LESSON_SOURCE);
    const variants: NormalizedLessonMetadata[][] = [
      [{ ...lesson('A'), sottotitolo: 'S' }, lesson('B')],
      [{ ...lesson('A'), difficolta: 'avanzata' }, lesson('B')],
      [{ ...lesson('A'), concettiChiave: ['x'] }, lesson('B')],
      [{ ...lesson('A'), obiettivi: ['y'] }, lesson('B')],
    ];
    for (const lessons of variants) {
      expect(canonicalizeSource({ ...LESSON_SOURCE, lessons })).not.toBe(base);
    }
  });
});

describe('classificazione di sorgente', () => {
  const expected = {
    requestId: 'req-1',
    sourceHash: 's'.repeat(64),
    kind: 'lesson' as const,
    programId: 'prog-1',
    importId: 'imp-1',
    udaId: 'uda-01-reti',
  };
  const committed = {
    requestId: 'req-1',
    sourceHash: expected.sourceHash,
    kind: 'lesson',
    programId: 'prog-1',
    importId: 'imp-1',
    udaId: 'uda-01-reti',
    status: 'committed',
    documentIds: ['l1', 'l2'],
    publicLessonIds: ['p1', 'p2'],
  };

  it('committed restituisce il risultato persistito, non uno ricostruito', () => {
    const probe = classifySourceAttempt(committed, expected);
    expect(probe.state).toBe('committed');
    if (probe.state === 'committed') {
      expect(probe.documentIds).toEqual(['l1', 'l2']);
      expect(probe.publicLessonIds).toEqual(['p1', 'p2']);
    }
  });

  it('un committed senza risultato leggibile è incoerente, non un successo', () => {
    expect(classifySourceAttempt({ ...committed, documentIds: undefined }, expected).state).toBe(
      'incoherent',
    );
    expect(
      classifySourceAttempt({ ...committed, publicLessonIds: undefined }, expected).state,
    ).toBe('incoherent');
  });

  it('sorgente diversa: conflitto', () => {
    expect(
      classifySourceAttempt({ ...committed, sourceHash: 'z'.repeat(64) }, expected).state,
    ).toBe('conflict');
  });

  it('stessa sorgente, altro bersaglio: conflitto', () => {
    for (const patch of [
      { kind: 'uda' },
      { programId: 'prog-2' },
      { importId: 'imp-2' },
      { udaId: 'uda-02-altra' },
    ]) {
      expect(classifySourceAttempt({ ...committed, ...patch }, expected).state).toBe('conflict');
    }
  });

  it('record legacy o parziale privo di sourceHash: incoerente, mai riparato', () => {
    const legacy = { ...committed } as Record<string, unknown>;
    delete legacy['sourceHash'];
    expect(classifySourceAttempt(legacy as never, expected).state).toBe('incoherent');
  });

  it('nessun record: tentativo nuovo; record prenotato: si prosegue', () => {
    expect(classifySourceAttempt(null, expected).state).toBe('none');
    expect(classifySourceAttempt({ ...committed, status: 'reserved' }, expected).state).toBe(
      'reserved',
    );
  });
});
