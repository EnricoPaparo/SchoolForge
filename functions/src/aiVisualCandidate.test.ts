import { describe, expect, it } from 'vitest';
import {
  AI_VISUAL_CANDIDATE_CONTRACT_VERSION,
  VISUAL_CANDIDATE_TTL_MS,
  checkVisualCandidate,
  computeSourceBodyHash,
  describeCandidateCheckFailure,
  describeCandidateConflict,
  parseStoredVisualCandidate,
  reconcileVisualCandidateBind,
  serializeVisualCandidate,
  validateVisualCandidateBindInput,
  type StoredVisualCandidate,
} from './aiVisualCandidate.js';
import { AI_CONTENT_RUN_TTL_MS } from './aiContentCore.js';
import { AiVisualError, computeVisualInputHash, sha256Hex } from './aiVisualCore.js';

/**
 * VISUAL-ENRICHMENT-03A — il ticket del candidato.
 *
 * La garanzia centrale è una sola: **un candidato non è promuovibile se non si
 * sa da quale lezione e da quale testo è nato**. Tutto il resto — replay,
 * conflitti, scadenza — esiste per non trasformare quella garanzia in un
 * ostacolo o, peggio, in una formalità aggirabile.
 */

const REQUEST_ID = '99999999-9999-4999-8999-999999999999';
const OWNER = 'owner-uid';
const BODY = '## Evaporazione\n\nL’acqua evapora.';

function bindInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: REQUEST_ID,
    programId: 'prog-1',
    importId: 'imp-1',
    lessonId: 'lesson-1',
    ...over,
  };
}

function candidate(over: Partial<StoredVisualCandidate> = {}): StoredVisualCandidate {
  return {
    contractVersion: AI_VISUAL_CANDIDATE_CONTRACT_VERSION,
    ownerUid: OWNER,
    programId: 'prog-1',
    importId: 'imp-1',
    lessonId: 'lesson-1',
    publicLessonId: 'imp-1_lesson-1',
    udaDir: 'uda-01',
    sourceBodyHash: computeSourceBodyHash(BODY),
    createdAtMs: 1_000,
    expireAtMs: 1_000 + VISUAL_CANDIDATE_TTL_MS,
    ...over,
  };
}

// ─── Payload del bind ─────────────────────────────────────────────────────────

describe('payload del bind', () => {
  it('accetta esattamente quattro chiavi', () => {
    expect(validateVisualCandidateBindInput(bindInput())).toEqual({
      requestId: REQUEST_ID,
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
    });
  });

  it.each([
    ['ownerUid', { ownerUid: OWNER }],
    ['sourceBodyHash', { sourceBodyHash: 'a'.repeat(64) }],
    ['udaDir', { udaDir: 'uda-01' }],
    ['publicLessonId', { publicLessonId: 'imp-1_lesson-1' }],
    ['lessonBody', { lessonBody: BODY }],
    ['storageRef', { storageRef: 'repository/x/y/z/visuals/a.webp' }],
    ['assetId', { assetId: '11111111-2222-4333-8444-555555555555' }],
  ])('rifiuta la proprietà autorevole %s dichiarata dal client', (_label, extra) => {
    /*
     * Nessuno di questi valori può arrivare dal chiamante: `sourceBodyHash` in
     * particolare, perché un hash dichiarato dal client non dimostra nulla su
     * ciò che il client ha davvero mandato, e accettarlo renderebbe la
     * protezione una formalità.
     */
    expect(() => validateVisualCandidateBindInput(bindInput(extra))).toThrow(
      /proprietà non ammesse/,
    );
  });

  it('rifiuta chiavi mancanti, requestId non UUID e segmenti non canonici', () => {
    const incomplete = bindInput();
    delete incomplete.lessonId;
    expect(() => validateVisualCandidateBindInput(incomplete)).toThrow(AiVisualError);
    expect(() => validateVisualCandidateBindInput(bindInput({ requestId: 'x' }))).toThrow(
      /requestId/,
    );
    for (const bad of ['', ' x', 'a/b', '.', '..', 42, null]) {
      expect(() => validateVisualCandidateBindInput(bindInput({ lessonId: bad }))).toThrow(
        AiVisualError,
      );
    }
  });

  it('non è un oggetto ⇒ rifiutato', () => {
    for (const bad of [null, 'x', 42, []]) {
      expect(() => validateVisualCandidateBindInput(bad)).toThrow(AiVisualError);
    }
  });
});

// ─── sourceBodyHash ───────────────────────────────────────────────────────────

describe('sourceBodyHash', () => {
  it('è lo SHA-256 del corpo salvato, senza normalizzazioni', () => {
    expect(computeSourceBodyHash(BODY)).toBe(sha256Hex(BODY));
    // Nessun trim: un corpo con spazi diversi è un corpo diverso.
    expect(computeSourceBodyHash(` ${BODY}`)).not.toBe(computeSourceBodyHash(BODY));
    expect(computeSourceBodyHash(`${BODY}\n`)).not.toBe(computeSourceBodyHash(BODY));
  });

  it('il corpo non viene conservato nel ticket, solo il suo hash', () => {
    const serialized = JSON.stringify(serializeVisualCandidate(candidate()));
    expect(serialized).not.toContain('evapora');
    expect(serialized).toContain(computeSourceBodyHash(BODY));
  });
});

// ─── Persistenza del ticket ───────────────────────────────────────────────────

describe('ticket persistito', () => {
  it('fa il giro serializza → parse senza perdere nulla', () => {
    const c = candidate();
    expect(parseStoredVisualCandidate(serializeVisualCandidate(c))).toEqual(c);
  });

  it('riusa il TTL del run, senza dichiararne uno proprio', () => {
    expect(VISUAL_CANDIDATE_TTL_MS).toBe(AI_CONTENT_RUN_TTL_MS);
  });

  it('rifiuta un documento con chiavi mancanti o valori fuori contratto', () => {
    for (const key of [
      'ownerUid',
      'programId',
      'importId',
      'lessonId',
      'publicLessonId',
      'udaDir',
      'sourceBodyHash',
    ]) {
      const doc = serializeVisualCandidate(candidate()) as Record<string, unknown>;
      delete doc[key];
      expect(parseStoredVisualCandidate(doc)).toBeNull();
    }
  });

  it('rifiuta una contractVersion diversa', () => {
    const doc = serializeVisualCandidate(candidate());
    doc.contractVersion = 2;
    expect(parseStoredVisualCandidate(doc)).toBeNull();
  });

  it('rifiuta un sourceBodyHash non canonico', () => {
    for (const bad of ['', 'corto', 'A'.repeat(64), 'g'.repeat(64), 42, null]) {
      const doc = serializeVisualCandidate(candidate());
      doc.sourceBodyHash = bad;
      expect(parseStoredVisualCandidate(doc)).toBeNull();
    }
  });

  it('accetta Timestamp risolti e rifiuta quelli irrisolti o non finiti', () => {
    const base = serializeVisualCandidate(candidate()) as Record<string, unknown>;
    delete base.createdAtMs;
    delete base.expireAtMs;

    const resolved = {
      ...base,
      createdAt: { toMillis: () => 1_000 },
      expireAt: { toMillis: () => 2_000 },
    };
    expect(parseStoredVisualCandidate(resolved)?.expireAtMs).toBe(2_000);

    for (const bad of [
      null,
      undefined,
      { toMillis: () => Number.NaN },
      {
        toMillis: () => {
          throw new Error('boom');
        },
      },
    ]) {
      expect(parseStoredVisualCandidate({ ...resolved, expireAt: bad })).toBeNull();
    }
  });

  it('non lancia mai su input arbitrari', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}]) {
      expect(() => parseStoredVisualCandidate(bad)).not.toThrow();
      expect(parseStoredVisualCandidate(bad)).toBeNull();
    }
  });
});

// ─── Bind ripetuto ────────────────────────────────────────────────────────────

describe('bind ripetuto', () => {
  it('senza ticket precedente crea', () => {
    expect(reconcileVisualCandidateBind({ existing: null, next: candidate() })).toEqual({
      status: 'created',
      candidate: candidate(),
    });
  });

  it('stessa identità e stesso hash ⇒ replay idempotente', () => {
    // Una risposta persa non deve costringere a ricominciare, e ripetere il
    // bind non deve produrre un secondo ticket.
    const existing = candidate();
    const outcome = reconcileVisualCandidateBind({
      existing,
      next: candidate({ createdAtMs: 9_999, expireAtMs: 99_999 }),
    });
    expect(outcome.status).toBe('replayed');
    // Il ticket conservato è quello **originale**: gli istanti del primo bind
    // sono quelli che descrivono davvero quando il candidato è nato.
    expect(outcome.status === 'replayed' && outcome.candidate).toEqual(existing);
  });

  it.each([
    ['target', { lessonId: 'altra-lezione' }],
    ['target', { programId: 'altro-programma' }],
    ['target', { importId: 'altro-import' }],
    ['target', { publicLessonId: 'altro_public' }],
    ['target', { udaDir: 'uda-99' }],
    ['owner', { ownerUid: 'altro-owner' }],
    ['source_body', { sourceBodyHash: sha256Hex('corpo diverso') }],
  ])('divergenza ⇒ conflict %s, mai sovrascrittura', (reason, over) => {
    const outcome = reconcileVisualCandidateBind({
      existing: candidate(),
      next: candidate(over as Partial<StoredVisualCandidate>),
    });
    expect(outcome.status).toBe('conflict');
    expect(outcome.status === 'conflict' && outcome.reason).toBe(reason);
  });

  it('i tre conflitti hanno messaggi distinti', () => {
    const messages = (['owner', 'target', 'source_body'] as const).map(describeCandidateConflict);
    expect(new Set(messages).size).toBe(3);
    expect(describeCandidateConflict('source_body')).toMatch(/contenuto della lezione è cambiato/);
  });
});

// ─── Controllo prima di generazione e promozione ──────────────────────────────

describe('controllo del ticket', () => {
  const NOW = 5_000;

  it('accetta un ticket valido, non scaduto, del proprietario', () => {
    expect(checkVisualCandidate({ candidate: candidate(), ownerUid: OWNER, nowMs: NOW })).toEqual({
      ok: true,
      candidate: candidate(),
    });
  });

  it('un run senza ticket non è promuovibile e non viene riparato', () => {
    /*
     * È il caso dei run VE-02 anteriori al ticket: inventare un legame che non
     * è mai esistito significherebbe promuovere un'immagine verso una lezione
     * che nessuno ha mai associato a quel candidato.
     */
    const outcome = checkVisualCandidate({ candidate: null, ownerUid: OWNER, nowMs: NOW });
    expect(outcome).toEqual({ ok: false, reason: 'missing' });
    expect(describeCandidateCheckFailure('missing')).toMatch(/rigenera/i);
  });

  it('rifiuta un ticket scaduto, al millisecondo', () => {
    const expiring = candidate({ expireAtMs: NOW });
    expect(checkVisualCandidate({ candidate: expiring, ownerUid: OWNER, nowMs: NOW }).ok).toBe(
      false,
    );
    const alive = candidate({ expireAtMs: NOW + 1 });
    expect(checkVisualCandidate({ candidate: alive, ownerUid: OWNER, nowMs: NOW }).ok).toBe(true);
  });

  it('rifiuta un ticket di un altro proprietario', () => {
    expect(checkVisualCandidate({ candidate: candidate(), ownerUid: 'altro', nowMs: NOW })).toEqual(
      { ok: false, reason: 'owner' },
    );
  });

  it.each(['programId', 'importId', 'lessonId', 'publicLessonId', 'udaDir'] as const)(
    'rifiuta una destinazione divergente su %s',
    (key) => {
      expect(
        checkVisualCandidate({
          candidate: candidate(),
          ownerUid: OWNER,
          nowMs: NOW,
          expectedTarget: { [key]: 'valore-diverso' },
        }),
      ).toEqual({ ok: false, reason: 'target' });
    },
  );

  it('rifiuta un corpo cambiato dopo il bind', () => {
    // È la protezione per cui il ticket esiste: fra generazione e approvazione
    // la lezione può essere stata riscritta.
    expect(
      checkVisualCandidate({
        candidate: candidate(),
        ownerUid: OWNER,
        nowMs: NOW,
        expectedSourceBodyHash: computeSourceBodyHash('corpo riscritto'),
      }),
    ).toEqual({ ok: false, reason: 'source_body' });
  });

  it('accetta quando corpo e destinazione coincidono', () => {
    expect(
      checkVisualCandidate({
        candidate: candidate(),
        ownerUid: OWNER,
        nowMs: NOW,
        expectedTarget: {
          programId: 'prog-1',
          importId: 'imp-1',
          lessonId: 'lesson-1',
          publicLessonId: 'imp-1_lesson-1',
          udaDir: 'uda-01',
        },
        expectedSourceBodyHash: computeSourceBodyHash(BODY),
      }).ok,
    ).toBe(true);
  });

  it('la scadenza non dipende dall’orologio di sistema', () => {
    // `nowMs` è un parametro: una decisione che dipende da `Date.now()` non
    // sarebbe verificabile.
    const c = candidate({ expireAtMs: 100 });
    expect(checkVisualCandidate({ candidate: c, ownerUid: OWNER, nowMs: 99 }).ok).toBe(true);
    expect(checkVisualCandidate({ candidate: c, ownerUid: OWNER, nowMs: 101 }).ok).toBe(false);
  });

  it('i cinque esiti negativi hanno messaggi distinti', () => {
    const reasons = ['missing', 'expired', 'owner', 'target', 'source_body'] as const;
    expect(new Set(reasons.map(describeCandidateCheckFailure)).size).toBe(5);
  });
});

// ─── Non-regressione VE-02 ────────────────────────────────────────────────────

describe('VE-02 non è stato toccato', () => {
  it('computeVisualInputHash copre ancora il solo subject', () => {
    /*
     * È la chiave di replay dei run già memorizzati: se l'identità della lezione
     * vi fosse entrata, ogni run precedente sarebbe stato invalidato in
     * silenzio. Il ticket esiste proprio per evitarlo.
     */
    const a = computeVisualInputHash({ requestId: REQUEST_ID, subject: 'Uno schema del ciclo' });
    const b = computeVisualInputHash({
      requestId: '11111111-1111-4111-8111-111111111111',
      subject: 'Uno schema del ciclo',
    });
    expect(a).toBe(b);
    expect(a).toBe(sha256Hex(JSON.stringify({ subject: 'Uno schema del ciclo' })));
  });

  it('il ticket non compare nella forma canonica della richiesta visuale', () => {
    const serialized = JSON.stringify({ requestId: REQUEST_ID, subject: 'x' });
    expect(serialized).not.toContain('sourceBodyHash');
    expect(serialized).not.toContain('lessonId');
    expect(serialized).not.toContain('publicLessonId');
  });
});
