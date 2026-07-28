import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    const classCard = within(panel)
      .getByText(/3A Informatica/)
      .closest('[role="listitem"]');
    expect(classCard).toBeTruthy();
    expect(classCard!.textContent).toContain('1 studente');
    expect(mockListStudents).toHaveBeenCalledOnce();
    expect(mockListClasses).toHaveBeenCalledOnce();
  });

  it('mostra Primo e Ultimo accesso come riquadri, con data e ora, e «—» sui legacy', async () => {
    const withPortal = STUDENTS.map((s) =>
      s.id === 'u-approved'
        ? {
            ...s,
            createdAt: { toDate: () => new Date('2026-01-05T10:00:00Z') },
            // Local wall-clock time: the assertion must not depend on the runner timezone.
            firstPortalAccessAt: { toDate: () => new Date(2026, 1, 10, 9, 5) },
            lastPortalAccessAt: { toDate: () => new Date(2026, 2, 20, 14, 30) },
          }
        : s,
    );
    mockListStudents.mockResolvedValue(withPortal);
    render(<StudentsView ownerUid={OWNER_UID} />);

    await waitFor(() => screen.getByText('Ada Approved'));
    // Nessuna tabella: i due accessi sono riquadri della card.
    expect(screen.queryByRole('table')).toBeNull();

    const approved = studentCard('Ada Approved');
    const labels = [...approved.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels).toEqual(['Stato', 'Primo accesso', 'Ultimo accesso']);
    expect(within(approved).getByText('10/02/2026')).toBeTruthy();
    expect(within(approved).getByText('09:05')).toBeTruthy();
    expect(within(approved).getByText('20/03/2026')).toBeTruthy();
    expect(within(approved).getByText('14:30')).toBeTruthy();
    // La data di richiesta accesso non è esposta.
    expect(within(approved).queryByText('05/01/2026')).toBeNull();

    // Uno studente legacy senza timestamp mostra «—», mai una data inventata.
    const pending = studentCard('Pia Pending');
    expect(within(pending).getAllByText('—').length).toBeGreaterThanOrEqual(2);
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

/**
 * UI-STUDENTI-CLASSI-01 — la lista studenti è fatta di card; le azioni discrete
 * vivono nel menu «…» (`RecordActionsMenu`). Questi helper aprono il menu della
 * card indicata e restituiscono la voce richiesta.
 */
function studentCard(name: string): HTMLElement {
  return screen.getByRole('listitem', { name: `Studente ${name}` });
}

function studentMenuItem(cardName: string, action: RegExp | string): HTMLButtonElement {
  const trigger = within(studentCard(cardName)).getByRole('button', {
    name: /^Azioni studente/,
  });
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return screen.getByRole('menuitem', { name: action }) as HTMLButtonElement;
}

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

describe('StudentsView — lista card', () => {
  it('mostra una card per studente, full-width, con nome, email, stato e classe', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const list = screen.getByRole('list', { name: 'Elenco studenti' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(STUDENTS.length);
    expect(screen.getByText('pending@test.com')).toBeTruthy();

    const pending = studentCard('Pia Pending');
    expect(within(pending).getByText('In attesa')).toBeTruthy();
    expect(within(pending).getByLabelText('Classe di Pia Pending')).toBeTruthy();
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

    fireEvent.click(studentMenuItem('Pia Pending', 'Approva Pia Pending'));

    await waitFor(() =>
      expect(mockApproveStudent).toHaveBeenCalledWith('u-pending', OWNER_UID, {}),
    );
  });

  it('blocks an approved student', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Ada Approved'));

    fireEvent.click(studentMenuItem('Ada Approved', 'Blocca Ada Approved'));

    await waitFor(() => expect(mockBlockStudent).toHaveBeenCalledWith('u-approved', OWNER_UID, {}));
  });

  it('resets a blocked student to pending', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Bo Blocked'));

    fireEvent.click(studentMenuItem('Bo Blocked', 'Rimetti in attesa Bo Blocked'));

    await waitFor(() =>
      expect(mockResetStudentToPending).toHaveBeenCalledWith('u-blocked', OWNER_UID, {}),
    );
  });

  it('removes a student after confirmation', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.click(studentMenuItem('Pia Pending', 'Rimuovi Pia Pending'));
    expect(screen.getByText(/rimuovere/i)).toBeTruthy();

    fireEvent.click(within(studentCard('Pia Pending')).getByRole('button', { name: 'Conferma' }));
    await waitFor(() => expect(mockRemoveStudent).toHaveBeenCalledWith('u-pending', OWNER_UID, {}));
  });

  it('cancels the removal confirmation without calling removeStudent', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.click(studentMenuItem('Pia Pending', 'Rimuovi Pia Pending'));
    fireEvent.click(within(studentCard('Pia Pending')).getByRole('button', { name: 'Annulla' }));

    expect(mockRemoveStudent).not.toHaveBeenCalled();
    // La card resta al suo posto e l'azione è di nuovo raggiungibile dal menu.
    expect(studentMenuItem('Pia Pending', 'Rimuovi Pia Pending')).toBeTruthy();
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

    fireEvent.click(studentMenuItem('Pia Pending', 'Approva Pia Pending'));

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

// ─── UI-STUDENTI-CLASSI-01 — dropdown Classe, menu azioni, contratto CSS ─────

describe('StudentsView — dropdown Classe nella card (UI-STUDENTI-CLASSI-01)', () => {
  it('resta nella card, con label visibile, e non finisce nel menu «…»', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const card = studentCard('Pia Pending');
    const select = within(card).getByLabelText('Classe di Pia Pending') as HTMLSelectElement;
    expect(select.tagName).toBe('SELECT');
    // Label reale e visibile, associata al controllo.
    const label = card.querySelector(`label[for="${select.id}"]`);
    expect(label?.textContent).toBe('Classe');
    // Nel menu non esiste alcuna voce «Classe».
    const trigger = within(card).getByRole('button', { name: /^Azioni studente/ });
    fireEvent.click(trigger);
    expect(screen.queryByRole('menuitem', { name: /class/i })).toBeNull();
  });

  it('salva il cambio classe una sola volta e non apre il menu azioni', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const card = studentCard('Pia Pending');
    const select = within(card).getByLabelText('Classe di Pia Pending');
    fireEvent.click(select);
    fireEvent.change(select, { target: { value: 'class-1' } });

    await waitFor(() =>
      expect(mockAssignStudentClass).toHaveBeenCalledWith('u-pending', 'class-1', OWNER_UID, {}),
    );
    expect(mockAssignStudentClass).toHaveBeenCalledTimes(1);
    // Nessun menu aperto dal click sulla select.
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(
      within(card)
        .getByRole('button', { name: /^Azioni studente/ })
        .getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('assegna «Nessuna classe» come null, come prima', async () => {
    mockListStudents.mockResolvedValue(
      STUDENTS.map((s) => (s.id === 'u-pending' ? { ...s, classId: 'class-1' } : s)),
    );
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.change(screen.getByLabelText('Classe di Pia Pending'), { target: { value: '' } });
    await waitFor(() =>
      expect(mockAssignStudentClass).toHaveBeenCalledWith('u-pending', null, OWNER_UID, {}),
    );
  });

  it('mostra l’errore del cambio classe senza spostare la lista', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    mockAssignStudentClass.mockRejectedValueOnce(new Error('denied'));
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    fireEvent.change(screen.getByLabelText('Classe di Pia Pending'), {
      target: { value: 'class-1' },
    });

    expect((await screen.findByRole('alert')).textContent).toContain('Operazione non riuscita');
    // Le card restano tutte al loro posto.
    expect(
      within(screen.getByRole('list', { name: 'Elenco studenti' })).getAllByRole('listitem'),
    ).toHaveLength(STUDENTS.length);
  });
});

describe('StudentsView — menu azioni studente (UI-STUDENTI-CLASSI-01)', () => {
  it('raccoglie le quattro azioni discrete e disabilita quelle non applicabili', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Ada Approved'));

    const card = studentCard('Ada Approved');
    // Un solo pulsante azione sulla card: il trigger «…».
    const buttons = within(card)
      .getAllByRole('button')
      .filter((b) => !b.closest('label'));
    expect(buttons).toHaveLength(1);

    fireEvent.click(within(card).getByRole('button', { name: /^Azioni studente/ }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Approva',
      'Blocca',
      'Rimetti in attesa',
      'Rimuovi studente',
    ]);
    // Già approvato ⇒ «Approva» disabilitato, con nome accessibile contestuale.
    const approve = screen.getByRole('menuitem', { name: 'Approva Ada Approved' });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByRole('menuitem', { name: 'Blocca Ada Approved' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('marca «Rimuovi studente» come distruttiva', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    const remove = studentMenuItem('Pia Pending', 'Rimuovi Pia Pending');
    expect(remove.className).toMatch(/menuDanger/);
  });

  it('non annida pulsanti dentro pulsanti', async () => {
    mockListStudents.mockResolvedValue(STUDENTS);
    render(<StudentsView ownerUid={OWNER_UID} />);
    await waitFor(() => screen.getByText('Pia Pending'));

    for (const button of screen.getAllByRole('button')) {
      expect(button.querySelector('button')).toBeNull();
    }
  });
});

describe('StudentsView — contratto CSS responsive (UI-STUDENTI-CLASSI-01)', () => {
  const recordCss = readFileSync(
    resolve(process.cwd(), 'src/components/RecordCard.module.css'),
    'utf8',
  );
  const viewCss = readFileSync(
    resolve(process.cwd(), 'src/features/teacher/StudentsView.module.css'),
    'utf8',
  );
  const classesCss = readFileSync(
    resolve(process.cwd(), 'src/features/teacher/ClassesTab.module.css'),
    'utf8',
  );

  it('liste verticali full-width, senza griglie multi-card né scroll orizzontale', () => {
    for (const [css, list] of [
      [viewCss, 'studentList'],
      [classesCss, 'classList'],
    ] as const) {
      expect(css).toMatch(new RegExp(`\\.${list}\\s*\\{[^}]*display:\\s*flex`, 's'));
      expect(css).toMatch(new RegExp(`\\.${list}\\s*\\{[^}]*flex-direction:\\s*column`, 's'));
      expect(css).toMatch(new RegExp(`\\.${list}\\s*\\{[^}]*min-width:\\s*0`, 's'));
    }
    expect(viewCss).not.toMatch(/overflow-x:\s*auto/);
    expect(recordCss).toMatch(/\.card\s*\{[^}]*width:\s*100%/s);
  });

  it('mobile studente: Stato a tutta riga, i due accessi affiancati, select full-width', () => {
    expect(recordCss).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsStudentAdmin\s+\.metrics\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(recordCss).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsStudentAdmin\s+\.metrics\s*>\s*:nth-child\(1\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
    expect(viewCss).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.classSelect\s*\{[^}]*min-height:\s*2\.75rem/s,
    );
  });

  it('mantiene il controllo Classe realmente interattivo sopra il contenuto non cliccabile', () => {
    expect(recordCss).toMatch(
      /\.identityControl\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*auto/s,
    );
  });

  it('desktop studente: identità, tre riquadri uniformi e azioni in tre aree', () => {
    expect(recordCss).toMatch(
      /@media\s*\(min-width:\s*44\.01rem\)[\s\S]*?\.cardActionsStudentAdmin\s*\{[^}]*'identity metrics actions'/s,
    );
    expect(recordCss).toMatch(
      /\.cardActionsStudentAdmin\s+\.metrics\s*\{[^}]*grid-auto-columns:\s*var\(--record-metric-size\)/s,
    );
  });

  it('«Nuova classe» è a larghezza piena con altezza sobria e target touch', () => {
    expect(classesCss).toMatch(/\.newClassBtn\s*\{[^}]*width:\s*100%/s);
    expect(classesCss).toMatch(/\.newClassBtn\s*\{[^}]*min-height:\s*2\.75rem/s);
  });

  it('il campo «Nome classe» usa altezza, spaziatura e superficie moderne', () => {
    expect(classesCss).toMatch(/\.input\s*\{[^}]*min-height:\s*2\.75rem/s);
    expect(classesCss).toMatch(/\.input\s*\{[^}]*border-radius:\s*var\(--radius-lg\)/s);
    expect(classesCss).toMatch(/\.input\s*\{[^}]*background:\s*color-mix/s);
  });
});
