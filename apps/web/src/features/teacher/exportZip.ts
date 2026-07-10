import JSZip from 'jszip';
import type { FirebaseStorage } from 'firebase/storage';
import { getBytes, ref } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';
import { listLessons, listUdas, type ProgramItem } from '../repository/programs/programsService.js';

/**
 * Fetches a Markdown file's content from Firebase Storage. Uses `getBytes`
 * (same primitive as `fetchLessonContent`/`repositoryEditorService.ts`)
 * rather than `getDownloadURL` + `fetch`, so export always reads the current
 * Storage bytes directly through the SDK instead of a plain HTTP request
 * that could be served from the browser's HTTP cache.
 */
async function fetchContent(storagePath: string, storage: FirebaseStorage): Promise<string> {
  const bytes = await getBytes(ref(storage, storagePath));
  return new TextDecoder().decode(bytes);
}

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
  storage: FirebaseStorage,
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

  const udaEntries = await Promise.all(
    udas.map(async (uda) => {
      if (uda.filename.endsWith('.pool.md')) return null;
      try {
        const content = await fetchContent(`${uda.storageBasePath}/${uda.filename}`, storage);
        return { path: `${uda.dir}/${uda.filename}`, content };
      } catch {
        // Skip files that can't be fetched — they may not exist in storage yet
        return null;
      }
    }),
  );
  for (const entry of udaEntries) {
    if (entry) zip.file(entry.path, entry.content);
  }

  const lessonEntries = await Promise.all(
    lessons.map(async (lesson) => {
      if (lesson.filename.endsWith('.pool.md')) return null;
      if (lesson.storageRef.endsWith('.pool.md')) return null;
      try {
        const content = await fetchContent(lesson.storageRef, storage);
        return { path: `${lesson.udaDir}/${lesson.filename}`, content };
      } catch {
        // Skip files that can't be fetched
        return null;
      }
    }),
  );
  for (const entry of lessonEntries) {
    if (entry) zip.file(entry.path, entry.content);
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
  storage: FirebaseStorage,
  db: Firestore,
): Promise<void> {
  const zip = await buildExportZip(program, storage, db);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${program.title.replace(/\s+/g, '_')}_export.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
