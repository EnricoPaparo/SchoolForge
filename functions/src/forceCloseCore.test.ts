import { describe, expect, it } from 'vitest';
import {
  decideForceCloseTask,
  decideScheduleFor,
  deadlineMatches,
  FORCE_CLOSE_GRACE_SECONDS,
  FORCE_CLOSE_MARKER_FIELDS,
  ForceCloseError,
  generateRequestId,
  isCanonicalRequestId,
  MAX_FORCE_CLOSE_BATCH,
  parseForceCloseTaskPayload,
  parseScheduleForceCloseInput,
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
    expect(
      decideScheduleFor(
        scheduleCtx(draft({ forceCloseRequestId: REQUEST_ID, forceCloseDeadline: DEADLINE })),
      ),
    ).toBe('already_scheduled');
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
      { forceCloseRequestId: 'corto', forceCloseDeadline: DEADLINE },
      { forceCloseRequestId: REQUEST_ID, forceCloseDeadline: 'domani' },
      { forceCloseRequestId: REQUEST_ID, forceCloseDeadline: null },
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

describe('parseForceCloseTaskPayload — payload chiuso anche server→server', () => {
  const valid = {
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    requestId: REQUEST_ID,
  };

  it('accetta esattamente le quattro chiavi attese', () => {
    expect(parseForceCloseTaskPayload({ ...valid })).toEqual(valid);
  });

  it('rifiuta chiavi extra o mancanti', () => {
    expect(() => parseForceCloseTaskPayload({ ...valid, deadline: DEADLINE })).toThrow(
      /chiavi non ammesse/,
    );
    expect(() => parseForceCloseTaskPayload({ verificationId: VERIFICATION })).toThrow(
      /chiavi non ammesse/,
    );
  });

  it('rifiuta id e requestId malformati', () => {
    expect(() => parseForceCloseTaskPayload({ ...valid, verificationId: 'a/b' })).toThrow(
      /verificationId/,
    );
    expect(() => parseForceCloseTaskPayload({ ...valid, studentUid: '' })).toThrow(/studentUid/);
    expect(() => parseForceCloseTaskPayload({ ...valid, ownerUid: '   ' })).toThrow(/ownerUid/);
    expect(() => parseForceCloseTaskPayload({ ...valid, requestId: 'corto' })).toThrow(/requestId/);
  });
});

describe('decideForceCloseTask — esecuzione fail-closed e no-op-safe', () => {
  const payload = {
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    requestId: REQUEST_ID,
  };
  const scheduled = draft({ forceCloseRequestId: REQUEST_ID, forceCloseDeadline: DEADLINE });

  it('esegue quando ritrova esattamente la propria richiesta', () => {
    expect(decideForceCloseTask({ payload, submission: scheduled })).toBe('run');
  });

  it.each([
    ['consegna eliminata', null],
    ['consegna normale nel frattempo', draft({ status: 'submitted' })],
    ['chiusura già eseguita', draft({ status: 'submitted', forcedByTeacher: true })],
    ['bozza già marcata', draft({ forcedByTeacher: true })],
    ['programmazione rimossa', draft()],
    [
      'riprogrammata con un’altra richiesta',
      draft({ forceCloseRequestId: 'z'.repeat(24), forceCloseDeadline: DEADLINE }),
    ],
    ['deadline malformata', draft({ forceCloseRequestId: REQUEST_ID, forceCloseDeadline: 'x' })],
    ['submission incoerente', { ...scheduled, studentUid: 'altro' }],
    ['owner diverso', { ...scheduled, ownerUid: 'altro' }],
  ])('«%s» ⇒ no-op sicuro, mai un errore ritentabile', (_label, submission) => {
    expect(
      decideForceCloseTask({
        payload,
        submission: submission as ScheduleSubmissionSnapshot | null,
      }),
    ).toBe('noop_superseded');
  });

  it('un retry dopo l’esecuzione è idempotente', () => {
    // Dopo la chiusura la submission è submitted, marcata e senza marcatori.
    const afterClose = draft({ status: 'submitted', forcedByTeacher: true });
    expect(decideForceCloseTask({ payload, submission: afterClose })).toBe('noop_superseded');
  });
});

describe('deadlineMatches — confronto deterministico', () => {
  it('combacia solo su istanti riconoscibili e uguali', () => {
    expect(deadlineMatches(DEADLINE, { _seconds: 1_800_000_060, _nanoseconds: 0 })).toBe(true);
    expect(deadlineMatches(DEADLINE, ts(1_800_000_061))).toBe(false);
    expect(deadlineMatches(null, null)).toBe(false);
    expect(deadlineMatches(undefined, DEADLINE)).toBe(false);
  });
});
