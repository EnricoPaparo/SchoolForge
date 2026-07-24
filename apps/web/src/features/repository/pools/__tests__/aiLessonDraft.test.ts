import { describe, expect, it } from 'vitest';
import { validateLessonDraftResult } from '../aiLessonDraft.js';
import type { AiLessonGenerateResult } from '../aiContentClient.js';

function result(over: Partial<AiLessonGenerateResult> = {}): AiLessonGenerateResult {
  return {
    status: 'completed',
    kind: 'lesson',
    modelProfile: 'gpt-5.6-luna',
    output: { body: '## Reti\n\nContenuto della lezione.' },
    actualCostMicroUsd: 1000,
    replayed: false,
    ...over,
  };
}

describe('validateLessonDraftResult (fail-closed)', () => {
  it('accepts a coherent lesson body', () => {
    const r = validateLessonDraftResult(result());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body).toContain('Reti');
  });
  it('rejects a wrong kind', () => {
    const r = validateLessonDraftResult(result({ kind: 'pool' as never }));
    expect(r.ok).toBe(false);
  });
  it('rejects an empty body', () => {
    expect(validateLessonDraftResult(result({ output: { body: '   ' } })).ok).toBe(false);
  });
  it('rejects a body starting with front matter', () => {
    const r = validateLessonDraftResult(result({ output: { body: '---\ntitolo: x\n---\n# a' } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/front matter/);
  });
  it('rejects an oversized body via the canonical size guard', () => {
    const r = validateLessonDraftResult(result({ output: { body: 'a'.repeat(700_001) } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/dimensione/);
  });
});
