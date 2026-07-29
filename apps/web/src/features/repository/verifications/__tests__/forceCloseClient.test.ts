import { describe, expect, it, vi } from 'vitest';
import type { Functions } from 'firebase/functions';

const httpsCallable = vi.hoisted(() => vi.fn());
vi.mock('firebase/functions', () => ({ httpsCallable }));

const {
  createScheduleForceClose,
  describeForceCloseExclusion,
  describeScheduleForceCloseError,
  describeScheduleOutcome,
  forceCloseExclusionFor,
  groupScheduleOutcomes,
  planForceClose,
  FORCE_CLOSE_GRACE_SECONDS,
  MAX_FORCE_CLOSE_BATCH,
} = await import('../forceCloseClient.js');

const functions = {} as Functions;

describe('createScheduleForceClose — contratto della callable', () => {
  it('invoca `scheduleForceCloseSubmissions` con la sola coppia attesa', async () => {
    const call = vi.fn(async (_req: unknown) => ({
      data: { graceSeconds: 60, results: [{ studentUid: 'u1', outcome: 'scheduled' as const }] },
    }));
    httpsCallable.mockReturnValue(call);

    const schedule = createScheduleForceClose(functions);
    const res = await schedule({ verificationId: 'v1', studentUids: ['u1'] });

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'scheduleForceCloseSubmissions');
    const payload = call.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['studentUids', 'verificationId']);
    expect(res.graceSeconds).toBe(60);
  });

  it('non propaga campi extra e non condivide l’array con il chiamante', async () => {
    const call = vi.fn(async (_req: unknown) => ({ data: { graceSeconds: 60, results: [] } }));
    httpsCallable.mockReturnValue(call);
    const studentUids = ['u1'];

    const schedule = createScheduleForceClose(functions);
    await schedule({
      verificationId: 'v1',
      studentUids,
      // Campi server-only: non devono raggiungere la callable.
      ownerUid: 'owner',
      requestId: 'x',
      deadline: 123,
      graceSeconds: 5,
    } as never);
    studentUids.push('u2');

    expect(call.mock.calls[0]![0]).toEqual({ verificationId: 'v1', studentUids: ['u1'] });
  });
});

describe('describeScheduleForceCloseError', () => {
  it.each([
    ['functions/unauthenticated', /Sessione scaduta/],
    ['functions/permission-denied', /questo account/],
    ['functions/not-found', /Verifica non trovata/],
    ['functions/invalid-argument', /Selezione non valida/],
    ['functions/internal', /Impossibile programmare/],
  ])('mappa %s in un messaggio leggibile', (code, expected) => {
    expect(describeScheduleForceCloseError({ code })).toMatch(expected);
  });

  it('non espone dettagli tecnici per un errore sconosciuto', () => {
    expect(describeScheduleForceCloseError(new Error('stack con uid segreto'))).toBe(
      'Impossibile programmare la chiusura. Riprova.',
    );
  });
});

describe('forceCloseExclusionFor / planForceClose — derivazione unica', () => {
  const candidate = (over: Record<string, unknown> = {}) => ({
    studentUid: 'u1',
    studentName: 'Anna',
    item: { status: 'draft' as const },
    correction: null,
    ...over,
  });

  it('una bozza senza correzione e senza programmazione è eleggibile', () => {
    expect(forceCloseExclusionFor(candidate() as never)).toBeNull();
  });

  it.each([
    ['non iniziata', { item: null }, 'not_started'],
    ['non iniziata (undefined)', { item: undefined }, 'not_started'],
    ['già consegnata', { item: { status: 'submitted' } }, 'already_submitted'],
    ['correzione avviata', { correction: { status: 'in_progress' } }, 'correction_started'],
    [
      'chiusura già programmata',
      { item: { status: 'draft', forceCloseDeadline: { seconds: 1, nanoseconds: 0 } } },
      'already_scheduled',
    ],
  ])('esclude «%s»', (_label, over, expected) => {
    expect(forceCloseExclusionFor(candidate(over) as never)).toBe(expected);
  });

  it('partiziona una selezione mista senza errori', () => {
    const plan = planForceClose([
      candidate({ studentUid: 'a' }),
      candidate({ studentUid: 'b', item: { status: 'submitted' } }),
      candidate({ studentUid: 'c', item: null }),
      candidate({ studentUid: 'd' }),
    ] as never);

    expect(plan.eligible.map((c) => c.studentUid)).toEqual(['a', 'd']);
    expect(plan.excluded.map((e) => e.reason)).toEqual(['already_submitted', 'not_started']);
  });

  it('ogni motivo ha una spiegazione sintetica non vuota', () => {
    for (const reason of [
      'not_started',
      'already_submitted',
      'correction_started',
      'already_scheduled',
    ] as const) {
      expect(describeForceCloseExclusion(reason).length).toBeGreaterThan(0);
    }
  });
});

describe('groupScheduleOutcomes — riepilogo degli esiti', () => {
  it('conta per categoria nell’ordine di presentazione', () => {
    const grouped = groupScheduleOutcomes({
      graceSeconds: 60,
      results: [
        { studentUid: 'a', outcome: 'failed' },
        { studentUid: 'b', outcome: 'scheduled' },
        { studentUid: 'c', outcome: 'scheduled' },
        { studentUid: 'd', outcome: 'not_started' },
      ],
    });

    expect(grouped).toEqual([
      { outcome: 'scheduled', count: 2 },
      { outcome: 'not_started', count: 1 },
      { outcome: 'failed', count: 1 },
    ]);
  });

  it('un esito che richiede intervento manuale è distinto da un fallimento pulito', () => {
    expect(describeScheduleOutcome('failed_cleanup')).not.toBe(describeScheduleOutcome('failed'));
    expect(describeScheduleOutcome('failed_cleanup')).toMatch(/manuale/);
  });

  it('non elenca categorie vuote', () => {
    expect(groupScheduleOutcomes({ graceSeconds: 60, results: [] })).toEqual([]);
  });

  it('ogni esito ha un’etichetta leggibile', () => {
    for (const outcome of [
      'scheduled',
      'already_scheduled',
      'not_started',
      'already_submitted',
      'incoherent',
      'failed',
      'failed_cleanup',
    ] as const) {
      expect(describeScheduleOutcome(outcome).length).toBeGreaterThan(0);
    }
  });
});

describe('costanti di contratto', () => {
  it('coincidono con quelle server-side', () => {
    expect(FORCE_CLOSE_GRACE_SECONDS).toBe(60);
    expect(MAX_FORCE_CLOSE_BATCH).toBe(60);
  });
});
