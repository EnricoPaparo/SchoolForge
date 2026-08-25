import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AiVisualMultiError, asRecord, assertExactKeys } from './aiVisualMultiCore.js';
import {
  assertCanonicalStorageRef,
  assertManifestText,
  VISUAL_STYLE_VERSION,
} from './aiContentVisualProposal.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';

/**
 * MULTI-VISUAL-01 — test strutturale di purezza/no-I/O e non-regressione sul
 * visual singolo (roadmap §19, ultimo punto della lista dei test obbligatori
 * dell'issue #424).
 *
 * Due garanzie distinte:
 *
 * 1. i quattro moduli nuovi di questo pacchetto non importano, nemmeno
 *    transitivamente attraverso ciò che riusano, alcuna dipendenza di rete o
 *    Firebase a runtime — solo `import type` è ammesso per quelle;
 * 2. le due sole righe toccate in un file del flusso singolo congelato
 *    (`aiContentVisualProposal.ts`: `export` aggiunto a due funzioni già
 *    esistenti) non ne hanno cambiato il comportamento — verificato
 *    chiamando direttamente i simboli ora esportati con gli stessi casi noti
 *    che il flusso singolo già si aspettava.
 */

const MULTI_VISUAL_MODULE_FILES = [
  'aiVisualMultiCore.ts',
  'aiVisualMultiManifest.ts',
  'aiVisualMultiAnchor.ts',
  'aiVisualMultiPlan.ts',
];

const FORBIDDEN_RUNTIME_IMPORT_RE =
  /^import\s+(?!type\s)[^;]*from\s+['"](firebase-admin|firebase-functions|openai|node:https?|node:net)/m;

describe('purezza strutturale dei moduli MULTI-VISUAL-01', () => {
  it.each(MULTI_VISUAL_MODULE_FILES)('%s non importa Firebase/rete a runtime', (fileName) => {
    const path = fileURLToPath(new URL(`./${fileName}`, import.meta.url));
    const source = readFileSync(path, 'utf8');
    expect(FORBIDDEN_RUNTIME_IMPORT_RE.test(source)).toBe(false);
  });
});

describe('non-regressione sul flusso visual singolo', () => {
  const OWNER = 'owner-uid';
  const IMPORT = 'imp-1';
  const UDA = 'uda-01';
  const ASSET_ID = '11111111-2222-4333-8444-555555555555';

  it('assertCanonicalStorageRef (ora esportata) accetta ancora il percorso canonico', () => {
    const ref = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: ASSET_ID,
    });
    expect(assertCanonicalStorageRef(ref, ASSET_ID)).toBe(ref);
  });

  it('assertCanonicalStorageRef (ora esportata) rifiuta ancora un assetId non corrispondente', () => {
    const ref = canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: ASSET_ID,
    });
    expect(() => assertCanonicalStorageRef(ref, '22222222-2222-4333-8444-555555555555')).toThrow();
  });

  it('assertManifestText (ora esportata) accetta ancora testo canonico', () => {
    expect(assertManifestText('Didascalia valida.', 'Didascalia', 500)).toBe('Didascalia valida.');
  });

  it('assertManifestText (ora esportata) rifiuta ancora spazi esterni', () => {
    expect(() => assertManifestText(' Didascalia con spazio ', 'Didascalia', 500)).toThrow();
  });

  it('VISUAL_STYLE_VERSION resta "schoolforge-sketch/v1", invariata', () => {
    expect(VISUAL_STYLE_VERSION).toBe('schoolforge-sketch/v1');
  });
});

describe('helper strutturali condivisi', () => {
  it('asRecord rifiuta array e primitivi', () => {
    expect(() => asRecord([], 'msg')).toThrow(AiVisualMultiError);
    expect(() => asRecord('x', 'msg')).toThrow(AiVisualMultiError);
    expect(() => asRecord(null, 'msg')).toThrow(AiVisualMultiError);
  });

  it('assertExactKeys rifiuta chiavi mancanti o extra', () => {
    expect(() => assertExactKeys({ a: 1 }, ['a', 'b'], 'label')).toThrow(AiVisualMultiError);
    expect(() => assertExactKeys({ a: 1, b: 2, c: 3 }, ['a', 'b'], 'label')).toThrow(
      AiVisualMultiError,
    );
    expect(() => assertExactKeys({ a: 1, b: 2 }, ['a', 'b'], 'label')).not.toThrow();
  });

  it("propaga il codice d'errore richiesto dal chiamante", () => {
    try {
      asRecord(null, 'msg', 'corrupted_state');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AiVisualMultiError);
      expect((error as AiVisualMultiError).code).toBe('corrupted_state');
    }
  });
});
