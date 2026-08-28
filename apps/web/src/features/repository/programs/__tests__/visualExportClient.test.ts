import { describe, expect, it, vi } from 'vitest';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: () => mockCallable,
}));

import {
  VISUAL_EXPORT_CONCURRENCY,
  VISUAL_EXPORT_LESSONS_PER_BATCH,
  VISUAL_EXPORT_ZIP_PREFIX,
  VisualExportError,
  createVisualExportClient,
} from '../visualExportClient.js';
import type { Functions } from 'firebase/functions';

/**
 * VISUAL-ENRICHMENT-03C — il client dell'operazione binaria.
 *
 * Spezzare un export in più chiamate è sicuro solo se la ricomposizione è
 * verificata: un risultato mancante diventerebbe una lezione senza figura, un
 * duplicato attribuirebbe la figura sbagliata alla lezione vicina. In entrambi
 * i casi dentro un archivio che sembra completo.
 */

const ASSET = '11111111-2222-4333-8444-555555555555';
const functions = {} as Functions;

const present = (lessonId: string, assetId = ASSET) => ({
  lessonId,
  status: 'present',
  assetId,
  manifestJson: '{}\n',
  base64: 'UklGRg==',
  byteLength: 4,
});
const absent = (lessonId: string) => ({ lessonId, status: 'absent' });
const multi = (lessonId: string) => ({
  lessonId,
  status: 'multi',
  assets: [
    {
      assetId: ASSET,
      manifestJson: '{}\n',
      base64: 'UklGRg==',
      byteLength: 4,
    },
  ],
});

function client() {
  return createVisualExportClient(functions);
}

const request = (lessonIds: string[]) => ({
  programId: 'prog-1',
  importId: 'imp-1',
  lessonIds,
});

describe('limiti duplicati dal server', () => {
  /**
   * Il web non può importare da Functions, quindi i limiti sono riscritti. La
   * duplicazione è dichiarata e va congelata: se divergessero, il client
   * comporrebbe batch che il server rifiuta.
   */
  it('coincidono con quelli dichiarati lato Functions', () => {
    expect(VISUAL_EXPORT_LESSONS_PER_BATCH).toBe(13);
    expect(VISUAL_EXPORT_CONCURRENCY).toBe(2);
    expect(VISUAL_EXPORT_ZIP_PREFIX).toBe('visuals/');
  });
});

describe('fetchLessonVisuals — batching e ordine', () => {
  it('non chiama nulla per una lista vuota', async () => {
    mockCallable.mockReset();
    expect(await client().fetchLessonVisuals(request([]))).toEqual([]);
    expect(mockCallable).not.toHaveBeenCalled();
  });

  it('usa una sola chiamata sotto il limite', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ data: { items: [present('a'), absent('b')] } });

    const items = await client().fetchLessonVisuals(request(['a', 'b']));

    expect(mockCallable).toHaveBeenCalledTimes(1);
    expect(items.map((i) => i.lessonId)).toEqual(['a', 'b']);
    expect(items[1]?.status).toBe('absent');
  });

  it('divide in più batch oltre il limite e ricompone l’ordine canonico', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `lesson-${i}`);
    mockCallable.mockReset();
    mockCallable.mockImplementation(async (payload: { lessonIds: string[] }) => ({
      data: { items: payload.lessonIds.map((id) => absent(id)) },
    }));

    const items = await client().fetchLessonVisuals(request(ids));

    expect(mockCallable).toHaveBeenCalledTimes(2);
    expect(mockCallable.mock.calls[0]?.[0].lessonIds).toHaveLength(13);
    expect(mockCallable.mock.calls[1]?.[0].lessonIds).toHaveLength(7);
    expect(items.map((i) => i.lessonId)).toEqual(ids);
  });

  /**
   * L'ordine non può dipendere dal completamento delle promise: i percorsi
   * dell'archivio ne discendono, e un archivio il cui ordine fisico cambia a
   * ogni export non si può confrontare con il precedente.
   */
  it('conserva l’ordine anche se il secondo batch risponde per primo', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `lesson-${i}`);
    mockCallable.mockReset();
    let call = 0;
    mockCallable.mockImplementation(async (payload: { lessonIds: string[] }) => {
      call += 1;
      const delay = call === 1 ? 20 : 0;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return { data: { items: payload.lessonIds.map((id) => absent(id)) } };
    });

    const items = await client().fetchLessonVisuals(request(ids));
    expect(items.map((i) => i.lessonId)).toEqual(ids);
  });

  /** Non rileggere due volte la stessa immagine è un requisito di costo. */
  it('deduplica conservando la prima posizione', async () => {
    mockCallable.mockReset();
    mockCallable.mockImplementation(async (payload: { lessonIds: string[] }) => ({
      data: { items: payload.lessonIds.map((id) => absent(id)) },
    }));

    const items = await client().fetchLessonVisuals(request(['a', 'b', 'a', 'c', 'b']));

    expect(mockCallable.mock.calls[0]?.[0].lessonIds).toEqual(['a', 'b', 'c']);
    expect(items.map((i) => i.lessonId)).toEqual(['a', 'b', 'c']);
  });

  it('non supera mai la concorrenza dichiarata', async () => {
    const ids = Array.from({ length: 160 }, (_, i) => `lesson-${i}`);
    mockCallable.mockReset();
    let inFlight = 0;
    let peak = 0;
    mockCallable.mockImplementation(async (payload: { lessonIds: string[] }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return { data: { items: payload.lessonIds.map((id) => absent(id)) } };
    });

    await client().fetchLessonVisuals(request(ids));
    expect(peak).toBeLessThanOrEqual(VISUAL_EXPORT_CONCURRENCY);
  });
});

describe('fetchLessonVisuals — risposte non conformi', () => {
  const expectRejection = async (items: unknown, ids = ['a', 'b']) => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ data: { items } });
    await expect(client().fetchLessonVisuals(request(ids))).rejects.toThrow(VisualExportError);
  };

  it('rifiuta un risultato mancante', async () => {
    await expectRejection([present('a')]);
  });

  it('rifiuta un risultato in più', async () => {
    await expectRejection([present('a'), absent('b'), absent('c')]);
  });

  it('rifiuta un ordine diverso da quello richiesto', async () => {
    await expectRejection([absent('b'), present('a')]);
  });

  it('rifiuta un elemento che parla di una lezione non richiesta', async () => {
    await expectRejection([present('a'), absent('z')]);
  });

  it('rifiuta items assente o non array', async () => {
    for (const bad of [undefined, null, 'x', 42, {}]) {
      await expectRejection(bad, ['a']);
    }
  });

  /**
   * L'`assetId` diventa il nome di un file dentro un archivio che l'utente
   * aprirà altrove: un valore inatteso smetterebbe di essere un dato per
   * diventare una posizione nel filesystem di chi lo estrae.
   */
  it('rifiuta un assetId che non è un UUID v4', async () => {
    for (const bad of ['', '../fuori', 'non-un-uuid', '11111111-2222-3333-4444-555555555555']) {
      await expectRejection([{ ...present('a'), assetId: bad }], ['a']);
    }
  });

  it('rifiuta un elemento present incompleto o con tipi errati', async () => {
    const cases: Array<Record<string, unknown>> = [
      { ...present('a'), manifestJson: '' },
      { ...present('a'), manifestJson: 42 },
      { ...present('a'), base64: '' },
      { ...present('a'), base64: null },
      { ...present('a'), byteLength: 0 },
      { ...present('a'), byteLength: -1 },
      { ...present('a'), byteLength: 1.5 },
      { ...present('a'), byteLength: '4' },
      { ...present('a'), status: 'boh' },
    ];
    for (const item of cases) {
      await expectRejection([item], ['a']);
    }
  });

  it('rifiuta un elemento che non è un oggetto', async () => {
    for (const bad of [null, 'x', 42]) {
      await expectRejection([bad], ['a']);
    }
  });

  it('accetta il contratto multi chiuso', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ data: { items: [multi('a')] } });
    await expect(client().fetchLessonVisuals(request(['a']))).resolves.toEqual([multi('a')]);
  });

  it('rifiuta asset multi duplicati, proprietà extra e cardinalità fuori cap', async () => {
    const valid = multi('a');
    const asset = valid.assets[0]!;
    for (const bad of [
      { ...valid, assets: [] },
      { ...valid, assets: [asset, asset] },
      { ...valid, assets: [asset, asset, asset, asset] },
      { ...valid, extra: true },
      { ...valid, assets: [{ ...asset, storageRef: '../../arbitrary' }] },
    ]) {
      await expectRejection([bad], ['a']);
    }
  });
});

describe('fetchLessonVisuals — risposta persa e ripetizione', () => {
  /**
   * L'export è una lettura: ripeterlo è sicuro e non produce effetti. Ciò che
   * deve valere è che la ripetizione dia lo stesso risultato, così un batch
   * ritentato dopo una risposta persa non cambia l'archivio.
   */
  it('una richiesta ripetuta produce lo stesso risultato', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ data: { items: [present('a')] } });

    const first = await client().fetchLessonVisuals(request(['a']));
    const second = await client().fetchLessonVisuals(request(['a']));

    expect(second).toEqual(first);
  });

  /** Un batch riuscito e uno fallito: l'export non consegna un mezzo archivio. */
  it('fallisce tutto se un solo batch fallisce', async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `lesson-${i}`);
    mockCallable.mockReset();
    let call = 0;
    mockCallable.mockImplementation(async (payload: { lessonIds: string[] }) => {
      call += 1;
      if (call === 2) throw new Error('resource-exhausted');
      return { data: { items: payload.lessonIds.map((id) => absent(id)) } };
    });

    await expect(client().fetchLessonVisuals(request(ids))).rejects.toThrow(/resource-exhausted/);
  });
});
