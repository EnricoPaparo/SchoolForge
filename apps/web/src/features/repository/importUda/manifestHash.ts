/**
 * Deterministic, synchronous fingerprint for a UDA import attempt
 * (uda-import-contract §9). Covers the active import id, the normalized
 * (sorted) manifest paths/ids and a content hash per uploaded file — so the
 * same ZIP against the same active import always yields the same hash
 * (idempotent replay), and any change to content, order or target ids yields a
 * different one. Never includes UIDs, tokens or raw content in a loggable form.
 *
 * FNV-1a over a canonical string: no async crypto, no Firebase — safe to unit
 * test and to call inside pure payload building.
 */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Unsigned 32-bit hex, zero-padded.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function computeManifestHash(params: {
  activeImportId: string;
  udaId: string;
  storagePaths: Array<{ path: string; content: string }>;
  lessonIds: string[];
  questionIndexIds: string[];
  publicLessonIds: string[];
  newUdaOrder: number;
}): string {
  const contentFingerprints = [...params.storagePaths]
    .map((f) => `${f.path}:${fnv1a(f.content)}`)
    .sort();
  const canonical = JSON.stringify({
    activeImportId: params.activeImportId,
    udaId: params.udaId,
    order: params.newUdaOrder,
    files: contentFingerprints,
    lessons: [...params.lessonIds].sort(),
    questions: [...params.questionIndexIds].sort(),
    publicLessons: [...params.publicLessonIds].sort(),
  });
  return fnv1a(canonical);
}
