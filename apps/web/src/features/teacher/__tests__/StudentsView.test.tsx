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
const mockGetStudentAccessSettings = vi.fn();
const mockSetStudentPortalEnabled = vi.fn();
const mockSetNewStudentRequestsEnabled = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {} }));

vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: (...args: unknown[]) => mockListClasses(...args),
}));

vi.mock('../../repository/students/studentAccessService.js', () => ({
  getStudentAccessSettings: (...args: unknown[]) => mockGetStudentAccessSettings(...args),
  setStudentPortalEnabled: (...args: unknown[]) => mockSetStudentPortalEnabled(...args),
  setNewStudentRequestsEnabled: (...args: unknown[]) => mockSetNewStudentRequestsEnabled(...args),
}));

vi.mock('../../repository/students/studentsService.js', () => ({
  listStudents: (...args: unknown[]) => mockListStudents(...args),
  approveStudent: (...args: unknown[]) => mockApproveStudent(...args),
  blockStudent: (...args: unknown[]) => mockBlockStudent(...args),
  resetStudentToPending: (...args: unknown[]) => mockResetStudentToPending(...args),
  removeStudent: (...args: unknown[]) => mockRemoveStudent(...args),
  assignStudentClass: (...args: unknown[]) => mockAssignStudentClass(...args),
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

const CLASSES = [{ id: 'class-1', ownerUid: OWNER_UID, name: '3A Informatica', description: null }];

beforeEach(() => {
  vi.clearAllMocks();
  mockListClasses.mockResolvedValue(CLASSES);
  mockGetStudentAccessSettings.mockResolvedValue({
    studentPortalEnabled: false,
    newStudentRequestsEnabled: false,
  });
  mockApproveStudent.mockResolvedValue(undefined);
  mockBlockStudent.mockResolvedValue(undefined);
  mockResetStudentToPending.mockResolvedValue(undefined);
  mockRemoveStudent.mockResolvedValue(undefined);
  mockAssignStudentClass.mockResolvedValue(undefined);
  mockSetStudentPortalEnabled.mockResolvedValue(undefined);
  mockSetNewStudentRequestsEnabled.mockResolvedValue(undefined);
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
    expect(document.querySelector('.badge-warning')?.textContent).toBe('In attesa');
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
  it('calls setStudentPortalEnabled when the portal toggle is clicked', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText(/Portale studenti/i));

    const [portalCheckbox] = screen.getAllByRole('checkbox');
    fireEvent.click(portalCheckbox);

    await waitFor(() =>
      expect(mockSetStudentPortalEnabled).toHaveBeenCalledWith(true, OWNER_UID, {}),
    );
  });

  it('calls setNewStudentRequestsEnabled when the requests toggle is clicked', async () => {
    mockListStudents.mockResolvedValue([]);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText(/Nuove richieste/i));

    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);

    await waitFor(() =>
      expect(mockSetNewStudentRequestsEnabled).toHaveBeenCalledWith(true, OWNER_UID, {}),
    );
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
    expect(screen.getByText(/rimuovere questo studente/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Conferma' }));
    await waitFor(() => expect(mockRemoveStudent).toHaveBeenCalledWith('u-pending', OWNER_UID, {}));
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
