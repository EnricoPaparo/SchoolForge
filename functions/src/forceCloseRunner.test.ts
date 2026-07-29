import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import type { Firestore } from 'firebase-admin/firestore';
import {
  ForceCloseTooEarlyError,
  isAlreadyExistsError,
  runForceCloseTask,
  runScheduleForceClose,
} from './forceCloseRunner.js';
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
      // `serverTimestamp()` è risolto come farebbe Firestore: senza questo, i
      // marcatori resterebbero sentinelle e risulterebbero malformati.
      else if (isServerTimestampSentinel(value)) next[key] = Timestamp.fromDate(SERVER_NOW);
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

/** Istante con cui la finta Firestore risolve `serverTimestamp()`. */
const SERVER_NOW = new Date('2026-07-29T09:59:59.000Z');

function isServerTimestampSentinel(value: unknown): boolean {
  return value instanceof FieldValue && value.isEqual(FieldValue.serverTimestamp());
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
type EnqueueOptions = { scheduleTime: Date; id: string };
let enqueued: { payload: Record<string, unknown>; options: EnqueueOptions }[];
const enqueue = vi.fn(async (payload: Record<string, unknown>, options: EnqueueOptions) => {
  enqueued.push({ payload, options });
});

beforeEach(() => {
  db = new FakeDb();
  db.seed(`verifications/${VERIFICATION}`, { ownerUid: OWNER, status: 'active' });
  enqueued = [];
  enqueue.mockClear();
  enqueue.mockImplementation(async (payload: Record<string, unknown>, options: EnqueueOptions) => {
    enqueued.push({ payload, options });
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
    expect(enqueued[0]!.options.scheduleTime.getTime()).toBe(DEADLINE.getTime());
    // Il payload porta anche la deadline canonica e un id deterministico.
    expect(Object.keys(enqueued[0]!.payload).sort()).toEqual([
      'deadlineMs',
      'ownerUid',
      'requestId',
      'studentUid',
      'verificationId',
    ]);
    expect(enqueued[0]!.payload.deadlineMs).toBe(DEADLINE.getTime());
    expect(enqueued[0]!.options.id).toBe(`fc-${enqueued[0]!.payload.requestId as string}`);
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

  it('enqueue fallito ⇒ compensazione e nessuna programmazione residua', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));
    db.seed(`submissions/${VERIFICATION}_b`, draftDoc('b'));
    enqueue.mockImplementationOnce(async () => {
      throw new Error('coda non disponibile');
    });

    const result = await schedule(['a', 'b']);

    // Un fallimento individuale non interrompe gli altri studenti.
    expect(result.results.find((r) => r.studentUid === 'a')!.outcome).toBe('failed');
    expect(result.results.find((r) => r.studentUid === 'b')!.outcome).toBe('scheduled');
    const failed = db.docs.get(`submissions/${VERIFICATION}_a`)!;
    for (const field of ['forceCloseRequestId', 'forceCloseDeadline', 'forceCloseRequestedAt']) {
      expect(field in failed).toBe(false);
    }
  });

  it('enqueue ALREADY_EXISTS ⇒ la task c’era già: successo, nessuna compensazione', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));
    enqueue.mockImplementationOnce(async () => {
      throw Object.assign(new Error('Requested entity already exists'), { code: 6 });
    });

    const result = await schedule(['a']);

    expect(result.results[0]!.outcome).toBe('scheduled');
    // I marcatori restano: la chiusura avverrà davvero.
    expect(db.docs.get(`submissions/${VERIFICATION}_a`)!.forceCloseRequestId).toBeTruthy();
  });

  it('compensazione fallita ⇒ failed_cleanup esplicito, mai un successo apparente', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));
    enqueue.mockImplementationOnce(async () => {
      throw new Error('coda non disponibile');
    });
    // La prima transazione (programmazione) riesce, la seconda (pulizia) no.
    const realRunTransaction = db.runTransaction.bind(db);
    let calls = 0;
    db.runTransaction = (async (fn: never) => {
      calls += 1;
      if (calls === 2) throw new Error('Firestore non disponibile');
      return realRunTransaction(fn);
    }) as typeof db.runTransaction;

    const result = await schedule(['a']);

    expect(result.results[0]).toEqual({ studentUid: 'a', outcome: 'failed_cleanup' });
    // Lo stato residuo è dichiarato, non nascosto.
    expect(db.docs.get(`submissions/${VERIFICATION}_a`)!.forceCloseRequestId).toBeTruthy();
  });

  it('la compensazione non tocca mai una programmazione diversa', async () => {
    db.seed(`submissions/${VERIFICATION}_a`, draftDoc('a'));
    enqueue.mockImplementationOnce(async () => {
      // Nel frattempo un'altra programmazione ha preso il posto della nostra.
      const path = `submissions/${VERIFICATION}_a`;
      db.docs.set(path, { ...db.docs.get(path)!, forceCloseRequestId: 'z'.repeat(24) });
      throw new Error('coda non disponibile');
    });

    await schedule(['a']);

    expect(db.docs.get(`submissions/${VERIFICATION}_a`)!.forceCloseRequestId).toBe('z'.repeat(24));
  });

  it('batch al massimo consentito: 60 esiti individuali, nessuno perso', async () => {
    const uids = Array.from({ length: 60 }, (_, i) => `s${i}`);
    // Metà bozze, metà già consegnate.
    uids.forEach((uid, i) => {
      db.seed(
        `submissions/${VERIFICATION}_${uid}`,
        draftDoc(uid, i % 2 === 0 ? {} : { status: 'submitted' }),
      );
    });

    const result = await schedule(uids);

    expect(result.results).toHaveLength(60);
    // L'ordine richiesto è preservato nonostante la concorrenza.
    expect(result.results.map((r) => r.studentUid)).toEqual(uids);
    expect(result.results.filter((r) => r.outcome === 'scheduled')).toHaveLength(30);
    expect(result.results.filter((r) => r.outcome === 'already_submitted')).toHaveLength(30);
    expect(enqueue).toHaveBeenCalledTimes(30);
    expect(new Set(enqueued.map((e) => e.options.id)).size).toBe(30);
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

  /** Orologio alla scadenza (la task gira quando deve). */
  const atDeadline = () => DEADLINE.getTime();

  function run(payload: unknown, now: () => number = atDeadline) {
    return runForceCloseTask(asDb(db), payload, now);
  }

  it('acquisisce l’ultima bozza salvata e crea la ricevuta coerente', async () => {
    const payload = await scheduleAndGetTask('a');

    expect(await run(payload)).toBe('closed');

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
    // Tutti e tre i marcatori si esauriscono nello stesso update.
    for (const field of ['forceCloseRequestId', 'forceCloseDeadline', 'forceCloseRequestedAt']) {
      expect(field in submission).toBe(false);
    }

    const receipt = db.docs.get(`submissionReceipts/${VERIFICATION}_a`)!;
    expect(receipt.forcedByTeacher).toBe(true);
    expect(receipt.deliveryCode).toBe(submission.deliveryCode);
    expect(receipt.verificationTitle).toBe(TITLE);
    expect(receipt.className).toBe(CLASS_NAME);
    expect('answers' in receipt).toBe(false);
  });

  it('consegna anticipata della coda ⇒ errore ritentabile, mai una chiusura prima del tempo', async () => {
    const payload = await scheduleAndGetTask('a');

    await expect(run(payload, () => DEADLINE.getTime() - 1000)).rejects.toBeInstanceOf(
      ForceCloseTooEarlyError,
    );
    expect(db.writes).toHaveLength(0);
    // La bozza è intatta e i marcatori restano: la task ritenterà.
    const submission = db.docs.get(`submissions/${VERIFICATION}_a`)!;
    expect(submission.status).toBe('draft');
    expect(submission.forceCloseRequestId).toBe(payload.requestId);
  });

  it('retry della stessa task ⇒ idempotente, zero scritture aggiuntive', async () => {
    const payload = await scheduleAndGetTask('a');
    await run(payload);
    const writesAfterFirst = db.writes.length;

    expect(await run(payload)).toBe('noop');
    expect(db.writes).toHaveLength(writesAfterFirst);
  });

  it('task tardiva ⇒ comunque idempotente', async () => {
    const payload = await scheduleAndGetTask('a');
    await run(payload);
    db.writes = [];

    expect(await run(payload, () => DEADLINE.getTime() + 3_600_000)).toBe('noop');
    expect(db.writes).toHaveLength(0);
  });

  it('consegna normale durante il preavviso ⇒ vince lei, marcatori ripuliti', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;
    const current = db.docs.get(path)!;
    // Lo studente consegna normalmente prima della scadenza (i marcatori
    // restano sul documento: le Rules non gli permettono di rimuoverli).
    db.docs.set(path, {
      ...current,
      status: 'submitted',
      deliveryCode: 'SF-2026-BBBB',
      submittedAt: Timestamp.fromMillis(1_700_000_900_000),
    });
    db.writes = [];

    expect(await run(payload)).toBe('cleaned');

    const submission = db.docs.get(path)!;
    // La consegna normale non è stata toccata…
    expect(submission.deliveryCode).toBe('SF-2026-BBBB');
    expect('forcedByTeacher' in submission).toBe(false);
    expect(db.docs.has(`submissionReceipts/${VERIFICATION}_a`)).toBe(false);
    // …ma i marcatori sono spariti: nessun banner scaduto senza ricevuta.
    for (const field of ['forceCloseRequestId', 'forceCloseDeadline', 'forceCloseRequestedAt']) {
      expect(field in submission).toBe(false);
    }
    // Una sola scrittura amministrativa di pulizia.
    expect(db.writes).toHaveLength(1);
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

    expect(await run(payload)).toBe('closed');

    const submission = db.docs.get(path)!;
    expect(submission.answers).toEqual({ '0': { tipo: 'aperta', testo: 'versione aggiornata' } });
    expect(submission.lastSavedAt).toEqual(Timestamp.fromMillis(1_700_000_800_000));
  });

  it('riprogrammazione successiva ⇒ la task vecchia è obsoleta e non cancella la nuova', async () => {
    const stale = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;
    db.docs.set(path, { ...db.docs.get(path)!, forceCloseRequestId: 'z'.repeat(24) });
    db.writes = [];

    expect(await run(stale)).toBe('noop');
    expect(db.writes).toHaveLength(0);
    expect(db.docs.get(path)!.forceCloseRequestId).toBe('z'.repeat(24));
  });

  it('stessa richiesta ma scadenza diversa ⇒ programmazione sostituita, no-op', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;
    db.docs.set(path, {
      ...db.docs.get(path)!,
      forceCloseDeadline: Timestamp.fromMillis(DEADLINE.getTime() + 120_000),
    });
    db.writes = [];

    expect(await run(payload)).toBe('noop');
    expect(db.writes).toHaveLength(0);
  });

  it('programmazione rimossa o consegna eliminata ⇒ no-op sicuro', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;

    const withoutMarkers = { ...db.docs.get(path)! };
    for (const f of ['forceCloseRequestId', 'forceCloseDeadline', 'forceCloseRequestedAt']) {
      delete withoutMarkers[f];
    }
    db.docs.set(path, withoutMarkers);
    db.writes = [];
    expect(await run(payload)).toBe('noop');

    db.docs.delete(path);
    expect(await run(payload)).toBe('noop');
    expect(db.writes).toHaveLength(0);
  });

  it('marcatori parziali ⇒ pulizia, mai un banner che non scade mai', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;
    const partial = { ...db.docs.get(path)! };
    delete partial.forceCloseRequestedAt;
    db.docs.set(path, partial);
    db.writes = [];

    expect(await run(payload)).toBe('cleaned');
    const submission = db.docs.get(path)!;
    for (const field of ['forceCloseRequestId', 'forceCloseDeadline', 'forceCloseRequestedAt']) {
      expect(field in submission).toBe(false);
    }
  });

  it('verifica passata a un altro proprietario ⇒ nessuna chiusura, marcatori ripuliti', async () => {
    const payload = await scheduleAndGetTask('a');
    db.seed(`verifications/${VERIFICATION}`, { ownerUid: 'altro' });
    db.writes = [];

    expect(await run(payload)).toBe('cleaned');
    expect('forceCloseRequestId' in db.docs.get(`submissions/${VERIFICATION}_a`)!).toBe(false);
  });

  it('errore permanente sui metadati ⇒ failed_permanent e marcatori ripuliti', async () => {
    const payload = await scheduleAndGetTask('a');
    const path = `submissions/${VERIFICATION}_a`;
    db.docs.set(path, { ...db.docs.get(path)!, verificationTitle: '' });
    db.writes = [];

    // Non viene inghiottito lasciando il documento bloccato…
    expect(await run(payload)).toBe('failed_permanent');
    const submission = db.docs.get(path)!;
    // …la consegna non è stata chiusa…
    expect(submission.status).toBe('draft');
    expect(db.docs.has(`submissionReceipts/${VERIFICATION}_a`)).toBe(false);
    // …e lo studente non resta con un banner scaduto per sempre.
    for (const field of ['forceCloseRequestId', 'forceCloseDeadline', 'forceCloseRequestedAt']) {
      expect(field in submission).toBe(false);
    }
  });

  it('un errore infrastrutturale viene propagato, così Cloud Tasks ritenta', async () => {
    const payload = await scheduleAndGetTask('a');
    db.runTransaction = (async () => {
      throw new Error('Firestore momentaneamente non disponibile');
    }) as typeof db.runTransaction;

    await expect(run(payload)).rejects.toThrow(/non disponibile/);
  });

  it('payload non valido ⇒ errore prima di qualunque lettura', async () => {
    await expect(run({ verificationId: VERIFICATION })).rejects.toThrow(ForceCloseError);
    expect(db.writes).toHaveLength(0);
  });

  it('nessuna via terminale lascia scadenza superata, marcatori e nessuna ricevuta', async () => {
    const path = `submissions/${VERIFICATION}_a`;
    const scenarios: [string, () => void][] = [
      [
        'consegna normale',
        () => {
          db.docs.set(path, { ...db.docs.get(path)!, status: 'submitted' });
        },
      ],
      [
        'metadati rotti',
        () => {
          db.docs.set(path, { ...db.docs.get(path)!, verificationTitle: '' });
        },
      ],
      [
        'owner cambiato',
        () => {
          db.seed(`verifications/${VERIFICATION}`, { ownerUid: 'altro' });
        },
      ],
      [
        'marcatori parziali',
        () => {
          const partial = { ...db.docs.get(path)! };
          delete partial.forceCloseDeadline;
          db.docs.set(path, partial);
        },
      ],
      ['nessuna alterazione (chiusura riuscita)', () => {}],
    ];

    for (const [label, mutate] of scenarios) {
      db = new FakeDb();
      db.seed(`verifications/${VERIFICATION}`, { ownerUid: OWNER, status: 'active' });
      enqueued = [];
      const payload = await scheduleAndGetTask('a');
      mutate();

      await run(payload);

      const submission = db.docs.get(path);
      const stillMarked = submission !== undefined && 'forceCloseRequestId' in submission;
      const hasReceipt = db.docs.has(`submissionReceipts/${VERIFICATION}_a`);
      expect(stillMarked && !hasReceipt, `«${label}» ha lasciato marcatori senza ricevuta`).toBe(
        false,
      );
    }
  });
});

describe('isAlreadyExistsError', () => {
  it('riconosce il rifiuto di Cloud Tasks per nome già usato', () => {
    expect(isAlreadyExistsError({ code: 6 })).toBe(true);
    expect(isAlreadyExistsError({ code: 409 })).toBe(true);
    expect(isAlreadyExistsError(new Error('Requested entity already exists'))).toBe(true);
    expect(isAlreadyExistsError(new Error('ALREADY_EXISTS'))).toBe(true);
  });

  it('non confonde un errore diverso con un successo', () => {
    expect(isAlreadyExistsError(new Error('permission denied'))).toBe(false);
    expect(isAlreadyExistsError({ code: 7 })).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
  });
});
