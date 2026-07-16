import { describe, expect, it } from 'vitest';
import {
  buildRequest,
  describeAiError,
  describeExclusion,
  newRequestId,
  type AiExclusionReason,
} from '../aiCorrectionClient.js';

/**
 * M5-03 — client callable IA: payload **chiuso** (solo i tre ID), requestId
 * stabile, etichette leggibili senza dati sensibili.
 */

describe('buildRequest', () => {
  it('emits exactly the three closed IDs and nothing else', () => {
    const req = buildRequest('ver1', ['ver1_s1', 'ver1_s2'], 'req-1');
    expect(Object.keys(req).sort()).toEqual(['requestId', 'submissionIds', 'verificationId']);
    expect(req).toEqual({
      verificationId: 'ver1',
      submissionIds: ['ver1_s1', 'ver1_s2'],
      requestId: 'req-1',
    });
  });

  it('copies the submissionIds array (no shared reference)', () => {
    const ids = ['a', 'b'];
    const req = buildRequest('v', ids, 'r');
    expect(req.submissionIds).not.toBe(ids);
    expect(req.submissionIds).toEqual(ids);
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
  });

  it('falls back to a generic message for unknown errors', () => {
    expect(describeAiError(new Error('boom'))).toBe(
      'Impossibile completare l’operazione di correzione IA. Riprova.',
    );
  });
});
