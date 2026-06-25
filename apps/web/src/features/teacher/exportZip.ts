import JSZip from 'jszip';
import type { FirebaseStorage } from 'firebase/storage';
import { getDownloadURL, ref } from 'firebase/storage';
import type { Firestore } from 'firebase/firestore';
import { listLessons, listUdas, type ProgramItem } from '../repository/programs/programsService.js';

/**
 * Fetches file content from Firebase Storage by storage ref path.
 * Throws if the fetch fails.
 */
async function fetchContent(storagePath: string, storage: FirebaseStorage): Promise<string> {
  const fileRef = ref(storage, storagePath);
  const url = await getDownloadURL(fileRef);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${storagePath}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Exports a ZIP archive of all lesson and UDA .md files from the program's active import.
 * Pool files (.pool.md) are excluded.
 * Triggers a browser download — does NOT write to Firebase Storage.
 */
export async function exportZip(
  program: ProgramItem,
  storage: FirebaseStorage,
  db: Firestore,
): Promise<void> {
  if (!program.activeImportId) {
    throw new Error('Program has no active import.');
  }

  const zip = new JSZip();

  const [udas, lessons] = await Promise.all([
    listUdas(program.id, program.activeImportId, db),
    listLessons(program.id, program.activeImportId, db),
  ]);

  // Add UDA .md files (skip pool files)
  await Promise.all(
    udas.map(async (uda) => {
      if (uda.filename.endsWith('.pool.md')) return;
      try {
        const content = await fetchContent(`${uda.storageBasePath}/${uda.filename}`, storage);
        zip.file(`${uda.dir}/${uda.filename}`, content);
      } catch {
        // Skip files that can't be fetched — they may not exist in storage yet
      }
    }),
  );

  // Add lesson .md files (skip pool files)
  await Promise.all(
    lessons.map(async (lesson) => {
      if (lesson.filename.endsWith('.pool.md')) return;
      if (lesson.storageRef.endsWith('.pool.md')) return;
      try {
        const content = await fetchContent(lesson.storageRef, storage);
        zip.file(`${lesson.udaDir}/${lesson.filename}`, content);
      } catch {
        // Skip files that can't be fetched
      }
    }),
  );

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${program.title.replace(/\s+/g, '_')}_export.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
