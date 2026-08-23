import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase-admin/firestore';
import {
  MAX_VISUAL_EXPORT_CONCURRENCY,
  MAX_VISUAL_EXPORT_LESSONS_PER_BATCH,
  MAX_VISUAL_EXPORT_TOTAL_BYTES,
  VISUAL_EXPORT_WORST_CASE_BYTES,
  VISUAL_EXPORT_ZIP_PREFIX,
  assertNoZipPathCollisions,
  planVisualExportBatches,
  reconcileVisualExportBatch,
  serializeVisualManifestForExport,
  validateVisualExportInput,
  visualExportZipPaths,
  type VisualExportItem,
} from './aiVisualExport.js';
import { MAX_VISUAL_BYTES } from './aiContentVisualProposal.js';
import { canonicalVisualStorageRef } from './aiVisualManifest.js';
import { validateLessonVisualPrivateManifest } from './aiVisualManifest.js';
import { AiVisualError } from './aiVisualCore.js';

/**
 * VISUAL-ENRICHMENT-03C — i contratti puri dell'export binario.
 *
 * Due garanzie contano più delle altre, perché sono quelle che rendono sicuro
 * spezzare un export in più chiamate:
 *
 * 1. **il sidecar è deterministico** — due export della stessa lezione danno lo
 *    stesso byte, altrimenti un diff fra archivi diventa illeggibile;
 * 2. **un risultato mancante, fuori ordine o duplicato è un errore** — non una
 *    lezione senza figura dentro un archivio che sembra completo.
 */

const ASSET_ID = '11111111-2222-4333-8444-555555555555';
const OWNER = 'owner-uid';
const IMPORT = 'imp-1';
const UDA = 'uda-01';

function manifest(over: Record<string, unknown> = {}) {
  return validateLessonVisualPrivateManifest({
    assetId: ASSET_ID,
    storageRef: canonicalVisualStorageRef({
      ownerUid: OWNER,
      importId: IMPORT,
      udaDir: UDA,
      assetId: ASSET_ID,
    }),
    anchor: {
      headingSlug: 'la-fotosintesi',
      headingText: 'La fotosintesi',
      placement: 'after-heading',
    },
    caption: 'Schema della fotosintesi',
    altText: 'Diagramma con foglia, luce e anidride carbonica',
    width: 1024,
    height: 1024,
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
  return { programId: 'prog-1', importId: IMPORT, lessonIds: ['lesson-1'], ...over };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('limiti del trasporto', () => {
  /**
   * Il numero di lezioni per batch non è scelto a caso: discende dal tetto
   * totale e dal limite per immagine già congelato in VE-02. Se qualcuno lo
   * alzasse senza alzare il tetto, questo test fallirebbe invece di lasciar
   * passare una risposta che in produzione verrebbe troncata.
   */
  it('il caso peggiore di un batch pieno sta nel tetto dichiarato', () => {
    expect(VISUAL_EXPORT_WORST_CASE_BYTES).toBe(
      MAX_VISUAL_EXPORT_LESSONS_PER_BATCH * MAX_VISUAL_BYTES,
    );
    expect(VISUAL_EXPORT_WORST_CASE_BYTES).toBeLessThanOrEqual(MAX_VISUAL_EXPORT_TOTAL_BYTES);
  });

  /** Anche gonfiato del 33% dalla base64 il caso peggiore resta ragionevole. */
  it('il caso peggiore in base64 resta lontano dal tetto di una callable', () => {
    const base64Bytes = Math.ceil(VISUAL_EXPORT_WORST_CASE_BYTES / 3) * 4;
    expect(base64Bytes).toBeLessThan(16_000_000);
  });

  it('la concorrenza client è limitata e maggiore di zero', () => {
    expect(MAX_VISUAL_EXPORT_CONCURRENCY).toBeGreaterThan(0);
    expect(MAX_VISUAL_EXPORT_CONCURRENCY).toBeLessThanOrEqual(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('validateVisualExportInput', () => {
  it('accetta il payload chiuso', () => {
    expect(validateVisualExportInput(input())).toEqual({
      programId: 'prog-1',
      importId: IMPORT,
      lessonIds: ['lesson-1'],
    });
  });

  it('rifiuta ciò che non è un oggetto', () => {
    for (const bad of [null, undefined, 'x', 42, []]) {
      expect(() => validateVisualExportInput(bad)).toThrow(AiVisualError);
    }
  });

  /**
   * Il cuore del contratto: il client non nomina percorsi né dichiara nulla di
   * autorevole. Se una di queste chiavi passasse, l'operazione binaria
   * diventerebbe una lettura arbitraria dello Storage con un altro nome.
   */
  it('rifiuta ogni campo autorevole che il client provasse a mandare', () => {
    for (const key of [
      'ownerUid',
      'storageRef',
      'assetId',
      'sha256',
      'byteLength',
      'mimeType',
      'width',
      'height',
      'manifest',
      'base64',
      'path',
      'paths',
    ]) {
      expect(() => validateVisualExportInput(input({ [key]: 'x' }))).toThrow(/non ammesse/);
    }
  });

  it('rifiuta un payload a cui manca una chiave', () => {
    const partial = input() as Record<string, unknown>;
    delete partial.importId;
    expect(() => validateVisualExportInput(partial)).toThrow(/non ammesse/);
  });

  it('rifiuta una lista vuota e una oltre il limite', () => {
    expect(() => validateVisualExportInput(input({ lessonIds: [] }))).toThrow(/almeno una/);
    const troppe = Array.from(
      { length: MAX_VISUAL_EXPORT_LESSONS_PER_BATCH + 1 },
      (_, i) => `lesson-${i}`,
    );
    expect(() => validateVisualExportInput(input({ lessonIds: troppe }))).toThrow(/al massimo/);
  });

  it('accetta esattamente il limite', () => {
    const esatte = Array.from(
      { length: MAX_VISUAL_EXPORT_LESSONS_PER_BATCH },
      (_, i) => `lesson-${i}`,
    );
    expect(validateVisualExportInput(input({ lessonIds: esatte })).lessonIds).toHaveLength(
      MAX_VISUAL_EXPORT_LESSONS_PER_BATCH,
    );
  });

  /**
   * Un duplicato farebbe leggere e fatturare due volte lo stesso oggetto, e
   * renderebbe ambigua la corrispondenza fra richiesta e risposta — che è
   * proprio ciò su cui il client si basa per accorgersi di un risultato
   * mancante.
   */
  it('rifiuta lessonIds duplicati', () => {
    expect(() => validateVisualExportInput(input({ lessonIds: ['a', 'b', 'a'] }))).toThrow(
      /duplicati/,
    );
  });

  it('rifiuta identificatori vuoti, non stringa o usabili come traversal', () => {
    for (const bad of ['', ' x', 'x ', 42, null, 'a/b', '.', '..', '/a']) {
      expect(() => validateVisualExportInput(input({ lessonIds: [bad] }))).toThrow(AiVisualError);
      expect(() => validateVisualExportInput(input({ programId: bad }))).toThrow(AiVisualError);
      expect(() => validateVisualExportInput(input({ importId: bad }))).toThrow(AiVisualError);
    }
  });

  it('conserva l’ordine ricevuto', () => {
    const ids = ['c', 'a', 'b'];
    expect(validateVisualExportInput(input({ lessonIds: ids })).lessonIds).toEqual(ids);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('serializeVisualManifestForExport', () => {
  it('è deterministico a parità di contenuto', () => {
    expect(serializeVisualManifestForExport(manifest())).toBe(
      serializeVisualManifestForExport(manifest()),
    );
  });

  /**
   * L'ordine delle chiavi è congelato e non ricavato da `Object.keys`: quello
   * di un oggetto letto da Firestore dipende da come è stato scritto, e due
   * export della stessa lezione darebbero due file diversi a parità di
   * contenuto.
   */
  it('emette le chiavi in ordine congelato, non nell’ordine dell’oggetto', () => {
    const json = serializeVisualManifestForExport(manifest());
    const keys = Object.keys(JSON.parse(json) as Record<string, unknown>);
    expect(keys).toEqual([
      'assetId',
      'storageRef',
      'anchor',
      'caption',
      'altText',
      'width',
      'height',
      'byteLength',
      'sha256',
      'mimeType',
      'styleVersion',
      'sourceBodyHash',
      'approvedAt',
    ]);
    expect(Object.keys((JSON.parse(json) as { anchor: object }).anchor)).toEqual([
      'headingSlug',
      'headingText',
      'placement',
    ]);
  });

  it('serializza approvedAt come ISO 8601 UTC, non come forma interna dell’SDK', () => {
    const parsed = JSON.parse(serializeVisualManifestForExport(manifest())) as {
      approvedAt: string;
    };
    expect(parsed.approvedAt).toBe('2023-11-14T22:13:20.000Z');
    expect(JSON.stringify(parsed)).not.toContain('_seconds');
  });

  /**
   * La garanzia negativa dell'archivio: un sidecar non deve poter trasportare
   * fuori da SchoolForge nulla che riguardi provider, costi o studenti.
   */
  it('non contiene URL, token, dati provider, prompt, subject, costi o dati studente', () => {
    const json = serializeVisualManifestForExport(manifest()).toLowerCase();
    for (const forbidden of [
      'http://',
      'https://',
      'token',
      'googleapis',
      'firebasestorage',
      'prompt',
      'subject',
      'openai',
      'gpt-',
      'apikey',
      'api_key',
      'cost',
      'microusd',
      'student',
      'studente',
    ]) {
      expect(json).not.toContain(forbidden);
    }
  });

  it('è JSON leggibile con newline finale', () => {
    const json = serializeVisualManifestForExport(manifest());
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toContain('\n  "assetId"');
  });

  it('riflette ogni campo del manifest validato', () => {
    const parsed = JSON.parse(serializeVisualManifestForExport(manifest())) as Record<
      string,
      unknown
    >;
    expect(parsed.assetId).toBe(ASSET_ID);
    expect(parsed.sha256).toBe('a'.repeat(64));
    expect(parsed.sourceBodyHash).toBe('b'.repeat(64));
    expect(parsed.mimeType).toBe('image/webp');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('visualExportZipPaths', () => {
  it('compone i due percorsi sotto il prefisso dichiarato', () => {
    expect(visualExportZipPaths(ASSET_ID)).toEqual({
      json: `${VISUAL_EXPORT_ZIP_PREFIX}${ASSET_ID}.json`,
      webp: `${VISUAL_EXPORT_ZIP_PREFIX}${ASSET_ID}.webp`,
    });
  });

  /**
   * L'`assetId` è già validato quando arriva qui, ma viene ricontrollato **al
   * momento di comporre un path**: è il punto in cui un valore inatteso
   * smetterebbe di essere un dato e diventerebbe una posizione nel filesystem
   * di chi apre l'archivio.
   */
  it('rifiuta un assetId che non è un UUID v4, traversal compresi', () => {
    for (const bad of [
      '',
      'non-un-uuid',
      '11111111-2222-3333-4444-555555555555',
      '../../etc/passwd',
      'a/b',
      `${ASSET_ID}/../x`,
    ]) {
      expect(() => visualExportZipPaths(bad)).toThrow(AiVisualError);
    }
  });

  it('non può collidere con una lezione, un pool o un manifest di UDA', () => {
    const { json, webp } = visualExportZipPaths(ASSET_ID);
    for (const path of [json, webp]) {
      expect(path.startsWith(VISUAL_EXPORT_ZIP_PREFIX)).toBe(true);
      expect(path.endsWith('.md')).toBe(false);
      expect(path).not.toContain('.pool.md');
    }
  });
});

describe('assertNoZipPathCollisions', () => {
  it('accetta percorsi distinti e validi', () => {
    expect(() =>
      assertNoZipPathCollisions(['uda-01/lezione-001.md', 'visuals/x.json']),
    ).not.toThrow();
  });

  /**
   * `JSZip.file()` sovrascrive in silenzio: due lezioni con lo stesso assetId
   * — per un bug, una copia manuale o un restore parziale — produrrebbero un
   * archivio a cui manca una figura senza che nulla lo segnali.
   */
  it('rifiuta due file che userebbero lo stesso percorso', () => {
    expect(() => assertNoZipPathCollisions(['visuals/x.webp', 'visuals/x.webp'])).toThrow(
      /stesso percorso/,
    );
  });

  it('rifiuta un visual che occuperebbe il nome di una lezione', () => {
    expect(() =>
      assertNoZipPathCollisions(['uda-01/lezione-001.md', 'uda-01/lezione-001.md']),
    ).toThrow(/stesso percorso/);
  });

  it('rifiuta percorsi assoluti, doppi slash, backslash e riferimenti relativi', () => {
    for (const bad of ['', '/uda/x.md', 'uda//x.md', 'uda\\x.md', '../x.md', 'uda/./x.md']) {
      expect(() => assertNoZipPathCollisions([bad])).toThrow(AiVisualError);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('planVisualExportBatches', () => {
  it('non produce batch per una lista vuota', () => {
    expect(planVisualExportBatches([])).toEqual([]);
  });

  it('tiene una lista corta in un solo batch', () => {
    expect(planVisualExportBatches(['a', 'b'])).toEqual([['a', 'b']]);
  });

  it('divide oltre il limite conservando l’ordine canonico', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `lesson-${i}`);
    const batches = planVisualExportBatches(ids);
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_VISUAL_EXPORT_LESSONS_PER_BATCH);
    expect(batches.flat()).toEqual(ids);
  });

  it('nessun batch supera mai il limite', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `lesson-${i}`);
    for (const batch of planVisualExportBatches(ids)) {
      expect(batch.length).toBeLessThanOrEqual(MAX_VISUAL_EXPORT_LESSONS_PER_BATCH);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('reconcileVisualExportBatch', () => {
  const item = (lessonId: string): VisualExportItem => ({ lessonId, status: 'absent' });

  it('accetta una risposta esatta e ordinata', () => {
    expect(() =>
      reconcileVisualExportBatch({
        requested: ['a', 'b'],
        items: [item('a'), item('b')],
      }),
    ).not.toThrow();
  });

  /** Un risultato mancante diventerebbe una lezione senza figura. */
  it('rifiuta una risposta più corta della richiesta', () => {
    expect(() => reconcileVisualExportBatch({ requested: ['a', 'b'], items: [item('a')] })).toThrow(
      /non copre tutte/,
    );
  });

  it('rifiuta una risposta più lunga della richiesta', () => {
    expect(() =>
      reconcileVisualExportBatch({
        requested: ['a'],
        items: [item('a'), item('b')],
      }),
    ).toThrow(/non copre tutte/);
  });

  /** Un ordine diverso attribuirebbe la figura alla lezione sbagliata. */
  it('rifiuta una risposta fuori ordine', () => {
    expect(() =>
      reconcileVisualExportBatch({
        requested: ['a', 'b'],
        items: [item('b'), item('a')],
      }),
    ).toThrow(/ordine/);
  });

  it('rifiuta un risultato duplicato', () => {
    expect(() =>
      reconcileVisualExportBatch({
        requested: ['a', 'a'],
        items: [item('a'), item('a')],
      }),
    ).toThrow(/duplicato/);
  });

  it('rifiuta un elemento che parla di una lezione non richiesta', () => {
    expect(() => reconcileVisualExportBatch({ requested: ['a'], items: [item('z')] })).toThrow(
      /ordine/,
    );
  });
});
