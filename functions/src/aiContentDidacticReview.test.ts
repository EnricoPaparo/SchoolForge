import { parseStoredRunDocument, serializeRun } from './aiContentRunDoc.js';
import { estimateContentCost } from './aiContentCost.js';
import { AI_CONTENT_CONTRACT_VERSION } from './aiContentCore.js';
import type { StoredAiContentRun } from './aiContentEngine.js';
import { describe, expect, it } from 'vitest';
import {
  canonicalRequest,
  validateAiContentRequest,
  resolveContentModelForRequest,
  type PoolReviewRequest,
  type ConceptMapReviewRequest,
} from './aiContentCore.js';
import { composeConceptMapMarkdown } from './aiContentConceptMap.js';
import {
  buildDidacticReviewPrompt,
  validatePoolReview as validatePoolReviewCanonical,
  validateMapReview,
  isValidStoredDidacticReview,
  assertNoDuplicateStems,
} from './aiContentDidacticReview.js';
import { buildContentStructuredRequest } from './aiContentPayload.js';
import { computeContentLeaseTtlMs } from './aiContentEngine.js';
import { retryPolicyFromConfig } from './aiContentGateway.js';
// Existing repair fixtures focus on replacement invariants; all now carry explicit support.
const evidence = (request: PoolReviewRequest) =>
  request.candidateQuestions.map((q) => ({
    questionOrder: q.order,
    capability: 'Comprendere la rete',
    operation: 'Definire il significato',
    status: 'prepared',
    sourceQuote: request.lessonSource,
  }));
const validatePoolReview = (raw: unknown, request: PoolReviewRequest) =>
  validatePoolReviewCanonical(
    {
      sourceInsufficient: false,
      preparationEvidence: evidence(request),
      ...(raw as object),
    },
    request,
  );
const base = {
  kind: 'pool' as const,
  requestId: '11111111-1111-4111-8111-111111111111',
  modelProfile: 'quality' as const,
  teacherGuidance: null,
  level: 'balanced' as const,
  counts: { aperta: 2, chiusa_singola: 0, chiusa_multipla: 0 },
  lessonSource: 'Una rete connette nodi tramite collegamenti.',
  existingPoolQuestionCount: 0,
};
const candidateQuestions = [
  {
    order: 0,
    tipo: 'aperta' as const,
    testo: 'Definisci nodo.',
    difficolta: 2,
    soluzione: 'Un dispositivo connesso.',
  },
  {
    order: 1,
    tipo: 'aperta' as const,
    testo: 'Definisci collegamento.',
    difficolta: 2,
    soluzione: 'Una connessione fra nodi.',
  },
];
const pool = () =>
  validateAiContentRequest({
    ...base,
    kind: 'pool_review',
    candidateQuestions,
  }) as PoolReviewRequest;
const candidateMarkdown = composeConceptMapMarkdown({
  summaryMarkdown: 'Una rete collega nodi.',
  diagram: 'Rete -> collega -> nodi',
});
const map = () =>
  validateAiContentRequest({
    kind: 'concept_map_review',
    requestId: base.requestId,
    modelProfile: 'quality',
    lessonBody: base.lessonSource,
    candidateMarkdown,
  }) as ConceptMapReviewRequest;
describe('didactic content review', () => {
  it('preserves old pool canonical hash without stems and binds stems when supplied', () => {
    const plain = validateAiContentRequest(base);
    expect(canonicalRequest(plain)).toEqual(
      canonicalRequest(validateAiContentRequest({ ...base, existingQuestionStems: [] })),
    );
    expect(canonicalRequest(plain)).not.toEqual(
      canonicalRequest(
        validateAiContentRequest({ ...base, existingQuestionStems: ['Altra domanda.'] }),
      ),
    );
  });
  it('limits stems and rejects malformed candidates and extra keys', () => {
    expect(() =>
      validateAiContentRequest({ ...base, existingQuestionStems: ['x'.repeat(2001)] }),
    ).toThrow();
    expect(() =>
      validateAiContentRequest({ ...base, existingQuestionStems: Array(1001).fill('x') }),
    ).toThrow();
    expect(() =>
      validateAiContentRequest({
        ...base,
        kind: 'pool_review',
        candidateQuestions: [{ ...candidateQuestions[0], order: 9 }, candidateQuestions[1]],
      }),
    ).toThrow();
    expect(() =>
      validateAiContentRequest({
        ...base,
        kind: 'pool_review',
        candidateQuestions,
        model: 'arbitrary',
      }),
    ).toThrow();
  });
  it('pins review model without changing generators and versions hashes independently', () => {
    expect(resolveContentModelForRequest(pool()).model).toBe('gpt-6.1-sol');
    expect(resolveContentModelForRequest(map()).model).toBe('gpt-5.6-luna');
    expect(resolveContentModelForRequest(validateAiContentRequest(base)).model).toBe('gpt-6.1-sol');
    expect(canonicalRequest(pool())).toContain('pool_review-v7');
    expect(canonicalRequest(map())).toContain('concept_map_review-v6');
    expect(buildContentStructuredRequest(pool(), 'gpt-5.6-luna').max_output_tokens).toBe(16000);
  });
  it('unchanged preserves authoritative candidate despite provider output', () => {
    const request = pool();
    const result = validatePoolReview(
      { reviewOutcome: 'unchanged', issueCodes: [], failedOrdinals: [], replacementQuestions: [] },
      request,
    );
    expect(result.questions).toBe(request.candidateQuestions);
    expect(() =>
      validatePoolReview(
        {
          reviewOutcome: 'unchanged',
          issueCodes: [],
          failedOrdinals: [0],
          replacementQuestions: [],
        },
        request,
      ),
    ).toThrow();
  });
  it('repairs only failed ordinal and rejects invalid index,type,count,difficulty', () => {
    const request = pool();
    const replacement = {
      tipo: 'aperta',
      testo: 'Spiega il ruolo di un nodo.',
      difficolta: 2,
      soluzione: 'Un nodo comunica nella rete.',
    };
    const output = {
      reviewOutcome: 'improved',
      issueCodes: ['incomplete_solution'],
      failedOrdinals: [0],
      replacementQuestions: [replacement],
    };
    const result = validatePoolReview(output, request);
    for (const extra of [{ order: 99 }, { extra: 'x' }, { soluzioneIndici: [0] }])
      expect(() =>
        validatePoolReview(
          { ...output, replacementQuestions: [{ ...replacement, ...extra }] },
          request,
        ),
      ).toThrow();
    expect(result.questions[1]).toEqual(request.candidateQuestions[1]);
    expect(result.questions[0]?.testo).toBe(replacement.testo);
    expect(() => validatePoolReview({ ...output, failedOrdinals: [30] }, request)).toThrow();
    expect(() =>
      validatePoolReview(
        { ...output, failedOrdinals: [0, 0], replacementQuestions: [replacement, replacement] },
        request,
      ),
    ).toThrow();
    expect(() =>
      validatePoolReview(
        { ...output, replacementQuestions: [{ ...replacement, tipo: 'chiusa_singola' }] },
        request,
      ),
    ).toThrow();
    const filtered = validatePoolReview(
      { ...output, replacementQuestions: [{ ...replacement, difficolta: 6 }] },
      request,
    );
    expect(filtered.questions).toHaveLength(1);
    expect(filtered.discardedQuestions).toHaveLength(1);
    expect(isValidStoredDidacticReview('pool_review', result)).toBe(true);
  });
  it('rejects duplicates within pool and against normalized existing stems', () => {
    expect(() => assertNoDuplicateStems(candidateQuestions, ['  DEFINISCI   NODO. '])).toThrow();
    expect(() =>
      assertNoDuplicateStems([
        candidateQuestions[0]!,
        { ...candidateQuestions[1]!, testo: candidateQuestions[0]!.testo },
      ]),
    ).toThrow();
  });
  it('unchanged maps preserve original and source issues never silently rewrite it', () => {
    const request = map();
    const raw = {
      summaryMarkdown: 'La rete contiene nodi.',
      diagram: 'Rete -> contiene -> nodi',
      reviewOutcome: 'unchanged',
      issueCodes: [],
      sourceIssue: false,
    };
    const result = validateMapReview(raw, request);
    expect(result.conceptMapMarkdown).toBe(candidateMarkdown);
    expect(isValidStoredDidacticReview('concept_map_review', result)).toBe(true);
    const issue = validateMapReview(
      { ...raw, reviewOutcome: 'improved', issueCodes: ['source_issue'], sourceIssue: true },
      request,
    );
    expect(issue.sourceIssue).toBe(true);
    expect(issue.conceptMapMarkdown).toBe(candidateMarkdown);
    expect(() => validateMapReview({ ...raw, sourceIssue: true }, request)).toThrow();
    expect(() =>
      validateMapReview({ ...raw, issueCodes: ['incorrect_relation'] }, request),
    ).toThrow();
  });
  it('reviews have bounded full provider lease under function deadline', () => {
    for (const kind of ['pool_review', 'concept_map_review']) {
      const policy = retryPolicyFromConfig(null, kind);
      expect(policy.attemptTimeoutMs).toBe(180000);
      expect(computeContentLeaseTtlMs(policy)).toBeLessThan(420000);
    }
  });
});

describe('didactic replay provenance', () => {
  it('roundtrips completed outputs and rejects missing provenance or malformed flags', () => {
    for (const request of [pool(), map()]) {
      const output =
        request.kind === 'pool_review'
          ? validatePoolReview(
              {
                reviewOutcome: 'unchanged',
                issueCodes: [],
                failedOrdinals: [],
                replacementQuestions: [],
              },
              request,
            )
          : validateMapReview(
              {
                summaryMarkdown: null,
                diagram: null,
                reviewOutcome: 'unchanged',
                issueCodes: [],
                sourceIssue: false,
              },
              request,
            );
      const run: StoredAiContentRun = {
        contractVersion: AI_CONTENT_CONTRACT_VERSION,
        promptContractVersion:
          request.kind === 'concept_map_review' ? 'concept_map_review-v6' : 'pool_review-v7',
        sourceBodyHash: 'b'.repeat(64),
        kind: request.kind,
        status: 'completed',
        inputHash: 'a'.repeat(64),
        modelProfile: 'quality',
        model: 'gpt-5.6-luna',
        priceListVersion: 'v8-2026-09-26-luna-cache-standard',
        estimatedInputTokens: 100,
        maxOutputTokens: 16000,
        actualInputTokens: 0,
        actualOutputTokens: 0,
        estimatedCostMicroUsd: 10,
        reservedCostMicroUsd: 100,
        settledCostMicroUsd: 0,
        actualCostMicroUsd: 0,
        leaseExecutionId: 'execution',
        leaseExpiresAtMs: 2000,
        output,
        createdAtMs: 1000,
        updatedAtMs: 1000,
        expireAtMs: 10000,
      };
      const serialized = serializeRun(run);
      expect(parseStoredRunDocument(serialized)).toEqual(run);
      expect(
        parseStoredRunDocument({ ...serialized, promptContractVersion: undefined }),
      ).toBeNull();
      expect(
        parseStoredRunDocument({ ...serialized, output: { ...output, issueCodes: ['arbitrary'] } }),
      ).toBeNull();
    }
  });
});

it('preserves valid untouched question bytes even while selectively repairing another', () => {
  const questions = [
    candidateQuestions[0]!,
    {
      ...candidateQuestions[1]!,
      testo: '  Definisci collegamento.\n',
      soluzione: ' Una connessione fra nodi.  ',
    },
  ];
  const request = validateAiContentRequest({
    ...base,
    kind: 'pool_review',
    candidateQuestions: questions,
  }) as PoolReviewRequest;
  const result = validatePoolReview(
    {
      reviewOutcome: 'improved',
      issueCodes: ['incomplete_solution'],
      failedOrdinals: [0],
      replacementQuestions: [
        {
          tipo: 'aperta',
          testo: 'Spiega il ruolo di un nodo.',
          difficolta: 2,
          soluzione: 'Un nodo comunica nella rete.',
        },
      ],
    },
    request,
  );
  expect(result.questions[1]).toBe(questions[1]);
  expect(JSON.stringify(result.questions[1])).toBe(JSON.stringify(questions[1]));
});
it('allows duplicate candidates to reach review and rejects an unchanged duplicate result', () => {
  const request = validateAiContentRequest({
    ...base,
    kind: 'pool_review',
    candidateQuestions: [
      candidateQuestions[0],
      { ...candidateQuestions[1], testo: candidateQuestions[0]!.testo },
    ],
  }) as PoolReviewRequest;
  expect(
    validatePoolReview(
      { reviewOutcome: 'unchanged', issueCodes: [], failedOrdinals: [], replacementQuestions: [] },
      request,
    ).discardedQuestions,
  ).toEqual([{ questionOrder: 1, reason: 'Domanda o soluzione non valida o duplicata.' }]);
  const result = validatePoolReview(
    {
      reviewOutcome: 'improved',
      issueCodes: ['duplicate'],
      failedOrdinals: [1],
      replacementQuestions: [
        {
          tipo: 'aperta',
          testo: 'Spiega il ruolo del collegamento.',
          difficolta: 2,
          soluzione: 'Il collegamento permette la comunicazione fra nodi.',
        },
      ],
    },
    request,
  );
  expect(result.questions[0]).toBe(request.candidateQuestions[0]);
});

it('blocks an insufficient-source audit before repair/outcome constraints and preserves legacy outputs', () => {
  expect(() => validatePoolReviewCanonical({ sourceInsufficient: true }, pool())).toThrow(
    expect.objectContaining({ code: 'provider_invalid_output' }),
  );
  const legacy = {
    reviewOutcome: 'unchanged',
    issueCodes: [],
    failedOrdinals: [],
    replacementQuestions: [],
  };
  expect(validatePoolReview({ ...legacy, sourceInsufficient: false }, pool())).toEqual(
    validatePoolReview(legacy, pool()),
  );
  expect(() => validatePoolReview({ ...legacy, sourceInsufficient: 'true' }, pool())).toThrow();
  expect(isValidStoredDidacticReview('pool_review', validatePoolReview(legacy, pool()))).toBe(true);
  const structured = buildContentStructuredRequest(pool(), 'gpt-5.6-luna');
  expect((structured.text.format.schema as { required: string[] }).required).toContain(
    'sourceInsufficient',
  );
});
it('forbids teaching a missing procedure inside a repaired assessment question', () => {
  const prompt = buildDidacticReviewPrompt(pool());
  expect(prompt.user).toContain('niente tutorial, nuove assunzioni operative');
  expect(prompt.user).toContain('Nuovi dati o contesti sono leciti soltanto');
  expect(prompt.user).toContain('nessuna riparazione applicabile');
});

it('filters unprepared or unverifiable proofs individually, normalizes typography and reindexes the accepted subset', () => {
  const request = pool();
  const raw = {
    sourceInsufficient: false,
    reviewOutcome: 'unchanged',
    issueCodes: [],
    failedOrdinals: [],
    replacementQuestions: [],
    preparationEvidence: evidence(request),
  };
  expect(validatePoolReviewCanonical(raw, request).questions).toEqual(request.candidateQuestions);
  for (const override of [
    { sourceInsufficient: undefined },
    { preparationEvidence: undefined },
    { preparationEvidence: [evidence(request)[0], evidence(request)[0]] },
  ])
    expect(() => validatePoolReviewCanonical({ ...raw, ...override }, request)).toThrow();
  for (const override of [
    { status: 'missing' },
    { sourceQuote: '' },
    { sourceQuote: 'Citazione inventata' },
  ]) {
    const result = validatePoolReviewCanonical(
      {
        ...raw,
        preparationEvidence: evidence(request).map((e, i) => (i === 0 ? { ...e, ...override } : e)),
      },
      request,
    );
    expect(result.questions).toEqual([{ ...request.candidateQuestions[1], order: 0 }]);
    expect(result.discardedQuestions).toHaveLength(1);
    expect(isValidStoredDidacticReview('pool_review', result)).toBe(true);
  }
  const empty = validatePoolReviewCanonical({ ...raw, preparationEvidence: [] }, request);
  expect(empty.questions).toEqual([]);
  expect(empty.discardedQuestions).toHaveLength(2);
  expect(isValidStoredDidacticReview('pool_review', empty)).toBe(true);
  const typography = { ...request, lessonSource: 'Una rete\r\n   collega i nodi.' };
  const prepared = evidence(request).map((e) => ({
    ...e,
    sourceQuote: 'Una rete collega i nodi.',
  }));
  expect(
    validatePoolReviewCanonical({ ...raw, preparationEvidence: prepared }, typography).questions,
  ).toHaveLength(2);
  const structured = buildContentStructuredRequest(request, 'gpt-5.6-luna');
  expect(
    (structured.text.format.schema as { properties: { preparationEvidence: unknown } }).properties
      .preparationEvidence,
  ).toMatchObject({ minItems: 2, maxItems: 2 });
});
it('uses the lesson quality reviewer and binds its model and price into audit identity and estimate', () => {
  const resolved = resolveContentModelForRequest(pool());
  expect(resolved).toEqual({
    model: 'gpt-6.1-sol',
    priceListVersion: 'v12-2026-09-29-gpt61-sol-standard',
  });
  expect(canonicalRequest(pool())).toContain(resolved.priceListVersion);
  expect(
    estimateContentCost(pool(), resolved.model, resolved.priceListVersion, 1)
      .reservationCostMicroUsd,
  ).toBeGreaterThan(0);
  expect(resolveContentModelForRequest(map()).model).toBe('gpt-5.6-luna');
});

it.each([null, ''])(
  'materializes compact unchanged map %j while retaining canonical replay and source provenance',
  (empty) => {
    const request = map();
    const before = canonicalRequest(request);
    const output = validateMapReview(
      {
        summaryMarkdown: empty,
        diagram: empty,
        reviewOutcome: 'unchanged',
        issueCodes: [],
        sourceIssue: false,
      },
      request,
    );
    expect(output.conceptMapMarkdown).toBe(candidateMarkdown);
    expect(isValidStoredDidacticReview('concept_map_review', output)).toBe(true);
    expect(canonicalRequest(request)).toBe(before);
    expect(() =>
      validateMapReview(
        {
          summaryMarkdown: empty,
          diagram: empty,
          reviewOutcome: 'improved',
          issueCodes: ['incorrect_relation'],
          sourceIssue: false,
        },
        request,
      ),
    ).toThrow();
  },
);

it('rebuilds coverage for accepted capabilities and drops advanced indices of discarded questions', () => {
  const request = pool();
  const proofs = evidence(request).map((e, i) => ({
    ...e,
    capability: i === 0 ? 'Solo scartata' : 'Accettata',
    status: i === 0 ? 'missing' : 'prepared',
  }));
  const raw = {
    sourceInsufficient: false,
    reviewOutcome: 'unchanged',
    issueCodes: [],
    failedOrdinals: [],
    replacementQuestions: [],
    preparationEvidence: proofs,
    coverageSummary: {
      coveredCapabilities: ['Solo scartata', 'Accettata'],
      gaps: [],
      advancedOrdinals: [0, 1],
    },
  };
  const result = validatePoolReviewCanonical(raw, request);
  expect(result.coverageSummary).toMatchObject({
    coveredCapabilities: ['Accettata'],
    advancedOrdinals: [0],
  });
  expect(
    validatePoolReviewCanonical({ ...raw, preparationEvidence: [] }, request).coverageSummary,
  ).toMatchObject({ coveredCapabilities: [], advancedOrdinals: [] });
});

it('discards existing stems with case, spacing and Unicode typography differences', () => {
  const request = pool();
  request.existingQuestionStems = [
    request.candidateQuestions[0]!.testo.toLocaleUpperCase('it').replaceAll(' ', '   '),
  ];
  const result = validatePoolReviewCanonical(
    {
      sourceInsufficient: false,
      preparationEvidence: evidence(request),
      reviewOutcome: 'unchanged',
      issueCodes: [],
      failedOrdinals: [],
      replacementQuestions: [],
    },
    request,
  );
  expect(result.questions).toHaveLength(1);
  expect(result.discardedQuestions?.[0]?.questionOrder).toBe(0);
});
