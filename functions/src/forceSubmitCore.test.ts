import { describe, expect, it } from 'vitest';
import {
  decideForceSubmit,
  forceSubmitWrites,
  isValidDocumentId,
  sameTimestamp,
  timestampKey,
  utf8ByteLength,
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

/** Timestamp Firestore-like deterministico (nessun Date.now()). */
function ts(seconds: number, nanoseconds = 0) {
  return { seconds, nanoseconds };
}

const SUBMITTED_AT = ts(1_800_000_000, 123);
const TITLE = 'Verifica Reti';
const CLASS_NAME = 'Classe 3A';

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
      verificationTitle: TITLE,
      className: CLASS_NAME,
      submittedAt: null,
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
    expect(decision).toEqual({
      kind: 'apply',
      submissionId: SUBMISSION_ID,
      deliveryCode: CODE,
      ownerUid: OWNER,
      verificationTitle: TITLE,
      className: CLASS_NAME,
    });
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
    verificationTitle: TITLE,
    className: CLASS_NAME,
    submittedAt: SUBMITTED_AT,
  };
  const coherentReceipt = {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    deliveryCode: CODE,
    forcedByTeacher: true,
    verificationTitle: TITLE,
    className: CLASS_NAME,
    submittedAt: SUBMITTED_AT,
  };
  /** Consegna normale dello studente: nessun marcatore su nessuno dei due documenti. */
  const normalSubmission = { ...forcedSubmission, forcedByTeacher: undefined };
  const normalReceipt = { ...coherentReceipt, forcedByTeacher: undefined };

  /** Generatore che esplode: prova che nessuna di queste vie genera un codice. */
  const noCode = () => {
    throw new Error('nessun codice deve essere generato in questa via');
  };

  it('replay: chiusura forzata coerente ⇒ successo idempotente senza scritture', () => {
    const decision = decideForceSubmit(
      context({ submission: forcedSubmission, receipt: coherentReceipt }),
      noCode,
    );
    expect(decision).toEqual({ kind: 'already_forced' });
    expect(resultForDecision(decision)).toEqual({ status: 'submitted' });
  });

  it('consegna normale coerente ⇒ already_submitted, nessuna modifica', () => {
    const decision = decideForceSubmit(
      context({ submission: normalSubmission, receipt: normalReceipt }),
      noCode,
    );
    expect(decision).toEqual({ kind: 'already_submitted' });
    expect(resultForDecision(decision)).toEqual({ status: 'already_submitted' });
  });

  it('chiusura forzata: ricevuta mancante o incoerente in un qualunque campo ⇒ fail-closed', () => {
    const broken = [
      null,
      { ...coherentReceipt, submissionId: 'altro_id' },
      { ...coherentReceipt, verificationId: 'altra' },
      { ...coherentReceipt, studentUid: 'altro' },
      { ...coherentReceipt, ownerUid: 'altro' },
      { ...coherentReceipt, deliveryCode: 'SF-2026-ZZZZ' },
      { ...coherentReceipt, deliveryCode: 'non-canonico' },
      { ...coherentReceipt, submittedAt: ts(1_800_000_000, 124) },
      { ...coherentReceipt, submittedAt: null },
      { ...coherentReceipt, verificationTitle: 'Altro titolo' },
      { ...coherentReceipt, className: 'Altra classe' },
      { ...coherentReceipt, forcedByTeacher: undefined },
      { ...coherentReceipt, forcedByTeacher: false },
    ];
    for (const receipt of broken) {
      expect(() =>
        decideForceSubmit(context({ submission: forcedSubmission, receipt }), noCode),
      ).toThrow(/ricevuta mancante o incoerente/);
    }
  });

  it('consegna normale: ricevuta assente ⇒ fail-closed, mai already_submitted', () => {
    try {
      decideForceSubmit(context({ submission: normalSubmission, receipt: null }), noCode);
      throw new Error('atteso failed_precondition');
    } catch (err) {
      expect((err as ForceSubmitError).code).toBe('failed_precondition');
      expect((err as ForceSubmitError).message).toMatch(/ricevuta mancante o incoerente/);
    }
  });

  it('consegna normale: ricevuta incoerente in un qualunque campo ⇒ fail-closed', () => {
    const broken = [
      { ...normalReceipt, submissionId: 'altro_id' },
      { ...normalReceipt, verificationId: 'altra' },
      { ...normalReceipt, studentUid: 'altro' },
      { ...normalReceipt, ownerUid: 'altro' },
      { ...normalReceipt, deliveryCode: 'SF-2026-ZZZZ' },
      { ...normalReceipt, deliveryCode: null },
      { ...normalReceipt, submittedAt: ts(1_800_000_001) },
      { ...normalReceipt, submittedAt: undefined },
      { ...normalReceipt, verificationTitle: 'Altro titolo' },
      { ...normalReceipt, verificationTitle: '' },
      { ...normalReceipt, className: 'Altra classe' },
    ];
    for (const receipt of broken) {
      expect(() =>
        decideForceSubmit(context({ submission: normalSubmission, receipt }), noCode),
      ).toThrow(/ricevuta mancante o incoerente/);
    }
  });

  it('consegna normale con marcatore inatteso su un qualunque documento ⇒ fail-closed', () => {
    // Marcatore `false` sulla submission: valore non ammesso dal contratto.
    for (const value of [false, null, 'true', 1]) {
      expect(() =>
        decideForceSubmit(
          context({
            submission: { ...normalSubmission, forcedByTeacher: value },
            receipt: normalReceipt,
          }),
          noCode,
        ),
      ).toThrow(/stato incoerente/);
    }
    // Marcatore presente sulla sola ricevuta di una consegna normale.
    for (const value of [true, false, null]) {
      expect(() =>
        decideForceSubmit(
          context({
            submission: normalSubmission,
            receipt: { ...normalReceipt, forcedByTeacher: value },
          }),
          noCode,
        ),
      ).toThrow(/ricevuta mancante o incoerente/);
    }
  });

  it('bozza con ricevuta già esistente ⇒ fail-closed, nessuna sovrascrittura', () => {
    try {
      decideForceSubmit(context({ receipt: normalReceipt }), noCode);
      throw new Error('atteso failed_precondition');
    } catch (err) {
      expect((err as ForceSubmitError).code).toBe('failed_precondition');
      expect((err as ForceSubmitError).message).toMatch(/ricevuta già esistente/);
    }
    // Vale per qualunque ricevuta, anche già marcata.
    expect(() => decideForceSubmit(context({ receipt: coherentReceipt }), noCode)).toThrow(
      /ricevuta già esistente/,
    );
  });
});

describe('decideForceSubmit — metadati fail-closed (nessun fallback)', () => {
  const noCode = () => {
    throw new Error('nessun codice per una bozza con metadati non validi');
  };

  it('rifiuta un titolo mancante, vuoto o malformato', () => {
    for (const verificationTitle of [
      undefined,
      null,
      '',
      '   ',
      42,
      {},
      'x'.repeat(1001),
      'a\u0000b',
    ]) {
      expect(() =>
        decideForceSubmit(
          context({ submission: { ...context().submission!, verificationTitle } }),
          noCode,
        ),
      ).toThrow(/titolo verifica valido/);
    }
  });

  it('rifiuta una className malformata ma ammette esplicitamente null', () => {
    for (const className of [undefined, '', '  ', 42, {}, 'x'.repeat(1001)]) {
      expect(() =>
        decideForceSubmit(context({ submission: { ...context().submission!, className } }), noCode),
      ).toThrow(/classe non valida/);
    }
    const decision = decideForceSubmit(
      context({ submission: { ...context().submission!, className: null } }),
      codeFor,
    );
    expect(decision.kind === 'apply' && decision.className).toBeNull();
  });

  it('rifiuta un ownerUid non canonico', () => {
    const ctx = context();
    // `ownerUid` diverso dal chiamante è già bloccato dalla coerenza; qui il
    // caso è un chiamante il cui uid non è una stringa canonica.
    // Una stringa vuota è già respinta come «non autenticato»: qui interessano
    // gli uid presenti ma non canonici.
    for (const uid of ['   ', 'a/b', 'x'.repeat(1001)]) {
      expect(() =>
        decideForceSubmit(
          {
            ...ctx,
            callerUid: uid,
            verification: { ownerUid: uid },
            submission: { ...ctx.submission!, ownerUid: uid },
          },
          noCode,
        ),
      ).toThrow(/proprietario non valido/);
    }
  });

  it('la decisione applicabile trasporta i metadati già validati', () => {
    const decision = decideForceSubmit(context(), codeFor);
    expect(decision).toEqual({
      kind: 'apply',
      submissionId: SUBMISSION_ID,
      deliveryCode: CODE,
      ownerUid: OWNER,
      verificationTitle: TITLE,
      className: CLASS_NAME,
    });
  });
});

describe('timestampKey / sameTimestamp — confronto deterministico', () => {
  it('riconosce i Timestamp Firestore e gli equivalenti serializzati', () => {
    expect(timestampKey(ts(10, 5))).toBe('10.000000005');
    expect(timestampKey({ _seconds: 10, _nanoseconds: 5 })).toBe('10.000000005');
    // Nanosecondi assenti ⇒ zero, non «malformato».
    expect(timestampKey({ seconds: 10 })).toBe('10.000000000');
  });

  it('non riconosce valori che non sono timestamp', () => {
    for (const bad of [
      null,
      undefined,
      0,
      'ora',
      {},
      { seconds: 'x' },
      { seconds: 1.5 },
      ts(1, -1),
      ts(1, 1e9),
    ]) {
      expect(timestampKey(bad)).toBeNull();
    }
  });

  it('due istanti uguali combaciano, un valore non riconoscibile non combacia mai', () => {
    expect(sameTimestamp(ts(10, 5), { _seconds: 10, _nanoseconds: 5 })).toBe(true);
    expect(sameTimestamp(ts(10, 5), ts(10, 6))).toBe(false);
    expect(sameTimestamp(null, null)).toBe(false);
    expect(sameTimestamp(undefined, undefined)).toBe(false);
  });
});

describe('isValidDocumentId — limite in byte UTF-8', () => {
  it('conta i byte reali, non i caratteri', () => {
    expect(utf8ByteLength('abc')).toBe(3);
    expect(utf8ByteLength('é')).toBe(2);
    expect(utf8ByteLength('日')).toBe(3);
    expect(utf8ByteLength('😀')).toBe(4);
  });

  it('rifiuta un segmento entro 1500 caratteri ma oltre 1500 byte', () => {
    // 800 caratteri accentati = 1600 byte: il vecchio controllo sui caratteri
    // lo avrebbe lasciato passare.
    const segment = 'é'.repeat(800);
    expect(segment.length).toBeLessThanOrEqual(1500);
    expect(utf8ByteLength(segment)).toBeGreaterThan(1500);
    expect(isValidDocumentId(segment)).toBe(false);
    expect(() => parseForceSubmitInput({ verificationId: segment, studentUid: 'u1' })).toThrow(
      /verificationId/,
    );
    expect(() => parseForceSubmitInput({ verificationId: 'v1', studentUid: segment })).toThrow(
      /studentUid/,
    );
  });

  it('rifiuta due segmenti validi il cui id concatenato supera il limite', () => {
    const half = 'a'.repeat(800);
    expect(isValidDocumentId(half)).toBe(true);
    // 800 + 1 + 800 = 1601 byte.
    expect(() => parseForceSubmitInput({ verificationId: half, studentUid: half })).toThrow(
      /Identificatore consegna non valido/,
    );
  });

  it('rifiuta caratteri di controllo e forme riservate', () => {
    for (const bad of ['a\u0000b', 'a\u001fb', '__x__', '.', '..', 'a/b', '']) {
      expect(isValidDocumentId(bad)).toBe(false);
    }
  });
});

describe('forceSubmitWrites — le due sole scritture della chiusura', () => {
  const NOW = Symbol('serverTimestamp');
  const decision = {
    kind: 'apply' as const,
    submissionId: SUBMISSION_ID,
    deliveryCode: CODE,
    ownerUid: OWNER,
    verificationTitle: TITLE,
    className: CLASS_NAME,
  };
  const input = { verificationId: VERIFICATION, studentUid: STUDENT };

  it('l’update tocca esattamente i quattro campi della chiusura', () => {
    const { submissionUpdate } = forceSubmitWrites(decision, input, NOW);
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
    const { submissionUpdate, receipt } = forceSubmitWrites(decision, input, NOW);
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

  it('la ricevuta usa solo i valori già validati, con lo stesso codice e istante', () => {
    const { submissionUpdate, receipt } = forceSubmitWrites(decision, input, NOW);
    expect(receipt).toEqual({
      submissionId: SUBMISSION_ID,
      verificationId: VERIFICATION,
      studentUid: STUDENT,
      ownerUid: OWNER,
      verificationTitle: TITLE,
      className: CLASS_NAME,
      deliveryCode: CODE,
      submittedAt: NOW,
      forcedByTeacher: true,
    });
    expect(receipt.deliveryCode).toBe(submissionUpdate.deliveryCode);
    expect(receipt.submittedAt).toBe(submissionUpdate.submittedAt);
  });

  it('nessun fallback: i metadati arrivano dalla decisione, mai normalizzati qui', () => {
    const { receipt } = forceSubmitWrites({ ...decision, className: null }, input, NOW);
    expect(receipt.className).toBeNull();
    expect(receipt.verificationTitle).toBe(TITLE);
  });

  it('il marcatore è sempre il letterale true, mai false', () => {
    const { submissionUpdate, receipt } = forceSubmitWrites(decision, input, NOW);
    expect(submissionUpdate.forcedByTeacher).toBe(true);
    expect(receipt.forcedByTeacher).toBe(true);
  });
});

describe('zero scritture in ogni via non applicabile', () => {
  /**
   * Rispecchia esattamente il gateway: si compongono scritture **solo** quando
   * la decisione è `apply`. Contando le scritture pianificate si dimostra che
   * ogni altra via — errore o esito idempotente — non ne produce nessuna.
   */
  function planWrites(ctx: ForceSubmitContext): unknown[] {
    const decision = decideForceSubmit(ctx, codeFor);
    if (decision.kind !== 'apply') return [];
    const { submissionUpdate, receipt } = forceSubmitWrites(
      decision,
      ctx.input,
      Symbol('serverTimestamp'),
    );
    return [submissionUpdate, receipt];
  }

  const base = context().submission!;
  const submitted = {
    ...base,
    status: 'submitted',
    deliveryCode: CODE,
    submittedAt: SUBMITTED_AT,
  };
  const receipt = {
    submissionId: SUBMISSION_ID,
    verificationId: VERIFICATION,
    studentUid: STUDENT,
    ownerUid: OWNER,
    deliveryCode: CODE,
    forcedByTeacher: undefined as unknown,
    verificationTitle: TITLE,
    className: CLASS_NAME,
    submittedAt: SUBMITTED_AT,
  };

  const rejected: [string, ForceSubmitContext][] = [
    ['non autenticato', context({ callerUid: null })],
    ['verifica assente', context({ verification: null })],
    ['verifica di un altro docente', context({ verification: { ownerUid: 'altro' } })],
    ['studente che non ha iniziato', context({ submission: null })],
    ['submission incoerente', context({ submission: { ...base, studentUid: 'altro' } })],
    ['stato sconosciuto', context({ submission: { ...base, status: 'boh' } })],
    ['bozza già marcata', context({ submission: { ...base, forcedByTeacher: true } })],
    ['bozza con ricevuta esistente', context({ receipt })],
    ['titolo mancante', context({ submission: { ...base, verificationTitle: '' } })],
    ['className malformata', context({ submission: { ...base, className: 42 } })],
    ['consegna normale senza ricevuta', context({ submission: submitted, receipt: null })],
    [
      'consegna normale con ricevuta incoerente',
      context({ submission: submitted, receipt: { ...receipt, submittedAt: ts(1, 0) } }),
    ],
    [
      'consegna normale con marcatore inatteso',
      context({ submission: { ...submitted, forcedByTeacher: false }, receipt }),
    ],
    [
      'chiusura forzata senza ricevuta coerente',
      context({ submission: { ...submitted, forcedByTeacher: true }, receipt: null }),
    ],
  ];

  it.each(rejected)('«%s» ⇒ errore e zero scritture', (_label, ctx) => {
    let writes: unknown[] = [];
    expect(() => {
      writes = planWrites(ctx);
    }).toThrow(ForceSubmitError);
    expect(writes).toHaveLength(0);
  });

  it('gli esiti idempotenti non producono scritture', () => {
    // Replay di una chiusura forzata coerente.
    expect(
      planWrites(
        context({
          submission: { ...submitted, forcedByTeacher: true },
          receipt: { ...receipt, forcedByTeacher: true },
        }),
      ),
    ).toHaveLength(0);
    // Consegna normale coerente.
    expect(planWrites(context({ submission: submitted, receipt }))).toHaveLength(0);
  });

  it('la sola via applicabile produce esattamente due scritture', () => {
    expect(planWrites(context())).toHaveLength(2);
  });
});
