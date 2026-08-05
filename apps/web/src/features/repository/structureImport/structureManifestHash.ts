import { fnv1a } from '../importUda/manifestHash.js';

/**
 * STRUCTURE-IMPORT-01 — deterministic fingerprint of an append attempt
 * (structure-metadata-import-roadmap.md §6, §9).
 *
 * Reuses the FNV-1a primitive the UDA import already relies on, over a
 * **canonical** serialization: every field is written in a fixed order and the
 * per-file fingerprints are sorted, so the same file against the same
 * destination always yields the same hash — the property 02A/02B need to
 * recognize a legitimate retry — while any change to a metadata value, to an
 * id, to a path or to the target import yields a different one.
 *
 * What it never contains: the owner UID, a token, or any pedagogical text in
 * recoverable form. Content participates only through its own hash.
 *
 * Pure module: no crypto, no async, no Firebase.
 */

export interface StructureManifestHashInput {
  kind: 'uda' | 'lesson';
  programId: string;
  importId: string;
  /** Destination UDA for a lesson import; `null` for a UDA import. */
  udaId: string | null;
  /** Document ids the attempt creates, in file order. */
  documentIds: string[];
  /** Projection ids the attempt creates, in file order (empty for UDAs). */
  projectionIds: string[];
  /** Files the attempt uploads: canonical path plus the exact content. */
  files: Array<{ path: string; content: string }>;
  /** `order` assigned to each entry, in file order. */
  orders: number[];
}

export function computeStructureManifestHash(input: StructureManifestHashInput): string {
  const fileFingerprints = input.files.map((file) => `${file.path}:${fnv1a(file.content)}`).sort();
  const canonical = JSON.stringify({
    kind: input.kind,
    programId: input.programId,
    importId: input.importId,
    udaId: input.udaId,
    documents: input.documentIds,
    projections: input.projectionIds,
    files: fileFingerprints,
    orders: input.orders,
  });
  return fnv1a(canonical);
}
