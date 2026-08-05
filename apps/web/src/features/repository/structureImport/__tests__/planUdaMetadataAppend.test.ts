import { describe, expect, it } from 'vitest';
import { planUdaMetadataAppend } from '../planUdaMetadataAppend.js';
import type { ExistingUdaForPlan, NormalizedUdaMetadata } from '../types.js';

/**
 * STRUCTURE-IMPORT-01 — planner puro delle UDA. Verifica che numerazione,
 * ordine, id e path canonici seguano gli stessi criteri di `createUda`, che il
 * corpo Markdown sia davvero vuoto e che nessuna collisione produca una
 * rinomina o una sovrascrittura.
 */

const BASE = {
  ownerUid: 'owner-1',
  programId: 'prog-1',
  importId: 'imp-1',
};

function uda(
  titolo: string,
  overrides: Partial<NormalizedUdaMetadata> = {},
): NormalizedUdaMetadata {
  return {
    titolo,
    descrizione: null,
    competenze: ['c'],
    obiettivi: ['o'],
    ...overrides,
  };
}

function plan(udas: NormalizedUdaMetadata[], existingUdas: ExistingUdaForPlan[] = []) {
  const result = planUdaMetadataAppend({ ...BASE, udas, existingUdas });
  if (!result.ok) throw new Error(`plan fallito: ${result.error.code}`);
  return result.value;
}

describe('append dopo i dati correnti', () => {
  it('su un import vuoto parte da uda-01 e order 0', () => {
    const manifest = plan([uda('Le reti'), uda('I protocolli')]);
    expect(manifest.udas.map((u) => u.dir)).toEqual(['uda-01-le-reti', 'uda-02-i-protocolli']);
    expect(manifest.udas.map((u) => u.order)).toEqual([0, 1]);
  });

  it('riprende dopo l’ultima UDA esistente', () => {
    const manifest = plan(
      [uda('Nuova')],
      [
        { udaId: 'uda-01-a', dir: 'uda-01-a', order: 0 },
        { udaId: 'uda-02-b', dir: 'uda-02-b', order: 1 },
      ],
    );
    expect(manifest.udas[0]!.dir).toBe('uda-03-nuova');
    expect(manifest.udas[0]!.order).toBe(2);
  });

  it('non riempie i buchi di numerazione: parte dal massimo', () => {
    const manifest = plan(
      [uda('Nuova')],
      [
        { udaId: 'uda-01-a', dir: 'uda-01-a', order: 0 },
        { udaId: 'uda-07-b', dir: 'uda-07-b', order: 1 },
      ],
    );
    expect(manifest.udas[0]!.dir).toBe('uda-08-nuova');
    expect(manifest.udas[0]!.order).toBe(2);
  });

  it('usa il prefisso uda-XX come order per i documenti legacy senza order', () => {
    const manifest = plan([uda('Nuova')], [{ udaId: 'uda-05-a', dir: 'uda-05-a' }]);
    // order legacy = 5 - 1 = 4, quindi la nuova è 5.
    expect(manifest.udas[0]!.order).toBe(5);
    expect(manifest.udas[0]!.dir).toBe('uda-06-nuova');
  });

  it('un import vuoto di voci produce un manifest vuoto e nessun path', () => {
    const manifest = plan([]);
    expect(manifest.udas).toEqual([]);
    expect(manifest.storagePaths).toEqual([]);
    expect(manifest.udaIds).toEqual([]);
  });

  it('conserva l’ordine del file, non l’ordine alfabetico', () => {
    const manifest = plan([uda('Zeta'), uda('Alfa')]);
    expect(manifest.udas.map((u) => u.metadata.titolo)).toEqual(['Zeta', 'Alfa']);
    expect(manifest.udas.map((u) => u.order)).toEqual([0, 1]);
  });
});

describe('slug, id e path canonici', () => {
  it('normalizza accenti e punteggiatura nello slug', () => {
    const manifest = plan([uda('Città, energia & società: un’introduzione')]);
    expect(manifest.udas[0]!.dir).toBe('uda-01-citta-energia-societa-un-introduzione');
  });

  it('un titolo di soli simboli ricade sullo slug di riserva', () => {
    const manifest = plan([uda('***')]);
    expect(manifest.udas[0]!.dir).toBe('uda-01-lezione');
  });

  it('produce id, filename e Storage path deterministici', () => {
    const manifest = plan([uda('Le reti')]);
    const planned = manifest.udas[0]!;
    expect(planned.udaId).toBe('uda-01-le-reti');
    expect(planned.filename).toBe('uda-01-le-reti.md');
    expect(planned.storageBasePath).toBe('repository/owner-1/imports/imp-1/uda-01-le-reti');
    expect(planned.storagePath).toBe(
      'repository/owner-1/imports/imp-1/uda-01-le-reti/uda-01-le-reti.md',
    );
  });

  it('il manifest elenca esattamente gli id e i path creati', () => {
    const manifest = plan([uda('A'), uda('B')]);
    expect(manifest.udaIds).toEqual(manifest.udas.map((u) => u.udaId));
    expect(manifest.storagePaths).toEqual(manifest.udas.map((u) => u.storagePath));
  });
});

describe('contenuto Markdown', () => {
  it('scrive solo il front matter, con corpo davvero vuoto', () => {
    const manifest = plan([
      uda('Le reti', {
        descrizione: 'Una descrizione.',
        competenze: ['c1', 'c2'],
        obiettivi: ['o1'],
      }),
    ]);
    const content = manifest.udas[0]!.content;
    expect(content).toBe(
      [
        '---',
        'titolo: Le reti',
        'descrizione: Una descrizione.',
        'competenze:',
        '  - c1',
        '  - c2',
        'obiettivi:',
        '  - o1',
        '---',
      ].join('\n'),
    );
    // Nessun corpo dopo il front matter di chiusura.
    expect(content.split('---')[2]!.trim()).toBe('');
  });

  it('non contiene mai pool, domande o soluzioni', () => {
    const content = plan([uda('Le reti')])!.udas[0]!.content;
    for (const forbidden of ['pool', 'domand', 'soluzion', 'question']) {
      expect(content.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('il documento pianificato nasce con lessonCount 0', () => {
    expect(plan([uda('Le reti')]).udas[0]!.doc.lessonCount).toBe(0);
  });

  it('il documento pianificato non contiene valori Firebase', () => {
    const doc = plan([uda('Le reti')]).udas[0]!.doc as unknown as Record<string, unknown>;
    for (const value of Object.values(doc)) {
      expect(typeof value === 'object' && value !== null && !Array.isArray(value)).toBe(false);
    }
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc);
  });
});

describe('collisioni', () => {
  it('rifiuta un titolo già presente nella destinazione', () => {
    const result = planUdaMetadataAppend({
      ...BASE,
      udas: [uda('Le Reti')],
      existingUdas: [{ udaId: 'x', dir: 'uda-01-le-reti', order: 0, titolo: '  le reti ' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('duplicate_title_in_destination');
  });

  it('rifiuta una collisione tecnica di id anche con titoli distinti', () => {
    // La UDA esistente occupa già l'id che la nuova numerazione produrrebbe.
    const result = planUdaMetadataAppend({
      ...BASE,
      udas: [uda('Nuova')],
      existingUdas: [{ udaId: 'uda-02-nuova', dir: 'uda-01-a', order: 0, titolo: 'Altro titolo' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('document_id_collision');
      expect(result.error.index).toBe(0);
    }
  });

  it('nessun path pianificato coincide con uno esistente, nemmeno a parità di slug', () => {
    // La numerazione da sola dovrebbe già garantirlo (il numero è sempre uno
    // più del massimo esistente); il guardrail su Storage resta come difesa in
    // profondità, e questo test verifica la proprietà che deve valere sempre.
    const existingUdas: ExistingUdaForPlan[] = [
      { udaId: 'uda-01-nuova', dir: 'uda-01-nuova', order: 0, titolo: 'Altro' },
      { udaId: 'uda-02-nuova', dir: 'uda-02-nuova', order: 1, titolo: 'Ancora altro' },
    ];
    const existingPaths = new Set(
      existingUdas.map((u) => `repository/owner-1/imports/imp-1/${u.dir}/${u.dir}.md`),
    );
    const manifest = plan([uda('Nuova'), uda('Nuova bis')], existingUdas);
    for (const planned of manifest.udas) {
      expect(existingPaths.has(planned.storagePath)).toBe(false);
    }
    expect(manifest.udas[0]!.dir).toBe('uda-03-nuova');
  });

  it('non rinomina, non aggiunge suffissi e non sovrascrive', () => {
    const result = planUdaMetadataAppend({
      ...BASE,
      udas: [uda('Le reti')],
      existingUdas: [
        { udaId: 'uda-01-le-reti', dir: 'uda-01-le-reti', order: 0, titolo: 'Le reti' },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain('_2');
  });
});

describe('manifest e hash', () => {
  it('è stabile a parità di input', () => {
    const a = plan([uda('Le reti'), uda('I protocolli')]);
    const b = plan([uda('Le reti'), uda('I protocolli')]);
    expect(a.manifestCanonical).toBe(b.manifestCanonical);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('cambia se cambia un metadato, anche non presente nei nomi tecnici', () => {
    const a = plan([uda('Le reti', { obiettivi: ['o1'] })]);
    const b = plan([uda('Le reti', { obiettivi: ['o2'] })]);
    expect(a.udas[0]!.dir).toBe(b.udas[0]!.dir);
    expect(a.manifestCanonical).not.toBe(b.manifestCanonical);
  });

  it('cambia se cambia la destinazione', () => {
    const a = plan([uda('Le reti')]);
    const b = planUdaMetadataAppend({
      ...BASE,
      importId: 'imp-2',
      udas: [uda('Le reti')],
      existingUdas: [],
    });
    expect(b.ok).toBe(true);
    if (b.ok) expect(a.manifestCanonical).not.toBe(b.value.manifestCanonical);
  });

  it('cambia se cambia l’ordine delle voci nel file', () => {
    const a = plan([uda('Alfa'), uda('Beta')]);
    const b = plan([uda('Beta'), uda('Alfa')]);
    expect(a.manifestCanonical).not.toBe(b.manifestCanonical);
  });

  it('è interamente serializzabile', () => {
    const manifest = plan([uda('Le reti')]);
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});
