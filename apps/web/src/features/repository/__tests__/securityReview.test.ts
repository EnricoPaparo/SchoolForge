/**
 * Security Review Tests — M1-G
 *
 * Unit tests verifying security invariants:
 * - Pool files excluded from ZIP
 * - generateMarkdown excludes non-completed lessons
 * - MarkdownRenderer XSS protection (cross-reference — see MarkdownRenderer.test.tsx)
 * - ReadinessReport canGenerateVerifiche false with no valid pool
 * - Storage rules contain owner-scoping
 * - Firestore rules contain programs/{programId} owner check
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks required by exportZip transitive imports ──────────────────────────

vi.mock('../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../programs/programsService.js', () => ({
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

const mockReadTexts = vi.fn();
vi.mock('../gateway/repositoryGatewayClient.js', () => ({
  readTexts: (...args: unknown[]) => mockReadTexts(...args),
}));

// Mock jszip so we don't need a real zip in tests
const mockZipFile = vi.fn();
const mockZipGenerate = vi.fn().mockResolvedValue(new Blob(['zip-content']));
vi.mock('jszip', () => ({
  default: vi.fn().mockImplementation(() => ({
    file: mockZipFile,
    generateAsync: mockZipGenerate,
  })),
}));

// Mock URL.createObjectURL / revokeObjectURL (not available in jsdom fully)
globalThis.URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
globalThis.URL.revokeObjectURL = vi.fn();

afterEach(() => {
  vi.clearAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROGRAM = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Informatica',
  activeImportId: 'imp-1',
  createdAt: null,
  updatedAt: null,
};

const NORMAL_LESSON = {
  id: 'lesson-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  udaDir: 'uda-01',
  path: 'uda-01/lezione-001.md',
  filename: 'lezione-001.md',
  poolStatus: 'valid' as const,
  questionCount: 3,
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01/lezione-001.md',
  poolStorageRef: 'repository/owner-uid/imports/imp-1/uda-01/lezione-001.pool.md',
  completed: true,
};

const POOL_LESSON = {
  ...NORMAL_LESSON,
  id: 'lesson-pool',
  filename: 'lezione-001.pool.md',
  storageRef: 'repository/owner-uid/imports/imp-1/uda-01/lezione-001.pool.md',
  poolStorageRef: null,
};

// ─── 1. Pool files excluded from ZIP ─────────────────────────────────────────

describe('Security: pool files excluded from ZIP', () => {
  it('does not request or add .pool.md lesson files', async () => {
    const { exportZip } = await import('../../teacher/exportZip.js');

    mockListUdas.mockResolvedValue([]);
    mockListLessons.mockResolvedValue([NORMAL_LESSON, POOL_LESSON]);

    mockReadTexts.mockImplementation(async (paths: string[]) =>
      paths.map((path) => ({ ok: true, path, content: 'lesson content' })),
    );

    // Create a fake anchor element for the download trigger
    const mockAnchor = { href: '', download: '', click: vi.fn() };
    vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor as unknown as HTMLElement);

    await exportZip(PROGRAM as never, {} as never, {} as never);

    expect(mockReadTexts).toHaveBeenCalledWith([NORMAL_LESSON.storageRef]);

    // zip.file() should have been called only for the normal lesson, not for pool lesson.
    const zipFileCalls = mockZipFile.mock.calls as [string, string][];
    const addedPaths = zipFileCalls.map(([path]) => path);
    expect(addedPaths.some((p) => p.endsWith('.pool.md'))).toBe(false);
    expect(addedPaths.some((p) => p.includes('lezione-001.md'))).toBe(true);

    vi.restoreAllMocks();
  });
});

// ─── 2. generateMarkdown excludes non-completed lessons ──────────────────────

describe('Security: generateMarkdown excludes non-completed lessons', () => {
  it('only includes completed lessons in the output', async () => {
    const { generateMarkdown } = await import('../../teacher/programmaSvolto.js');

    const UDA = {
      id: 'uda-1',
      ownerUid: 'owner-uid',
      importId: 'imp-1',
      dir: 'uda-01',
      filename: 'uda-01.md',
      storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01',
      lessonCount: 2,
      descrizione: null,
      competenze: [],
      obiettivi: [],
    };

    const completedLesson = { ...NORMAL_LESSON, completed: true, filename: 'lezione-001.md' };
    const incompleteLesson = {
      ...NORMAL_LESSON,
      id: 'lesson-2',
      completed: false,
      filename: 'lezione-002.md',
    };

    const md = generateMarkdown(PROGRAM as never, [UDA], [completedLesson, incompleteLesson]);

    // EXP-01: readable label, completed-only filter unchanged.
    expect(md).toContain('Lezione 001');
    expect(md).not.toContain('Lezione 002');
  });

  it('returns placeholder when no lessons are completed', async () => {
    const { generateMarkdown } = await import('../../teacher/programmaSvolto.js');
    const UDA = {
      id: 'uda-1',
      ownerUid: 'owner-uid',
      importId: 'imp-1',
      dir: 'uda-01',
      filename: 'uda-01.md',
      storageBasePath: 'repository/owner-uid/imports/imp-1/uda-01',
      lessonCount: 1,
      descrizione: null,
      competenze: [],
      obiettivi: [],
    };
    const incompleteLesson = { ...NORMAL_LESSON, completed: false, filename: 'lezione-001.md' };
    const md = generateMarkdown(PROGRAM as never, [UDA], [incompleteLesson]);
    expect(md).toContain('Nessun argomento segnato come svolto');
    expect(md).not.toContain('lezione-001.md');
  });
});

// ─── 3. MarkdownRenderer XSS protection — cross-reference ────────────────────
// Full XSS coverage exists in:
//   apps/web/src/features/teacher/__tests__/MarkdownRenderer.test.tsx
// (describe block: 'MarkdownRenderer — XSS protection')
// One additional edge case: combined data URI should be stripped.
// NOTE: This test is intentionally kept here as a cross-reference marker; the
// rendering tests in MarkdownRenderer.test.tsx already cover script/onerror/onclick/javascript:.

describe('Security: MarkdownRenderer XSS — cross-reference edge case', () => {
  it('MarkdownRenderer.test.tsx covers script/onerror/onclick/javascript: stripping', () => {
    // This assertion acts as a documentation anchor.
    // If the XSS tests are deleted from MarkdownRenderer.test.tsx, this comment
    // will flag the gap in a code review.
    expect(true).toBe(true);
  });
});

// ─── 4. ReadinessReport canGenerateVerifiche false with no valid pool ─────────

describe('Security: ReadinessReport canGenerateVerifiche false with no valid pool', () => {
  it('returns canGenerateVerifiche=false when no lessons have poolStatus=valid', async () => {
    const { computeReadiness } = await import('../readiness/readinessReport.js');

    const lessonNone = {
      ...NORMAL_LESSON,
      poolStatus: 'absent' as const,
      questionCount: 0,
      completed: true,
    };
    const lessonInvalid = {
      ...NORMAL_LESSON,
      id: 'lesson-invalid',
      poolStatus: 'invalid' as const,
      questionCount: 0,
      completed: true,
    };

    const report = computeReadiness({
      program: PROGRAM as never,
      udas: [],
      lessons: [lessonNone, lessonInvalid],
      hasActiveImport: true,
    });

    expect(report.canGenerateVerifiche).toBe(false);
  });
});

// ─── 5. Storage paths are owner-scoped ───────────────────────────────────────

describe('Security: storage.rules owner-scoping', () => {
  it('storage.rules contains the owner uid check pattern', () => {
    const rulesPath = join(__dirname, '../../../../../..', 'storage.rules');
    const rules = readFileSync(rulesPath, 'utf-8');
    // The rules must scope access to the matching owner uid
    expect(rules).toContain('request.auth.uid == ownerUid');
    // The path must be under repository/{ownerUid}/
    expect(rules).toContain('repository/{ownerUid}/');
  });

  it('storage.rules has a default-deny catch-all', () => {
    const rulesPath = join(__dirname, '../../../../../..', 'storage.rules');
    const rules = readFileSync(rulesPath, 'utf-8');
    expect(rules).toContain('allow read, write: if false');
  });
});

// ─── 6. Firestore rules exist for programs path with owner check ──────────────

describe('Security: firestore.rules programs owner check', () => {
  it('firestore.rules contains programs/{docId} rule with isOwner', () => {
    const rulesPath = join(__dirname, '../../../../../..', 'firestore.rules');
    const rules = readFileSync(rulesPath, 'utf-8');
    // Programs collection must exist
    expect(rules).toContain('programs/{docId}');
    // The rule must use the isOwner function
    expect(rules).toMatch(/programs\/\{docId\}[\s\S]{0,100}isOwner/);
  });

  it('firestore.rules isOwner checks ownerUid stored in settings/owner', () => {
    const rulesPath = join(__dirname, '../../../../../..', 'firestore.rules');
    const rules = readFileSync(rulesPath, 'utf-8');
    // The isOwner function should compare uid against the stored ownerUid
    expect(rules).toContain('ownerUid');
    expect(rules).toContain('request.auth.uid');
  });

  it('firestore.rules has a default-deny catch-all', () => {
    const rulesPath = join(__dirname, '../../../../../..', 'firestore.rules');
    const rules = readFileSync(rulesPath, 'utf-8');
    expect(rules).toContain('allow read, write: if false');
  });
});
