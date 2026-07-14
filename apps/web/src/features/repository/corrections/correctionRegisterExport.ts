import type { SubmissionMonitorItem } from '../verifications/submissionsMonitorService.js';
import {
  formatDateForFilename,
  sanitizeForFilename,
} from '../verifications/verificationPdfNaming.js';

export type CorrectionRegisterStatus =
  | 'not_started'
  | 'draft'
  | 'submitted'
  | 'in_progress'
  | 'completed'
  | 'returned';

export type CorrectionRegisterExportRow = {
  studentName: string;
  studentEmail: string | null;
  status: CorrectionRegisterStatus;
  statusLabel: string;
  totalPoints: number | null;
  maxPoints: number | null;
  percentage: number | null;
  submittedAt: Date | null;
  deliveryCode: string | null;
};

export type CorrectionRegisterExportSource = {
  studentName: string;
  studentEmail: string | null;
  submission: SubmissionMonitorItem | null;
};

const CSV_HEADERS = [
  'Studente',
  'Email',
  'Stato',
  'Punteggio',
  'Punteggio massimo',
  'Percentuale',
  'Consegnata il',
  'Codice consegna',
] as const;

function statusFor(submission: SubmissionMonitorItem | null): {
  status: CorrectionRegisterStatus;
  label: string;
} {
  if (!submission) return { status: 'not_started', label: 'Non iniziata' };
  if (submission.status === 'draft') return { status: 'draft', label: 'In corso' };
  switch (submission.correctionStatus) {
    case 'in_progress':
      return { status: 'in_progress', label: 'In correzione' };
    case 'completed':
      return { status: 'completed', label: 'Corretta' };
    case 'returned':
      return { status: 'returned', label: 'Restituita' };
    default:
      return { status: 'submitted', label: 'Consegnata' };
  }
}

function timestampToDate(value: unknown): Date | null {
  if (value instanceof Date) return new Date(value.getTime());
  if (!value || typeof value !== 'object') return null;
  if ('toDate' in value && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate();
  }
  if ('seconds' in value && typeof (value as { seconds?: unknown }).seconds === 'number') {
    return new Date((value as { seconds: number }).seconds * 1000);
  }
  return null;
}

/** Builds the export model from the already-loaded monitor data, preserving input order. */
export function buildCorrectionRegisterExportRows(
  sources: readonly CorrectionRegisterExportSource[],
): CorrectionRegisterExportRow[] {
  return sources.map(({ studentName, studentEmail, submission }) => {
    const { status, label } = statusFor(submission);
    const summary =
      status === 'submitted' || status === 'draft' ? null : submission?.correctionSummary;
    return {
      studentName,
      studentEmail,
      status,
      statusLabel: label,
      totalPoints: summary?.totalPoints ?? null,
      maxPoints: summary?.maxPoints ?? null,
      percentage: summary?.percentage ?? null,
      submittedAt: timestampToDate(submission?.submittedAt),
      deliveryCode: submission?.deliveryCode ?? null,
    };
  });
}

function protectSpreadsheetText(value: string): string {
  return /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

function escapeCsvCell(value: string): string {
  const protectedValue = protectSpreadsheetText(value);
  return /[;"\r\n]/.test(protectedValue)
    ? `"${protectedValue.replace(/"/g, '""')}"`
    : protectedValue;
}

function formatDecimal(value: number | null): string {
  if (value === null) return '';
  return new Intl.NumberFormat('it-IT', {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatLocalDateTime(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  const dd = String(value.getDate()).padStart(2, '0');
  const mm = String(value.getMonth() + 1).padStart(2, '0');
  const yyyy = value.getFullYear();
  const hh = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${minutes}`;
}

/** UTF-8 CSV for Italian Excel: BOM, semicolon delimiter, decimal comma. */
export function serializeCorrectionRegisterCsv(
  rows: readonly CorrectionRegisterExportRow[],
): string {
  const lines = [CSV_HEADERS.map(escapeCsvCell).join(';')];
  for (const row of rows) {
    lines.push(
      [
        escapeCsvCell(row.studentName),
        escapeCsvCell(row.studentEmail ?? ''),
        escapeCsvCell(row.statusLabel),
        formatDecimal(row.totalPoints),
        formatDecimal(row.maxPoints),
        row.percentage === null ? '' : String(row.percentage),
        escapeCsvCell(formatLocalDateTime(row.submittedAt)),
        escapeCsvCell(row.deliveryCode ?? ''),
      ].join(';'),
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}

export function buildCorrectionRegisterCsvFilename(params: {
  title: string;
  className: string | null;
  date?: Date;
}): string {
  const date = formatDateForFilename(params.date ?? new Date());
  const title = sanitizeForFilename(params.title) || 'verifica';
  const className = params.className?.trim() ? `${sanitizeForFilename(params.className)}-` : '';
  return `${date}-${className}${title}-registro-correzioni.csv`;
}

export function downloadCorrectionRegisterCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  try {
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
