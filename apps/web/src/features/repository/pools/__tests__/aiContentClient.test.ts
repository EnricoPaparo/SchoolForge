import { describe, expect, it } from 'vitest';
import {
  buildLessonContentRequest,
  buildPoolContentRequest,
  describeAiContentError,
  formatMicroUsd,
  missingLessonRequirements,
  newRequestId,
  type LessonAiContext,
  type LessonUdaContext,
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
    expect(describeAiContentError({ details: { code: 'output_incomplete' } })).toMatch(
      /interrotta prima di completare/,
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

/** Contesto completo secondo il contratto AIGEN-CONTEXT-01. */
const UDA_CONTEXT = {
  title: 'UDA 1',
  descrizione: 'Le reti locali e il loro funzionamento.',
  competenze: ['Progettare una LAN'],
  obiettivi: ['Riconoscere i livelli'],
  currentLessonPosition: 2,
  lessons: [
    { position: 1, titolo: 'Introduzione', sottotitolo: null },
    { position: 2, titolo: 'Le reti', sottotitolo: 'Trasporto' },
    { position: 3, titolo: 'Il routing', sottotitolo: null },
  ],
};

function fullContext(over: Partial<LessonAiContext> = {}): LessonAiContext {
  return {
    titolo: 'Le reti',
    sottotitolo: null,
    difficolta: 'intermedia',
    udaTitle: 'UDA 1',
    concettiChiave: ['TCP', 'IP'],
    obiettivi: ['capire i livelli'],
    udaContext: UDA_CONTEXT,
    currentBody: '',
    ...over,
  };
}

describe('buildLessonContentRequest (AIGEN-03 / AIGEN-CONTEXT-01 closed lesson payload)', () => {
  it('builds a closed lesson payload, derives hasCurrentContent, omits an empty sottotitolo', () => {
    const req = buildLessonContentRequest({
      requestId: REQ,
      modelProfile: 'economy',
      depth: 'complete',
      context: fullContext({
        titolo: '  Le reti  ',
        sottotitolo: '',
        concettiChiave: ['TCP', '  ', 'IP'],
        currentBody: '## Reti\nContenuto',
      }),
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
      difficolta: 'intermedia',
      udaTitle: 'UDA 1',
      concettiChiave: ['TCP', 'IP'],
      obiettivi: ['capire i livelli'],
      udaContext: UDA_CONTEXT,
      currentBody: '## Reti\nContenuto',
    });
    // Sottotitolo vuoto omesso; nessun campo server-only.
    expect('sottotitolo' in req).toBe(false);
    expect('modelId' in req).toBe(false);
    expect('ownerUid' in req).toBe(false);
  });

  it('omits currentBody and sets hasCurrentContent=false for an empty editor', () => {
    const req = buildLessonContentRequest({
      requestId: REQ,
      modelProfile: 'quality',
      depth: 'synthetic',
      context: fullContext({ currentBody: '   ' }),
    });
    expect(req.hasCurrentContent).toBe(false);
    expect('currentBody' in req).toBe(false);
    expect('teacherGuidance' in req).toBe(false);
  });

  it('never sends technical IDs in the UDA outline', () => {
    const req = buildLessonContentRequest({
      requestId: REQ,
      modelProfile: 'economy',
      depth: 'complete',
      context: fullContext(),
    });
    const serialized = JSON.stringify(req);
    for (const forbidden of [
      'lessonId',
      'udaId',
      'udaDir',
      'filename',
      'storageRef',
      'publicLessonId',
      'ownerUid',
      'importId',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const item of req.udaContext.lessons) {
      expect(Object.keys(item).sort()).toEqual(['position', 'sottotitolo', 'titolo']);
    }
  });

  it('refuses fail-closed to build a payload when required metadata is missing', () => {
    for (const over of [
      { titolo: '  ' },
      { difficolta: null },
      { concettiChiave: [] },
      { obiettivi: ['   '] },
      { udaTitle: null },
      { udaContext: null },
    ] as Partial<LessonAiContext>[]) {
      expect(() =>
        buildLessonContentRequest({
          requestId: REQ,
          modelProfile: 'economy',
          depth: 'complete',
          context: fullContext(over),
        }),
      ).toThrow(/Metadati della lezione incompleti/);
    }
  });
});

describe('missingLessonRequirements (preflight, AIGEN-CONTEXT-01)', () => {
  it('accepts a complete context, and a missing sottotitolo does not block', () => {
    expect(missingLessonRequirements(fullContext())).toEqual([]);
    expect(missingLessonRequirements(fullContext({ sottotitolo: null }))).toEqual([]);
    expect(missingLessonRequirements(fullContext({ sottotitolo: '' }))).toEqual([]);
  });

  it('lists exactly the missing required fields', () => {
    expect(missingLessonRequirements(fullContext({ titolo: '' }))).toEqual(['titolo']);
    expect(missingLessonRequirements(fullContext({ difficolta: '  ' }))).toEqual(['difficolta']);
    expect(missingLessonRequirements(fullContext({ concettiChiave: ['  '] }))).toEqual([
      'concettiChiave',
    ]);
    expect(missingLessonRequirements(fullContext({ obiettivi: [] }))).toEqual(['obiettivi']);
    expect(missingLessonRequirements(fullContext({ udaTitle: null }))).toEqual(['udaTitle']);
    expect(missingLessonRequirements(fullContext({ udaContext: null }))).toEqual(['udaContext']);
    // Più campi mancanti → elenco completo, nell'ordine del contratto.
    expect(
      missingLessonRequirements(fullContext({ titolo: '', difficolta: '', obiettivi: [] })),
    ).toEqual(['titolo', 'difficolta', 'obiettivi']);
  });

  it('rejects an incoherent UDA outline (empty, unordered, or bad current position)', () => {
    const bad: LessonUdaContext[] = [
      { ...UDA_CONTEXT, currentLessonPosition: 1, lessons: [] },
      {
        ...UDA_CONTEXT,
        title: 'UDA 1',
        currentLessonPosition: 1,
        lessons: [
          { position: 2, titolo: 'A', sottotitolo: null },
          { position: 1, titolo: 'B', sottotitolo: null },
        ],
      },
      {
        ...UDA_CONTEXT,
        title: 'UDA 1',
        currentLessonPosition: 5,
        lessons: [{ position: 1, titolo: 'A', sottotitolo: null }],
      },
      {
        ...UDA_CONTEXT,
        title: '  ',
        currentLessonPosition: 1,
        lessons: [{ position: 1, titolo: 'A', sottotitolo: null }],
      },
      {
        ...UDA_CONTEXT,
        title: 'UDA 1',
        currentLessonPosition: 1,
        lessons: [{ position: 1, titolo: '  ', sottotitolo: null }],
      },
    ];
    for (const udaContext of bad) {
      expect(missingLessonRequirements(fullContext({ udaContext }))).toContain('udaContext');
    }
  });
});
