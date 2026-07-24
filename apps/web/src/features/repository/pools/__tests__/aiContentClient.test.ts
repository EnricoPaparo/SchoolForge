import { describe, expect, it } from 'vitest';
import {
  buildLessonContentRequest,
  buildPoolContentRequest,
  describeAiContentError,
  formatMicroUsd,
  newRequestId,
} from '../aiContentClient.js';

const REQ = '11111111-2222-3333-4444-555555555555';

describe('buildPoolContentRequest', () => {
  it('builds the closed payload with only allowed fields', () => {
    const req = buildPoolContentRequest({
      requestId: REQ,
      modelProfile: 'quality',
      level: 'balanced',
      counts: { aperta: 2, chiusa_singola: 1, chiusa_multipla: 0 },
      lessonSource: 'Le reti.',
      existingPoolQuestionCount: 5,
      teacherGuidance: '  sii conciso  ',
    });
    expect(req).toEqual({
      kind: 'pool',
      requestId: REQ,
      modelProfile: 'quality',
      level: 'balanced',
      counts: { aperta: 2, chiusa_singola: 1, chiusa_multipla: 0 },
      lessonSource: 'Le reti.',
      existingPoolQuestionCount: 5,
      teacherGuidance: 'sii conciso',
    });
    // Never leaks server-only fields.
    expect(Object.keys(req)).not.toContain('ownerUid');
    expect(Object.keys(req)).not.toContain('modelId');
  });

  it('omits an empty/whitespace guidance', () => {
    const req = buildPoolContentRequest({
      requestId: REQ,
      modelProfile: 'economy',
      level: 'base',
      counts: { aperta: 1, chiusa_singola: 0, chiusa_multipla: 0 },
      lessonSource: 'x',
      existingPoolQuestionCount: 0,
      teacherGuidance: '   ',
    });
    expect('teacherGuidance' in req).toBe(false);
  });
});

describe('newRequestId', () => {
  it('returns a fresh UUID each call', () => {
    expect(newRequestId()).not.toBe(newRequestId());
    expect(newRequestId()).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('describeAiContentError (sanitized)', () => {
  it('maps stable gateway codes to readable messages, never raw details', () => {
    expect(describeAiContentError({ details: { code: 'feature_disabled' } })).toMatch(
      /disattivata/,
    );
    expect(describeAiContentError({ details: { code: 'budget_exceeded' } })).toMatch(/[Bb]udget/);
    expect(describeAiContentError({ details: { code: 'running' } })).toMatch(/già in corso/);
    expect(describeAiContentError({ details: { code: 'run_conflict' } })).toMatch(/Ricalcola/);
    expect(describeAiContentError({ details: { code: 'provider_unavailable' } })).toMatch(
      /non è disponibile/,
    );
    // Unknown → generic, never the raw error text.
    const msg = describeAiContentError(new Error('sk-secret internal stacktrace'));
    expect(msg).toBe('Impossibile completare la generazione IA. Riprova.');
    expect(msg).not.toMatch(/sk-secret/);
  });
  it('falls back on https codes when details.code absent', () => {
    expect(describeAiContentError({ code: 'functions/unauthenticated' })).toMatch(/Sessione/);
    expect(describeAiContentError({ code: 'functions/permission-denied' })).toMatch(/proprietario/);
  });
});

describe('formatMicroUsd', () => {
  it('formats micro-USD integers as USD with 6 decimals', () => {
    expect(formatMicroUsd(1_250_000)).toBe('1.250000 USD');
    expect(formatMicroUsd(0)).toBe('0.000000 USD');
  });
});

describe('buildLessonContentRequest (AIGEN-03 closed lesson payload)', () => {
  it('builds a closed lesson payload, derives hasCurrentContent, omits empty context', () => {
    const req = buildLessonContentRequest({
      requestId: REQ,
      modelProfile: 'economy',
      depth: 'complete',
      context: {
        titolo: '  Le reti  ',
        sottotitolo: '',
        udaTitle: 'UDA 1',
        concettiChiave: ['TCP', '  ', 'IP'],
        obiettivi: [],
        currentBody: '## Reti\nContenuto',
      },
      teacherGuidance: '  tono formale  ',
    });
    expect(req).toEqual({
      kind: 'lesson',
      requestId: REQ,
      modelProfile: 'economy',
      depth: 'complete',
      hasCurrentContent: true,
      teacherGuidance: 'tono formale',
      titolo: 'Le reti',
      udaTitle: 'UDA 1',
      concettiChiave: ['TCP', 'IP'],
      currentBody: '## Reti\nContenuto',
    });
    // Empty sottotitolo/obiettivi omitted; never leaks server-only fields.
    expect('sottotitolo' in req).toBe(false);
    expect('obiettivi' in req).toBe(false);
    expect('modelId' in req).toBe(false);
    expect('ownerUid' in req).toBe(false);
  });

  it('omits currentBody and sets hasCurrentContent=false for an empty editor', () => {
    const req = buildLessonContentRequest({
      requestId: REQ,
      modelProfile: 'quality',
      depth: 'synthetic',
      context: { titolo: 'T', currentBody: '   ' },
    });
    expect(req.hasCurrentContent).toBe(false);
    expect('currentBody' in req).toBe(false);
    expect('teacherGuidance' in req).toBe(false);
  });
});
