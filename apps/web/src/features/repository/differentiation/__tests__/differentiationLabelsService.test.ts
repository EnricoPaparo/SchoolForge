import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

/**
 * VDIF-01 — test del service canonico.
 *
 * La transazione è simulata con un piccolo store in memoria che riproduce le
 * due proprietà di Firestore che contano qui:
 *
 * 1. `transaction.get` registra il documento letto, **anche se assente**;
 * 2. tutte le letture di un tentativo vedono lo **stesso istante**: una
 *    modifica concorrente non compare a metà callback;
 * 3. il commit fallisce se un documento letto è cambiato nel frattempo, e il
 *    callback viene rieseguito da capo.
 *
 * Senza la (1) le corse sulla creazione dello stesso nome non sarebbero
 * verificabili — ed è la garanzia su cui poggia l'unicità. Senza la (2) il
 * callback prenderebbe decisioni su uno stato misto, che in Firestore non può
 * accadere, e i test dimostrerebbero un comportamento che il codice reale non
 * ha.
 */

type Store = Map<string, Record<string, unknown>>;

const store: Store = new Map();
/** Mutazione applicata da "un'altra scheda" alla prima lettura di un path. */
let concurrentMutation: { path: string; apply: () => void; fired: boolean } | null = null;
let commitAttempts = 0;

function pathOf(ref: { path: string }): string {
  return ref.path;
}

let autoId = 0;
const mockDoc = vi.fn((first: unknown, ...segments: string[]) => {
  // `doc(collectionRef)` — nuovo documento con id generato (è così che il
  // service crea l'evento di audit dentro la transazione).
  if (typeof first === 'object' && first !== null && '__collection' in first) {
    return { path: `${(first as { __collection: string }).__collection}/auto-${++autoId}` };
  }
  return { path: segments.join('/') };
});
const mockCollection = vi.fn((_db: unknown, name: string) => ({ path: name, __collection: name }));
const mockQuery = vi.fn((coll: unknown, ...constraints: unknown[]) => ({ coll, constraints }));
const mockWhere = vi.fn((field: string, op: string, value: unknown) => ({ field, op, value }));
const mockServerTimestamp = vi.fn(() => ({ __serverTimestamp: true }));
const mockGetDocs = vi.fn();

const mockRunTransaction = vi.fn(
  async (_db: unknown, updateFn: (t: unknown) => Promise<unknown>) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      commitAttempts += 1;
      const readVersions = new Map<string, string>();
      const writes: { type: 'set' | 'update' | 'delete'; path: string; data?: unknown }[] = [];
      // Istante di lettura del tentativo: tutte le get vedono questo stato,
      // qualunque cosa accada nel frattempo su `store`.
      const readSnapshot = new Map(store);

      const transaction = {
        get: async (ref: { path: string }) => {
          const path = pathOf(ref);
          const data = readSnapshot.get(path);
          readVersions.set(path, JSON.stringify(data ?? null));
          // La modifica concorrente colpisce lo store reale: si manifesterà solo
          // al commit, come conflitto, non a metà callback.
          if (concurrentMutation && !concurrentMutation.fired && concurrentMutation.path === path) {
            concurrentMutation.fired = true;
            concurrentMutation.apply();
          }
          return {
            exists: () => data !== undefined,
            data: () => data,
          };
        },
        set: (ref: { path: string }, data: unknown) => {
          writes.push({ type: 'set', path: pathOf(ref), data });
        },
        update: (ref: { path: string }, data: unknown) => {
          writes.push({ type: 'update', path: pathOf(ref), data });
        },
        delete: (ref: { path: string }) => {
          writes.push({ type: 'delete', path: pathOf(ref) });
        },
      };

      const result = await updateFn(transaction);

      // Conflitto: un documento letto è cambiato dopo la lettura.
      const stale = [...readVersions.entries()].some(
        ([path, version]) => JSON.stringify(store.get(path) ?? null) !== version,
      );
      if (stale) continue;

      for (const write of writes) {
        if (write.type === 'delete') store.delete(write.path);
        else if (write.type === 'set') store.set(write.path, write.data as Record<string, unknown>);
        else
          store.set(write.path, {
            ...(store.get(write.path) ?? {}),
            ...(write.data as Record<string, unknown>),
          });
      }
      return result;
    }
    throw new Error('Transazione non riuscita dopo troppi tentativi.');
  },
);

vi.mock('firebase/firestore', () => ({
  collection: (db: unknown, name: string) => mockCollection(db, name),
  doc: (first: unknown, ...segments: string[]) => mockDoc(first, ...segments),
  getDocs: (built: unknown) => mockGetDocs(built),
  query: (coll: unknown, ...constraints: unknown[]) => mockQuery(coll, ...constraints),
  runTransaction: (db: unknown, updateFn: (t: unknown) => Promise<unknown>) =>
    mockRunTransaction(db, updateFn),
  serverTimestamp: () => mockServerTimestamp(),
  where: (field: string, op: string, value: unknown) => mockWhere(field, op, value),
}));

import {
  DifferentiationLabelError,
  createDifferentiationLabel,
  deleteDifferentiationLabel,
  describeUsage,
  listDifferentiationLabels,
  parseDifferentiationLabel,
  renameDifferentiationLabel,
} from '../differentiationLabelsService.js';
import {
  computeNameKey,
  countCodePoints,
  countUtf8Bytes,
  normalizeLabelName,
} from '../labelName.js';
import { computeLabelReservationId } from '../labelReservationId.js';
import type { Firestore } from 'firebase/firestore';

const fakeDb = {} as Firestore;
const OWNER_UID = 'owner-uid';
const OTHER_UID = 'other-uid';

/**
 * Timestamp con la forma che il client SDK restituisce in lettura: il parser lo
 * riconosce dalla struttura, non da `instanceof`, quindi qui basta riprodurla.
 * Un sentinel `serverTimestamp()` non risolto **non** deve passare, ed è
 * verificato da un test dedicato.
 */
function ts(millis: number) {
  return {
    seconds: Math.floor(millis / 1000),
    nanoseconds: (millis % 1000) * 1e6,
    toMillis: () => millis,
  };
}

const CREATED_AT = ts(1_760_000_000_000);
const UPDATED_AT = ts(1_760_000_500_000);

function validLabel(over: Record<string, unknown> = {}) {
  return {
    labelId: 'label-1',
    ownerUid: OWNER_UID,
    name: 'Percorso A',
    nameKey: 'percorso a',
    assignedCount: 0,
    draftUsageCount: 0,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...over,
  };
}

async function seedLabel(over: Record<string, unknown> = {}) {
  const label = validLabel(over);
  store.set(`differentiationLabels/${label.labelId}`, label);
  const reservationId = await computeLabelReservationId(OWNER_UID, label.nameKey as string);
  store.set(`differentiationLabelNames/${reservationId}`, {
    ownerUid: OWNER_UID,
    labelId: label.labelId,
    nameKey: label.nameKey,
    createdAt: CREATED_AT,
  });
  return { label, reservationId };
}

function auditWrites() {
  return [...store.keys()].filter((key) => key.startsWith('auditEvents/'));
}

function labelDocs() {
  return [...store.keys()].filter((key) => key.startsWith('differentiationLabels/'));
}

function reservationDocs() {
  return [...store.keys()].filter((key) => key.startsWith('differentiationLabelNames/'));
}

beforeEach(() => {
  vi.clearAllMocks();
  store.clear();
  concurrentMutation = null;
  commitAttempts = 0;
  // `randomUUID` deterministico per poter asserire sugli id creati. Lo spread
  // di `globalThis.crypto` NON funziona (le proprietà stanno sul prototipo e
  // `subtle` andrebbe persa): la si riporta esplicitamente, così l'hash reale
  // resta quello di Web Crypto e non una finzione.
  let counter = 0;
  const realCrypto = globalThis.crypto;
  vi.stubGlobal('crypto', {
    subtle: realCrypto.subtle,
    getRandomValues: (array: Uint8Array) => realCrypto.getRandomValues(array),
    randomUUID: () => `label-new-${++counter}`,
  });
});

describe('parseDifferentiationLabel — fail-closed', () => {
  it('accetta la forma esatta a otto chiavi', () => {
    const parsed = parseDifferentiationLabel('label-1', validLabel(), OWNER_UID);
    expect(parsed.name).toBe('Percorso A');
    expect(parsed.assignedCount).toBe(0);
    expect(parsed.draftUsageCount).toBe(0);
  });

  it('rifiuta una chiave in più', () => {
    expect(() =>
      parseDifferentiationLabel('label-1', validLabel({ color: 'rosso' }), OWNER_UID),
    ).toThrow(DifferentiationLabelError);
  });

  it('rifiuta una chiave mancante', () => {
    const partial = validLabel();
    delete (partial as Record<string, unknown>).draftUsageCount;
    expect(() => parseDifferentiationLabel('label-1', partial, OWNER_UID)).toThrow(
      DifferentiationLabelError,
    );
  });

  it('rifiuta identità incoerente fra campo e path', () => {
    expect(() => parseDifferentiationLabel('label-2', validLabel(), OWNER_UID)).toThrow(
      /identità incoerente/,
    );
  });

  it('rifiuta un documento di un altro owner', () => {
    expect(() =>
      parseDifferentiationLabel('label-1', validLabel({ ownerUid: OTHER_UID }), OWNER_UID),
    ).toThrow(/proprietario incoerente/);
  });

  it('rifiuta contatori non interi, negativi o non numerici', () => {
    for (const bad of [-1, 1.5, Number.NaN, '0', null, undefined]) {
      expect(() =>
        parseDifferentiationLabel('label-1', validLabel({ assignedCount: bad }), OWNER_UID),
      ).toThrow(DifferentiationLabelError);
      expect(() =>
        parseDifferentiationLabel('label-1', validLabel({ draftUsageCount: bad }), OWNER_UID),
      ).toThrow(DifferentiationLabelError);
    }
  });

  // ── Canonicità del nome ────────────────────────────────────────────────
  // Un documento con spazi non canonici o un `nameKey` estraneo non è
  // «leggermente sporco»: la sua prenotazione è derivata da un `nameKey`
  // diverso e quindi punta a un altro documento. Va rifiutato, non ripulito.

  it('rifiuta un nome con spazi esterni', () => {
    expect(() =>
      parseDifferentiationLabel(
        'label-1',
        validLabel({ name: ' Percorso A ', nameKey: 'percorso a' }),
        OWNER_UID,
      ),
    ).toThrow(/forma canonica/);
  });

  it('rifiuta un nome con spazi interni non canonici', () => {
    expect(() =>
      parseDifferentiationLabel(
        'label-1',
        validLabel({ name: 'Percorso  A', nameKey: 'percorso  a' }),
        OWNER_UID,
      ),
    ).toThrow(/forma canonica/);
  });

  it('rifiuta un nome con caratteri di controllo', () => {
    expect(() =>
      parseDifferentiationLabel(
        'label-1',
        validLabel({ name: 'Percorso\u0000A', nameKey: 'percorso\u0000a' }),
        OWNER_UID,
      ),
    ).toThrow(/non valido/);
  });

  it('rifiuta un nome oltre i 40 code point', () => {
    const long = 'a'.repeat(41);
    expect(() =>
      parseDifferentiationLabel('label-1', validLabel({ name: long, nameKey: long }), OWNER_UID),
    ).toThrow(/non valido/);
  });

  it('rifiuta un nome oltre i 120 byte pur restando entro i code point', () => {
    // 31 emoji = 31 code point (entro il limite) ma 124 byte (oltre).
    const heavy = '🎯'.repeat(31);
    expect(countCodePoints(heavy)).toBeLessThanOrEqual(40);
    expect(countUtf8Bytes(heavy)).toBeGreaterThan(120);
    expect(() =>
      parseDifferentiationLabel('label-1', validLabel({ name: heavy, nameKey: heavy }), OWNER_UID),
    ).toThrow(/non valido/);
  });

  it('rifiuta un nameKey non derivato dal nome', () => {
    expect(() =>
      parseDifferentiationLabel('label-1', validLabel({ nameKey: 'chiave-estranea' }), OWNER_UID),
    ).toThrow(/non derivata dal nome/);
  });

  // ── Timestamp ──────────────────────────────────────────────────────────

  it('rifiuta timestamp assenti', () => {
    expect(() =>
      parseDifferentiationLabel('label-1', validLabel({ createdAt: null }), OWNER_UID),
    ).toThrow(/date mancanti/);
    expect(() =>
      parseDifferentiationLabel('label-1', validLabel({ updatedAt: undefined }), OWNER_UID),
    ).toThrow(DifferentiationLabelError);
  });

  it('rifiuta timestamp non validi, sentinel non risolti inclusi', () => {
    for (const bad of [
      'ieri',
      1_760_000_000_000,
      new Date('2026-08-01'),
      { __serverTimestamp: true },
      { seconds: 'x', nanoseconds: 0, toMillis: () => 0 },
    ]) {
      expect(() =>
        parseDifferentiationLabel('label-1', validLabel({ createdAt: bad }), OWNER_UID),
      ).toThrow(/date mancanti/);
    }
  });

  it('rifiuta updatedAt precedente a createdAt', () => {
    expect(() =>
      parseDifferentiationLabel(
        'label-1',
        validLabel({ createdAt: ts(2000), updatedAt: ts(1000) }),
        OWNER_UID,
      ),
    ).toThrow(/date incoerenti/);
  });

  it('accetta updatedAt uguale a createdAt (documento appena creato)', () => {
    const same = ts(1000);
    expect(
      parseDifferentiationLabel(
        'label-1',
        validLabel({ createdAt: same, updatedAt: same }),
        OWNER_UID,
      ).name,
    ).toBe('Percorso A');
  });
});

describe('listDifferentiationLabels', () => {
  it('usa una sola query filtrata su ownerUid e ordina per nameKey', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        {
          id: 'label-2',
          data: () => validLabel({ labelId: 'label-2', name: 'Zeta', nameKey: 'zeta' }),
        },
        {
          id: 'label-1',
          data: () => validLabel({ labelId: 'label-1', name: 'Alfa', nameKey: 'alfa' }),
        },
      ],
    });

    const result = await listDifferentiationLabels(OWNER_UID, fakeDb);

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockWhere).toHaveBeenCalledWith('ownerUid', '==', OWNER_UID);
    expect(result.map((item) => item.name)).toEqual(['Alfa', 'Zeta']);
  });

  it('un documento malformato fa fallire l’intera lista, mai una lista parziale', async () => {
    mockGetDocs.mockResolvedValue({
      docs: [
        { id: 'label-1', data: () => validLabel() },
        { id: 'label-2', data: () => validLabel({ labelId: 'label-2', assignedCount: -3 }) },
      ],
    });

    await expect(listDifferentiationLabels(OWNER_UID, fakeDb)).rejects.toBeInstanceOf(
      DifferentiationLabelError,
    );
  });
});

describe('createDifferentiationLabel', () => {
  it('crea etichetta, prenotazione e audit in un solo commit', async () => {
    const created = await createDifferentiationLabel('  Percorso   A ', OWNER_UID, fakeDb);

    expect(created.name).toBe('Percorso A');
    expect(created.nameKey).toBe('percorso a');
    expect(created.assignedCount).toBe(0);
    expect(created.draftUsageCount).toBe(0);

    expect(labelDocs()).toHaveLength(1);
    expect(reservationDocs()).toHaveLength(1);
    expect(auditWrites()).toHaveLength(1);
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);

    const label = store.get(labelDocs()[0]!)!;
    expect(Object.keys(label).sort()).toEqual([
      'assignedCount',
      'createdAt',
      'draftUsageCount',
      'labelId',
      'name',
      'nameKey',
      'ownerUid',
      'updatedAt',
    ]);
    const reservation = store.get(reservationDocs()[0]!)!;
    expect(Object.keys(reservation).sort()).toEqual([
      'createdAt',
      'labelId',
      'nameKey',
      'ownerUid',
    ]);
    expect(store.get(auditWrites()[0]!)).toMatchObject({
      action: 'label.created',
      actorUid: OWNER_UID,
      reason: null,
      outcome: 'success',
    });
  });

  it('rifiuta un nome non valido prima di qualunque operazione', async () => {
    await expect(createDifferentiationLabel('   ', OWNER_UID, fakeDb)).rejects.toThrow(
      /Indica un nome/,
    );
    expect(mockRunTransaction).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });

  it('rifiuta un duplicato semantico senza scrivere nulla', async () => {
    await seedLabel();

    await expect(
      createDifferentiationLabel('  PERCORSO   a ', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'duplicate_name' });

    expect(labelDocs()).toHaveLength(1);
    expect(reservationDocs()).toHaveLength(1);
    expect(auditWrites()).toHaveLength(0);
  });

  it('due creazioni concorrenti dello stesso nome: una sola riesce', async () => {
    const nameKey = computeNameKey(normalizeLabelName('Percorso A'));
    const reservationId = await computeLabelReservationId(OWNER_UID, nameKey);

    // Alla prima lettura della prenotazione, "l'altra scheda" la crea.
    concurrentMutation = {
      path: `differentiationLabelNames/${reservationId}`,
      fired: false,
      apply: () => {
        store.set(`differentiationLabelNames/${reservationId}`, {
          ownerUid: OWNER_UID,
          labelId: 'label-altra-scheda',
          nameKey,
          createdAt: CREATED_AT,
        });
        store.set(
          'differentiationLabels/label-altra-scheda',
          validLabel({ labelId: 'label-altra-scheda' }),
        );
      },
    };

    await expect(createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'duplicate_name',
      },
    );

    // La transazione è stata ritentata (il documento letto era cambiato) e al
    // secondo giro ha visto la prenotazione altrui.
    expect(commitAttempts).toBeGreaterThan(1);
    expect(labelDocs()).toEqual(['differentiationLabels/label-altra-scheda']);
    expect(auditWrites()).toHaveLength(0);
  });

  it('nomi diversi non si ostacolano', async () => {
    await createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb);
    await createDifferentiationLabel('Obiettivi essenziali', OWNER_UID, fakeDb);
    expect(labelDocs()).toHaveLength(2);
    expect(reservationDocs()).toHaveLength(2);
  });
});

/**
 * Il replay va **dimostrato**, non dedotto dalla sola presenza della
 * prenotazione: una prenotazione con il nostro `labelId` prova soltanto che
 * qualcuno l'ha scritta, non che il commit sia arrivato in fondo.
 */
describe('createDifferentiationLabel — replay', () => {
  /** Prepara lo stato «commit precedente riuscito» con il labelId che il mock genererà. */
  async function seedReplayState(labelOver: Record<string, unknown> = {}) {
    const labelId = 'label-new-1'; // primo id prodotto dal randomUUID deterministico
    const nameKey = 'percorso a';
    const reservationId = await computeLabelReservationId(OWNER_UID, nameKey);
    store.set(`differentiationLabelNames/${reservationId}`, {
      ownerUid: OWNER_UID,
      labelId,
      nameKey,
      createdAt: CREATED_AT,
    });
    if (labelOver !== null) {
      store.set(`differentiationLabels/${labelId}`, validLabel({ labelId, ...labelOver }));
    }
    return { labelId, reservationId };
  }

  it('prenotazione nostra + etichetta coerente ⇒ replay senza scritture né secondo audit', async () => {
    const { labelId } = await seedReplayState();
    const before = new Map(store);

    const result = await createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb);

    expect(result.labelId).toBe(labelId);
    expect(result.name).toBe('Percorso A');
    expect(auditWrites()).toHaveLength(0);
    expect(store.size).toBe(before.size);
  });

  it('prenotazione nostra senza etichetta ⇒ corrupted_state', async () => {
    const labelId = 'label-new-1';
    const reservationId = await computeLabelReservationId(OWNER_UID, 'percorso a');
    store.set(`differentiationLabelNames/${reservationId}`, {
      ownerUid: OWNER_UID,
      labelId,
      nameKey: 'percorso a',
      createdAt: CREATED_AT,
    });

    await expect(createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'corrupted_state',
      },
    );
    expect(labelDocs()).toHaveLength(0);
    expect(auditWrites()).toHaveLength(0);
  });

  it('etichetta malformata ⇒ corrupted_state', async () => {
    await seedReplayState({ assignedCount: 'zero' });

    await expect(createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'corrupted_state',
      },
    );
    expect(auditWrites()).toHaveLength(0);
  });

  it('nome divergente sull’etichetta esistente ⇒ corrupted_state', async () => {
    // Documento internamente coerente, ma non è quello che questa creazione
    // avrebbe prodotto: la prenotazione dice «percorso a», l'etichetta no.
    await seedReplayState({ name: 'Gruppo 2', nameKey: 'gruppo 2' });

    await expect(createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'corrupted_state',
      },
    );
    expect(auditWrites()).toHaveLength(0);
  });

  it('contatore già positivo ⇒ corrupted_state', async () => {
    await seedReplayState({ assignedCount: 1 });

    await expect(createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'corrupted_state',
      },
    );
    expect(auditWrites()).toHaveLength(0);
  });

  it('prenotazione con chiavi extra ⇒ corrupted_state', async () => {
    const { reservationId } = await seedReplayState();
    store.set(`differentiationLabelNames/${reservationId}`, {
      ...(store.get(`differentiationLabelNames/${reservationId}`) as Record<string, unknown>),
      note: 'estranea',
    });

    await expect(createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'corrupted_state',
      },
    );
    expect(auditWrites()).toHaveLength(0);
  });

  it('prenotazione senza createdAt valido ⇒ corrupted_state', async () => {
    const { reservationId } = await seedReplayState();
    store.set(`differentiationLabelNames/${reservationId}`, {
      ownerUid: OWNER_UID,
      labelId: 'label-new-1',
      nameKey: 'percorso a',
      createdAt: 'ieri',
    });

    await expect(createDifferentiationLabel('Percorso A', OWNER_UID, fakeDb)).rejects.toMatchObject(
      {
        code: 'corrupted_state',
      },
    );
    expect(auditWrites()).toHaveLength(0);
  });
});

describe('renameDifferentiationLabel', () => {
  it('cambia nome e nameKey, sposta la prenotazione, conserva identità e contatori', async () => {
    const { label, reservationId } = await seedLabel({ assignedCount: 2, draftUsageCount: 1 });

    const renamed = await renameDifferentiationLabel(
      label.labelId,
      'Obiettivi essenziali',
      OWNER_UID,
      fakeDb,
    );

    expect(renamed.labelId).toBe(label.labelId);
    expect(renamed.name).toBe('Obiettivi essenziali');
    expect(renamed.nameKey).toBe('obiettivi essenziali');
    expect(renamed.assignedCount).toBe(2);
    expect(renamed.draftUsageCount).toBe(1);

    const stored = store.get(`differentiationLabels/${label.labelId}`)!;
    expect(stored.labelId).toBe(label.labelId);
    expect(stored.ownerUid).toBe(OWNER_UID);
    expect(stored.assignedCount).toBe(2);
    expect(stored.draftUsageCount).toBe(1);

    // Vecchia prenotazione rilasciata, nuova creata, nello stesso commit.
    const nextReservationId = await computeLabelReservationId(OWNER_UID, 'obiettivi essenziali');
    expect(store.has(`differentiationLabelNames/${reservationId}`)).toBe(false);
    expect(store.has(`differentiationLabelNames/${nextReservationId}`)).toBe(true);
    expect(auditWrites()).toHaveLength(1);
    expect(store.get(auditWrites()[0]!)).toMatchObject({ action: 'label.updated' });
  });

  it('nome semanticamente invariato: no-op, zero scritture', async () => {
    const { label } = await seedLabel();
    const before = new Map(store);

    const result = await renameDifferentiationLabel(
      label.labelId,
      '  PERCORSO   a  ',
      OWNER_UID,
      fakeDb,
    );

    // Stesso nameKey ma forma canonica diversa ⇒ aggiorna solo `name`.
    expect(result.nameKey).toBe('percorso a');
    expect(result.name).toBe('PERCORSO a');
    expect(reservationDocs()).toHaveLength(1);
    expect(before.size + 1).toBe(store.size); // solo l'audit in più
  });

  it('nome identico anche nella forma: nessuna scrittura, nemmeno l’audit', async () => {
    const { label } = await seedLabel();
    await renameDifferentiationLabel(label.labelId, 'Percorso A', OWNER_UID, fakeDb);
    expect(auditWrites()).toHaveLength(0);
  });

  it('rifiuta se il nuovo nome è già di un’altra etichetta', async () => {
    const { label } = await seedLabel();
    await seedLabel({ labelId: 'label-2', name: 'Gruppo 2', nameKey: 'gruppo 2' });

    await expect(
      renameDifferentiationLabel(label.labelId, 'Gruppo 2', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'duplicate_name' });
    expect(auditWrites()).toHaveLength(0);
    expect(store.get(`differentiationLabels/${label.labelId}`)!.name).toBe('Percorso A');
  });

  it('fail-closed se la prenotazione corrente manca', async () => {
    store.set('differentiationLabels/label-1', validLabel());

    await expect(
      renameDifferentiationLabel('label-1', 'Gruppo 2', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
    expect(auditWrites()).toHaveLength(0);
  });

  it('fail-closed se la prenotazione corrente appartiene a un’altra etichetta', async () => {
    const { label, reservationId } = await seedLabel();
    store.set(`differentiationLabelNames/${reservationId}`, {
      ownerUid: OWNER_UID,
      labelId: 'label-diversa',
      nameKey: label.nameKey,
      createdAt: CREATED_AT,
    });

    await expect(
      renameDifferentiationLabel(label.labelId, 'Gruppo 2', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'corrupted_state' });
    expect(auditWrites()).toHaveLength(0);
  });

  it('rifiuta se l’etichetta non esiste più', async () => {
    await expect(
      renameDifferentiationLabel('label-assente', 'Gruppo 2', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });

  it('stato parziale (nuova prenotazione nostra ma etichetta non rinominata) ⇒ corrupted_state', async () => {
    // Non è il replay di una rinomina riuscita: una rinomina valida è atomica e
    // avrebbe già aggiornato l'etichetta e rilasciato la vecchia prenotazione.
    const { label } = await seedLabel();
    const nextReservationId = await computeLabelReservationId(OWNER_UID, 'gruppo 2');
    store.set(`differentiationLabelNames/${nextReservationId}`, {
      ownerUid: OWNER_UID,
      labelId: label.labelId,
      nameKey: 'gruppo 2',
      createdAt: CREATED_AT,
    });
    const before = new Map(store);

    await expect(
      renameDifferentiationLabel(label.labelId, 'Gruppo 2', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'corrupted_state' });

    // Zero scritture: l'etichetta conserva il vecchio nome e nessuna
    // prenotazione viene toccata.
    expect(store.size).toBe(before.size);
    expect(store.get(`differentiationLabels/${label.labelId}`)!.name).toBe('Percorso A');
    expect(auditWrites()).toHaveLength(0);
  });

  it('il replay di una rinomina già committata è un no-op, non uno stato parziale', async () => {
    // Rinomina già avvenuta: l'etichetta porta il nuovo nameKey e possiede la
    // prenotazione corrispondente. Ripetere la stessa richiesta non scrive.
    const { label } = await seedLabel({ name: 'Gruppo 2', nameKey: 'gruppo 2' });
    const before = new Map(store);

    const result = await renameDifferentiationLabel(label.labelId, 'Gruppo 2', OWNER_UID, fakeDb);

    expect(result.name).toBe('Gruppo 2');
    expect(store.size).toBe(before.size);
    expect(auditWrites()).toHaveLength(0);
  });

  it('rinomina contro eliminazione: l’eliminazione vince, la rinomina fallisce', async () => {
    const { label, reservationId } = await seedLabel();
    concurrentMutation = {
      path: `differentiationLabels/${label.labelId}`,
      fired: false,
      apply: () => {
        store.delete(`differentiationLabels/${label.labelId}`);
        store.delete(`differentiationLabelNames/${reservationId}`);
      },
    };

    await expect(
      renameDifferentiationLabel(label.labelId, 'Gruppo 2', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_not_found' });
    expect(auditWrites()).toHaveLength(0);
  });
});

describe('deleteDifferentiationLabel', () => {
  it('elimina etichetta, prenotazione e scrive audit in un solo commit', async () => {
    const { label, reservationId } = await seedLabel();

    await deleteDifferentiationLabel(label.labelId, OWNER_UID, fakeDb);

    expect(store.has(`differentiationLabels/${label.labelId}`)).toBe(false);
    expect(store.has(`differentiationLabelNames/${reservationId}`)).toBe(false);
    expect(auditWrites()).toHaveLength(1);
    expect(store.get(auditWrites()[0]!)).toMatchObject({
      action: 'label.deleted',
      targetId: label.labelId,
      reason: null,
    });
  });

  it('rifiuta con assignedCount positivo, senza scrivere nulla', async () => {
    const { label } = await seedLabel({ assignedCount: 3 });

    await expect(
      deleteDifferentiationLabel(label.labelId, OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_in_use' });

    expect(store.has(`differentiationLabels/${label.labelId}`)).toBe(true);
    expect(auditWrites()).toHaveLength(0);
  });

  it('rifiuta con draftUsageCount positivo, senza scrivere nulla', async () => {
    const { label } = await seedLabel({ draftUsageCount: 1 });

    await expect(
      deleteDifferentiationLabel(label.labelId, OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_in_use' });

    expect(store.has(`differentiationLabels/${label.labelId}`)).toBe(true);
    expect(auditWrites()).toHaveLength(0);
  });

  it('un contatore che diventa positivo durante l’eliminazione la fa fallire', async () => {
    const { label } = await seedLabel();
    concurrentMutation = {
      path: `differentiationLabels/${label.labelId}`,
      fired: false,
      apply: () => {
        store.set(
          `differentiationLabels/${label.labelId}`,
          validLabel({ labelId: label.labelId, draftUsageCount: 1 }),
        );
      },
    };

    await expect(
      deleteDifferentiationLabel(label.labelId, OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_in_use' });

    expect(commitAttempts).toBeGreaterThan(1);
    expect(store.has(`differentiationLabels/${label.labelId}`)).toBe(true);
    expect(auditWrites()).toHaveLength(0);
  });

  it('fail-closed se la prenotazione manca', async () => {
    store.set('differentiationLabels/label-1', validLabel());

    await expect(deleteDifferentiationLabel('label-1', OWNER_UID, fakeDb)).rejects.toMatchObject({
      code: 'corrupted_state',
    });
    expect(store.has('differentiationLabels/label-1')).toBe(true);
    expect(auditWrites()).toHaveLength(0);
  });

  it('rifiuta un documento di un altro owner senza scrivere', async () => {
    store.set('differentiationLabels/label-1', validLabel({ ownerUid: OTHER_UID }));

    await expect(deleteDifferentiationLabel('label-1', OWNER_UID, fakeDb)).rejects.toMatchObject({
      code: 'corrupted_state',
    });
    expect(auditWrites()).toHaveLength(0);
  });

  it('rifiuta se l’etichetta non esiste più', async () => {
    await expect(
      deleteDifferentiationLabel('label-assente', OWNER_UID, fakeDb),
    ).rejects.toMatchObject({ code: 'label_not_found' });
  });
});

describe('describeUsage', () => {
  it('nomina entrambi gli utilizzi', () => {
    const text = describeUsage({ name: 'Percorso A', assignedCount: 2, draftUsageCount: 1 });
    expect(text).toContain('2 studenti');
    expect(text).toContain('1 bozza');
  });

  it('usa il singolare quando serve', () => {
    const text = describeUsage({ name: 'Percorso A', assignedCount: 1, draftUsageCount: 0 });
    expect(text).toContain('1 studente');
    expect(text).not.toContain('bozza');
  });

  it('stringa vuota se non è in uso', () => {
    expect(describeUsage({ name: 'x', assignedCount: 0, draftUsageCount: 0 })).toBe('');
  });
});
