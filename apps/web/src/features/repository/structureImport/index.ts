/**
 * STRUCTURE-IMPORT-01 — public surface of the pure structural import layer.
 *
 * Nothing here touches Firestore, Storage or the DOM: this package only turns
 * the **bytes** of a YAML file into validated metadata, and validated metadata
 * into a manifest. The dialogs, the lease, the uploads and the commit are
 * STRUCTURE-IMPORT-02A and 02B.
 *
 * Two contracts the callers of 02A/02B must respect:
 *
 * 1. **byte-first.** Read the file with `file.arrayBuffer()` and pass the bytes.
 *    `File.text()` is not an accepted source: it repairs invalid UTF-8 into
 *    U+FFFD instead of refusing the file.
 * 2. **the identity of an attempt is `SHA-256(manifestCanonical)`**, computed by
 *    the runtime adapter with Web Crypto before the lease, the staging and any
 *    write. The manifests published here carry the canonical serialization, not
 *    an identity, and never a 32-bit fingerprint.
 *
 * The text-only entry points (`parseStructureYamlText`,
 * `validateUdaMetadataFileText`, `validateLessonMetadataFileText`,
 * `parseSimpleUdaStructure`, `parseSimpleLessonStructure`) are deliberately
 * **not** re-exported here: they exist for internal reuse and tests, and the UI
 * must never reach them. L'unica porta della UI è
 * `parse{Uda,Lesson}StructureInput`, che è byte-first e riconosce da sola quale
 * delle due sintassi ha davanti (STRUCTURE-IMPORT-SIMPLE-01).
 */
export {
  STRUCTURE_IMPORT_EXTENSIONS,
  STRUCTURE_IMPORT_LIMITS,
  LESSON_METADATA_SCHEMA,
  UDA_METADATA_SCHEMA,
} from './limits.js';
export { decodeStructureImportFile, hasAcceptedExtension } from './decodeStructureImportFile.js';
export type { StructureImportBytes } from './decodeStructureImportFile.js';
export { parseStructureYaml } from './parseStructureYaml.js';
export { validateUdaMetadataFile, UDA_ENTRY_KEYS } from './validateUdaMetadataFile.js';
export { validateLessonMetadataFile, LESSON_ENTRY_KEYS } from './validateLessonMetadataFile.js';
export {
  LESSON_METADATA_TEMPLATE,
  LESSON_SIMPLE_TEMPLATE,
  LESSON_TEMPLATE_FILENAME,
  STRUCTURE_IMPORT_TEMPLATES,
  UDA_METADATA_TEMPLATE,
  UDA_SIMPLE_TEMPLATE,
  UDA_TEMPLATE_FILENAME,
} from './structureImportTemplates.js';
export {
  detectStructureFormat,
  parseLessonStructureInput,
  parseUdaStructureInput,
} from './structureInputAdapter.js';
export type { StructureInputFormat } from './structureInputAdapter.js';
export { planUdaMetadataAppend } from './planUdaMetadataAppend.js';
export { planLessonMetadataAppend } from './planLessonMetadataAppend.js';
export {
  canonicalizeManifest,
  canonicalizeWithVersion,
  MANIFEST_CANONICAL_VERSION,
} from './structureManifestCanonical.js';
export type {
  ExistingLessonForPlan,
  ExistingUdaForPlan,
  LessonStructureImportManifest,
  ManifestBody,
  NormalizedLessonMetadata,
  NormalizedUdaMetadata,
  PlannedLesson,
  PlannedUda,
  StructureImportError,
  StructureImportErrorCode,
  StructureImportFileKind,
  StructureImportManifest,
  StructureImportResult,
  UdaStructureImportManifest,
} from './types.js';
