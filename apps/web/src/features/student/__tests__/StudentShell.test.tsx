import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { StudentShell } from '../StudentShell.js';

const mockSignOut = vi.fn();
const mockLoadStudentLessons = vi.fn();
const mockLoadStudentVerifications = vi.fn();
const mockLoadSubmission = vi.fn();
const mockLoadReceipt = vi.fn();
let mockUser: { uid: string; email: string; displayName: string | null; photoURL?: string | null } =
  { uid: 'student-uid', email: 'student@test.com', displayName: null };

vi.mock('../../../lib/firebase.js', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: mockUser, signOut: mockSignOut }),
}));
vi.mock('../../repository/programs/studentLessonsService.js', () => ({
  loadStudentLessons: (...args: unknown[]) => mockLoadStudentLessons(...args),
}));
vi.mock('../../repository/verifications/studentVerificationsService.js', () => ({
  loadStudentVerifications: (...args: unknown[]) => mockLoadStudentVerifications(...args),
}));
vi.mock('../submissionsService.js', () => ({
  loadSubmission: (...args: unknown[]) => mockLoadSubmission(...args),
  loadReceipt: (...args: unknown[]) => mockLoadReceipt(...args),
  startSubmission: vi.fn(),
}));
vi.mock('../OnlineExamView.js', () => ({
  OnlineExamView: ({ title }: { title: string }) => (
    <div data-testid="online-exam-view">{title}</div>
  ),
}));

mockLoadStudentLessons.mockResolvedValue({ status: 'no-class' });
mockLoadStudentVerifications.mockResolvedValue({ status: 'no-class' });
mockLoadSubmission.mockResolvedValue(null);
mockLoadReceipt.mockResolvedValue(null);

describe('StudentShell', () => {
  it('renders exactly the Lezioni and Verifiche sections, nothing else', async () => {
    render(<StudentShell />);
    const nav = await screen.findByRole('navigation', { name: 'Sezioni studente' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((btn) => btn.textContent?.replace(/[^\p{L}]/gu, '') ?? '');
    expect(labels).toEqual(['Lezioni', 'Verifiche']);
  });

  it('never shows teacher-only navigation entries', () => {
    render(<StudentShell />);
    for (const teacherLabel of ['Corsi', 'Classi', 'Template']) {
      expect(screen.queryByRole('button', { name: teacherLabel })).toBeNull();
    }
  });

  it('shows the Lezioni section content by default', async () => {
    render(<StudentShell />);
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('shows the Verifiche section content on nav click', async () => {
    render(<StudentShell />);
    fireEvent.click(await screen.findByRole('button', { name: /Verifiche/ }));
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('integration: an approved student with a class sees real lesson content wired through Lezioni', async () => {
    mockLoadStudentLessons.mockResolvedValueOnce({
      status: 'ok',
      programs: [{ id: 'prog-a', title: 'Informatica', classIds: ['class-a'] }],
      lessonsByProgram: { 'prog-a': [] },
    });
    render(<StudentShell />);
    await waitFor(() => expect(screen.getByText('Informatica')).toBeTruthy());
  });

  it('integration: an approved student with a class sees real verification content wired through Verifiche', async () => {
    // Queued twice: StudentShell's own mandatory-session check
    // (resolveActiveSession) calls loadStudentVerifications once at mount,
    // before StudentVerificationsView mounts and calls it again itself —
    // each `mockResolvedValueOnce` here is consumed by one of those calls,
    // then the module-level default ('no-class') resumes for later tests.
    const okResult = {
      status: 'ok' as const,
      verifications: [
        {
          id: 'ver-1',
          title: 'Verifica Reti',
          className: 'Classe A',
          activatedAt: null,
          questionCount: 2,
          questions: [],
        },
      ],
    };
    mockLoadStudentVerifications.mockResolvedValueOnce(okResult).mockResolvedValueOnce(okResult);
    render(<StudentShell />);
    fireEvent.click(await screen.findByRole('button', { name: /Verifiche/ }));
    await waitFor(() => expect(screen.getByText('Verifica Reti')).toBeTruthy());
  });

  it('renders no verification data when no class is assigned (empty state only)', async () => {
    render(<StudentShell />);
    fireEvent.click(await screen.findByRole('button', { name: /Verifiche/ }));
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders avatar button with account menu', () => {
    render(<StudentShell />);
    expect(screen.getByRole('button', { name: /Account:/ })).toBeTruthy();
  });

  it('shows email and logout in dropdown when avatar clicked', () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.getByText('student@test.com')).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Esci' })).toBeTruthy();
  });

  it('calls signOut when Esci clicked in dropdown', () => {
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Esci' }));
    expect(mockSignOut).toHaveBeenCalledOnce();
  });

  it('renders the SchoolForge wordmark logo in the header', () => {
    render(<StudentShell />);
    expect(screen.getByRole('img', { name: 'SchoolForge' })).toBeTruthy();
  });

  it('shows displayName above email in dropdown when displayName is present', () => {
    mockUser = { uid: 'student-uid', email: 'student@test.com', displayName: 'Lucia Bianchi' };
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.getByText('Lucia Bianchi')).toBeTruthy();
    expect(screen.getByText('student@test.com')).toBeTruthy();
  });

  it('shows only email in dropdown when displayName is null', () => {
    mockUser = { uid: 'student-uid', email: 'student@test.com', displayName: null };
    render(<StudentShell />);
    fireEvent.click(screen.getByRole('button', { name: /Account:/ }));
    expect(screen.queryByText('null')).toBeNull();
    expect(screen.getByText('student@test.com')).toBeTruthy();
  });
});

describe('StudentShell — mandatory exam session (M3F-06)', () => {
  const ONLINE_VERIFICATION = {
    id: 'ver-online',
    title: 'Verifica Online',
    className: 'Classe A',
    activatedAt: null,
    questionCount: 1,
    questions: [{ order: 0, tipo: 'aperta' as const, maxPoints: 2, testo: 'Domanda?' }],
    onlineEnabled: true,
    ownerUid: 'owner-uid',
  };

  const DRAFT_SUBMISSION = {
    submissionId: 'ver-online_student-uid',
    verificationId: 'ver-online',
    studentUid: 'student-uid',
    ownerUid: 'owner-uid',
    status: 'draft' as const,
    answers: {},
    flagged: {},
    attentionEvents: [],
    deliveryCode: null,
    verificationTitle: 'Verifica Online',
    className: 'Classe A',
    startedAt: { seconds: 100 },
    lastSavedAt: { seconds: 100 },
    submittedAt: null,
  };

  it('a draft submission found on mount (e.g. after a refresh) mounts the exam directly, with no Lezioni/Verifiche nav', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [ONLINE_VERIFICATION],
    });
    mockLoadSubmission.mockResolvedValue(DRAFT_SUBMISSION);

    render(<StudentShell />);

    await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Sezioni studente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lezioni' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verifiche' })).toBeNull();

    // The header (account menu) stays available — it is not app navigation
    // to Lezioni/Verifiche and does not bypass the mandatory session.
    expect(screen.getByRole('button', { name: /Account:/ })).toBeTruthy();
  });

  it('shows the nav normally when no draft session exists', async () => {
    mockLoadStudentVerifications.mockResolvedValue({ status: 'no-class' });
    render(<StudentShell />);

    await waitFor(() =>
      expect(screen.getByRole('navigation', { name: 'Sezioni studente' })).toBeTruthy(),
    );
    expect(screen.queryByTestId('online-exam-view')).toBeNull();
  });
});
