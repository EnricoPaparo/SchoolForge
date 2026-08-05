/**
 * STRUCTURE-IMPORT-01 — public surface of the pure structural import layer.
 *
 * Nothing here touches Firestore, Storage or the DOM: this package only turns
 * a YAML file into validated metadata, and validated metadata into a manifest.
 * The dialogs, the lease, the uploads and the commit are STRUCTURE-IMPORT-02A
 * and 02B.
 */
export {
  STRUCTURE_IMPORT_EXTENSIONS,
  STRUCTURE_IMPORT_LIMITS,
  LESSON_METADATA_SCHEMA,
  UDA_METADATA_SCHEMA,
  utf8ByteLength,
} from './limits.js';
export { hasAcceptedExtension, parseStructureYaml } from './parseStructureYaml.js';
export { validateUdaMetadataFile, UDA_ENTRY_KEYS } from './validateUdaMetadataFile.js';
export { validateLessonMetadataFile, LESSON_ENTRY_KEYS } from './validateLessonMetadataFile.js';
export {
  LESSON_METADATA_TEMPLATE,
  LESSON_TEMPLATE_FILENAME,
  STRUCTURE_IMPORT_TEMPLATES,
  UDA_METADATA_TEMPLATE,
  UDA_TEMPLATE_FILENAME,
} from './structureImportTemplates.js';
export { planUdaMetadataAppend } from './planUdaMetadataAppend.js';
export { planLessonMetadataAppend } from './planLessonMetadataAppend.js';
export { computeStructureManifestHash } from './structureManifestHash.js';
export type {
  ExistingLessonForPlan,
  ExistingUdaForPlan,
  LessonStructureImportManifest,
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
