import { describe, expect, it } from 'vitest';
import {
  decideForceCloseTask,
  decideScheduleFor,
  FORCE_CLOSE_GRACE_SECONDS,
  FORCE_CLOSE_MARKER_FIELDS,
  ForceCloseError,
  generateRequestId,
  isCanonicalRequestId,
  MAX_FORCE_CLOSE_BATCH,
  millisToTimestampKey,
  parseForceCloseTaskPayload,
  parseScheduleForceCloseInput,
  readMarkerState,
  taskNameFor,
  scheduleResult,
  scheduleWrite,
  type ScheduleSubmissionSnapshot,
} from './forceCloseCore.js';

const OWNER = 'owner-uid';
const STUDENT = 'stud-a';
const VERIFICATION = 'ver-1';
const SUBMISSION_ID = `${VERIFICATION}_${STUDENT}`;
const REQUEST_ID = 'abcdefghijklmnopqrstuvwx';

function ts(seconds: number, nanoseconds = 0) {
  return { seconds, nanoseconds };
}
const DEADLINE = ts(1_800_000_060);

function draft(over: Partial<ScheduleSubmissionSnapshot> = {}): ScheduleSubmissionSnapshot {
  return {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    status: 'draft',
    forcedByTeacher: undefined,
    forceCloseRequestId: undefined,
    forceCloseDeadline: undefined,
    forceCloseRequestedAt: undefined,
    ...over,
  };
}

/** I tre marcatori coerenti di una programmazione attiva. */
function scheduled(over: Record<string, unknown> = {}) {
  return {
    forceCloseRequestId: REQUEST_ID,
    forceCloseDeadline: DEADLINE,
    forceCloseRequestedAt: ts(1_800_000_000),
    ...over,
  };
}

function scheduleCtx(submission: ScheduleSubmissionSnapshot | null) {
  return { callerUid: OWNER, verificationId: VERIFICATION, studentUid: STUDENT, submission };
}

describe('parseScheduleForceCloseInput — input chiuso', () => {
  it('accetta esattamente verificationId e studentUids', () => {
    expect(
      parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: ['u1', 'u2'] }),
    ).toEqual({ verificationId: 'v1', studentUids: ['u1', 'u2'] });
  });

  it('rifiuta input non-oggetto', () => {
    for (const bad of [null, undefined, 'x', 42, [], true]) {
      expect(() => parseScheduleForceCloseInput(bad)).toThrow(ForceCloseError);
    }
  });

  it('rifiuta ogni chiave che il client non deve poter proporre', () => {
    for (const extra of [
      'ownerUid',
      'submissionId',
      'requestId',
      'deadline',
      'graceSeconds',
      'status',
      'forcedByTeacher',
      'forceCloseDeadline',
    ]) {
      expect(() =>
        parseScheduleForceCloseInput({
          verificationId: 'v1',
          studentUids: ['u1'],
          [extra]: 'x',
        }),
      ).toThrow(/chiavi non ammesse/);
    }
  });

  it('rifiuta un elenco vuoto o non un array', () => {
    expect(() => parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: [] })).toThrow(
      /Nessuno studente/,
    );
    expect(() => parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: 'u1' })).toThrow(
      /Nessuno studente/,
    );
  });

  it('applica il cap esplicito del batch', () => {
    const ok = Array.from({ length: MAX_FORCE_CLOSE_BATCH }, (_, i) => `u${i}`);
    expect(
      parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: ok }).studentUids,
    ).toHaveLength(MAX_FORCE_CLOSE_BATCH);
    expect(() =>
      parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: [...ok, 'extra'] }),
    ).toThrow(/Troppe consegne/);
  });

  it('rifiuta uid duplicati', () => {
    expect(() =>
      parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: ['u1', 'u2', 'u1'] }),
    ).toThrow(/duplicato/);
  });

  it('rifiuta id malformati e id concatenati oltre 1500 byte UTF-8', () => {
    expect(() =>
      parseScheduleForceCloseInput({ verificationId: 'a/b', studentUids: ['u1'] }),
    ).toThrow(/verificationId/);
    expect(() =>
      parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: ['a/b'] }),
    ).toThrow(/studentUid/);
    expect(() => parseScheduleForceCloseInput({ verificationId: 'v1', studentUids: [42] })).toThrow(
      /studentUid/,
    );
    // 800 caratteri accentati = 1600 byte.
    expect(() =>
      parseScheduleForceCloseInput({ verificationId: 'é'.repeat(800), studentUids: ['u1'] }),
    ).toThrow(/verificationId/);
    const half = 'a'.repeat(800);
    expect(() =>
      parseScheduleForceCloseInput({ verificationId: half, studentUids: [half] }),
    ).toThrow(/Identificatore consegna/);
  });

  it('non condivide l’array con il chiamante', () => {
    const studentUids = ['u1'];
    const parsed = parseScheduleForceCloseInput({ verificationId: 'v1', studentUids });
    studentUids.push('u2');
    expect(parsed.studentUids).toEqual(['u1']);
  });
});

describe('generateRequestId — identificatore opaco', () => {
  it('produce una stringa canonica di lunghezza fissa', () => {
    const id = generateRequestId(() => 0);
    expect(id).toBe('a'.repeat(24));
    expect(isCanonicalRequestId(id)).toBe(true);
  });

  it('non riconosce forme diverse', () => {
    for (const bad of ['', 'abc', 'A'.repeat(24), 'a'.repeat(25), null, 42, 'a-'.repeat(12)]) {
      expect(isCanonicalRequestId(bad)).toBe(false);
    }
  });
});

describe('decideScheduleFor — eleggibilità per studente', () => {
  it('una bozza non programmata è eleggibile', () => {
    expect(decideScheduleFor(scheduleCtx(draft()))).toBe('scheduled');
  });

  it('nessuna submission ⇒ not_started, nulla viene creato', () => {
    expect(decideScheduleFor(scheduleCtx(null))).toBe('not_started');
  });

  it('già consegnata ⇒ already_submitted', () => {
    expect(decideScheduleFor(scheduleCtx(draft({ status: 'submitted' })))).toBe(
      'already_submitted',
    );
  });

  it('chiusura già programmata ⇒ no-op idempotente, non un errore', () => {
    expect(decideScheduleFor(scheduleCtx(draft(scheduled())))).toBe('already_scheduled');
  });

  it('submission incoerente con verifica, studente o owner ⇒ incoherent', () => {
    for (const patch of [
      { submissionId: 'altro' },
      { verificationId: 'altra' },
      { studentUid: 'altro' },
      { ownerUid: 'altro' },
      { status: 'boh' },
      { forcedByTeacher: true },
      { forcedByTeacher: false },
    ]) {
      expect(decideScheduleFor(scheduleCtx(draft(patch)))).toBe('incoherent');
    }
  });

  it('marcatori di programmazione spaiati o malformati ⇒ incoherent', () => {
    for (const patch of [
      { forceCloseRequestId: REQUEST_ID },
      { forceCloseDeadline: DEADLINE },
      { forceCloseRequestedAt: DEADLINE },
      // Due su tre: stato parziale, mai «riparato».
      { forceCloseRequestId: REQUEST_ID, forceCloseDeadline: DEADLINE },
      { forceCloseDeadline: DEADLINE, forceCloseRequestedAt: DEADLINE },
      { ...scheduled(), forceCloseRequestId: 'corto' },
      { ...scheduled(), forceCloseDeadline: 'domani' },
      { ...scheduled(), forceCloseDeadline: null },
      { ...scheduled(), forceCloseRequestedAt: 'ieri' },
    ]) {
      expect(decideScheduleFor(scheduleCtx(draft(patch)))).toBe('incoherent');
    }
  });
});

describe('scheduleWrite — la sola scrittura della programmazione', () => {
  it('scrive esattamente i tre marcatori server-only', () => {
    const { submissionUpdate } = scheduleWrite(REQUEST_ID, DEADLINE, 'NOW');
    expect(Object.keys(submissionUpdate).sort()).toEqual([...FORCE_CLOSE_MARKER_FIELDS].sort());
    expect(submissionUpdate).toEqual({
      forceCloseRequestId: REQUEST_ID,
      forceCloseDeadline: DEADLINE,
      forceCloseRequestedAt: 'NOW',
    });
  });

  it('non tocca stato, contenuti né campi di consegna', () => {
    const { submissionUpdate } = scheduleWrite(REQUEST_ID, DEADLINE, 'NOW');
    for (const forbidden of [
      'status',
      'answers',
      'flagged',
      'attentionEvents',
      'lastSavedAt',
      'submittedAt',
      'deliveryCode',
      'forcedByTeacher',
    ]) {
      expect(forbidden in submissionUpdate).toBe(false);
    }
  });
});

describe('scheduleResult — risposta sanitizzata', () => {
  it('riporta solo uid ed esito, con la finestra di contratto', () => {
    const result = scheduleResult([
      { studentUid: 'u1', outcome: 'scheduled' },
      { studentUid: 'u2', outcome: 'not_started' },
    ]);
    expect(result.graceSeconds).toBe(FORCE_CLOSE_GRACE_SECONDS);
    expect(result.results).toEqual([
      { studentUid: 'u1', outcome: 'scheduled' },
      { studentUid: 'u2', outcome: 'not_started' },
    ]);
    for (const row of result.results) {
      expect(Object.keys(row).sort()).toEqual(['outcome', 'studentUid']);
    }
  });
});

describe('readMarkerState — i tre marcatori sono un fatto unico', () => {
  const base = {
    forceCloseRequestId: undefined,
    forceCloseDeadline: undefined,
    forceCloseRequestedAt: undefined,
  };

  it('tutti assenti ⇒ absent', () => {
    expect(readMarkerState(base)).toEqual({ kind: 'absent' });
  });

  it('tutti presenti e ben formati ⇒ present, con chiave scadenza canonica', () => {
    expect(readMarkerState(scheduled())).toEqual({
      kind: 'present',
      requestId: REQUEST_ID,
      deadlineKey: '1800000060.000000000',
    });
  });

  it.each([
    ['solo requestId', { ...base, forceCloseRequestId: REQUEST_ID }],
    ['solo deadline', { ...base, forceCloseDeadline: DEADLINE }],
    ['solo requestedAt', { ...base, forceCloseRequestedAt: DEADLINE }],
    ['manca requestedAt', { ...scheduled(), forceCloseRequestedAt: undefined }],
    ['manca deadline', { ...scheduled(), forceCloseDeadline: undefined }],
    ['requestId non canonico', { ...scheduled(), forceCloseRequestId: 'X' }],
    ['deadline non timestamp', { ...scheduled(), forceCloseDeadline: 123 }],
    ['requestedAt non timestamp', { ...scheduled(), forceCloseRequestedAt: 'ieri' }],
  ])('«%s» ⇒ malformed', (_label, snapshot) => {
    expect(readMarkerState(snapshot as never).kind).toBe('malformed');
  });
});

describe('taskNameFor — nome deterministico e opaco', () => {
  it('deriva dal requestId senza esporre uid o id verifica', () => {
    expect(taskNameFor(REQUEST_ID)).toBe(`fc-${REQUEST_ID}`);
    expect(taskNameFor(REQUEST_ID)).toBe(taskNameFor(REQUEST_ID));
    expect(taskNameFor(REQUEST_ID)).not.toContain(VERIFICATION);
    expect(taskNameFor(REQUEST_ID)).not.toContain(STUDENT);
    expect(taskNameFor(REQUEST_ID)).toMatch(/^[A-Za-z0-9_-]{1,500}$/);
  });

  it('rifiuta un requestId non canonico', () => {
    expect(() => taskNameFor('corto')).toThrow(ForceCloseError);
  });
});

describe('parseForceCloseTaskPayload — payload chiuso anche server→server', () => {
  const valid = {
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    requestId: REQUEST_ID,
    deadlineMs: 1_800_000_060_000,
  };

  it('accetta esattamente le cinque chiavi attese, deadline inclusa', () => {
    expect(parseForceCloseTaskPayload({ ...valid })).toEqual(valid);
  });

  it('rifiuta chiavi extra o mancanti', () => {
    expect(() => parseForceCloseTaskPayload({ ...valid, graceSeconds: 60 })).toThrow(
      /chiavi non ammesse/,
    );
    const withoutDeadline = { ...valid } as Record<string, unknown>;
    delete withoutDeadline.deadlineMs;
    expect(() => parseForceCloseTaskPayload(withoutDeadline)).toThrow(/chiavi non ammesse/);
  });

  it('rifiuta id, requestId e deadline malformati', () => {
    expect(() => parseForceCloseTaskPayload({ ...valid, verificationId: 'a/b' })).toThrow(
      /verificationId/,
    );
    expect(() => parseForceCloseTaskPayload({ ...valid, studentUid: '' })).toThrow(/studentUid/);
    expect(() => parseForceCloseTaskPayload({ ...valid, ownerUid: '   ' })).toThrow(/ownerUid/);
    expect(() => parseForceCloseTaskPayload({ ...valid, requestId: 'corto' })).toThrow(/requestId/);
    for (const bad of [0, -1, 1.5, NaN, '1800000060000', null]) {
      expect(() => parseForceCloseTaskPayload({ ...valid, deadlineMs: bad })).toThrow(/deadlineMs/);
    }
  });
});

describe('decideForceCloseTask — esecuzione fail-closed e no-op-safe', () => {
  const DEADLINE_MS = 1_800_000_060_000;
  const payload = {
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    requestId: REQUEST_ID,
    deadlineMs: DEADLINE_MS,
  };
  const ours = draft(scheduled());
  const decide = (submission: unknown, nowMs = DEADLINE_MS) =>
    decideForceCloseTask({
      payload,
      submission: submission as ScheduleSubmissionSnapshot | null,
      nowMs,
    });

  it('chiude solo se ritrova esattamente la propria richiesta e la scadenza è passata', () => {
    expect(decide(ours)).toEqual({ kind: 'run' });
    expect(decide(ours, DEADLINE_MS + 5_000)).toEqual({ kind: 'run' });
  });

  it('consegna anticipata della coda ⇒ too_early, mai una chiusura in anticipo', () => {
    expect(decide(ours, DEADLINE_MS - 1)).toEqual({ kind: 'too_early', remainingMs: 1 });
    expect(decide(ours, DEADLINE_MS - 30_000)).toEqual({
      kind: 'too_early',
      remainingMs: 30_000,
    });
  });

  it('la deadline persistita deve combaciare con quella della task', () => {
    const otherDeadline = draft(scheduled({ forceCloseDeadline: ts(1_800_000_999) }));
    expect(decide(otherDeadline)).toEqual({ kind: 'noop', reason: 'superseded' });
  });

  it('un altro requestId è una programmazione diversa: mai cancellata da noi', () => {
    const other = draft(scheduled({ forceCloseRequestId: 'z'.repeat(24) }));
    expect(decide(other)).toEqual({ kind: 'noop', reason: 'superseded' });
  });

  it.each([
    ['consegna eliminata', null, 'submission_missing'],
    ['programmazione già rimossa', draft(), 'markers_absent'],
    [
      'documento estraneo senza i nostri marcatori',
      draft({ studentUid: 'altro' }),
      'identity_mismatch',
    ],
  ])('«%s» ⇒ noop, nulla da ripulire', (_label, submission, reason) => {
    expect(decide(submission)).toEqual({ kind: 'noop', reason });
  });

  it.each([
    ['consegna normale durante la finestra', { ...ours, status: 'submitted' }, 'already_submitted'],
    ['bozza già marcata', { ...ours, forcedByTeacher: true }, 'already_forced'],
    ['marcatori parziali', draft({ forceCloseRequestId: REQUEST_ID }), 'markers_malformed'],
    [
      'documento incoerente ma con i nostri marcatori',
      { ...ours, studentUid: 'altro' },
      'submission_incoherent',
    ],
  ])('«%s» ⇒ cleanup: mai un banner scaduto senza ricevuta', (_label, submission, reason) => {
    expect(decide(submission)).toEqual({ kind: 'cleanup', reason });
  });

  it('un retry dopo l’esecuzione è idempotente', () => {
    const afterClose = draft({ status: 'submitted', forcedByTeacher: true });
    expect(decide(afterClose)).toEqual({ kind: 'noop', reason: 'markers_absent' });
  });
});

describe('millisToTimestampKey', () => {
  it('produce la stessa chiave canonica di un Timestamp equivalente', () => {
    expect(millisToTimestampKey(1_800_000_060_000)).toBe('1800000060.000000000');
    expect(millisToTimestampKey(1_500)).toBe('1.500000000');
  });
});
