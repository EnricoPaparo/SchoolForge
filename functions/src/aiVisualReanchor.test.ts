import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  REANCHOR_IMMUTABLE_KEYS,
  composeReanchoredManifest,
  isSameAnchor,
  validateVisualReanchorInput,
} from './aiVisualReanchor.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import { validateLessonVisualPrivateManifest } from './aiVisualManifest.js';
import { AiVisualError } from './aiVisualCore.js';

/**
 * VE-04A — il riancoraggio cambia l'ancora e nient'altro.
 *
 * La garanzia che questi test difendono è di **immutabilità**: dopo un
 * riancoraggio, ogni altro campo del manifest deve essere identico. In
 * particolare `approvedAt`, che racconta quando il docente ha approvato
 * quell'immagine — spostarla non è approvarne un'altra.
 */

const ASSET_ID = '11111111-2222-4333-8444-555555555555';

function manifest(over: Record<string, unknown> = {}) {
  return validateLessonVisualPrivateManifest({
    assetId: ASSET_ID,
    storageRef: canonicalVisualStorageRef({
      ownerUid: 'owner-uid',
      importId: 'imp-1',
      udaDir: 'uda-01',
      assetId: ASSET_ID,
    }),
    anchor: { headingSlug: 'reti', headingText: 'Reti', placement: 'after-heading' },
    caption: 'Schema dei nodi',
    altText: 'Tre nodi collegati',
    width: 1024,
    height: 768,
    byteLength: 1234,
    sha256: 'a'.repeat(64),
    mimeType: 'image/webp',
    styleVersion: 'schoolforge-sketch/v1',
    sourceBodyHash: 'b'.repeat(64),
    approvedAt: Timestamp.fromMillis(1_700_000_000_000),
    ...over,
  });
}

function input(over: Record<string, unknown> = {}): unknown {
  return {
    programId: 'prog-1',
    importId: 'imp-1',
    lessonId: 'lesson-1',
    anchorHeadingText: 'Nuova sezione',
    ...over,
  };
}

describe('validateVisualReanchorInput', () => {
  it('accetta il payload chiuso di quattro chiavi', () => {
    expect(validateVisualReanchorInput(input())).toEqual({
      programId: 'prog-1',
      importId: 'imp-1',
      lessonId: 'lesson-1',
      anchorHeadingText: 'Nuova sezione',
    });
  });

  it('rifiuta ciò che non è un oggetto', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(() => validateVisualReanchorInput(bad)).toThrow(AiVisualError);
    }
  });

  /**
   * Il caso più insidioso è `headingSlug`: sembrerebbe un dettaglio tecnico
   * innocuo e invece permetterebbe di ancorare a un identificatore che nel
   * corpo non esiste, aggirando l'unico controllo che conta.
   */
  it('rifiuta ogni campo autorevole, slug e manifest compresi', () => {
    for (const key of [
      'ownerUid',
      'publicLessonId',
      'assetId',
      'storageRef',
      'headingSlug',
      'anchor',
      'visual',
      'manifest',
      'caption',
      'altText',
      'approvedAt',
      'sha256',
    ]) {
      expect(() => validateVisualReanchorInput(input({ [key]: 'x' }))).toThrow(/non ammesse/);
    }
  });

  it('rifiuta un payload a cui manca una chiave', () => {
    const partial = input() as Record<string, unknown>;
    delete partial.lessonId;
    expect(() => validateVisualReanchorInput(partial)).toThrow(/non ammesse/);
  });

  it('applica la semantica canonica agli identificatori', () => {
    for (const bad of ['', ' x', 'x ', 'a/b', '.', '..', '__riservato__', 42, null]) {
      for (const key of ['programId', 'importId', 'lessonId']) {
        expect(() => validateVisualReanchorInput(input({ [key]: bad }))).toThrow(AiVisualError);
      }
    }
  });

  it('rifiuta un heading vuoto, non trimmato o oltre il limite', () => {
    for (const bad of ['', '  ', ' x', 'x ', 42, null]) {
      expect(() => validateVisualReanchorInput(input({ anchorHeadingText: bad }))).toThrow(
        AiVisualError,
      );
    }
    expect(() =>
      validateVisualReanchorInput(input({ anchorHeadingText: 'a'.repeat(301) })),
    ).toThrow(/ancoraggio/i);
  });

  it('conta il limite per code point, non per unità UTF-16', () => {
    expect(() =>
      validateVisualReanchorInput(input({ anchorHeadingText: '\u{1F331}'.repeat(300) })),
    ).not.toThrow();
  });
});

describe('composeReanchoredManifest', () => {
  const anchor = { headingSlug: 'nuova-sezione', headingText: 'Nuova sezione' };

  it('sostituisce soltanto l’ancora', () => {
    const next = composeReanchoredManifest({ current: manifest(), anchor });
    expect(next.anchor).toEqual({
      headingSlug: 'nuova-sezione',
      headingText: 'Nuova sezione',
      placement: 'after-heading',
    });
  });

  /**
   * L'immutabilità campo per campo. `approvedAt` in particolare: spostare
   * un'immagine non è approvarne una nuova, e cambiare quella data
   * riscriverebbe la storia dell'approvazione.
   */
  it('conserva ogni altro campo, approvedAt compreso', () => {
    const current = manifest();
    const next = composeReanchoredManifest({ current, anchor });

    for (const key of REANCHOR_IMMUTABLE_KEYS) {
      expect(next[key]).toBe(current[key]);
    }
    expect(next.approvedAt.toMillis()).toBe(current.approvedAt.toMillis());
  });

  it('il risultato supera il validatore autorevole', () => {
    const next = composeReanchoredManifest({ current: manifest(), anchor });
    expect(() => validateLessonVisualPrivateManifest(next)).not.toThrow();
  });

  it('non muta il manifest ricevuto', () => {
    const current = manifest();
    composeReanchoredManifest({ current, anchor });
    expect(current.anchor.headingSlug).toBe('reti');
  });
});

describe('isSameAnchor — riconoscimento del replay', () => {
  it('è vero quando slug e testo coincidono', () => {
    expect(isSameAnchor(manifest(), { headingSlug: 'reti', headingText: 'Reti' })).toBe(true);
  });

  it('è falso se cambia lo slug o il testo', () => {
    expect(isSameAnchor(manifest(), { headingSlug: 'reti-2', headingText: 'Reti' })).toBe(false);
    expect(isSameAnchor(manifest(), { headingSlug: 'reti', headingText: 'Reti locali' })).toBe(
      false,
    );
  });
});
