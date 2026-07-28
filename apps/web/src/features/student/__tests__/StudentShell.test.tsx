import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);
import { StudentShell } from '../StudentShell.js';

const mockSignOut = vi.fn();
const mockLoadStudentLessons = vi.fn();
const mockLoadStudentVerifications = vi.fn();
const mockLoadSubmission = vi.fn();
const mockLoadReceipt = vi.fn();
const mockGetOwnStudentDoc = vi.fn();
const mockWatchStudentAccessSettings = vi.fn();
let mockUser: { uid: string; email: string; displayName: string | null; photoURL?: string | null } =
  { uid: 'student-uid', email: 'student@test.com', displayName: null };

vi.mock('../../../lib/firebase.js', () => ({
  app: {},
  auth: {},
  db: {},
  storage: {},
  functions: {},
}));
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
vi.mock('../../repository/students/studentsService.js', () => ({
  getOwnStudentDoc: (...args: unknown[]) => mockGetOwnStudentDoc(...args),
}));
vi.mock('../../repository/students/studentAccessService.js', () => ({
  watchStudentAccessSettings: (...args: unknown[]) => mockWatchStudentAccessSettings(...args),
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
mockGetOwnStudentDoc.mockResolvedValue(null);
mockWatchStudentAccessSettings.mockImplementation(
  (_db: unknown, onChange: (settings: { examMode: unknown }) => void) => {
    onChange({ examMode: { enabled: false, scope: 'all', classIds: [], enabledAt: null } });
    return vi.fn();
  },
);

describe('StudentShell', () => {
  it('renders exactly the Didattica and Verifiche sections, nothing else', async () => {
    render(<StudentShell />);
    const nav = await screen.findByRole('navigation', { name: 'Sezioni studente' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((btn) => btn.textContent?.replace(/[^\p{L}]/gu, '') ?? '');
    expect(labels).toEqual(['Didattica', 'Verifiche']);
  });

  it('places the section navigation inside the single unified header', async () => {
    render(<StudentShell />);
    const nav = await screen.findByRole('navigation', { name: 'Sezioni studente' });
    expect(nav.closest('header')).not.toBeNull();
  });

  it('never shows teacher-only navigation entries', () => {
    render(<StudentShell />);
    for (const teacherLabel of ['Corsi', 'Classi', 'Template']) {
      expect(screen.queryByRole('button', { name: teacherLabel })).toBeNull();
    }
  });

  it('shows the Didattica section content by default', async () => {
    render(<StudentShell />);
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('shows the Verifiche section content on nav click', async () => {
    render(<StudentShell />);
    fireEvent.click(await screen.findByRole('button', { name: /Verifiche/ }));
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('integration: an approved student with a class sees real lesson content wired through Didattica', async () => {
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

describe('StudentShell shared header interaction contract', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/components/HeaderSectionNav.module.css'),
    'utf8',
  );
  const source = readFileSync(
    resolve(process.cwd(), 'src/features/student/StudentShell.tsx'),
    'utf8',
  );

  it('uses the same opt-in navigation styles as the teacher shell', () => {
    expect(source).toContain(
      "import navStyles from '../../components/HeaderSectionNav.module.css'",
    );
    expect(source).toContain('className={navStyles.navBtn}');
    expect(css).toMatch(
      /\.navBtn\[aria-current='page'\]\s*\{[^}]*background:\s*#2563eb[^}]*border-color:\s*#2563eb/s,
    );
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.navBtn:not\(\[aria-current='page'\]\):hover:not\(:disabled\)\s*\{[^}]*color:\s*var\(--color-brand-interactive\)[^}]*translateY\(-2px\)/s,
    );
    expect(css).toMatch(
      /\.navBtn:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-brand-interactive\)/s,
    );
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.navBtn:hover:not\(:disabled\),[\s\S]*?transform:\s*none/s,
    );
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

  it('a draft submission found on mount (e.g. after a refresh) mounts the exam directly, with no Didattica/Verifiche nav', async () => {
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [ONLINE_VERIFICATION],
    });
    mockLoadSubmission.mockResolvedValue(DRAFT_SUBMISSION);

    render(<StudentShell />);

    await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
    expect(screen.queryByRole('navigation', { name: 'Sezioni studente' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Didattica' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Verifiche' })).toBeNull();

    // The header (account menu) stays available — it is not app navigation
    // to Didattica/Verifiche and does not bypass the mandatory session.
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

describe('StudentShell — Modalità verifica (M3F-07)', () => {
  it('hides the "Didattica" nav entry and shows Verifiche when exam mode applies to the student\'s class', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-1' });
    mockWatchStudentAccessSettings.mockImplementation(
      (_db: unknown, onChange: (settings: { examMode: unknown }) => void) => {
        onChange({
          examMode: { enabled: true, scope: 'classes', classIds: ['class-1'], enabledAt: null },
        });
        return vi.fn();
      },
    );
    render(<StudentShell />);

    const nav = await screen.findByRole('navigation', { name: 'Sezioni studente' });
    expect(within(nav).queryByRole('button', { name: 'Didattica' })).toBeNull();
    expect(within(nav).getByRole('button', { name: 'Verifiche' })).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Nessuna classe assegnata/)).toBeTruthy());
  });

  it('unmounts StudentDidatticaView immediately and switches to Verifiche when exam mode turns on while Didattica is open', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-1' });
    mockLoadStudentLessons.mockResolvedValueOnce({
      status: 'ok',
      programs: [{ id: 'prog-a', title: 'Informatica', classIds: ['class-1'] }],
      lessonsByProgram: { 'prog-a': [] },
    });
    let pushSettings: ((settings: { examMode: unknown }) => void) | undefined;
    mockWatchStudentAccessSettings.mockImplementation(
      (_db: unknown, onChange: (settings: { examMode: unknown }) => void) => {
        pushSettings = onChange;
        onChange({ examMode: { enabled: false, scope: 'all', classIds: [], enabledAt: null } });
        return vi.fn();
      },
    );
    render(<StudentShell />);
    await waitFor(() => expect(screen.getByText('Informatica')).toBeTruthy());

    pushSettings?.({
      examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null },
    });

    await waitFor(() => expect(screen.queryByText('Informatica')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Didattica' })).toBeNull();
  });

  it('does not hide Didattica for a class not covered by a classes-scoped exam mode', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-2' });
    mockWatchStudentAccessSettings.mockImplementation(
      (_db: unknown, onChange: (settings: { examMode: unknown }) => void) => {
        onChange({
          examMode: { enabled: true, scope: 'classes', classIds: ['class-1'], enabledAt: null },
        });
        return vi.fn();
      },
    );
    render(<StudentShell />);

    const nav = await screen.findByRole('navigation', { name: 'Sezioni studente' });
    expect(within(nav).getByRole('button', { name: 'Didattica' })).toBeTruthy();
  });

  it('restores Didattica without a new login once the teacher disables exam mode', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-1' });
    let pushSettings: ((settings: { examMode: unknown }) => void) | undefined;
    mockWatchStudentAccessSettings.mockImplementation(
      (_db: unknown, onChange: (settings: { examMode: unknown }) => void) => {
        pushSettings = onChange;
        onChange({ examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null } });
        return vi.fn();
      },
    );
    render(<StudentShell />);
    const nav = await screen.findByRole('navigation', { name: 'Sezioni studente' });
    expect(within(nav).queryByRole('button', { name: 'Didattica' })).toBeNull();

    pushSettings?.({ examMode: { enabled: false, scope: 'all', classIds: [], enabledAt: null } });

    await waitFor(() =>
      expect(within(nav).getByRole('button', { name: 'Didattica' })).toBeTruthy(),
    );
  });

  it('an in-progress exam session stays prioritized and is never interrupted by exam mode turning on', async () => {
    mockGetOwnStudentDoc.mockResolvedValue({ classId: 'class-1' });
    mockLoadStudentVerifications.mockResolvedValue({
      status: 'ok',
      verifications: [
        {
          id: 'ver-online',
          title: 'Verifica Online',
          className: 'Classe A',
          activatedAt: null,
          questionCount: 1,
          questions: [],
          onlineEnabled: true,
          ownerUid: 'owner-uid',
        },
      ],
    });
    mockLoadSubmission.mockResolvedValue({
      submissionId: 'ver-online_student-uid',
      verificationId: 'ver-online',
      studentUid: 'student-uid',
      ownerUid: 'owner-uid',
      status: 'draft',
      answers: {},
      flagged: {},
      attentionEvents: [],
      deliveryCode: null,
      verificationTitle: 'Verifica Online',
      className: 'Classe A',
      startedAt: { seconds: 100 },
      lastSavedAt: { seconds: 100 },
      submittedAt: null,
    });
    mockWatchStudentAccessSettings.mockImplementation(
      (_db: unknown, onChange: (settings: { examMode: unknown }) => void) => {
        onChange({
          examMode: { enabled: true, scope: 'classes', classIds: ['class-1'], enabledAt: null },
        });
        return vi.fn();
      },
    );

    render(<StudentShell />);

    await waitFor(() => expect(screen.getByTestId('online-exam-view')).toBeTruthy());
    expect(screen.getByText('Verifica Online')).toBeTruthy();
  });
});
