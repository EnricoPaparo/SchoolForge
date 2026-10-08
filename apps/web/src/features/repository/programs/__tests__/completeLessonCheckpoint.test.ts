import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCompleteLessonCheckpoint,
  completeLessonCheckpointKey,
  createCompleteLessonCheckpoint,
  parseCompleteLessonCheckpoint,
  readCompleteLessonCheckpoint,
  writeCompleteLessonCheckpoint,
} from '../completeLessonCheckpoint.js';

const identity = { programId: 'program', importId: 'import', lessonId: 'lesson' };
const body = '## Lezione\n\nContenuto già salvato.';

function checkpoint(nowMs = 1_000) {
  return createCompleteLessonCheckpoint({
    identity,
    body,
    nowMs,
    options: {
      level: 'balanced',
      counts: { aperta: 5, chiusa_singola: 3, chiusa_multipla: 2 },
      modelProfile: 'quality',
      reviewStatus: 'improved',
    },
    bodyPersisted: true,
    mapCompleted: true,
    poolCompleted: false,
    mapRequestId: 'map-request',
    poolRequestId: 'pool-request',
    mapCostMicroUsd: 12,
    poolCostMicroUsd: 0,
    visual: {
      contentRequestId: 'content-request',
      planRequestId: 'plan-request',
      promotionRequestIds: { '0': 'promotion-request' },
    },
  });
}

describe('complete lesson session checkpoint', () => {
  beforeEach(() => window.sessionStorage.clear());
  it('whitelists checkpoint fields so transient summaries cannot reach browser storage', () => {
    const value = { ...checkpoint(Date.now()), reviewReports: { map: 'PRIVATE REPORT' } };
    Object.assign(value.options, { reviewFeedback: { changes: ['PRIVATE REPORT'] } });
    writeCompleteLessonCheckpoint(value);
    const raw = window.sessionStorage.getItem(completeLessonCheckpointKey(identity));
    expect(raw).not.toContain('PRIVATE REPORT');
    expect(raw).not.toContain('reviewFeedback');
    expect(raw).not.toContain('reviewReports');
    expect(readCompleteLessonCheckpoint(identity, body)).not.toBeNull();
  });

  it('ripristina soltanto la stessa lezione e lo stesso corpo entro il TTL', () => {
    const value = checkpoint();
    const raw = JSON.stringify(value);
    expect(parseCompleteLessonCheckpoint(raw, identity, body, 2_000)).toEqual(value);
    expect(parseCompleteLessonCheckpoint(raw, identity, `${body} cambiato`, 2_000)).toBeNull();
    expect(
      parseCompleteLessonCheckpoint(raw, { ...identity, lessonId: 'altra' }, body, 2_000),
    ).toBeNull();
    expect(parseCompleteLessonCheckpoint(raw, identity, body, value.expiresAtMs)).toBeNull();
  });

  it('non conserva il testo della lezione, prompt o indicazioni nel browser', () => {
    writeCompleteLessonCheckpoint(checkpoint(Date.now()));
    const raw = window.sessionStorage.getItem(completeLessonCheckpointKey(identity));
    expect(raw).not.toContain(body);
    expect(raw).not.toContain('prompt');
    expect(raw).not.toContain('guidance');
    expect(readCompleteLessonCheckpoint(identity, body)).not.toBeNull();
    clearCompleteLessonCheckpoint(identity);
    expect(window.sessionStorage.getItem(completeLessonCheckpointKey(identity))).toBeNull();
  });

  it('ignora e rimuove checkpoint corrotti', () => {
    window.sessionStorage.setItem(completeLessonCheckpointKey(identity), '{rotto');
    expect(readCompleteLessonCheckpoint(identity, body)).toBeNull();
    expect(window.sessionStorage.getItem(completeLessonCheckpointKey(identity))).toBeNull();
  });
});
