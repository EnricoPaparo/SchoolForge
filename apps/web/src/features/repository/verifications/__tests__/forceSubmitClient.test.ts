import { describe, expect, it, vi } from 'vitest';
import type { Functions } from 'firebase/functions';

const httpsCallable = vi.hoisted(() => vi.fn());
vi.mock('firebase/functions', () => ({ httpsCallable }));

const {
  createForceSubmitSubmission,
  describeForceSubmitBlocked,
  describeForceSubmitError,
  forceSubmitBlockedReason,
} = await import('../forceSubmitClient.js');

const functions = {} as Functions;

describe('createForceSubmitSubmission — contratto della callable', () => {
  it('invoca `forceSubmitSubmission` con esattamente verificationId e studentUid', async () => {
    const call = vi.fn(async (_req: unknown) => ({ data: { status: 'submitted' as const } }));
    httpsCallable.mockReturnValue(call);

    const forceSubmit = createForceSubmitSubmission(functions);
    const res = await forceSubmit({ verificationId: 'v1', studentUid: 'u1' });

    expect(httpsCallable).toHaveBeenCalledWith(functions, 'forceSubmitSubmission');
    expect(call).toHaveBeenCalledTimes(1);
    const payload = call.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['studentUid', 'verificationId']);
    expect(res).toEqual({ status: 'submitted' });
  });

  it('non propaga mai campi extra proposti dal chiamante', async () => {
    const call = vi.fn(async (_req: unknown) => ({
      data: { status: 'already_submitted' as const },
    }));
    httpsCallable.mockReturnValue(call);

    const forceSubmit = createForceSubmitSubmission(functions);
    await forceSubmit({
      verificationId: 'v1',
      studentUid: 'u1',
      // Campi server-only: non devono raggiungere la callable.
      forcedByTeacher: true,
      deliveryCode: 'SF-2026-AAAA',
      status: 'submitted',
      ownerUid: 'owner',
    } as never);

    expect(call.mock.calls[0]![0]).toEqual({ verificationId: 'v1', studentUid: 'u1' });
  });
});

describe('describeForceSubmitError', () => {
  it.each([
    ['functions/unauthenticated', /Sessione scaduta/],
    ['functions/permission-denied', /questo account/],
    ['functions/not-found', /Nessuna consegna/],
    ['functions/invalid-argument', /non valida/],
    ['functions/failed-precondition', /non è più in bozza/],
    ['functions/internal', /Impossibile chiudere/],
  ])('mappa %s in un messaggio leggibile', (code, expected) => {
    expect(describeForceSubmitError({ code })).toMatch(expected);
  });

  it('non espone dettagli tecnici per un errore sconosciuto', () => {
    expect(describeForceSubmitError(new Error('stack interno con uid segreto'))).toBe(
      'Impossibile chiudere la consegna. Riprova.',
    );
  });
});

describe('forceSubmitBlockedReason — unica derivazione enabled/disabled', () => {
  const draft = { status: 'draft' as const };

  it('abilita l’azione solo su una bozza esistente, senza correzione e non occupata', () => {
    expect(forceSubmitBlockedReason({ item: draft, correction: null, busy: false })).toBeNull();
  });

  it.each([
    ['non iniziata', { item: null, correction: null, busy: false }, 'not_started'],
    ['non iniziata (undefined)', { item: undefined, correction: null, busy: false }, 'not_started'],
    [
      'già consegnata',
      { item: { status: 'submitted' as const }, correction: null, busy: false },
      'already_submitted',
    ],
    [
      'correzione avviata',
      { item: draft, correction: { status: 'in_progress' as const }, busy: false },
      'correction_started',
    ],
    ['chiusura in corso', { item: draft, correction: null, busy: true }, 'busy'],
  ])('blocca il caso «%s»', (_label, input, expected) => {
    expect(forceSubmitBlockedReason(input as never)).toBe(expected);
  });

  it('`busy` ha la precedenza: una riga in corso non è mai ri-cliccabile', () => {
    expect(forceSubmitBlockedReason({ item: null, correction: null, busy: true })).toBe('busy');
  });

  it('ogni motivo ha una spiegazione non vuota', () => {
    for (const reason of [
      'not_started',
      'already_submitted',
      'correction_started',
      'busy',
    ] as const) {
      expect(describeForceSubmitBlocked(reason).length).toBeGreaterThan(0);
    }
  });
});
