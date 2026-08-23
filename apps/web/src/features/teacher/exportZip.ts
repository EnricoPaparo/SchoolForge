import JSZip from 'jszip';
import type { Firestore } from 'firebase/firestore';
import { listLessons, listUdas, type ProgramItem } from '../repository/programs/programsService.js';
import { readTexts } from '../repository/gateway/repositoryGatewayClient.js';
import { filterCommittedLessons } from '../repository/programs/committedUdas.js';
import {
  VISUAL_EXPORT_ZIP_PREFIX,
  VisualExportError,
  type VisualExportItem,
} from '../repository/programs/visualExportClient.js';

/**
 * VE-03C — lettura dei visual, iniettabile. Il default carica il client reale
 * solo quando serve davvero: un programma senza immagini non deve importare né
 * istanziare nulla, e non fa alcuna chiamata.
 */
export type FetchLessonVisuals = (request: {
  programId: string;
  importId: string;
  lessonIds: string[];
}) => Promise<VisualExportItem[]>;

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Decodifica base64 → byte, senza dipendenze nuove. */
function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
  _legacyStorage: unknown,
  db: Firestore,
  fetchLessonVisuals?: FetchLessonVisuals,
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
  const writtenPaths = new Set<string>();
  for (const entry of entries) {
    const content = contentByPath.get(entry.storagePath);
    if (content !== undefined) {
      zip.file(entry.zipPath, content);
      writtenPaths.add(entry.zipPath);
    }
  }

  // VE-03C — i sidecar visuali, dopo i file didattici e in ordine di lezione.
  //
  // `lesson.visual` è già nel documento che l'export ha appena letto: sapere
  // quali lezioni hanno un'immagine non costa **nessuna** lettura in più, e un
  // programma che non ne ha nemmeno una non fa alcuna chiamata binaria.
  const lessonsWithVisual = lessons.filter(
    (lesson) => lesson.visual !== undefined && lesson.visual !== null,
  );
  if (lessonsWithVisual.length > 0) {
    const fetchVisuals =
      fetchLessonVisuals ??
      (async (request) => {
        const [{ functions }, { createVisualExportClient }] = await Promise.all([
          import('../../lib/firebase.js'),
          import('../repository/programs/visualExportClient.js'),
        ]);
        return createVisualExportClient(functions).fetchLessonVisuals(request);
      });

    const items = await fetchVisuals({
      programId: program.id,
      importId: program.activeImportId,
      lessonIds: lessonsWithVisual.map((lesson) => lesson.id),
    });
    if (items.length !== lessonsWithVisual.length) {
      throw new VisualExportError('L’export delle immagini non copre tutte le lezioni richieste.');
    }

    for (let i = 0; i < lessonsWithVisual.length; i += 1) {
      const lesson = lessonsWithVisual[i]!;
      const item = items[i]!;
      if (item.lessonId !== lesson.id) {
        throw new VisualExportError(
          'L’ordine delle immagini esportate non corrisponde alle lezioni.',
        );
      }
      // Fail-closed: la lezione **dichiara** un'immagine. Un `absent` qui non è
      // il caso normale — quello non arriva nemmeno fin qui — ma una divergenza
      // fra il documento e ciò che il server è riuscito a verificare.
      if (item.status !== 'present') {
        throw new VisualExportError(
          `L’immagine della lezione ${lesson.filename} non è disponibile: export interrotto.`,
        );
      }
      if (!UUID_V4_RE.test(item.assetId)) {
        throw new VisualExportError('Identificativo immagine non valido: export interrotto.');
      }

      const jsonPath = `${VISUAL_EXPORT_ZIP_PREFIX}${item.assetId}.json`;
      const webpPath = `${VISUAL_EXPORT_ZIP_PREFIX}${item.assetId}.webp`;
      for (const path of [jsonPath, webpPath]) {
        // `JSZip.file()` sovrascrive in silenzio: senza questo controllo due
        // lezioni con lo stesso assetId produrrebbero un archivio a cui manca
        // una figura, e nulla lo segnalerebbe.
        if (writtenPaths.has(path)) {
          throw new VisualExportError(`Collisione di percorso nell’archivio: ${path}`);
        }
        writtenPaths.add(path);
      }

      const bytes = decodeBase64(item.base64);
      if (bytes.byteLength !== item.byteLength) {
        throw new VisualExportError('I byte dell’immagine non corrispondono a quanto dichiarato.');
      }
      zip.file(jsonPath, item.manifestJson);
      zip.file(webpPath, bytes);
    }
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
  fetchLessonVisuals?: FetchLessonVisuals,
): Promise<void> {
  const zip = await buildExportZip(program, legacyStorage, db, fetchLessonVisuals);

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${program.title.replace(/\s+/g, '_')}_export.zip`;
  a.click();
  URL.revokeObjectURL(url);
}
