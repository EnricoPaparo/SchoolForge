import { composeMarkdownWithFrontMatter } from '../validation/frontMatter.js';
import {
  maxUdaNumber,
  maxUdaOrder,
  toDocId,
  udaDirName,
  udaFrontMatterFields,
  udaStorageBasePath,
} from '../canonicalNaming.js';
import { canonicalizeManifest } from './structureManifestCanonical.js';
import { assertNoTitleCollisions } from './validateStructureRoot.js';
import type {
  ManifestBody,
  ExistingUdaForPlan,
  NormalizedUdaMetadata,
  PlannedUda,
  StructureImportResult,
  UdaStructureImportManifest,
} from './types.js';

/**
 * STRUCTURE-IMPORT-01 — pure planner of a UDA append
 * (structure-metadata-import-roadmap.md §6, §7.1).
 *
 * Given validated metadata plus the destination's current state, it produces
 * the complete manifest of what a commit would create — ids, canonical names,
 * `order`, Storage paths and Markdown — and nothing else. It performs **no**
 * read, **no** write, **no** upload and no simulated commit: 02A owns those,
 * and receives from here everything it needs to preflight collisions and to
 * clean up exactly what the attempt owned if it fails midway.
 *
 * Numbering and ordering follow the canonical services exactly (shared helpers,
 * not a re-derivation): the first new number is one past the highest `uda-XX`
 * already present — gaps are never filled — and the first new `order` is one
 * past the highest existing `order`, falling back to the `uda-XX` prefix for
 * legacy documents that never stored one.
 *
 * Pure module: no Firebase, no React, no browser API, no network.
 */

export interface PlanUdaMetadataAppendInput {
  ownerUid: string;
  programId: string;
  importId: string;
  /** Validated entries, in file order — which is the append order. */
  udas: readonly NormalizedUdaMetadata[];
  /** Every UDA already in the destination import. */
  existingUdas: readonly ExistingUdaForPlan[];
}

export function planUdaMetadataAppend(
  input: PlanUdaMetadataAppendInput,
): StructureImportResult<UdaStructureImportManifest> {
  const { ownerUid, programId, importId, udas, existingUdas } = input;

  // Defence in depth: the validator already refuses a title that exists in the
  // destination, but the planner must never be the layer that lets one through.
  const titleCollision = assertNoTitleCollisions(
    udas.map((uda) => uda.titolo),
    existingUdas
      .map((uda) => uda.titolo)
      .filter((titolo): titolo is string => typeof titolo === 'string'),
    'uda',
  );
  if (titleCollision) return { ok: false, error: titleCollision };

  const takenDocIds = new Set(existingUdas.map((uda) => uda.udaId));
  const takenStoragePaths = new Set(
    existingUdas
      .filter((uda) => typeof uda.dir === 'string' && uda.dir.length > 0)
      .map((uda) => `${udaStorageBasePath(ownerUid, importId, uda.dir!)}/${uda.dir!}.md`),
  );

  const baseNumber = maxUdaNumber(existingUdas);
  const baseOrder = maxUdaOrder(existingUdas);

  const planned: PlannedUda[] = [];

  for (const [index, metadata] of udas.entries()) {
    const dir = udaDirName(baseNumber + 1 + index, metadata.titolo);
    const filename = `${dir}.md`;
    const udaId = toDocId(dir);
    const order = baseOrder + 1 + index;
    const storageBasePath = udaStorageBasePath(ownerUid, importId, dir);
    const storagePath = `${storageBasePath}/${filename}`;

    // Two different titles can slugify to the same directory, and `toDocId` is
    // deliberately lossy — so a technical collision is possible even when every
    // title is distinct. It blocks the whole file: never a rename, never a
    // suffix, never an overwrite.
    if (takenDocIds.has(udaId)) {
      return {
        ok: false,
        error: {
          code: 'document_id_collision',
          message: `La UDA «${metadata.titolo}» genererebbe un identificatore già in uso nel corso. Modifica il titolo e riprova.`,
          fileKind: 'uda',
          index,
          field: 'titolo',
        },
      };
    }
    if (takenStoragePaths.has(storagePath)) {
      return {
        ok: false,
        error: {
          code: 'storage_path_collision',
          message: `La UDA «${metadata.titolo}» genererebbe un file già esistente nel corso. Modifica il titolo e riprova.`,
          fileKind: 'uda',
          index,
          field: 'titolo',
        },
      };
    }
    takenDocIds.add(udaId);
    takenStoragePaths.add(storagePath);

    // Canonical Markdown: front matter only. The body is deliberately empty —
    // a structural import never carries content.
    const content = composeMarkdownWithFrontMatter(
      udaFrontMatterFields(metadata.titolo, metadata),
      '',
    );

    planned.push({
      index,
      udaId,
      dir,
      filename,
      order,
      storageBasePath,
      storagePath,
      content,
      metadata,
      doc: {
        ownerUid,
        importId,
        dir,
        filename,
        order,
        storageBasePath,
        lessonCount: 0,
        titolo: metadata.titolo,
        descrizione: metadata.descrizione,
        competenze: metadata.competenze,
        obiettivi: metadata.obiettivi,
      },
    });
  }

  const body: ManifestBody<UdaStructureImportManifest> = {
    kind: 'uda',
    ownerUid,
    programId,
    importId,
    udas: planned,
    udaIds: planned.map((uda) => uda.udaId),
    storagePaths: planned.map((uda) => uda.storagePath),
  };

  // Serializzazione canonica dell'intero manifest, non un hash: l'identità
  // autorevole è `SHA-256(manifestCanonical)` e la calcola l'adapter di 02A.
  return { ok: true, value: { ...body, manifestCanonical: canonicalizeManifest(body) } };
}
