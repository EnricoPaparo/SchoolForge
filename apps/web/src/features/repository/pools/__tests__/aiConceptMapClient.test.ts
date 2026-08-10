import { describe, expect, it, vi } from 'vitest';
import {
  buildConceptMapRequest,
  createAiConceptMapCallables,
  validateConceptMapResult,
  type AiConceptMapGenerateResult,
} from '../aiConceptMapClient.js';
import { newRequestId } from '../aiContentClient.js';
import { MAX_CONCEPT_MAP_BYTES, isValidConceptMap } from '../../programs/conceptMapContract.js';
import type { Functions } from 'firebase/functions';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (req: unknown) => mockCallable(name, req),
}));

/**
 * CONCEPT-MAP-03 — il contratto del payload verso le callable esistenti. Il
 * valore difeso qui è la **povertà** del payload: qualunque campo in più
 * sarebbe rifiutato dal server. Il profilo è sempre esplicito: il dialog lo
 * chiede a ogni apertura e preview/generate condividono lo stesso payload.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const BODY = '## La densità\n\nLa densità è massa su volume.';

describe('payload della mappa concettuale', () => {
  it('contiene esattamente quattro campi e nient’altro', () => {
    const req = buildConceptMapRequest({
      requestId: REQUEST_ID,
      modelProfile: 'quality',
      lessonBody: BODY,
    });
    expect(req).toEqual({
      kind: 'concept_map',
      requestId: REQUEST_ID,
      modelProfile: 'quality',
      lessonBody: BODY,
    });
    expect(Object.keys(req).sort()).toEqual(['kind', 'lessonBody', 'modelProfile', 'requestId']);
  });

  it.each(['economy', 'quality'] as const)('trasporta esplicitamente il profilo %s', (profile) => {
    expect(
      buildConceptMapRequest({ requestId: REQUEST_ID, modelProfile: profile, lessonBody: BODY })
        .modelProfile,
    ).toBe(profile);
  });

  it('non normalizza il corpo: al server arriva il testo salvato', () => {
    const quirky = '  ## Titolo\n\n   testo   \n';
    expect(
      buildConceptMapRequest({
        requestId: REQUEST_ID,
        modelProfile: 'quality',
        lessonBody: quirky,
      }).lessonBody,
    ).toBe(quirky);
  });

  it('non trasporta profondità, indicazioni, metadati, modello o listino', () => {
    const serialized = JSON.stringify(
      buildConceptMapRequest({
        requestId: REQUEST_ID,
        modelProfile: 'quality',
        lessonBody: BODY,
      }),
    );
    // Chiavi JSON complete: `model` come sottostringa colpirebbe il legittimo
    // `modelProfile`, e il test fallirebbe per la ragione sbagliata.
    for (const forbidden of [
      '"depth"',
      '"teacherGuidance"',
      '"titolo"',
      '"udaContext"',
      '"model"',
      '"priceListVersion"',
      '"ownerUid"',
      '"concettiChiave"',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});

describe('callable condivise', () => {
  it('preview e generate usano le stesse due Function di pool e lezione', async () => {
    mockCallable.mockResolvedValue({ data: { ok: true } });
    const callables = createAiConceptMapCallables({} as Functions);
    const req = buildConceptMapRequest({
      requestId: REQUEST_ID,
      modelProfile: 'quality',
      lessonBody: BODY,
    });
    await callables.preview(req);
    await callables.generate(req);
    expect(mockCallable).toHaveBeenNthCalledWith(1, 'aiContentPreview', req);
    expect(mockCallable).toHaveBeenNthCalledWith(2, 'aiContentGenerate', req);
  });

  it('lo stesso requestId produce lo stesso payload per entrambe', () => {
    const id = newRequestId();
    const a = buildConceptMapRequest({ requestId: id, modelProfile: 'quality', lessonBody: BODY });
    const b = buildConceptMapRequest({ requestId: id, modelProfile: 'quality', lessonBody: BODY });
    expect(a).toEqual(b);
  });
});

describe('validazione del risultato', () => {
  function result(over: Record<string, unknown> = {}): AiConceptMapGenerateResult {
    return {
      status: 'completed',
      kind: 'concept_map',
      modelProfile: 'economy',
      output: { conceptMapMarkdown: '## Ossatura della lezione\n\n- densità\n' },
      actualCostMicroUsd: 1200,
      replayed: false,
      ...over,
    } as AiConceptMapGenerateResult;
  }

  it('accetta un Markdown non vuoto', () => {
    const validated = validateConceptMapResult(result());
    expect(validated.ok).toBe(true);
  });

  it('rifiuta un risultato vuoto o malformato senza toccare nulla', () => {
    expect(validateConceptMapResult(result({ output: { conceptMapMarkdown: '' } })).ok).toBe(false);
    expect(validateConceptMapResult(result({ output: { conceptMapMarkdown: '  ' } })).ok).toBe(
      false,
    );
    expect(
      validateConceptMapResult(result({ output: { conceptMapMarkdown: '\n\t \r\n' } })).ok,
    ).toBe(false);
    expect(validateConceptMapResult(result({ output: {} })).ok).toBe(false);
    expect(validateConceptMapResult(result({ output: { conceptMapMarkdown: 42 } })).ok).toBe(false);
    expect(validateConceptMapResult(result({ output: { conceptMapMarkdown: null } })).ok).toBe(
      false,
    );
    expect(
      validateConceptMapResult(result({ output: { conceptMapMarkdown: ['- voce'] } })).ok,
    ).toBe(false);
    expect(validateConceptMapResult(result({ output: undefined })).ok).toBe(false);
  });

  it('rifiuta un risultato oltre il cap in byte', () => {
    expect(
      validateConceptMapResult(
        result({ output: { conceptMapMarkdown: 'x'.repeat(MAX_CONCEPT_MAP_BYTES + 1) } }),
      ).ok,
    ).toBe(false);
    expect(
      validateConceptMapResult(
        result({ output: { conceptMapMarkdown: 'x'.repeat(MAX_CONCEPT_MAP_BYTES) } }),
      ).ok,
    ).toBe(true);
  });

  it('il cap è in byte UTF-8, non in caratteri', () => {
    // Questo è il caso che un cap in caratteri lascerebbe passare, e che il
    // salvataggio rifiuterebbe **dopo** aver già sostituito il testo del
    // docente: 20.000 caratteri (ben sotto 32.000) ma 60.000 byte.
    const emDash = '─'; // U+2500, 3 byte in UTF-8
    const multibyte = emDash.repeat(20_000);
    expect(multibyte.length).toBeLessThan(MAX_CONCEPT_MAP_BYTES);
    expect(new TextEncoder().encode(multibyte).length).toBeGreaterThan(MAX_CONCEPT_MAP_BYTES);
    expect(validateConceptMapResult(result({ output: { conceptMapMarkdown: multibyte } })).ok).toBe(
      false,
    );
  });

  it('applica lo stesso metro del salvataggio, senza duplicarlo', () => {
    // Se i due limiti divergessero, esisterebbe una proposta accettata
    // dall'anteprima e rifiutata dal salvataggio: il docente perderebbe il
    // testo precedente in cambio di nulla. Il contratto è uno solo.
    const cases: unknown[] = [
      '## Ossatura\n\n- voce',
      '',
      '   ',
      42,
      null,
      'ù'.repeat(MAX_CONCEPT_MAP_BYTES), // 2 byte per carattere: oltre il cap
      'x'.repeat(MAX_CONCEPT_MAP_BYTES),
    ];
    for (const value of cases) {
      expect(validateConceptMapResult(result({ output: { conceptMapMarkdown: value } })).ok).toBe(
        isValidConceptMap(value),
      );
    }
  });
});
