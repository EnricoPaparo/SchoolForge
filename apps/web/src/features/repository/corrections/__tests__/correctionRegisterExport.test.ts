import { afterEach, describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  buildCorrectionRegisterCsvFilename,
  buildCorrectionRegisterExportRows,
  downloadCorrectionRegisterCsv,
  serializeCorrectionRegisterCsv,
  type CorrectionRegisterExportRow,
} from '../correctionRegisterExport.js';

const DATE = new Date(2026, 6, 14, 9, 5);

const completeRow: CorrectionRegisterExportRow = {
  studentName: 'Mario Rossi',
  studentEmail: 'mario@example.test',
  status: 'completed',
  statusLabel: 'Corretta',
  totalPoints: 8.5,
  maxPoints: 10,
  percentage: 85,
  submittedAt: DATE,
  deliveryCode: 'SF-A1',
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('buildCorrectionRegisterExportRows', () => {
  it('preserves input order and maps status, score and timestamp without technical fields', () => {
    const rows = buildCorrectionRegisterExportRows([
      { studentName: 'Bruno', studentEmail: 'b@test.it', submission: null },
      {
        studentName: 'Anna',
        studentEmail: 'a@test.it',
        submission: {
          studentUid: 'private-uid',
          status: 'submitted',
          lastSavedAt: Timestamp.fromDate(DATE),
          submittedAt: Timestamp.fromDate(DATE),
          deliveryCode: 'SF-A',
          correctionStatus: 'completed',
          correctionSummary: { totalPoints: 8.5, maxPoints: 10, percentage: 85 },
          attentionEventsCount: 12,
          attentionEvents: [{ type: 'copy_attempt', ts: 123 }],
        },
      },
    ]);

    expect(rows.map((row) => row.studentName)).toEqual(['Bruno', 'Anna']);
    expect(rows[0]).toMatchObject({ status: 'not_started', statusLabel: 'Non iniziata' });
    expect(rows[1]).toMatchObject({
      status: 'completed',
      statusLabel: 'Corretta',
      totalPoints: 8.5,
      maxPoints: 10,
      percentage: 85,
      deliveryCode: 'SF-A',
    });
    expect(rows[1]?.submittedAt?.getTime()).toBe(DATE.getTime());
    expect(JSON.stringify(rows)).not.toMatch(
      /private-uid|attentionEvents|copy_attempt|answers|feedback/i,
    );
  });

  it('does not expose a stale summary while the correction is still only submitted', () => {
    const [row] = buildCorrectionRegisterExportRows([
      {
        studentName: 'Anna',
        studentEmail: null,
        submission: {
          studentUid: 'uid',
          status: 'submitted',
          lastSavedAt: Timestamp.fromDate(DATE),
          submittedAt: null,
          deliveryCode: null,
          correctionStatus: 'submitted',
          correctionSummary: { totalPoints: 7, maxPoints: 10, percentage: 70 },
          attentionEventsCount: 0,
          attentionEvents: [],
        },
      },
    ]);
    expect(row).toMatchObject({ totalPoints: null, maxPoints: null, percentage: null });
  });
});

describe('serializeCorrectionRegisterCsv', () => {
  it('uses BOM, Italian headers, semicolons, decimal comma and numeric percentage', () => {
    const csv = serializeCorrectionRegisterCsv([completeRow]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain(
      'Studente;Email;Stato;Punteggio;Punteggio massimo;Percentuale;Consegnata il;Codice consegna',
    );
    expect(csv).toContain(
      'Mario Rossi;mario@example.test;Corretta;8,5;10;85;14/07/2026 09:05;SF-A1',
    );
    expect(csv).not.toContain('85%');
  });

  it('escapes semicolons, quotes and newlines and neutralizes spreadsheet formulas', () => {
    const csv = serializeCorrectionRegisterCsv([
      {
        ...completeRow,
        studentName: '=HYPERLINK("bad";"Mario")',
        studentEmail: 'mario;rossi@example.test',
        statusLabel: 'Corretta\nverificata',
      },
    ]);
    expect(csv).toContain('"\'=HYPERLINK(""bad"";""Mario"")"');
    expect(csv).toContain('"mario;rossi@example.test"');
    expect(csv).toContain('"Corretta\nverificata"');
  });

  it('renders every missing value as an empty field', () => {
    const csv = serializeCorrectionRegisterCsv([
      {
        ...completeRow,
        studentEmail: null,
        totalPoints: null,
        maxPoints: null,
        percentage: null,
        submittedAt: null,
        deliveryCode: null,
      },
    ]);
    expect(csv.split('\r\n')[1]).toBe('Mario Rossi;;Corretta;;;;;');
    expect(csv).not.toMatch(/undefined|null|—/);
  });
});

describe('CSV filename and download', () => {
  it('builds a sanitized filename and omits the class segment when absent', () => {
    expect(
      buildCorrectionRegisterCsvFilename({
        title: 'Verifica: "Reti" / TCP?',
        className: 'Classe 3A',
        date: DATE,
      }),
    ).toBe('20260714-Classe-3A-Verifica-Reti-TCP-registro-correzioni.csv');
    expect(buildCorrectionRegisterCsvFilename({ title: 'Reti', className: null, date: DATE })).toBe(
      '20260714-Reti-registro-correzioni.csv',
    );
  });

  it('always revokes the object URL after triggering the browser download', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:csv');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadCorrectionRegisterCsv('csv', 'registro.csv');
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv');
  });
});
