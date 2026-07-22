import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { StudentsView } from '../StudentsView.js';

const mockListStudents = vi.fn();
const mockApproveStudent = vi.fn();
const mockBlockStudent = vi.fn();
const mockResetStudentToPending = vi.fn();
const mockRemoveStudent = vi.fn();
const mockAssignStudentClass = vi.fn();
const mockListClasses = vi.fn();
const mockCreateClass = vi.fn();
const mockUpdateClass = vi.fn();
const mockDeleteClass = vi.fn();
const mockGetStudentAccessSettings = vi.fn();
const mockSetStudentPortalEnabled = vi.fn();
const mockSetNewStudentRequestsEnabled = vi.fn();
const mockSetExamMode = vi.fn();
const mockListActiveOnlineVerificationClassIds = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));

vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: (...args: unknown[]) => mockListClasses(...args),
  createClass: (...args: unknown[]) => mockCreateClass(...args),
  updateClass: (...args: unknown[]) => mockUpdateClass(...args),
  deleteClass: (...args: unknown[]) => mockDeleteClass(...args),
}));

vi.mock('../../repository/students/studentAccessService.js', () => ({
  getStudentAccessSettings: (...args: unknown[]) => mockGetStudentAccessSettings(...args),
  setStudentPortalEnabled: (...args: unknown[]) => mockSetStudentPortalEnabled(...args),
  setNewStudentRequestsEnabled: (...args: unknown[]) => mockSetNewStudentRequestsEnabled(...args),
  setExamMode: (...args: unknown[]) => mockSetExamMode(...args),
}));

vi.mock('../../repository/students/studentsService.js', () => ({
  listStudents: (...args: unknown[]) => mockListStudents(...args),
  approveStudent: (...args: unknown[]) => mockApproveStudent(...args),
  blockStudent: (...args: unknown[]) => mockBlockStudent(...args),
  resetStudentToPending: (...args: unknown[]) => mockResetStudentToPending(...args),
  removeStudent: (...args: unknown[]) => mockRemoveStudent(...args),
  assignStudentClass: (...args: unknown[]) => mockAssignStudentClass(...args),
}));

vi.mock('../../repository/verifications/verificationsService.js', () => ({
  listActiveOnlineVerificationClassIds: (...args: unknown[]) =>
    mockListActiveOnlineVerificationClassIds(...args),
}));

const OWNER_UID = 'owner-uid';

const STUDENTS = [
  {
    id: 'u-pending',
    uid: 'u-pending',
    ownerUid: OWNER_UID,
    email: 'pending@test.com',
    displayName: 'Pia Pending',
    status: 'pending' as const,
    classId: null,
    createdAt: null,
    updatedAt: null,
    lastLoginAt: null,
  },
  {
    id: 'u-approved',
    uid: 'u-approved',
    ownerUid: OWNER_UID,
    email: 'approved@test.com',
    displayName: 'Ada Approved',
    status: 'approved' as const,
    classId: 'class-1',
    createdAt: null,
    updatedAt: null,
    lastLoginAt: null,
  },
  {
    id: 'u-blocked',
    uid: 'u-blocked',
    ownerUid: OWNER_UID,
    email: 'blocked@test.com',
    displayName: 'Bo Blocked',
    status: 'blocked' as const,
    classId: null,
    createdAt: null,
    updatedAt: null,
    lastLoginAt: null,
  },
];

const CLASSES = [
  { id: 'class-1', ownerUid: OWNER_UID, name: '3A Informatica', description: null },
  { id: 'class-2', ownerUid: OWNER_UID, name: '4B Chimica', description: null },
];

const EXAM_MODE_OFF = { enabled: false, scope: 'all' as const, classIds: [], enabledAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  mockListClasses.mockResolvedValue(CLASSES);
  mockCreateClass.mockResolvedValue('new-class');
  mockUpdateClass.mockResolvedValue(undefined);
  mockDeleteClass.mockResolvedValue(undefined);
  mockGetStudentAccessSettings.mockResolvedValue({
    studentPortalEnabled: false,
    newStudentRequestsEnabled: false,
    examMode: EXAM_MODE_OFF,
  });
  mockApproveStudent.mockResolvedValue(undefined);
  mockBlockStudent.mockResolvedValue(undefined);
  mockResetStudentToPending.mockResolvedValue(undefined);
  mockRemoveStudent.mockResolvedValue(undefined);
  mockAssignStudentClass.mockResolvedValue(undefined);
  mockSetStudentPortalEnabled.mockResolvedValue(undefined);
  mockSetNewStudentRequestsEnabled.mockResolvedValue(undefined);
  mockSetExamMode.mockResolvedValue(undefined);
  mockListActiveOnlineVerificationClassIds.mockResolvedValue(['class-1']);
});

describe('StudentsView — tabs Studenti/Classi (DUX-05A)', () => {
  it('shows Classi inside Studenti and derives counts from the already loaded students', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);

    const tabs = await screen.findByRole('tablist', { name: 'Gestione studenti e classi' });
    expect(
      within(tabs)
        .getByRole('tab', { name: /Studenti/ })
        .getAttribute('aria-selected'),
    ).toBe('true');

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Classi' }));
    const panel = screen.getByRole('tabpanel', { name: 'Classi' });
    expect(screen.getAllByRole('switch')).toHaveLength(3);
    const classRow = within(panel).getByText('3A Informatica').closest('tr');
    expect(classRow).toBeTruthy();
    expect(within(classRow!).getByText('1')).toBeTruthy();
    expect(mockListStudents).toHaveBeenCalledOnce();
    expect(mockListClasses).toHaveBeenCalledOnce();
  });

  it('shows only "Ultimo accesso" with date + time, hiding request/first access columns', async () => {
    const withPortal = STUDENTS.map((s) =>
      s.id === 'u-approved'
        ? {
            ...s,
            createdAt: { toDate: () => new Date('2026-01-05T10:00:00Z') },
            firstPortalAccessAt: { toDate: () => new Date('2026-02-10T10:00:00Z') },
            lastPortalAccessAt: { toDate: () => new Date('2026-03-20T14:30:00Z') },
          }
        : s,
    );
    mockListStudents.mockResolvedValue(withPortal);
    render(<StudentsView ownerUid={OWNER_UID} />);

    // Only "Ultimo accesso" remains; the request/first-access columns are gone.
    expect(await screen.findByRole('columnheader', { name: 'Ultimo accesso' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Richiesta accesso' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Primo accesso' })).toBeNull();

    // Approved row shows its last portal access as date on one line, time below.
    const approvedRow = screen.getByText('Ada Approved').closest('tr')!;
    expect(within(approvedRow).getByText('20/03/2026')).toBeTruthy();
    expect(within(approvedRow).getByText('14:30')).toBeTruthy();
    // The hidden columns' dates no longer appear anywhere.
    expect(within(approvedRow).queryByText('05/01/2026')).toBeNull();
    expect(within(approvedRow).queryByText('10/02/2026')).toBeNull();

    // A legacy row without a last-access timestamp shows "—".
    const pendingRow = screen.getByText('Pia Pending').closest('tr')!;
    expect(within(pendingRow).getByText('—')).toBeTruthy();
  });

  it('moves tab selection and focus with the keyboard', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);

    const studentsTab = await screen.findByRole('tab', { name: /Studenti/ });
    studentsTab.focus();
    fireEvent.keyDown(studentsTab, { key: 'ArrowRight' });

    const classesTab = screen.getByRole('tab', { name: 'Classi' });
    expect(classesTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(classesTab);
  });
});

describe('StudentsView — loading and empty states', () => {
  it('shows loading state initially', () => {
    mockListStudents.mockReturnValue(new Promise(() => {}));
    render(<StudentsView ownerUid={OWNER_UID} />);
    expect(screen.getByText(/caricamento/i)).toBeTruthy();
  });

  it('shows empty state when there are no students at all', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => expect(screen.getByText(/nessuno studente ha ancora/i)).toBeTruthy());
  });
});

describe('StudentsView — table', () => {
  it('renders the students table with name, email, status and class', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    expect(screen.getByText('pending@test.com')).toBeTruthy();
    const pendingRow = screen.getByText('Pia Pending').closest('tr')!;
    expect(within(pendingRow).getByText('In attesa')).toBeTruthy();
    expect(screen.getByText('Approvato')).toBeTruthy();
    expect(screen.getByText('Bloccato')).toBeTruthy();
  });

  it('shows "Nessuna classe" for a student with no classId', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const select = screen.getByLabelText('Classe di Pia Pending') as HTMLSelectElement;
    expect(select.value).toBe('');
  });
});

describe('StudentsView — search', () => {
  it('filters by displayName', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.change(screen.getByLabelText('Cerca studenti'), { target: { value: 'Ada' } });
    expect(screen.getByText('Ada Approved')).toBeTruthy();
    expect(screen.queryByText('Pia Pending')).toBeNull();
  });

  it('filters by email', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.change(screen.getByLabelText('Cerca studenti'), { target: { value: 'blocked@' } });
    expect(screen.getByText('Bo Blocked')).toBeTruthy();
    expect(screen.queryByText('Pia Pending')).toBeNull();
  });

  it('filters by status label', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.change(screen.getByLabelText('Cerca studenti'), { target: { value: 'attesa' } });
    expect(screen.getByText('Pia Pending')).toBeTruthy();
    expect(screen.queryByText('Ada Approved')).toBeNull();
  });

  it('filters by class name', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.change(screen.getByLabelText('Cerca studenti'), {
      target: { value: '3A Informatica' },
    });
    expect(screen.getByText('Ada Approved')).toBeTruthy();
    expect(screen.queryByText('Pia Pending')).toBeNull();
  });

  it('shows "nessuno studente trovato" when the search matches nothing', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.change(screen.getByLabelText('Cerca studenti'), {
      target: { value: 'zzz-no-match' },
    });
    expect(screen.getByText(/nessuno studente trovato/i)).toBeTruthy();
  });
});

describe('StudentsView — toggles', () => {
  it('renders all three toggles as accessible switches with a clear on/off state', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText(/Portale studenti/i));

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(3);
    for (const s of switches) expect(s.getAttribute('aria-checked')).toBe('false');
    expect(screen.getAllByText('Disattivato')).toHaveLength(2);
    expect(screen.getByRole('switch', { name: 'Modalità verifica' })).toBeTruthy();
  });

  it('calls setStudentPortalEnabled when the portal switch is clicked', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText(/Portale studenti/i));

    fireEvent.click(screen.getByRole('switch', { name: 'Portale studenti' }));

    await waitFor(() =>
      expect(mockSetStudentPortalEnabled).toHaveBeenCalledWith(true, OWNER_UID, {}),
    );
  });

  it('calls setNewStudentRequestsEnabled when the requests switch is clicked', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText(/Nuove richieste/i));

    fireEvent.click(screen.getByRole('switch', { name: 'Nuove richieste' }));

    await waitFor(() =>
      expect(mockSetNewStudentRequestsEnabled).toHaveBeenCalledWith(true, OWNER_UID, {}),
    );
  });

  it('shows "Attivo" once the portal switch reflects an enabled setting', async () => {
    mockListStudents.mockResolvedValue([]);
    mockGetStudentAccessSettings.mockResolvedValue({
      studentPortalEnabled: true,
      newStudentRequestsEnabled: false,
      examMode: EXAM_MODE_OFF,
    });
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText(/Portale studenti/i));

    expect(
      screen.getByRole('switch', { name: 'Portale studenti' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(screen.getByText('Attivo')).toBeTruthy();
  });
});

describe('StudentsView — row actions', () => {
  it('approves a pending student', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const row = screen.getByText('Pia Pending').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Approva' }));

    await waitFor(() =>
      expect(mockApproveStudent).toHaveBeenCalledWith('u-pending', OWNER_UID, {}),
    );
  });

  it('blocks an approved student', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Ada Approved'));

    const row = screen.getByText('Ada Approved').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Blocca' }));

    await waitFor(() => expect(mockBlockStudent).toHaveBeenCalledWith('u-approved', OWNER_UID, {}));
  });

  it('resets a blocked student to pending', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Bo Blocked'));

    const row = screen.getByText('Bo Blocked').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Rimetti in attesa' }));

    await waitFor(() =>
      expect(mockResetStudentToPending).toHaveBeenCalledWith('u-blocked', OWNER_UID, {}),
    );
  });

  it('removes a student after confirmation', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const row = screen.getByText('Pia Pending').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Rimuovi' }));
    expect(screen.getByText(/rimuovere/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Conferma rimozione' }));
    await waitFor(() => expect(mockRemoveStudent).toHaveBeenCalledWith('u-pending', OWNER_UID, {}));
  });

  it('cancels the removal confirmation without calling removeStudent', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const row = screen.getByText('Pia Pending').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Rimuovi' }));
    fireEvent.click(screen.getByRole('button', { name: 'Annulla rimozione' }));

    expect(mockRemoveStudent).not.toHaveBeenCalled();
    expect(within(row).getByRole('button', { name: 'Rimuovi' })).toBeTruthy();
  });

  it('assigns a class to a student', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const select = screen.getByLabelText('Classe di Pia Pending');
    fireEvent.change(select, { target: { value: 'class-1' } });

    await waitFor(() =>
      expect(mockAssignStudentClass).toHaveBeenCalledWith('u-pending', 'class-1', OWNER_UID, {}),
    );
  });

  it('clears a class assignment when "Nessuna classe" is selected', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Ada Approved'));

    const select = screen.getByLabelText('Classe di Ada Approved');
    fireEvent.change(select, { target: { value: '' } });

    await waitFor(() =>
      expect(mockAssignStudentClass).toHaveBeenCalledWith('u-approved', null, OWNER_UID, {}),
    );
  });

  it('calls onStudentsChanged after a mutating action', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    const onStudentsChanged = vi.fn();
    render(<StudentsView ownerUid={OWNER_UID} onStudentsChanged={onStudentsChanged} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const row = screen.getByText('Pia Pending').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Approva' }));

    await waitFor(() => expect(onStudentsChanged).toHaveBeenCalled());
  });
});

describe('StudentsView — Modalità verifica (M3F-11A)', () => {
  it('shows "Disattivata" and no banner when off', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByRole('switch', { name: 'Modalità verifica' }));

    expect(screen.getByText('Disattivata')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('activates directly for the classes derived from active online verifications', async () => {
    mockListStudents.mockResolvedValue([]);
    mockListActiveOnlineVerificationClassIds.mockResolvedValue(['class-1', 'class-2']);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByRole('switch', { name: 'Modalità verifica' }));

    fireEvent.click(screen.getByRole('switch', { name: 'Modalità verifica' }));

    await waitFor(() =>
      expect(mockSetExamMode).toHaveBeenCalledWith(
        { enabled: true, scope: 'classes', classIds: ['class-1', 'class-2'] },
        OWNER_UID,
        {},
      ),
    );
    expect(screen.queryByRole('alertdialog', { name: 'Attiva modalità verifica' })).toBeNull();
  });

  it('disables activation when no active online verification has a class', async () => {
    mockListStudents.mockResolvedValue([]);
    mockListActiveOnlineVerificationClassIds.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    const toggle = await screen.findByRole('switch', { name: 'Modalità verifica' });

    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(toggle.getAttribute('title')).toMatch(/Nessuna verifica online attiva/);
  });

  it('shows only the concise requested description and the derived class names', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await screen.findByRole('switch', { name: 'Modalità verifica' });
    expect(
      screen.getByText('Nasconde temporaneamente le Lezioni agli studenti delle classi coinvolte.'),
    ).toBeTruthy();
    expect(screen.getByText(/Classi coinvolte: 3A Informatica/)).toBeTruthy();
  });

  it('shows a readable inline error when direct activation fails', async () => {
    mockSetExamMode.mockRejectedValue(new Error('boom'));
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByRole('switch', { name: 'Modalità verifica' }));
    fireEvent.click(screen.getByRole('switch', { name: 'Modalità verifica' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('boom'));
  });

  it('shows a prominent banner with the active scope when enabled', async () => {
    mockListStudents.mockResolvedValue([]);
    mockGetStudentAccessSettings.mockResolvedValue({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: { enabled: true, scope: 'classes', classIds: ['class-1'], enabledAt: null },
    });
    render(<StudentsView ownerUid={OWNER_UID} />);

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/3A Informatica/);
    expect(screen.getByText('3A Informatica')).toBeTruthy(); // status label on the card too
  });

  it('shows "Tutte le classi" in the status/banner for scope=all', async () => {
    mockListStudents.mockResolvedValue([]);
    mockGetStudentAccessSettings.mockResolvedValue({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null },
    });
    render(<StudentsView ownerUid={OWNER_UID} />);

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByRole('status').textContent).toMatch(/Tutte le classi/);
  });

  it('disabling requires confirmation, and calls setExamMode({enabled:false}) on confirm', async () => {
    mockListStudents.mockResolvedValue([]);
    mockGetStudentAccessSettings.mockResolvedValue({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null },
    });
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByRole('switch', { name: 'Modalità verifica' }));

    fireEvent.click(screen.getByRole('switch', { name: 'Modalità verifica' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Disattiva modalità verifica' });
    expect(mockSetExamMode).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Disattiva' }));

    await waitFor(() =>
      expect(mockSetExamMode).toHaveBeenCalledWith({ enabled: false }, OWNER_UID, {}),
    );
  });

  it('cancelling the disable confirmation does not call setExamMode', async () => {
    mockListStudents.mockResolvedValue([]);
    mockGetStudentAccessSettings.mockResolvedValue({
      studentPortalEnabled: false,
      newStudentRequestsEnabled: false,
      examMode: { enabled: true, scope: 'all', classIds: [], enabledAt: null },
    });
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByRole('switch', { name: 'Modalità verifica' }));

    fireEvent.click(screen.getByRole('switch', { name: 'Modalità verifica' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Disattiva modalità verifica' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));

    expect(mockSetExamMode).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog', { name: 'Disattiva modalità verifica' })).toBeNull();
  });
});
