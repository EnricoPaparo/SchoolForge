import { describe, expect, it } from 'vitest';
import {
  decideForceSubmit,
  forceSubmitWrites,
  ForceSubmitError,
  generateDeliveryCode,
  isCanonicalDeliveryCode,
  parseForceSubmitInput,
  resultForDecision,
  submissionIdFor,
  type ForceSubmitContext,
} from './forceSubmitCore.js';

const OWNER = 'owner-uid';
const STUDENT = 'stud-a';
const VERIFICATION = 'ver-1';
const SUBMISSION_ID = `${VERIFICATION}_${STUDENT}`;
const CODE = 'SF-2026-A1B2';

function context(over: Partial<ForceSubmitContext> = {}): ForceSubmitContext {
  return {
    callerUid: OWNER,
    input: { verificationId: VERIFICATION, studentUid: STUDENT },
    verification: { ownerUid: OWNER },
    submission: {
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION,
      studentUid: STUDENT,
      ownerUid: OWNER,
      status: 'draft',
      deliveryCode: null,
      forcedByTeacher: undefined,
    },
    receipt: null,
    ...over,
  };
}

const codeFor = () => CODE;

describe('parseForceSubmitInput — input chiuso', () => {
  it('accetta esattamente verificationId e studentUid', () => {
    expect(parseForceSubmitInput({ verificationId: 'v1', studentUid: 'u1' })).toEqual({
      verificationId: 'v1',
      studentUid: 'u1',
    });
  });

  it('rifiuta input non-oggetto', () => {
    for (const bad of [null, undefined, 'stringa', 42, [], true]) {
      expect(() => parseForceSubmitInput(bad)).toThrow(ForceSubmitError);
    }
  });

  it('rifiuta chiavi extra, incluse quelle che il client non deve poter proporre', () => {
    for (const extra of [
      'ownerUid',
      'submissionId',
      'deliveryCode',
      'status',
      'submittedAt',
      'answers',
      'forcedByTeacher',
      'lastSavedAt',
    ]) {
      expect(() =>
        parseForceSubmitInput({ verificationId: 'v1', studentUid: 'u1', [extra]: 'x' }),
      ).toThrow(/chiavi non ammesse/);
    }
  });

  it('rifiuta id mancanti, vuoti o malformati', () => {
    expect(() => parseForceSubmitInput({ verificationId: 'v1' })).toThrow(ForceSubmitError);
    expect(() => parseForceSubmitInput({ verificationId: '', studentUid: 'u1' })).toThrow(
      /verificationId/,
    );
    expect(() => parseForceSubmitInput({ verificationId: 'a/b', studentUid: 'u1' })).toThrow(
      /verificationId/,
    );
    expect(() => parseForceSubmitInput({ verificationId: 'v1', studentUid: 'a/b' })).toThrow(
      /studentUid/,
    );
    expect(() => parseForceSubmitInput({ verificationId: 'v1', studentUid: 42 })).toThrow(
      /studentUid/,
    );
    expect(() => parseForceSubmitInput({ verificationId: '..', studentUid: 'u1' })).toThrow(
      /verificationId/,
    );
  });
});

describe('generateDeliveryCode — formato canonico server-side', () => {
  it('usa il formato SF-YYYY-XXXX con l’alfabeto senza caratteri ambigui', () => {
    const code = generateDeliveryCode(2026, () => 0);
    expect(code).toBe('SF-2026-AAAA');
    expect(isCanonicalDeliveryCode(code)).toBe(true);
  });

  it('riconosce come non canonico qualunque altra forma', () => {
    for (const bad of ['SF-26-AAAA', 'XX-2026-AAAA', 'SF-2026-AAA', 'SF-2026-aaaa', '', null, 42]) {
      expect(isCanonicalDeliveryCode(bad)).toBe(false);
    }
  });
});

describe('decideForceSubmit — autorizzazione e precondizioni', () => {
  it('richiede autenticazione', () => {
    expect(() => decideForceSubmit(context({ callerUid: null }), codeFor)).toThrow(
      /Autenticazione/,
    );
  });

  it('richiede una verifica esistente', () => {
    expect(() => decideForceSubmit(context({ verification: null }), codeFor)).toThrow(
      /Verifica non trovata/,
    );
  });

  it('nega a un docente che non possiede la verifica', () => {
    try {
      decideForceSubmit(context({ verification: { ownerUid: 'altro-owner' } }), codeFor);
      throw new Error('atteso permission_denied');
    } catch (err) {
      expect((err as ForceSubmitError).code).toBe('permission_denied');
    }
  });

  it('non crea nulla per uno studente che non ha iniziato', () => {
    try {
      decideForceSubmit(context({ submission: null }), codeFor);
      throw new Error('atteso not_found');
    } catch (err) {
      expect((err as ForceSubmitError).code).toBe('not_found');
      expect((err as ForceSubmitError).message).toMatch(/non ha ancora iniziato/);
    }
  });

  it('rifiuta una submission incoerente con verifica, studente o owner', () => {
    const incoherent = [
      { submissionId: 'altro_id' },
      { verificationId: 'altra-verifica' },
      { studentUid: 'altro-studente' },
      { ownerUid: 'altro-owner' },
    ];
    for (const patch of incoherent) {
      const ctx = context();
      expect(() =>
        decideForceSubmit({ ...ctx, submission: { ...ctx.submission!, ...patch } }, codeFor),
      ).toThrow(/incoerente/);
    }
  });

  it('rifiuta uno stato diverso da draft o submitted', () => {
    const ctx = context();
    expect(() =>
      decideForceSubmit({ ...ctx, submission: { ...ctx.submission!, status: 'boh' } }, codeFor),
    ).toThrow(/non è in bozza/);
  });

  it('rifiuta una bozza che porta già il marcatore forcedByTeacher', () => {
    const ctx = context();
    expect(() =>
      decideForceSubmit(
        { ...ctx, submission: { ...ctx.submission!, forcedByTeacher: true } },
        codeFor,
      ),
    ).toThrow(/stato incoerente/);
  });
});

describe('decideForceSubmit — draft valido', () => {
  it('chiude la bozza generando un codice server-side', () => {
    const decision = decideForceSubmit(context(), codeFor);
    expect(decision).toEqual({ kind: 'apply', submissionId: SUBMISSION_ID, deliveryCode: CODE });
    expect(resultForDecision(decision)).toEqual({ status: 'submitted' });
  });

  it('usa sempre l’id deterministico, mai uno proposto dall’esterno', () => {
    expect(submissionIdFor(VERIFICATION, STUDENT)).toBe(SUBMISSION_ID);
    const decision = decideForceSubmit(context(), codeFor);
    expect(decision.kind === 'apply' && decision.submissionId).toBe(SUBMISSION_ID);
  });
});

describe('decideForceSubmit — concorrenza e idempotenza', () => {
  const forcedSubmission = {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    status: 'submitted',
    deliveryCode: CODE,
    forcedByTeacher: true,
  };
  const coherentReceipt = {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    deliveryCode: CODE,
    forcedByTeacher: true,
  };

  it('replay: chiusura già completata ⇒ successo idempotente senza scritture', () => {
    const decision = decideForceSubmit(
      context({ submission: forcedSubmission, receipt: coherentReceipt }),
      () => {
        throw new Error('nessun nuovo codice deve essere generato in un replay');
      },
    );
    expect(decision).toEqual({ kind: 'already_forced' });
    expect(resultForDecision(decision)).toEqual({ status: 'submitted' });
  });

  it('consegna normale dello studente nel frattempo ⇒ esito leggibile, nessuna modifica', () => {
    const decision = decideForceSubmit(
      context({
        submission: { ...forcedSubmission, forcedByTeacher: undefined },
        receipt: { ...coherentReceipt, forcedByTeacher: undefined },
      }),
      () => {
        throw new Error('nessun codice per una consegna già effettuata');
      },
    );
    expect(decision).toEqual({ kind: 'already_submitted' });
    expect(resultForDecision(decision)).toEqual({ status: 'already_submitted' });
  });

  it('fail-closed se la chiusura risulta fatta ma la receipt manca o è incoerente', () => {
    const broken = [
      null,
      { ...coherentReceipt, deliveryCode: 'SF-2026-ZZZZ' },
      { ...coherentReceipt, studentUid: 'altro' },
      { ...coherentReceipt, ownerUid: 'altro' },
      { ...coherentReceipt, verificationId: 'altra' },
      { ...coherentReceipt, submissionId: 'altro_id' },
      { ...coherentReceipt, forcedByTeacher: undefined },
      { ...coherentReceipt, deliveryCode: 'non-canonico' },
    ];
    for (const receipt of broken) {
      expect(() =>
        decideForceSubmit(context({ submission: forcedSubmission, receipt }), codeFor),
      ).toThrow(/ricevuta mancante o incoerente/);
    }
  });
});

describe('forceSubmitWrites — le due sole scritture della chiusura', () => {
  const NOW = Symbol('serverTimestamp');
  const decision = { kind: 'apply' as const, submissionId: SUBMISSION_ID, deliveryCode: CODE };
  const input = { verificationId: VERIFICATION, studentUid: STUDENT };
  const submission = {
    ownerUid: OWNER,
    verificationTitle: 'Verifica Reti',
    className: 'Classe 3A',
  };

  it('l’update tocca esattamente i quattro campi della chiusura', () => {
    const { submissionUpdate } = forceSubmitWrites(decision, input, submission, NOW);
    expect(Object.keys(submissionUpdate).sort()).toEqual([
      'deliveryCode',
      'forcedByTeacher',
      'status',
      'submittedAt',
    ]);
    expect(submissionUpdate).toEqual({
      status: 'submitted',
      deliveryCode: CODE,
      submittedAt: NOW,
      forcedByTeacher: true,
    });
  });

  it('non tocca mai lastSavedAt né i contenuti dello studente', () => {
    const { submissionUpdate, receipt } = forceSubmitWrites(decision, input, submission, NOW);
    for (const forbidden of [
      'lastSavedAt',
      'answers',
      'flagged',
      'attentionEvents',
      'assignedQuestionOrders',
      'assignedAnswerKeys',
      'startedAt',
    ]) {
      expect(forbidden in submissionUpdate).toBe(false);
      expect(forbidden in receipt).toBe(false);
    }
  });

  it('la ricevuta usa solo dati server-side, con lo stesso codice della submission', () => {
    const { submissionUpdate, receipt } = forceSubmitWrites(decision, input, submission, NOW);
    expect(receipt).toEqual({
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION,
      studentUid: STUDENT,
      ownerUid: OWNER,
      verificationTitle: 'Verifica Reti',
      className: 'Classe 3A',
      deliveryCode: CODE,
      submittedAt: NOW,
      forcedByTeacher: true,
    });
    // Stesso codice e stesso istante su entrambi i documenti: un solo commit.
    expect(receipt.deliveryCode).toBe(submissionUpdate.deliveryCode);
    expect(receipt.submittedAt).toBe(submissionUpdate.submittedAt);
  });

  it('normalizza titolo e classe mancanti senza inventare valori', () => {
    const { receipt } = forceSubmitWrites(decision, input, { ownerUid: OWNER }, NOW);
    expect(receipt.verificationTitle).toBe('');
    expect(receipt.className).toBeNull();
  });

  it('il marcatore è sempre il letterale true, mai false', () => {
    const { submissionUpdate, receipt } = forceSubmitWrites(decision, input, submission, NOW);
    expect(submissionUpdate.forcedByTeacher).toBe(true);
    expect(receipt.forcedByTeacher).toBe(true);
  });
});
