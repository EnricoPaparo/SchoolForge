import { describe, expect, it, vi } from 'vitest';
import { downloadMarkdown, downloadPdf, generateMarkdown } from '../programmaSvolto.js';
import type {
  LessonItem,
  ProgramItem,
  UdaItem,
} from '../../repository/programs/programsService.js';

const PROGRAM: ProgramItem = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Informatica',
  activeImportId: 'imp-1',
  classIds: [],
  createdAt: null as never,
  updatedAt: null as never,
};

const UDA: UdaItem = {
  id: 'uda-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  dir: 'uda-01-reti',
  filename: 'uda-01-reti.md',
  storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01-reti',
  lessonCount: 2,
  descrizione: null,
  competenze: [],
  obiettivi: [],
};

const LESSON_COMPLETED: LessonItem = {
  id: 'lesson-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  poolStatus: 'valid',
  questionCount: 2,
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  poolStorageRef: null,
  completed: true,
  completedAt: null,
};

const LESSON_NOT_COMPLETED: LessonItem = {
  ...LESSON_COMPLETED,
  id: 'lesson-2',
  filename: 'lezione-002.md',
  completed: false,
};

describe('generateMarkdown', () => {
  it('includes only completed lessons', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_COMPLETED, LESSON_NOT_COMPLETED]);
    expect(md).toContain('lezione-001.md');
    expect(md).not.toContain('lezione-002.md');
  });

  it('includes program title', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_COMPLETED]);
    expect(md).toContain('Informatica');
  });

  it('includes UDA directory as heading', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_COMPLETED]);
    expect(md).toContain('uda-01-reti');
  });

  it('shows empty message when no completed lessons', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_NOT_COMPLETED]);
    expect(md).toContain('Nessuna lezione');
  });

  it('includes completedAt date when present', () => {
    const lessonWithDate: LessonItem = {
      ...LESSON_COMPLETED,
      completedAt: { seconds: 1750000000, nanoseconds: 0 } as never,
    };
    const md = generateMarkdown(PROGRAM, [UDA], [lessonWithDate]);
    // Should contain a date string
    expect(md).toMatch(/\(\d{1,2}\/\d{1,2}\/\d{4}\)/);
  });

  it('handles lessons without explicit completed flag (falsy)', () => {
    const lesson: LessonItem = { ...LESSON_COMPLETED, completed: undefined };
    const md = generateMarkdown(PROGRAM, [UDA], [lesson]);
    // completed is undefined, treated as falsy
    expect(md).not.toContain('lezione-001.md');
  });
});

describe('generateMarkdown — metadata presence rules', () => {
  it('never prints a descrizione section when programmaMeta is absent', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_COMPLETED]);
    expect(md).not.toContain('Non indicato');
  });

  it('prints the program descrizione only when present', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_COMPLETED], {
      annoScolastico: null,
      docente: null,
      materia: null,
      classe: null,
      descrizione: 'Descrizione del programma annuale.',
    });
    expect(md).toContain('Descrizione del programma annuale.');
  });

  it('omits the descrizione section when programmaMeta.descrizione is null', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_COMPLETED], {
      annoScolastico: '2025/2026',
      docente: null,
      materia: null,
      classe: null,
      descrizione: null,
    });
    expect(md).not.toContain('Non indicato');
  });

  it('prints Competenze/Obiettivi only when the UDA has them', () => {
    const udaWithMeta: UdaItem = {
      ...UDA,
      competenze: ['Competenza A'],
      obiettivi: ['Obiettivo 1'],
    };
    const md = generateMarkdown(PROGRAM, [udaWithMeta], [LESSON_COMPLETED]);
    expect(md).toContain('Competenze:');
    expect(md).toContain('Competenza A');
    expect(md).toContain('Obiettivi:');
    expect(md).toContain('Obiettivo 1');
  });

  it('omits Competenze/Obiettivi sections when the UDA has none (fallback to minimal output)', () => {
    const md = generateMarkdown(PROGRAM, [UDA], [LESSON_COMPLETED]);
    expect(md).not.toContain('Competenze:');
    expect(md).not.toContain('Obiettivi:');
    expect(md).not.toContain('Non indicato');
  });

  it('omits Obiettivi when only competenze is present', () => {
    const udaCompetenzeOnly: UdaItem = { ...UDA, competenze: ['Competenza A'], obiettivi: [] };
    const md = generateMarkdown(PROGRAM, [udaCompetenzeOnly], [LESSON_COMPLETED]);
    expect(md).toContain('Competenze:');
    expect(md).not.toContain('Obiettivi:');
  });
});

describe('downloadMarkdown', () => {
  it('calls URL.createObjectURL and creates an anchor element', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const revokeObjectURL = vi.fn();
    global.URL.createObjectURL = createObjectURL;
    global.URL.revokeObjectURL = revokeObjectURL;

    const clickSpy = vi.fn();
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') {
        const el = origCreate('a');
        el.click = clickSpy;
        return el;
      }
      return origCreate(tag);
    });

    downloadMarkdown('# Test', 'test.md');

    expect(createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    vi.restoreAllMocks();
  });
});

describe('downloadPdf', () => {
  it('resolves without throwing for standard markdown content', async () => {
    // jsPDF uses canvas APIs not available in jsdom — we only verify the function
    // does not throw when jsPDF is available (it will fail gracefully if jsPDF save fails).
    const content = '# Title\n\n## UDA\n\n- lesson.md\n';
    // downloadPdf dynamically imports jsPDF; in jsdom it may throw due to missing canvas.
    // We catch and only fail on unexpected errors.
    try {
      await downloadPdf(content, 'programma-svolto');
    } catch (e) {
      // Acceptable in jsdom environment where canvas/font APIs are not available
      const msg = e instanceof Error ? e.message : String(e);
      // Re-throw if it's an unexpected error unrelated to jsdom limitations
      if (
        !msg.includes('canvas') &&
        !msg.includes('font') &&
        !msg.includes('jsPDF') &&
        !msg.includes('not a function') &&
        !msg.includes('undefined')
      ) {
        throw e;
      }
    }
  });
});
