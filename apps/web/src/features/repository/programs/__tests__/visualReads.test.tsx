import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({ httpsCallable: () => mockCallable }));

const mockGetDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

import {
  createTeacherVisualReader,
  readStudentVisualBytes,
  VisualReadError,
} from '../visualReadClients.js';
import { useLessonVisual, type LessonVisualState } from '../useLessonVisual.js';
import type { Functions } from 'firebase/functions';
import type { Firestore } from 'firebase/firestore';
import type { LessonVisualPublicManifest } from '../../../../types/firestore.js';
import type { LessonVisualBytes } from '../visualReadClients.js';

/**
 * VE-04A — le letture dei byte, e soprattutto le letture che **non** avvengono.
 *
 * La garanzia che rende questa funzione a costo zero per chi non la usa è
 * negativa: una lezione senza manifest non produce nemmeno un'operazione.
 */

const ASSET = '11111111-2222-4333-8444-555555555555';
const OTHER_ASSET = '99999999-8888-4777-8666-555555555555';
const DATA = 'UklGRg==';

const MANIFEST: LessonVisualPublicManifest = {
  assetId: ASSET,
  anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
  caption: 'Schema',
  altText: 'Diagramma',
  width: 1024,
  height: 768,
};

const present = (over: Record<string, unknown> = {}) => ({
  lessonId: 'lesson-1',
  status: 'present',
  assetId: ASSET,
  manifestJson: '{}\n',
  base64: DATA,
  byteLength: 4,
  ...over,
});

function teacherRead(over: Record<string, unknown> = {}) {
  return createTeacherVisualReader({} as Functions)({
    programId: 'p1',
    importId: 'i1',
    lessonId: 'lesson-1',
    manifest: { assetId: ASSET, width: 1024, height: 768 },
    ...over,
  });
}

describe('lettura docente — riusa l’export binario', () => {
  it('una sola callable per una sola lezione', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ data: { items: [present()] } });

    const bytes = await teacherRead();

    expect(mockCallable).toHaveBeenCalledTimes(1);
    expect(mockCallable.mock.calls[0]?.[0]).toEqual({
      programId: 'p1',
      importId: 'i1',
      lessonIds: ['lesson-1'],
    });
    expect(bytes).toEqual({
      assetId: ASSET,
      dataUri: `data:image/webp;base64,${DATA}`,
      width: 1024,
      height: 768,
    });
  });

  /**
   * `absent` è un esito legittimo del server, ma non qui: siamo arrivati a
   * chiedere **perché** il LessonDoc dichiara un manifest. I due documenti
   * divergono e non si indovina quale abbia ragione.
   */
  it('rifiuta un absent quando il manifest esiste', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({
      data: { items: [{ lessonId: 'lesson-1', status: 'absent' }] },
    });
    expect(await teacherRead()).toBeNull();
  });

  it('rifiuta un assetId divergente dal manifest', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ data: { items: [present({ assetId: OTHER_ASSET })] } });
    expect(await teacherRead()).toBeNull();
  });

  it('rifiuta base64 non utilizzabile invece di mostrare un’immagine rotta', async () => {
    mockCallable.mockReset();
    mockCallable.mockResolvedValue({ data: { items: [present({ base64: 'Ukl!' })] } });
    expect(await teacherRead()).toBeNull();
  });

  it('rifiuta una risposta di forma sbagliata o su un’altra lezione', async () => {
    for (const items of [
      undefined,
      [],
      [present(), present()],
      [null],
      [present({ lessonId: 'x' })],
    ]) {
      mockCallable.mockReset();
      mockCallable.mockResolvedValue({ data: { items } });
      await expect(teacherRead()).rejects.toBeInstanceOf(VisualReadError);
    }
  });
});

describe('lettura studente — una getDoc puntuale', () => {
  const db = {} as Firestore;

  it('legge esattamente publicLessonVisuals/{publicLessonId}', async () => {
    mockGetDoc.mockReset();
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        publicLessonId: 'l1',
        programId: 'p1',
        importId: 'i1',
        assetId: ASSET,
        dataUri: `data:image/webp;base64,${DATA}`,
        width: 1024,
        height: 768,
      }),
    });

    const bytes = await readStudentVisualBytes({ db, publicLessonId: 'l1', manifest: MANIFEST });

    expect(mockGetDoc).toHaveBeenCalledTimes(1);
    expect(mockGetDoc.mock.calls[0]?.[0]).toEqual({ path: 'publicLessonVisuals/l1' });
    expect(bytes?.dataUri).toBe(`data:image/webp;base64,${DATA}`);
  });

  it('documento assente ⇒ nessuna figura, nessun errore', async () => {
    mockGetDoc.mockReset();
    mockGetDoc.mockResolvedValue({ exists: () => false });
    expect(
      await readStudentVisualBytes({ db, publicLessonId: 'l1', manifest: MANIFEST }),
    ).toBeNull();
  });

  it('documento divergente dal manifest ⇒ fail-closed', async () => {
    mockGetDoc.mockReset();
    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        publicLessonId: 'l1',
        programId: 'p1',
        importId: 'i1',
        assetId: OTHER_ASSET,
        dataUri: `data:image/webp;base64,${DATA}`,
        width: 1024,
        height: 768,
      }),
    });
    expect(
      await readStudentVisualBytes({ db, publicLessonId: 'l1', manifest: MANIFEST }),
    ).toBeNull();
  });
});

// ── Hook ───────────────────────────────────────────────────────────────────────

function Probe({
  request,
  load,
  onState,
}: {
  request: { assetId: string; lessonKey: string } | null;
  load: (r: { assetId: string; lessonKey: string }) => Promise<LessonVisualBytes | null>;
  onState: (state: LessonVisualState) => void;
}) {
  onState(useLessonVisual(request, load));
  return null;
}

const bytesFor = (assetId: string) => ({
  assetId,
  dataUri: `data:image/webp;base64,${DATA}`,
  width: 10,
  height: 10,
});

describe('useLessonVisual — cancellazione e memoria', () => {
  /** La garanzia di costo: senza manifest non parte nulla. */
  it('non legge nulla quando la lezione non ha immagine', () => {
    const load = vi.fn();
    const states: LessonVisualState[] = [];
    render(<Probe request={null} load={load} onState={(s) => states.push(s)} />);

    expect(load).not.toHaveBeenCalled();
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  it('legge una volta sola e memorizza per assetId', async () => {
    const load = vi.fn(async () => bytesFor(ASSET));
    const states: LessonVisualState[] = [];
    const request = { assetId: ASSET, lessonKey: 'lesson-1' };

    const { rerender } = render(
      <Probe request={request} load={load} onState={(s) => states.push(s)} />,
    );
    await waitFor(() => expect(states.at(-1)?.status).toBe('ready'));

    // Rimontare la stessa immagine non ricompra i byte.
    rerender(<Probe request={{ ...request }} load={load} onState={(s) => states.push(s)} />);
    await waitFor(() => expect(states.at(-1)?.status).toBe('ready'));
    expect(load).toHaveBeenCalledTimes(1);
  });

  /**
   * Il difetto classico: la risposta della lezione precedente arriva dopo il
   * cambio e sovrascrive quella corrente. Il numero di sequenza lo impedisce.
   */
  it('una risposta tardiva della lezione precedente non scrive nulla', async () => {
    let resolveFirst: (v: unknown) => void = () => {};
    const load = vi.fn((r: { assetId: string }) =>
      r.assetId === ASSET
        ? new Promise((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve(bytesFor(OTHER_ASSET)),
    );
    const states: LessonVisualState[] = [];

    const { rerender } = render(
      <Probe
        request={{ assetId: ASSET, lessonKey: 'lesson-1' }}
        load={load as never}
        onState={(s) => states.push(s)}
      />,
    );
    rerender(
      <Probe
        request={{ assetId: OTHER_ASSET, lessonKey: 'lesson-2' }}
        load={load as never}
        onState={(s) => states.push(s)}
      />,
    );
    await waitFor(() => expect(states.at(-1)?.status).toBe('ready'));

    // La prima lettura risolve **dopo** il cambio: deve essere ignorata.
    await act(async () => {
      resolveFirst(bytesFor(ASSET));
    });

    const last = states.at(-1);
    expect(last?.status).toBe('ready');
    if (last?.status === 'ready') expect(last.bytes.assetId).toBe(OTHER_ASSET);
  });

  it('lo smontaggio non produce setState tardivi', async () => {
    let resolveLoad: (v: unknown) => void = () => {};
    const load = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const states: LessonVisualState[] = [];
    const { unmount } = render(
      <Probe
        request={{ assetId: ASSET, lessonKey: 'lesson-1' }}
        load={load as never}
        onState={(s) => states.push(s)}
      />,
    );
    const before = states.length;
    unmount();

    await act(async () => {
      resolveLoad(bytesFor(ASSET));
    });
    expect(states.length).toBe(before);
  });

  it('una lettura rifiutata lascia la lezione senza figura', async () => {
    const load = vi.fn(async () => null);
    const states: LessonVisualState[] = [];
    render(
      <Probe
        request={{ assetId: ASSET, lessonKey: 'lesson-1' }}
        load={load}
        onState={(s) => states.push(s)}
      />,
    );
    await waitFor(() => expect(states.at(-1)).toEqual({ status: 'unavailable' }));
  });

  /** Nessun retry: un errore di rete non deve diventare un ciclo. */
  it('un errore non viene ritentato', async () => {
    const load = vi.fn(async () => {
      throw new Error('rete');
    });
    const states: LessonVisualState[] = [];
    render(
      <Probe
        request={{ assetId: ASSET, lessonKey: 'lesson-1' }}
        load={load as never}
        onState={(s) => states.push(s)}
      />,
    );
    await waitFor(() => expect(states.at(-1)).toEqual({ status: 'unavailable' }));
    expect(load).toHaveBeenCalledTimes(1);
  });
});
