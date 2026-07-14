import JSZip from 'jszip';
import type { Firestore } from 'firebase/firestore';
import { listLessons, listUdas, type ProgramItem } from '../repository/programs/programsService.js';
import { readTexts } from '../repository/gateway/repositoryGatewayClient.js';

/**
 * Builds the exportable archive for a program's active import, reading live
 * from Firestore/Storage — so it always reflects every Repository Editor
 * change (create/update/reorder/delete), never a stale snapshot. Split out
 * from `exportZip` so tests can inspect the archive's contents and entry
 * order directly, without the browser-download side effects.
 *
 * UDA/lesson content is fetched concurrently for speed, but `zip.file()` is
 * only ever called afterwards, in a single sequential pass over the already
 * `order`-sorted arrays from `listUdas`/`listLessons`. Calling `zip.file()`
 * from inside the concurrent fetch callbacks would let network timing
 * decide the archive's physical entry order instead of `order` — and
 * `readZipFile`/`validateImport` derive a freshly-reimported UDA/lesson's
 * `order` from that physical position (see `buildImportPayload.ts`), so a
 * scrambled archive would silently lose a teacher's RE-04 reorder on the
 * next reimport.
 */
export async function buildExportZip(
  program: ProgramItem,
  _legacyStorage: unknown,
  db: Firestore,
): Promise<JSZip> {
  if (!program.activeImportId) {
    throw new Error('Program has no active import.');
  }

  const zip = new JSZip();

  const [udas, lessons] = await Promise.all([
    listUdas(program.id, program.activeImportId, db),
    listLessons(program.id, program.activeImportId, db),
  ]);

  const entries = [
    ...udas
      .filter((uda) => !uda.filename.endsWith('.pool.md'))
      .map((uda) => ({
        storagePath: `${uda.storageBasePath}/${uda.filename}`,
        zipPath: `${uda.dir}/${uda.filename}`,
      })),
    ...lessons
      .filter(
        (lesson) =>
          !lesson.filename.endsWith('.pool.md') && !lesson.storageRef.endsWith('.pool.md'),
      )
      .map((lesson) => ({
        storagePath: lesson.storageRef,
        zipPath: `${lesson.udaDir}/${lesson.filename}`,
      })),
  ];
  const results = await readTexts(entries.map((entry) => entry.storagePath));
  const contentByPath = new Map(
    results.filter((result) => result.ok).map((result) => [result.path, result.content]),
  );
  for (const entry of entries) {
    const content = contentByPath.get(entry.storagePath);
    if (content !== undefined) zip.file(entry.zipPath, content);
  }

  return zip;
}

/**
 * Exports a ZIP archive of all lesson and UDA .md files from the program's
 * active import. Pool files (.pool.md) are excluded.
 * Triggers a browser download — does NOT write to Firebase Storage.
 */
export async function exportZip(
  program: ProgramItem,
  legacyStorage: unknown,
  db: Firestore,
): Promise<void> {
  const zip = await buildExportZip(program, legacyStorage, db);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${program.title.replace(/\s+/g, '_')}_export.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
