import { describe, expect, it, vi } from 'vitest';
import type { CorrectionArchiveModel } from '../correctionArchiveModel.js';
import {
  buildCorrectionArchivePdfFilename,
  classifyCorrectionArchiveEligibility,
  resolveCorrectionArchiveFilenameCollisions,
  runCorrectionArchiveExport,
} from '../correctionArchiveExport.js';
import type { PdfModuleLoadError } from '../../../../lib/pdfModuleLoader.js';

function model(studentName: string): CorrectionArchiveModel {
  return {
    verificationTitle: 'Reti e protocolli',
    studentName,
    className: '3A',
    submittedAt: null,
    correctionStatus: 'completed',
    totalPoints: 4,
    maxPoints: 4,
    percentage: 100,
    questions: [
      {
        order: 0,
        questionText: 'Domanda',
        answerText: 'Risposta',
        points: 4,
        maxPoints: 4,
      },
    ],
  };
}

class FakePdf {
  setFont() {}
  setFontSize() {}
  setTextColor() {}
  line() {}
  splitTextToSize(text: string) {
    return [text];
  }
  text() {}
  addPage() {}
  setPage() {}
  getNumberOfPages() {
    return 1;
  }
  output() {
    return new Uint8Array([1, 2, 3]).buffer;
  }
}

function params(names: string[]) {
  const candidates = names.map((studentName, index) => ({
    submissionId: `sub-${index}`,
    studentUid: `student-${index}`,
    studentName,
  }));
  return {
    verificationId: 'verification-private',
    verification: { teacherSnapshot: { title: 'Reti e protocolli' } } as never,
    ownerUid: 'owner-private',
    candidates,
    db: {} as never,
    loadModels: vi.fn(async () => ({
      models: candidates.map((candidate) => ({ candidate, model: model(candidate.studentName) })),
      failures: [],
    })),
  };
}

describe('correctionArchiveExport', () => {
  it('classifies completed/returned only without opening corrections', () => {
    const result = classifyCorrectionArchiveEligibility([
      {
        studentUid: 'a',
        submissionId: 's-a',
        studentName: 'Anna',
        progress: { status: 'completed' },
      },
      {
        studentUid: 'b',
        submissionId: 's-b',
        studentName: 'Bruno',
        progress: { status: 'returned' },
      },
      {
        studentUid: 'c',
        submissionId: 's-c',
        studentName: 'Carla',
        progress: { status: 'in_progress' },
      },
      { studentUid: 'd', submissionId: 's-d', studentName: 'Dario', progress: null },
    ] as never);
    expect(result.eligible.map((entry) => entry.studentName)).toEqual(['Anna', 'Bruno']);
    expect(result.excluded).toHaveLength(2);
  });

  it('sanitizes names and resolves collisions in row order without technical IDs', () => {
    expect(buildCorrectionArchivePdfFilename('Anna Bìanchi', 'Reti: TCP/IP')).toBe(
      'Bìanchi_Anna_Reti_TCPIP.pdf',
    );
    expect(buildCorrectionArchivePdfFilename('', '')).toBe('Studente_Verifica.pdf');
    expect(resolveCorrectionArchiveFilenameCollisions(['A.pdf', 'a.pdf', 'A.pdf'])).toEqual([
      'A.pdf',
      'a_2.pdf',
      'A_3.pdf',
    ]);
  });

  it('downloads one PDF directly and loads jsPDF exactly once', async () => {
    const input = params(['Anna Bianchi']);
    const loadJsPdf = vi.fn(async () => ({ jsPDF: FakePdf as never }));
    const download = vi.fn();
    const result = await runCorrectionArchiveExport({ ...input, loadJsPdf, download });
    expect(result).toEqual({
      ok: true,
      kind: 'pdf',
      filenames: ['Bianchi_Anna_Reti_e_protocolli.pdf'],
    });
    expect(loadJsPdf).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  });

  it('creates an all-or-nothing ZIP with one distinct PDF per student', async () => {
    const input = params(['Anna Bianchi', 'Anna Bianchi', 'Anna Bianchi']);
    const files: string[] = [];
    const zipGenerate = vi.fn(async () => new Uint8Array([9]));
    class FakeZip {
      file(name: string) {
        files.push(name);
      }
      generateAsync = zipGenerate;
    }
    const download = vi.fn();
    const result = await runCorrectionArchiveExport({
      ...input,
      loadJsPdf: async () => ({ jsPDF: FakePdf as never }),
      loadZip: async () => ({ default: FakeZip as never }),
      download,
    });
    expect(result.ok && result.kind).toBe('zip');
    expect(files).toEqual([
      'Bianchi_Anna_Reti_e_protocolli.pdf',
      'Bianchi_Anna_Reti_e_protocolli_2.pdf',
      'Bianchi_Anna_Reti_e_protocolli_3.pdf',
    ]);
    expect(download).toHaveBeenCalledTimes(1);
    expect(download.mock.calls[0]?.[1]).toBe('Reti_e_protocolli_correzioni.zip');
  });

  it('downloads nothing when any authoritative load fails', async () => {
    const input = params(['Anna', 'Bruno']);
    const download = vi.fn();
    const loadJsPdf = vi.fn();
    const result = await runCorrectionArchiveExport({
      ...input,
      loadModels: vi.fn(async () => ({
        models: [{ candidate: input.candidates[0]!, model: model('Anna') }],
        failures: [{ candidate: input.candidates[1]!, message: 'Dati non coerenti.' }],
      })),
      loadJsPdf,
      download,
    });
    expect(result.ok).toBe(false);
    expect(loadJsPdf).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('does not create a partial ZIP when one PDF renderer fails', async () => {
    const input = params(['Anna', 'Bruno']);
    let created = 0;
    class FailingPdf extends FakePdf {
      readonly number = ++created;
      override output() {
        if (this.number === 2) throw new Error('render failed');
        return super.output();
      }
    }
    const loadZip = vi.fn();
    const download = vi.fn();
    const result = await runCorrectionArchiveExport({
      ...input,
      loadJsPdf: async () => ({ jsPDF: FailingPdf as never }),
      loadZip,
      download,
    });
    expect(result).toMatchObject({
      ok: false,
      failures: [{ candidate: { studentName: 'Bruno' } }],
    });
    expect(loadZip).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it('propagates stale chunks as typed PDF load errors and never downloads', async () => {
    const input = params(['Anna']);
    const download = vi.fn();
    await expect(
      runCorrectionArchiveExport({
        ...input,
        loadJsPdf: async () => {
          throw new TypeError('Failed to fetch dynamically imported module: old-hash.js');
        },
        download,
      }),
    ).rejects.toMatchObject({ category: 'stale_chunk' } satisfies Partial<PdfModuleLoadError>);
    expect(download).not.toHaveBeenCalled();
  });
});
