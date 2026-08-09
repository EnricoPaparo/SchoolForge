import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockCollection = vi.fn();
const mockDoc = vi.fn();
const mockRunTransaction = vi.fn();
const mockTxGet = vi.fn();
const mockTxUpdate = vi.fn();
const mockTxSet = vi.fn();

vi.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  runTransaction: (...args: unknown[]) => mockRunTransaction(...args),
  serverTimestamp: () => '__serverTimestamp',
  // Sentinella riconoscibile: `deleteField()` non ha rappresentazione utile
  // fuori dall'SDK, e i test devono poter asserire «qui il campo viene rimosso».
  deleteField: () => ({ __delete: true }),
}));

import { saveLessonConceptMap, ConceptMapSaveError } from '../conceptMapService.js';
import { MAX_CONCEPT_MAP_BYTES } from '../conceptMapContract.js';
import type { Firestore } from 'firebase/firestore';

/**
 * CONCEPT-MAP-02 — il servizio di salvataggio. Le garanzie difese qui sono
 * tre: un unico commit senza stati parziali, il campo pubblico che esiste solo
 * su lezione svolta, e il testo persistito byte per byte identico a quello
 * ricevuto.
 */

const fakeDb = {} as Firestore;
const MAP = '## Ossatura della lezione\n\n- densità\n';

function pathStub(_root: unknown, ...segments: string[]) {
  return { __path: segments.join('/') };
}

function snap(data: Record<string, unknown> | null) {
  return { exists: () => data !== null, data: () => data };
}

const LESSON = { ownerUid: 'owner-1', importId: 'import-1', completed: false };
const PUBLIC = { ownerUid: 'owner-1', importId: 'import-1', programId: 'program-1' };

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` azzera le chiamate ma NON le code di
  // `mockResolvedValueOnce`: un test che fallisce prima di consumarle
  // le lascerebbe al test successivo.
  mockTxGet.mockReset();
  mockCollection.mockImplementation(pathStub);
  mockDoc.mockImplementation(pathStub);
  mockRunTransaction.mockImplementation(
    async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet }),
  );
});

function save(
  over: {
    lesson?: unknown;
    publicLesson?: unknown;
    conceptMapMarkdown?: unknown;
  } = {},
) {
  const lesson = 'lesson' in over ? over.lesson : LESSON;
  const publicLesson = 'publicLesson' in over ? over.publicLesson : PUBLIC;
  mockTxGet
    .mockResolvedValueOnce(snap(lesson as Record<string, unknown> | null))
    .mockResolvedValueOnce(snap(publicLesson as Record<string, unknown> | null));
  return saveLessonConceptMap({
    programId: 'program-1',
    importId: 'import-1',
    lessonId: 'lesson-1',
    publicLessonId: 'import-1_lesson-1',
    ownerUid: 'owner-1',
    conceptMapMarkdown: ('conceptMapMarkdown' in over ? over.conceptMapMarkdown : MAP) as string,
    db: fakeDb,
  });
}

describe('salvataggio su lezione non svolta', () => {
  it('scrive solo la copia privata e non tocca la proiezione', async () => {
    await save();

    expect(mockTxUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxUpdate).toHaveBeenCalledWith(
      { __path: 'programs/program-1/imports/import-1/lessons/lesson-1' },
      { conceptMapMarkdown: MAP },
    );
  });

  it('rimuove il campo pubblico se una proiezione lo conteneva già', async () => {
    // Non dovrebbe accadere, ma se accadesse il salvataggio è il momento giusto
    // per ripristinare l'invariante invece di lasciarlo rotto.
    await save({ publicLesson: { ...PUBLIC, conceptMapMarkdown: 'residuo' } });

    expect(mockTxUpdate).toHaveBeenCalledWith(
      { __path: 'publicLessons/import-1_lesson-1' },
      { conceptMapMarkdown: { __delete: true } },
    );
  });
});

describe('salvataggio su lezione svolta', () => {
  it('scrive privata e pubblica nello stesso commit', async () => {
    await save({ lesson: { ...LESSON, completed: true } });

    expect(mockRunTransaction).toHaveBeenCalledOnce();
    expect(mockTxUpdate).toHaveBeenCalledWith(
      { __path: 'programs/program-1/imports/import-1/lessons/lesson-1' },
      { conceptMapMarkdown: MAP },
    );
    expect(mockTxUpdate).toHaveBeenCalledWith(
      { __path: 'publicLessons/import-1_lesson-1' },
      { conceptMapMarkdown: MAP },
    );
  });
});

describe('validazione dell’input', () => {
  it.each([
    ['vuota', ''],
    ['di soli spazi', '   \n '],
    ['non stringa', 42],
    ['oltre il cap', 'x'.repeat(MAX_CONCEPT_MAP_BYTES + 1)],
  ])('rifiuta una mappa %s senza leggere né scrivere', async (_label, value) => {
    await expect(save({ conceptMapMarkdown: value })).rejects.toThrow();
    // Zero operazioni, non solo zero scritture: la validazione precede la
    // transazione, quindi non costa nemmeno le due letture.
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(mockTxGet).not.toHaveBeenCalled();
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });
});

describe('coerenza fail-closed', () => {
  it('rifiuta una lezione inesistente', async () => {
    await expect(save({ lesson: null })).rejects.toThrow(ConceptMapSaveError);
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });

  it('rifiuta una proiezione inesistente', async () => {
    await expect(save({ publicLesson: null })).rejects.toThrow(/proiezione .* non esiste/);
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('rifiuta un owner diverso su uno qualunque dei due documenti', async () => {
    await expect(save({ lesson: { ...LESSON, ownerUid: 'altro' } })).rejects.toThrow(
      /non appartiene a questo utente/,
    );
    vi.clearAllMocks();
    mockDoc.mockImplementation(pathStub);
    mockCollection.mockImplementation(pathStub);
    mockRunTransaction.mockImplementation(
      async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) =>
        fn({ get: mockTxGet, update: mockTxUpdate, set: mockTxSet }),
    );
    await expect(save({ publicLesson: { ...PUBLIC, ownerUid: 'altro' } })).rejects.toThrow(
      /non appartiene a questo utente/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('rifiuta un import incoerente', async () => {
    await expect(save({ lesson: { ...LESSON, importId: 'import-2' } })).rejects.toThrow(
      /non appartiene a questa importazione/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('rifiuta una proiezione di un altro corso', async () => {
    // Difende dal `publicLessonId` sbagliato: senza questo controllo la mappa
    // di una lezione finirebbe sulla proiezione di un'altra.
    await expect(save({ publicLesson: { ...PUBLIC, programId: 'program-2' } })).rejects.toThrow(
      /non appartiene a questo corso/,
    );
    expect(mockTxUpdate).not.toHaveBeenCalled();
  });

  it('propaga l’errore della transazione senza stato parziale', async () => {
    mockRunTransaction.mockRejectedValueOnce(new Error('transazione fallita'));
    await expect(save()).rejects.toThrow('transazione fallita');
    expect(mockTxUpdate).not.toHaveBeenCalled();
    expect(mockTxSet).not.toHaveBeenCalled();
  });
});

describe('audit e fedeltà del testo', () => {
  it('registra l’audit nello stesso commit', async () => {
    await save({ lesson: { ...LESSON, completed: true } });

    expect(mockTxSet).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        actorUid: 'owner-1',
        action: 'lesson.conceptMapSaved',
        targetId: 'lesson-1',
        outcome: 'success',
      }),
    );
  });

  it('persiste il testo byte per byte, senza normalizzazioni', async () => {
    const quirky = '## Ossatura\n\n-  voce   con    spazi\n\n\n- altra voce';
    await save({ lesson: { ...LESSON, completed: true }, conceptMapMarkdown: quirky });

    const privateWrite = mockTxUpdate.mock.calls.find((call) =>
      (call[0] as { __path: string }).__path.includes('/lessons/'),
    );
    const publicWrite = mockTxUpdate.mock.calls.find((call) =>
      (call[0] as { __path: string }).__path.startsWith('publicLessons/'),
    );
    expect((privateWrite?.[1] as { conceptMapMarkdown: string }).conceptMapMarkdown).toBe(quirky);
    expect((publicWrite?.[1] as { conceptMapMarkdown: string }).conceptMapMarkdown).toBe(quirky);
  });
});
