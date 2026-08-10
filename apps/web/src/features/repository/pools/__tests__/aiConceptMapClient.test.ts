import { describe, expect, it, vi } from 'vitest';
import {
  CONCEPT_MAP_MODEL_PROFILE,
  buildConceptMapRequest,
  createAiConceptMapCallables,
  validateConceptMapResult,
  type AiConceptMapGenerateResult,
} from '../aiConceptMapClient.js';
import { newRequestId } from '../aiContentClient.js';
import type { Functions } from 'firebase/functions';

const mockCallable = vi.fn();
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => (req: unknown) => mockCallable(name, req),
}));

/**
 * CONCEPT-MAP-03 — il contratto del payload verso le callable esistenti. Il
 * valore difeso qui è la **povertà** del payload: qualunque campo in più
 * sarebbe rifiutato dal server (payload chiuso), e un profilo scelto dal client
 * violerebbe il contratto del kind.
 */

const REQUEST_ID = '55555555-5555-4555-8555-555555555555';
const BODY = '## La densità\n\nLa densità è massa su volume.';

describe('payload della mappa concettuale', () => {
  it('contiene esattamente quattro campi e nient’altro', () => {
    const req = buildConceptMapRequest({ requestId: REQUEST_ID, lessonBody: BODY });
    expect(req).toEqual({
      kind: 'concept_map',
      requestId: REQUEST_ID,
      modelProfile: 'economy',
      lessonBody: BODY,
    });
    expect(Object.keys(req).sort()).toEqual(['kind', 'lessonBody', 'modelProfile', 'requestId']);
  });

  it('il profilo è economy e non è parametrizzabile', () => {
    expect(CONCEPT_MAP_MODEL_PROFILE).toBe('economy');
    // La firma non espone alcun modo di scegliere il profilo: è il contratto
    // del kind, non un default.
    expect(buildConceptMapRequest({ requestId: REQUEST_ID, lessonBody: BODY }).modelProfile).toBe(
      'economy',
    );
  });

  it('non normalizza il corpo: al server arriva il testo salvato', () => {
    const quirky = '  ## Titolo\n\n   testo   \n';
    expect(buildConceptMapRequest({ requestId: REQUEST_ID, lessonBody: quirky }).lessonBody).toBe(
      quirky,
    );
  });

  it('non trasporta profondità, indicazioni, metadati, modello o listino', () => {
    const serialized = JSON.stringify(
      buildConceptMapRequest({ requestId: REQUEST_ID, lessonBody: BODY }),
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
    const req = buildConceptMapRequest({ requestId: REQUEST_ID, lessonBody: BODY });
    await callables.preview(req);
    await callables.generate(req);
    expect(mockCallable).toHaveBeenNthCalledWith(1, 'aiContentPreview', req);
    expect(mockCallable).toHaveBeenNthCalledWith(2, 'aiContentGenerate', req);
  });

  it('lo stesso requestId produce lo stesso payload per entrambe', () => {
    const id = newRequestId();
    const a = buildConceptMapRequest({ requestId: id, lessonBody: BODY });
    const b = buildConceptMapRequest({ requestId: id, lessonBody: BODY });
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
    expect(validateConceptMapResult(result({ output: {} })).ok).toBe(false);
    expect(validateConceptMapResult(result({ output: { conceptMapMarkdown: 42 } })).ok).toBe(false);
  });
});
