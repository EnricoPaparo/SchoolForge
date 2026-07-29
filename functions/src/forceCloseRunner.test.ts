import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import { runForceCloseTask, runScheduleForceClose } from './forceCloseRunner.js';
import { ForceCloseError } from './forceCloseCore.js';

/**
 * FORCE-SUBMIT-02 — il runner è esercitato su una Firestore **finta** in
 * memoria: si contano davvero le scritture, le task accodate e le letture, così
 * «zero write» e «una sola task» sono asserzioni, non buone intenzioni.
 */

const OWNER = 'owner-uid';
const VERIFICATION = 'ver-1';
const TITLE = 'Verifica Reti';
const CLASS_NAME = 'Classe 3A';

type Doc = Record<string, unknown>;

class FakeDb {
  docs = new Map<string, Doc>();
  writes: { path: string; kind: 'update' | 'set'; data: Doc }[] = [];
  reads: string[] = [];
  /** Numero di transazioni effettivamente avviate. */
  transactions = 0;

  seed(path: string, data: Doc): void {
    this.docs.set(path, { ...data });
  }

  apply(path: string, kind: 'update' | 'set', data: Doc): void {
    this.writes.push({ path, kind, data: { ...data } });
    const current = kind === 'set' ? {} : (this.docs.get(path) ?? {});
    const next: Doc = { ...current };
    for (const [key, value] of Object.entries(data)) {
      if (isDeleteSentinel(value)) delete next[key];
      else next[key] = value;
    }
    this.docs.set(path, next);
  }

  doc(path: string) {
    return {
      path,
      get: async () => {
        this.reads.push(path);
        const data = this.docs.get(path);
        return { exists: data !== undefined, data: () => data };
      },
      update: async (data: Doc) => {
        if (!this.docs.has(path)) throw new Error(`update su documento assente: ${path}`);
        this.apply(path, 'update', data);
      },
    };
  }

  async runTransaction<T>(fn: (tx: FakeTx) => Promise<T>): Promise<T> {
    this.transactions += 1;
    return fn(new FakeTx(this));
  }
}

class FakeTx {
  constructor(private readonly db: FakeDb) {}
  async get(ref: { path: string }) {
    this.db.reads.push(ref.path);
    const data = this.db.docs.get(ref.path);
    return { exists: data !== undefined, data: () => data };
  }
  update(ref: { path: string }, data: Doc) {
    this.db.apply(ref.path, 'update', data);
  }
  set(ref: { path: string }, data: Doc) {
    this.db.apply(ref.path, 'set', data);
  }
}

/**
 * Il runner usa il vero `FieldValue.delete()`: la finta Firestore lo riconosce
 * per tipo e rimuove davvero il campo, così «i marcatori spariscono» è una
 * verifica reale e non una convenzione del test.
 */
function isDeleteSentinel(value: unknown): boolean {
  return value instanceof FieldValue && value.isEqual(FieldValue.delete());
}

function asDb(db: FakeDb): Firestore {
  return db as unknown as Firestore;
}

const NOW = new Date('2026-07-29T10:00:00.000Z');
const DEADLINE = new Date(NOW.getTime() + 60_000);

function draftDoc(studentUid: string, over: Doc = {}): Doc {
  return {
    submissionId: `${VERIFICATION}_${studentUid}`,
    verificationId: VERIFICATION,
    studentUid,
    ownerUid: OWNER,
    status: 'draft',
    answers: { '0': { tipo: 'aperta', testo: 'bozza' } },
    flagged: {},
    attentionEvents: [{ type: 'window_blur', ts: 1 }],
    deliveryCode: null,
    verificationTitle: TITLE,
    className: CLASS_NAME,
    startedAt: Timestamp.fromMillis(1_700_000_000_000),
    lastSavedAt: Timestamp.fromMillis(1_700_000_500_000),
    submittedAt: null,
    ...over,
  };
}

let db: FakeDb;
let enqueued: { payload: Record<string, unknown>; at: Date }[];
const enqueue = vi.fn(async (payload: Record<string, unknown>, at: Date) => {
  enqueued.push({ payload, at });
});

beforeEach(() => {
  db = new FakeDb();
  db.seed(`verifications/${VERIFICATION}`, { ownerUid: OWNER, status: 'active' });
  enqueued = [];
  enqueue.mockClear();
  enqueue.mockImplementation(async (payload: Record<string, unknown>, at: Date) => {
    enqueued.push({ payload, at });
  });
});

function schedule(studentUids: string[], caller: string | null = OWNER) {
  return runScheduleForceClose(
    asDb(db),
    caller,
    { verificationId: VERIFICATION, studentUids },
    enqueue as never,
    () => NOW,
  );
}

describe('runScheduleForceClose — autorizzazione', () => {
  it('richiede autenticazione', async () => {
    await expect(schedule(['a'], null)).rejects.toThrow(/Autenticazione/);
    expect(db.writes).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('richiede una verifica esistente e di questo docente', async () => {
    db.docs.delete(`verifications/${VERIFICATION}`);
    await expect(schedule(['a'])).rejects.toThrow(/Verifica non trovata/);

    db.seed(`verifications/${VERIFICATION}`, { ownerUid: 'altro' });
    await expect(schedule(['a'])).rejects.toThrow(/non di questo docente/);
    expect(db.writes).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('rifiuta un input non valido prima di qualunque lettura', async () => {
    await expect(
      runScheduleForceClose(asDb(db), OWNER, { verificationId: VERIFICATION }, enqueue as never),
    ).rejects.toThrow(ForceCloseError);
    expect(db.reads).toHaveLength(0);
  });
});

describe('runScheduleForceClose — programmazione', () => {
  it('una bozza ⇒ una scrittura e una sola task a +60 secondi', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));

    const result = await schedule(['a']);

    expect(result.graceSeconds).toBe(60);
    expect(result.results).toEqual([{ studentUid: 'a', outcome: 'scheduled' }]);
    expect(db.writes).toHaveLength(1);
    expect(Object.keys(db.writes[0]!.data).sort()).toEqual([
      'forceCloseDeadline',
      'forceCloseRequestId',
      'forceCloseRequestedAt',
    ]);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueued[0]!.at.getTime()).toBe(DEADLINE.getTime());
    expect(Object.keys(enqueued[0]!.payload).sort()).toEqual([
      'ownerUid',
      'requestId',
      'studentUid',
      'verificationId',
    ]);
    // La bozza non è stata consegnata né toccata nei contenuti.
    const doc = db.docs.get(`submissions/${VERIFICATION}_a`)!;
    expect(doc.status).toBe('draft');
    expect(doc.answers).toEqual({ '0': { tipo: 'aperta', testo: 'bozza' } });
    expect(doc.lastSavedAt).toEqual(Timestamp.fromMillis(1_700_000_500_000));
  });

  it('studente che non ha iniziato ⇒ zero scritture, zero task, nessuna consegna creata', async () => {
    const result = await schedule(['assente']);

    expect(result.results).toEqual([{ studentUid: 'assente', outcome: 'not_started' }]);
    expect(db.writes).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
    expect(db.docs.has(`submissions/${VERIFICATION}_assente`)).toBe(false);
  });

  it('consegna già effettuata ⇒ zero scritture, zero task', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a', { status: 'submitted' }));

    const result = await schedule(['a']);

    expect(result.results).toEqual([{ studentUid: 'a', outcome: 'already_submitted' }]);
    expect(db.writes).toHaveLength(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('richiesta ripetuta (doppio click) ⇒ nessuna seconda task, esito idempotente', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));

    const first = await schedule(['a']);
    const second = await schedule(['a']);

    expect(first.results[0]!.outcome).toBe('scheduled');
    expect(second.results[0]!.outcome).toBe('already_scheduled');
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(db.writes).toHaveLength(1);
  });

  it('selezione mista: ogni riga il suo esito, task solo per le bozze', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));
    db.seed(`submissions/${VERIFICATION}_b`, draftDoc('b', { status: 'submitted' }));
    db.seed(`submissions/${VERIFICATION}_c`, draftDoc('c'));
    // 'd' non ha mai iniziato.

    const result = await schedule(['a', 'b', 'c', 'd']);

    expect(result.results).toEqual([
      { studentUid: 'a', outcome: 'scheduled' },
      { studentUid: 'b', outcome: 'already_submitted' },
      { studentUid: 'c', outcome: 'scheduled' },
      { studentUid: 'd', outcome: 'not_started' },
    ]);
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(db.writes).toHaveLength(2);
  });

  it('un fallimento individuale non interrompe le altre righe', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));
    db.seed(`submissions/${VERIFICATION}_b`, draftDoc('b'));
    enqueue.mockImplementationOnce(async () => {
      throw new Error('coda non disponibile');
    });

    const result = await schedule(['a', 'b']);

    expect(result.results[0]).toEqual({ studentUid: 'a', outcome: 'failed' });
    expect(result.results[1]).toEqual({ studentUid: 'b', outcome: 'scheduled' });
    // Compensazione: la riga fallita non resta programmata.
    const failed = db.docs.get(`submissions/${VERIFICATION}_a`)!;
    expect('forceCloseRequestId' in failed).toBe(false);
    expect('forceCloseDeadline' in failed).toBe(false);
  });

  it('ogni richiesta ha un requestId distinto', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));
    db.seed(`submissions/${VERIFICATION}_b`, draftDoc('b'));

    await schedule(['a', 'b']);

    const ids = enqueued.map((e) => e.payload.requestId);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('runForceCloseTask — esecuzione alla scadenza', () => {
  /** Programma davvero, poi restituisce il payload della task accodata. */
  async function scheduleAndGetTask(studentUid: string) {
    db.seed(`submissions/${VERIFICATION}_${studentUid}`, draftDoc(studentUid));
    await schedule([studentUid]);
    db.writes = [];
    return enqueued[0]!.payload;
  }

  it('acquisisce l’ultima bozza salvata e crea la ricevuta coerente', async () => {
    const payload = await scheduleAndGetTask('a');

    const outcome = await runForceCloseTask(asDb(db), payload);

    expect(outcome).toBe('closed');
    expect(db.writes).toHaveLength(2);
    const submission = db.docs.get(`submissions/${VERIFICATION}_a`)!;
    expect(submission.status).toBe('submitted');
    expect(submission.forcedByTeacher).toBe(true);
    expect(submission.deliveryCode).toMatch(/^SF-\d{4}-[A-Z0-9]{4}$/);
    // Contenuti congelati, non modificati.
    expect(submission.answers).toEqual({ '0': { tipo: 'aperta', testo: 'bozza' } });
    expect(submission.attentionEvents).toEqual([{ type: 'window_blur', ts: 1 }]);
    // `lastSavedAt` resta l'ultimo salvataggio REALE dello studente.
    expect(submission.lastSavedAt).toEqual(Timestamp.fromMillis(1_700_000_500_000));
    // I marcatori della programmazione si esauriscono nello stesso update.
    expect('forceCloseRequestId' in submission).toBe(false);
    expect('forceCloseDeadline' in submission).toBe(false);
    expect('forceCloseRequestedAt' in submission).toBe(false);

    const receipt = db.docs.get(`submissionReceipts/${VERIFICATION}_a`)!;
    expect(receipt.forcedByTeacher).toBe(true);
    expect(receipt.deliveryCode).toBe(submission.deliveryCode);
    expect(receipt.verificationTitle).toBe(TITLE);
    expect(receipt.className).toBe(CLASS_NAME);
    expect('answers' in receipt).toBe(false);
  });

  it('retry della stessa task ⇒ idempotente, zero scritture aggiuntive', async () => {
    const payload = await scheduleAndGetTask('a');
    await runForceCloseTask(asDb(db), payload);
    const writesAfterFirst = db.writes.length;

    const outcome = await runForceCloseTask(asDb(db), payload);

    expect(outcome).toBe('noop');
    expect(db.writes).toHaveLength(writesAfterFirst);
  });

  it('consegna normale durante il preavviso ⇒ no-op, mai sovrascritta', async () => {
    const payload = await scheduleAndGetTask('a');
    // Lo studente consegna normalmente prima della scadenza.
    const path = `submissions/${VERIFICATION}_a`;
    db.seed(path, {
      ...draftDoc('a'),
      status: 'submitted',
      deliveryCode: 'SF-2026-BBBB',
      submittedAt: Timestamp.fromMillis(1_700_000_900_000),
    });
    db.writes = [];

    const outcome = await runForceCloseTask(asDb(db), payload);

    expect(outcome).toBe('noop');
    expect(db.writes).toHaveLength(0);
    const submission = db.docs.get(path)!;
    expect(submission.deliveryCode).toBe('SF-2026-BBBB');
    expect('forcedByTeacher' in submission).toBe(false);
    expect(db.docs.has(`submissionReceipts/${VERIFICATION}_a`)).toBe(false);
  });

  it('salvataggio dello studente durante il preavviso ⇒ viene acquisita la versione nuova', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;
    const current = db.docs.get(path)!;
    db.docs.set(path, {
      ...current,
      answers: { '0': { tipo: 'aperta', testo: 'versione aggiornata' } },
      lastSavedAt: Timestamp.fromMillis(1_700_000_800_000),
    });
    db.writes = [];

    await runForceCloseTask(asDb(db), payload);

    const submission = db.docs.get(path)!;
    expect(submission.answers).toEqual({ '0': { tipo: 'aperta', testo: 'versione aggiornata' } });
    expect(submission.lastSavedAt).toEqual(Timestamp.fromMillis(1_700_000_800_000));
  });

  it('riprogrammazione successiva ⇒ la task vecchia è obsoleta e non fa nulla', async () => {
    const stale = await scheduleAndGetTask('a');
    // Il docente riprogramma: nuovo requestId sulla submission.
    const path = `submissions/${VERIFICATION}_a`;
    db.docs.set(path, { ...db.docs.get(path)!, forceCloseRequestId: 'z'.repeat(24) });
    db.writes = [];

    expect(await runForceCloseTask(asDb(db), stale)).toBe('noop');
    expect(db.writes).toHaveLength(0);
  });

  it('programmazione rimossa o consegna eliminata ⇒ no-op sicuro', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;

    const withoutMarkers = { ...db.docs.get(path)! };
    delete withoutMarkers.forceCloseRequestId;
    delete withoutMarkers.forceCloseDeadline;
    db.docs.set(path, withoutMarkers);
    db.writes = [];
    expect(await runForceCloseTask(asDb(db), payload)).toBe('noop');

    db.docs.delete(path);
    expect(await runForceCloseTask(asDb(db), payload)).toBe('noop');
    expect(db.writes).toHaveLength(0);
  });

  it('verifica passata a un altro proprietario ⇒ no-op', async () => {
    const payload = await scheduleAndGetTask('a');
    db.seed(`verifications/${VERIFICATION}`, { ownerUid: 'altro' });
    db.writes = [];

    expect(await runForceCloseTask(asDb(db), payload)).toBe('noop');
    expect(db.writes).toHaveLength(0);
  });

  it('metadati incoerenti sulla bozza ⇒ errore e zero scritture', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;
    db.docs.set(path, { ...db.docs.get(path)!, verificationTitle: '' });
    db.writes = [];

    await expect(runForceCloseTask(asDb(db), payload)).rejects.toThrow(/titolo verifica/);
    expect(db.writes).toHaveLength(0);
  });

  it('payload non valido ⇒ errore prima di qualunque lettura', async () => {
    await expect(runForceCloseTask(asDb(db), { verificationId: VERIFICATION })).rejects.toThrow(
      ForceCloseError,
    );
    expect(db.writes).toHaveLength(0);
  });
});
