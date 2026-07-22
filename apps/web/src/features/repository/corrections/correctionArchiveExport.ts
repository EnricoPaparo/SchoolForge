import type { Firestore } from 'firebase/firestore';
import type { jsPDF as JsPdfInstance } from 'jspdf';
import type { VerificationDoc } from '../../../types/firestore.js';
import { loadPdfModule } from '../../../lib/pdfModuleLoader.js';
import { sanitizeForFilename } from '../verifications/verificationPdfNaming.js';
import type { BatchSelectedRow } from './batchCorrectionActions.js';
import {
  loadCorrectionArchiveModels,
  type CorrectionArchiveCandidate,
  type CorrectionArchiveLoadFailure,
} from './correctionArchiveModel.js';
import {
  renderCorrectionArchivePdf,
  type CorrectionArchivePdfDoc,
} from './correctionArchivePdf.js';

export type CorrectionArchiveExclusionReason = 'missing_correction' | 'not_completed';

export type CorrectionArchiveEligibility = {
  eligible: CorrectionArchiveCandidate[];
  excluded: Array<{
    studentName: string;
    reason: CorrectionArchiveExclusionReason;
  }>;
};

export function classifyCorrectionArchiveEligibility(
  rows: readonly BatchSelectedRow[],
): CorrectionArchiveEligibility {
  const eligible: CorrectionArchiveCandidate[] = [];
  const excluded: CorrectionArchiveEligibility['excluded'] = [];
  for (const row of rows) {
    if (!row.progress) {
      excluded.push({ studentName: row.studentName, reason: 'missing_correction' });
    } else if (row.progress.status !== 'completed' && row.progress.status !== 'returned') {
      excluded.push({ studentName: row.studentName, reason: 'not_completed' });
    } else {
      eligible.push({
        submissionId: row.submissionId,
        studentUid: row.studentUid,
        studentName: row.studentName,
      });
    }
  }
  return { eligible, excluded };
}

export function describeCorrectionArchiveExclusion(
  reason: CorrectionArchiveExclusionReason,
): string {
  return reason === 'missing_correction'
    ? 'Correzione non disponibile.'
    : 'La correzione deve essere completata prima dell’esportazione.';
}

function filenamePart(value: string, fallback: string): string {
  return sanitizeForFilename(value).replace(/-/g, '_') || fallback;
}

export function buildCorrectionArchivePdfFilename(studentName: string, title: string): string {
  const parts = studentName.trim().split(/\s+/).filter(Boolean);
  const name = parts.shift() ?? '';
  const surname = parts.join(' ');
  const student = surname
    ? `${filenamePart(surname, 'Studente')}_${filenamePart(name, '')}`
    : filenamePart(name, 'Studente');
  return `${student}_${filenamePart(title, 'Verifica')}.pdf`;
}

export function buildCorrectionArchiveZipFilename(title: string): string {
  return `${filenamePart(title, 'Verifica')}_correzioni.zip`;
}

export function resolveCorrectionArchiveFilenameCollisions(filenames: readonly string[]): string[] {
  const counts = new Map<string, number>();
  return filenames.map((filename) => {
    const key = filename.toLocaleLowerCase('it-IT');
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count === 1 ? filename : filename.replace(/\.pdf$/i, `_${count}.pdf`);
  });
}

export function downloadArchiveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

type JsPdfConstructor = new (options: {
  orientation: 'portrait';
  unit: 'pt';
  format: 'a4';
}) => JsPdfInstance;

type ZipInstance = {
  file(name: string, data: Uint8Array): void;
  generateAsync(options: { type: 'uint8array' }): Promise<Uint8Array>;
};
type ZipConstructor = new () => ZipInstance;

export type CorrectionArchiveExportResult =
  | { ok: true; kind: 'pdf' | 'zip'; filenames: string[] }
  | { ok: false; failures: CorrectionArchiveLoadFailure[] };

export async function runCorrectionArchiveExport(params: {
  verificationId: string;
  verification: VerificationDoc;
  ownerUid: string;
  candidates: readonly CorrectionArchiveCandidate[];
  db: Firestore;
  loadModels?: typeof loadCorrectionArchiveModels;
  loadJsPdf?: () => Promise<{ jsPDF: JsPdfConstructor }>;
  loadZip?: () => Promise<{ default: ZipConstructor }>;
  download?: typeof downloadArchiveBlob;
}): Promise<CorrectionArchiveExportResult> {
  const loadModels = params.loadModels ?? loadCorrectionArchiveModels;
  const loaded = await loadModels(params);
  if (loaded.failures.length > 0) return { ok: false, failures: loaded.failures };
  if (loaded.models.length === 0) return { ok: false, failures: [] };

  // One dynamic jsPDF module load for the whole operation; one document per student.
  const { jsPDF } = await loadPdfModule(params.loadJsPdf ?? (() => import('jspdf')));
  const filenames = resolveCorrectionArchiveFilenameCollisions(
    loaded.models.map(({ model }) =>
      buildCorrectionArchivePdfFilename(model.studentName, model.verificationTitle),
    ),
  );
  const rendered: Array<{ filename: string; bytes: Uint8Array }> = [];
  const renderFailures: CorrectionArchiveLoadFailure[] = [];
  loaded.models.forEach(({ candidate, model }, index) => {
    try {
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
      rendered.push({
        filename: filenames[index]!,
        bytes: renderCorrectionArchivePdf(model, pdf as unknown as CorrectionArchivePdfDoc),
      });
    } catch {
      renderFailures.push({ candidate, message: 'Impossibile generare questo PDF.' });
    }
  });
  if (renderFailures.length > 0) return { ok: false, failures: renderFailures };

  const download = params.download ?? downloadArchiveBlob;
  if (rendered.length === 1) {
    download(
      new Blob([copyToArrayBuffer(rendered[0]!.bytes)], { type: 'application/pdf' }),
      rendered[0]!.filename,
    );
    return { ok: true, kind: 'pdf', filenames };
  }

  const { default: Zip } = await (params.loadZip ?? (() => import('jszip')))();
  const zip: ZipInstance = new Zip();
  for (const item of rendered) zip.file(item.filename, item.bytes);
  const bytes = await zip.generateAsync({ type: 'uint8array' });
  download(
    new Blob([copyToArrayBuffer(bytes)], { type: 'application/zip' }),
    buildCorrectionArchiveZipFilename(params.verification.teacherSnapshot?.title ?? 'Verifica'),
  );
  return { ok: true, kind: 'zip', filenames };
}
