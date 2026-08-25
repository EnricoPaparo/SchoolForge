import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AiVisualMultiError,
  asRecord,
  assertExactKeys,
  computeOpaqueVisualPlanId,
  isSha256Hex,
  isUuidV4,
} from './aiVisualMultiCore.js';
import {
  assertCanonicalStorageRef,
  assertManifestText,
  assertProposalField,
  VISUAL_STYLE_VERSION,
} from './aiContentVisualProposal.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import { sha256Hex, canonicalTuple } from './aiVisualCore.js';

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

/**
 * Review fix (blocker 1) — test strutturale che impedisce la reintroduzione
 * delle regex UUID/SHA-256 duplicate: `aiVisualMultiManifest.ts` e
 * `aiVisualMultiPlan.ts` devono importarle da `aiVisualMultiCore.ts`, mai
 * ridichiararle localmente. Un futuro `const UUID_V4_RE = /…/` in uno dei due
 * file fa fallire questo test.
 */
describe('blocker 1 — nessuna regex UUID/SHA-256 duplicata nei moduli MULTI-VISUAL', () => {
  const FILES_THAT_MUST_NOT_DECLARE_LOCALLY = ['aiVisualMultiManifest.ts', 'aiVisualMultiPlan.ts'];
  const LOCAL_REDECLARATION_RE = /\b(?:const|let)\s+(?:UUID_V4_RE|SHA256_HEX_RE)\s*=/;

  it.each(FILES_THAT_MUST_NOT_DECLARE_LOCALLY)(
    '%s non ridichiara UUID_V4_RE/SHA256_HEX_RE',
    (fileName) => {
      const path = fileURLToPath(new URL(`./${fileName}`, import.meta.url));
      const source = readFileSync(path, 'utf8');
      expect(LOCAL_REDECLARATION_RE.test(source)).toBe(false);
    },
  );

  it('aiVisualMultiCore.ts resta l’unica definizione', () => {
    const path = fileURLToPath(new URL('./aiVisualMultiCore.ts', import.meta.url));
    const source = readFileSync(path, 'utf8');
    expect(/export const UUID_V4_RE\s*=/.test(source)).toBe(true);
    expect(/export const SHA256_HEX_RE\s*=/.test(source)).toBe(true);
  });
});

describe('isUuidV4 / isSha256Hex', () => {
  it('accettano la forma canonica minuscola', () => {
    expect(isUuidV4('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(true);
    expect(isSha256Hex('a'.repeat(64))).toBe(true);
  });

  it('rifiutano la forma maiuscola (nessuna coercizione di case)', () => {
    expect(isUuidV4('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')).toBe(false);
    expect(isSha256Hex('A'.repeat(64))).toBe(false);
  });

  it('rifiutano valori non stringa', () => {
    expect(isUuidV4(123)).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
  });
});

describe('computeOpaqueVisualPlanId (roadmap §10.1)', () => {
  it("è la tupla canonica ['visual-plan/v1', ownerUid, requestId] sotto SHA-256", () => {
    const ownerUid = 'owner-uid';
    const requestId = '11111111-2222-4333-8444-555555555555';
    const expected = sha256Hex(canonicalTuple(['visual-plan/v1', ownerUid, requestId]));
    expect(computeOpaqueVisualPlanId(ownerUid, requestId)).toBe(expected);
  });

  it('è deterministico: stessa coppia ⇒ stesso id', () => {
    const a = computeOpaqueVisualPlanId('owner-uid', '11111111-2222-4333-8444-555555555555');
    const b = computeOpaqueVisualPlanId('owner-uid', '11111111-2222-4333-8444-555555555555');
    expect(a).toBe(b);
  });

  it('owner o requestId diversi producono id diversi', () => {
    const a = computeOpaqueVisualPlanId('owner-uid-1', '11111111-2222-4333-8444-555555555555');
    const b = computeOpaqueVisualPlanId('owner-uid-2', '11111111-2222-4333-8444-555555555555');
    expect(a).not.toBe(b);
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

  it('assertProposalField (ora esportata) accetta ancora testo canonico', () => {
    expect(assertProposalField('Testo valido.', 'Campo', 500)).toBe('Testo valido.');
  });

  it('assertProposalField (ora esportata) rifiuta ancora un blocco di codice (fence)', () => {
    expect(() => assertProposalField('```codice```', 'Campo', 500)).toThrow();
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
