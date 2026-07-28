import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentVerificationsView } from '../StudentVerificationsView.js';
import type * as VexExamModule from '../vexExamService.js';

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'student-uid', email: 's@test.com', displayName: null } }),
}));

const mockLoadStudentVerifications = vi.fn();
vi.mock('../../repository/verifications/studentVerificationsService.js', () => ({
  loadStudentVerifications: (...a: unknown[]) => mockLoadStudentVerifications(...a),
}));
vi.mock('../../repository/verifications/verificationPdf.js', () => ({
  downloadStudentPdfFromProjection: vi.fn(),
}));

const mockLoadReceipt = vi.fn();
const mockLoadSubmission = vi.fn();
vi.mock('../submissionsService.js', () => ({
  loadReceipt: (...a: unknown[]) => mockLoadReceipt(...a),
  loadSubmission: (...a: unknown[]) => mockLoadSubmission(...a),
  startSubmission: vi.fn(),
}));

vi.mock('../examDeterrence.js', () => ({ requestFullscreenBestEffort: vi.fn() }));
vi.mock('../studentCorrectionReturnsService.js', () => ({
  loadStudentCorrectionReturns: vi.fn(async () => []),
}));

// Mock the VEX exam service so we can assert routing without a real callable.
const mockResolveVexExam = vi.fn();
const mockResolveSameQuestionsExam = vi.fn();
vi.mock('../vexExamService.js', async () => {
  const actual = await vi.importActual<typeof VexExamModule>('../vexExamService.js');
  return {
    ...actual,
    productionVexExamDeps: () => ({ assign: vi.fn(), load: vi.fn() }),
    resolveVexExam: (...a: unknown[]) => mockResolveVexExam(...a),
    resolveSameQuestionsExam: (...a: unknown[]) => mockResolveSameQuestionsExam(...a),
  };
});

vi.mock('../OnlineExamView.js', () => ({
  OnlineExamView: (props: { title: string }) => (
    <div data-testid="online-exam-view">{props.title}</div>
  ),
}));
vi.mock('../ConfirmationView.js', () => ({ ConfirmationView: () => <div /> }));
vi.mock('../StudentCorrectionView.js', () => ({ StudentCorrectionView: () => <div /> }));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

const draftSubmission = {
  submissionId: 's',
  status: 'draft' as const,
  answers: {},
  flagged: {},
  attentionEvents: [],
};

function vexItem(over: Record<string, unknown> = {}) {
  return {
    id: 'ver-vex',
    title: 'Verifica VEX',
    className: 'Classe 3A',
    activatedAt: { seconds: 100 },
    questionCount: 1,
    questions: [{ order: 0, tipo: 'aperta', maxPoints: 2, testo: 'Comune?' }],
    onlineEnabled: true,
    studentPdfEnabled: true,
    ownerUid: 'owner-uid',
    status: 'active',
    distributionMode: 'equivalent_variants',
    ...over,
  };
}

function sameItem(over: Record<string, unknown> = {}) {
  return {
    ...vexItem(over),
    id: 'ver-sq',
    title: 'Verifica SQ',
    distributionMode: 'same_questions',
  };
}

async function renderWith(verifications: unknown[]) {
  mockLoadStudentVerifications.mockResolvedValue({ status: 'ok', verifications });
  mockLoadReceipt.mockResolvedValue(null);
  mockLoadSubmission.mockResolvedValue(null); // no active draft → list shown
  render(<StudentVerificationsView />);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /Svolgi online|Apertura/ })).toBeTruthy(),
  );
}

describe('StudentVerificationsView — VEX-02A routing', () => {
  it('same_questions start calls the client flow, never the VEX callable', async () => {
    mockResolveSameQuestionsExam.mockResolvedValue({ submission: draftSubmission, questions: [] });
    await renderWith([sameItem()]);
    fireEvent.click(screen.getByRole('button', { name: 'Svolgi online — Verifica SQ' }));
    await waitFor(() => expect(mockResolveSameQuestionsExam).toHaveBeenCalledTimes(1));
    expect(mockResolveVexExam).not.toHaveBeenCalled();
  });

  it('equivalent_variants start invokes the callable exactly once (double-click guarded)', async () => {
    let resolveFn: (v: unknown) => void = () => {};
    mockResolveVexExam.mockReturnValue(
      new Promise((res) => {
        resolveFn = res;
      }),
    );
    await renderWith([vexItem()]);
    const btn = screen.getByRole('button', { name: 'Svolgi online — Verifica VEX' });
    fireEvent.click(btn);
    fireEvent.click(btn); // second click during the in-flight callable must be ignored
    expect(mockResolveVexExam).toHaveBeenCalledTimes(1);
    resolveFn({ submission: draftSubmission, questions: [], assignedQuestionOrders: [0] });
    await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
  });

  it('hides the student PDF button for a VEX verification', async () => {
    await renderWith([vexItem()]);
    expect(screen.queryByRole('button', { name: /Scarica PDF/ })).toBeNull();
  });

  it('keeps the student PDF button for a same_questions verification', async () => {
    await renderWith([sameItem()]);
    expect(screen.getByRole('button', { name: /Scarica PDF/ })).toBeTruthy();
  });
});
