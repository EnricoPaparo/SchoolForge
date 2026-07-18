import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  describeAiError,
  describeExclusion,
  gradingModeDescription,
  DEFAULT_GRADING_MODE,
  GRADING_MODE_OPTIONS,
  newRequestId,
  type AiExclusionReason,
} from '../aiCorrectionClient.js';

/**
 * M5-03 — client callable IA: payload **chiuso** (ID + criteri), requestId
 * stabile, etichette leggibili senza dati sensibili.
 */

describe('buildRequest', () => {
  it('emits exactly the closed IDs + gradingMode and nothing else', () => {
    const req = buildRequest('ver1', ['ver1_s1', 'ver1_s2'], 'req-1', 'balanced');
    expect(Object.keys(req).sort()).toEqual([
      'gradingMode',
      'requestId',
      'submissionIds',
      'verificationId',
    ]);
    expect(req).toEqual({
      verificationId: 'ver1',
      submissionIds: ['ver1_s1', 'ver1_s2'],
      requestId: 'req-1',
      gradingMode: 'balanced',
    });
  });

  it('includes the trimmed teacherGuidance only when non-empty', () => {
    expect(buildRequest('v', ['v_a'], 'r', 'rigorous', '  spiega meglio  ').teacherGuidance).toBe(
      'spiega meglio',
    );
    expect(buildRequest('v', ['v_a'], 'r', 'rigorous', '   ')).not.toHaveProperty(
      'teacherGuidance',
    );
    expect(buildRequest('v', ['v_a'], 'r', 'compassionate').gradingMode).toBe('compassionate');
  });

  it('copies the submissionIds array (no shared reference)', () => {
    const ids = ['a', 'b'];
    const req = buildRequest('v', ids, 'r', 'balanced');
    expect(req.submissionIds).not.toBe(ids);
    expect(req.submissionIds).toEqual(ids);
  });
});

describe('grading mode metadata', () => {
  it('default is balanced and exposes the three labelled options', () => {
    expect(DEFAULT_GRADING_MODE).toBe('balanced');
    expect(GRADING_MODE_OPTIONS.map((o) => o.value)).toEqual([
      'compassionate',
      'balanced',
      'rigorous',
    ]);
    expect(GRADING_MODE_OPTIONS.map((o) => o.label)).toEqual([
      'Comprensivo',
      'Equilibrato',
      'Rigoroso',
    ]);
  });
  it('gives a distinct non-empty description per mode', () => {
    const descriptions = GRADING_MODE_OPTIONS.map((o) => gradingModeDescription(o.value));
    expect(new Set(descriptions).size).toBe(3);
    for (const d of descriptions) expect(d.length).toBeGreaterThan(0);
  });
});

describe('newRequestId', () => {
  it('returns distinct non-empty ids', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('describeExclusion', () => {
  const reasons: AiExclusionReason[] = [
    'not_found',
    'wrong_owner',
    'wrong_verification',
    'not_submitted',
    'snapshot_unavailable',
    'correction_not_in_progress',
    'nothing_to_grade',
    'too_large',
    'changed_since_preview',
    'write_error',
  ];
  it('maps every reason to a readable label', () => {
    for (const r of reasons) {
      const label = describeExclusion(r);
      expect(label.length).toBeGreaterThan(0);
    }
  });
});

describe('describeAiError', () => {
  it('recognises the stable gateway codes without leaking details', () => {
    expect(describeAiError({ details: { code: 'feature_disabled' } })).toBe(
      'La correzione assistita da IA è disattivata.',
    );
    expect(describeAiError({ code: 'functions/permission-denied' })).toBe(
      'Operazione riservata al docente proprietario.',
    );
    expect(describeAiError({ code: 'functions/unauthenticated' })).toBe(
      'Sessione scaduta: accedi di nuovo.',
    );
    expect(describeAiError({ details: { code: 'batch_limit_exceeded' } })).toBe(
      'Troppe consegne selezionate: riduci la selezione.',
    );
    expect(describeAiError({ details: { code: 'invalid_input' } })).toBe(
      'Selezione non valida. Riprova.',
    );
    expect(describeAiError({ details: { code: 'operation_budget_exceeded' } })).toContain(
      'singola operazione',
    );
    expect(describeAiError({ details: { code: 'daily_budget_exceeded' } })).toContain(
      'budget giornaliero',
    );
    expect(describeAiError({ details: { code: 'budget_exceeded' } })).toContain('budget mensile');
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(describeAiError(new Error('boom'))).toBe(
      'Impossibile completare l’operazione di correzione IA. Riprova.',
    );
  });
});
