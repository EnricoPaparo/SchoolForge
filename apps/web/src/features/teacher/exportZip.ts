import JSZip from 'jszip';
import type { Firestore } from 'firebase/firestore';
import { listLessons, listUdas, type ProgramItem } from '../repository/programs/programsService.js';
import { readTexts } from '../repository/gateway/repositoryGatewayClient.js';
import { filterCommittedLessons } from '../repository/programs/committedUdas.js';

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

  const [udas, allLessons] = await Promise.all([
    listUdas(program.id, program.activeImportId, db),
    listLessons(program.id, program.activeImportId, db),
  ]);
  // Never export a lesson staged for a not-yet-committed UDA (no UdaDoc).
  const lessons = filterCommittedLessons(udas, allLessons);

  const entries: Array<{ storagePath: string; zipPath: string }> = [
    ...udas
      .filter((uda) => !uda.filename.endsWith('.pool.md'))
      .map((uda) => ({
        storagePath: `${uda.storageBasePath}/${uda.filename}`,
        zipPath: `${uda.dir}/${uda.filename}`,
      })),
  ];

  // Lessons keep their `order` sequence; each lesson that carries a valid pool
  // emits its companion `.pool.md` entry immediately after the lesson entry, so
  // the archive is a full pool round-trip (TWU-04B). The pool zip name is
  // derived from the lesson filename (`lezione-XXX-slug.pool.md`) so a
  // reimported archive re-associates the pool with its lesson by the same
  // companion convention `readZipFile`/`validateImport` already expect.
  // Pools are read from the authoritative `poolStorageRef` and only exported
  // when the pool is `valid`: an `invalid`/`absent` pool is never emitted, so a
  // program without pools exports exactly as before (no regression).
  for (const lesson of lessons) {
    if (lesson.filename.endsWith('.pool.md') || lesson.storageRef.endsWith('.pool.md')) continue;
    entries.push({
      storagePath: lesson.storageRef,
      zipPath: `${lesson.udaDir}/${lesson.filename}`,
    });
    if (lesson.poolStatus === 'valid' && lesson.poolStorageRef) {
      const poolZipName = lesson.filename.replace(/\.md$/, '.pool.md');
      entries.push({
        storagePath: lesson.poolStorageRef,
        zipPath: `${lesson.udaDir}/${poolZipName}`,
      });
    }
  }
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
