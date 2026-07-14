import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { VerificationsView } from '../VerificationsView.js';

const mockListVerifications = vi.fn();
const mockCreateVerification = vi.fn();
const mockUpdateVerificationConfig = vi.fn();
const mockActivateVerification = vi.fn();
const mockSetVerificationVisibility = vi.fn();
const mockSetVerificationOnlineEnabled = vi.fn();
const mockSetVerificationStudentPdfEnabled = vi.fn();
const mockCloseVerification = vi.fn();
const mockDeleteVerification = vi.fn();
const mockListQuestionIndex = vi.fn();
const mockListPrograms = vi.fn();
const mockGetImportMeta = vi.fn();
const mockListClasses = vi.fn();
const mockListStudents = vi.fn();
const mockWatchSubmissions = vi.fn();

const mockLoadSelectedQuestions = vi.fn();
const mockDownloadStudentPdf = vi.fn();
const mockLoadSelectedQuestionsWithSolutions = vi.fn();
const mockDownloadTeacherSolutionsPdf = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../repository/verifications/loadSelectedQuestions.js', () => ({
  loadSelectedQuestions: (...args: unknown[]) => mockLoadSelectedQuestions(...args),
}));
vi.mock('../../repository/verifications/loadSelectedQuestionsWithSolutions.js', () => ({
  loadSelectedQuestionsWithSolutions: (...args: unknown[]) =>
    mockLoadSelectedQuestionsWithSolutions(...args),
}));
vi.mock('../../repository/verifications/verificationPdf.js', () => ({
  downloadStudentPdf: (...args: unknown[]) => mockDownloadStudentPdf(...args),
  downloadTeacherSolutionsPdf: (...args: unknown[]) => mockDownloadTeacherSolutionsPdf(...args),
}));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'owner-uid' } }),
}));
vi.mock('../../repository/verifications/verificationsService.js', () => ({
  listVerifications: (...args: unknown[]) => mockListVerifications(...args),
  createVerification: (...args: unknown[]) => mockCreateVerification(...args),
  updateVerificationConfig: (...args: unknown[]) => mockUpdateVerificationConfig(...args),
  activateVerification: (...args: unknown[]) => mockActivateVerification(...args),
  setVerificationVisibility: (...args: unknown[]) => mockSetVerificationVisibility(...args),
  setVerificationOnlineEnabled: (...args: unknown[]) => mockSetVerificationOnlineEnabled(...args),
  setVerificationStudentPdfEnabled: (...args: unknown[]) =>
    mockSetVerificationStudentPdfEnabled(...args),
  closeVerification: (...args: unknown[]) => mockCloseVerification(...args),
  deleteVerification: (...args: unknown[]) => mockDeleteVerification(...args),
}));
vi.mock('../../repository/verifications/questionIndexService.js', () => ({
  listQuestionIndex: (...args: unknown[]) => mockListQuestionIndex(...args),
}));
vi.mock('../../repository/verifications/submissionsMonitorService.js', () => ({
  watchSubmissions: (...args: unknown[]) => mockWatchSubmissions(...args),
}));
vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: (...args: unknown[]) => mockListClasses(...args),
}));
vi.mock('../../repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
  getImportMeta: (...args: unknown[]) => mockGetImportMeta(...args),
}));
vi.mock('../../repository/students/studentsService.js', () => ({
  listStudents: (...args: unknown[]) => mockListStudents(...args),
}));
// CorrectionWorkspace (M4-02) has its own dedicated test suite — mocked here
// so this file stays focused on how VerificationsView opens it (which
// submissions get the action, what props it receives), not its internals.
vi.mock('../CorrectionWorkspace.js', () => ({
  CorrectionWorkspace: (props: {
    submissionId: string;
    studentName: string;
    onClose: () => void;
  }) => (
    <div data-testid="correction-workspace">
      <span>Correzione — {props.studentName}</span>
      <span>{props.submissionId}</span>
      <button type="button" onClick={props.onClose}>
        Chiudi workspace
      </button>
    </div>
  ),
}));

const sampleProgram = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Matematica',
  activeImportId: 'imp-1',
  createdAt: null,
  updatedAt: null,
};
const sampleClass = {
  id: 'cls-1',
  ownerUid: 'owner-uid',
  name: 'Classe 3A',
  description: null,
  createdAt: null,
  updatedAt: null,
};

const makeDraftVer = (overrides = {}) => ({
  id: 'ver-1',
  ownerUid: 'owner-uid',
  status: 'draft' as const,
  config: {
    title: 'Verifica Algebra',
    classId: 'cls-1',
    programId: 'prog-1',
    importId: 'imp-1',
    questionRefs: [],
  },
  teacherSnapshot: null,
  createdAt: null,
  updatedAt: null,
  activatedAt: null,
  closedAt: null,
  ...overrides,
});

const sampleQuestionIndexEntries = [
  {
    id: 'qi-1',
    udaDir: 'UDA1',
    lessonFilename: 'lezione1.md',
    poolStorageRef: 'gs://bucket/imports/imp-1/UDA1/lezione1.pool.md',
    questionLocalId: 'q1',
    tipo: 'chiusa_singola' as const,
    difficolta: 2 as const,
    peso: 1 as const,
    maxPoints: 2,
    questionPreview: 'Quale livello gestisce il routing?',
  },
  {
    id: 'qi-2',
    udaDir: 'UDA1',
    lessonFilename: 'lezione2.md',
    poolStorageRef: 'gs://bucket/imports/imp-1/UDA1/lezione2.pool.md',
    questionLocalId: 'q2',
    tipo: 'aperta' as const,
    difficolta: 3 as const,
    peso: 2 as const,
    maxPoints: 4,
    questionPreview: 'Descrivi il modello OSI.',
  },
];

const sampleQuestionRef = {
  questionIndexEntryId: 'qi-1',
  questionLocalId: 'q1',
  udaDir: 'UDA1',
  lessonFilename: 'lezione1.md',
  poolStorageRef: 'gs://bucket/imports/imp-1/UDA1/lezione1.pool.md',
  tipo: 'chiusa_singola' as const,
  difficolta: 2 as const,
  peso: 1 as const,
  maxPoints: 2,
};

function setupDefaults() {
  vi.clearAllMocks();
  mockListVerifications.mockResolvedValue([]);
  mockListPrograms.mockResolvedValue([sampleProgram]);
  mockGetImportMeta.mockResolvedValue(null);
  mockListClasses.mockResolvedValue([sampleClass]);
  mockListQuestionIndex.mockResolvedValue(sampleQuestionIndexEntries);
  mockUpdateVerificationConfig.mockResolvedValue(undefined);
  mockActivateVerification.mockResolvedValue(undefined);
  mockCloseVerification.mockResolvedValue(undefined);
  mockDeleteVerification.mockResolvedValue(undefined);
  mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [] });
  mockDownloadStudentPdf.mockResolvedValue(undefined);
  mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({ ok: true, questions: [] });
  mockDownloadTeacherSolutionsPdf.mockResolvedValue(undefined);
  mockSetVerificationOnlineEnabled.mockResolvedValue(undefined);
  mockSetVerificationStudentPdfEnabled.mockResolvedValue(undefined);
  mockListStudents.mockResolvedValue([]);
  mockWatchSubmissions.mockReturnValue(vi.fn());
}

describe('VerificationsView', () => {
  it('shows loading state initially', () => {
    mockListVerifications.mockReturnValue(new Promise(() => {}));
    mockListPrograms.mockResolvedValue([]);
    mockListClasses.mockResolvedValue([]);
    render(<VerificationsView />);
    expect(screen.getByText(/caricamento/i)).toBeTruthy();
  });

  it('shows empty state when no verifications', async () => {
    setupDefaults();
    render(<VerificationsView />);
    await waitFor(() => expect(screen.getByText(/nessuna verifica/i)).toBeTruthy());
  });

  it('renders a table with the expected columns and status badges', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer(),
      makeDraftVer({
        id: 'ver-2',
        status: 'active',
        config: { ...makeDraftVer().config, title: 'Verifica Geometria' },
        teacherSnapshot: {
          title: 'Verifica Geometria',
          classId: 'cls-1',
          className: 'Classe 3A',
          programId: 'prog-1',
          importId: 'imp-1',
          questionRefs: [sampleQuestionRef],
          activatedAt: null,
        },
      }),
      makeDraftVer({
        id: 'ver-3',
        status: 'closed',
        config: { ...makeDraftVer().config, title: 'Verifica Trigonometria' },
        teacherSnapshot: {
          title: 'Verifica Trigonometria',
          classId: 'cls-1',
          className: 'Classe 3A',
          programId: 'prog-1',
          importId: 'imp-1',
          questionRefs: [],
          activatedAt: null,
        },
      }),
    ]);
    render(<VerificationsView />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Titolo')).toBeTruthy();
    expect(within(table).getByText('Classe')).toBeTruthy();
    expect(within(table).getByRole('columnheader', { name: 'Corso' })).toBeTruthy();
    expect(within(table).getByText('Stato')).toBeTruthy();
    expect(within(table).getByText('Es.')).toBeTruthy();

    expect(within(table).getByText('Verifica Algebra')).toBeTruthy();
    expect(within(table).getByText('Verifica Geometria')).toBeTruthy();
    expect(within(table).getByText('Verifica Trigonometria')).toBeTruthy();
    expect(within(table).getByText('bozza')).toBeTruthy();
    expect(within(table).getByText('nascosta')).toBeTruthy();
    expect(within(table).getByText('chiusa')).toBeTruthy();
    // Classe / Corso columns resolved from ids
    expect(within(table).getAllByText('Classe 3A').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getAllByText('Matematica').length).toBeGreaterThanOrEqual(1);
  });

  it('shows activatedAt/closedAt timestamps under the title for active and closed verifications', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        id: 'ver-2',
        status: 'active',
        activatedAt: { seconds: 1751970000, nanoseconds: 0 },
        config: { ...makeDraftVer().config, title: 'Verifica Geometria' },
      }),
      makeDraftVer({
        id: 'ver-3',
        status: 'closed',
        activatedAt: { seconds: 1751970000, nanoseconds: 0 },
        closedAt: { seconds: 1752060000, nanoseconds: 0 },
        config: { ...makeDraftVer().config, title: 'Verifica Trigonometria' },
      }),
    ]);
    render(<VerificationsView />);

    const table = await screen.findByRole('table');
    expect(within(table).getAllByText(/Attivata:/)).toHaveLength(2);
    expect(within(table).getByText(/Chiusa:/)).toBeTruthy();
  });

  it('does not show activation/closure timestamps for a draft verification', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);

    const table = await screen.findByRole('table');
    expect(within(table).queryByText(/Attivata:/)).toBeNull();
  });

  it('falls back to "—" when an active verification is missing activatedAt (legacy doc)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({ id: 'ver-2', status: 'active', activatedAt: null }),
    ]);
    render(<VerificationsView />);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Attivata: —')).toBeTruthy();
  });

  it('every verification row has the same number of table cells regardless of status (stable actions column)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer(),
      makeDraftVer({
        id: 'ver-2',
        status: 'active',
        config: { ...makeDraftVer().config, title: 'Verifica Geometria' },
        teacherSnapshot: {
          title: 'Verifica Geometria',
          classId: 'cls-1',
          className: 'Classe 3A',
          programId: 'prog-1',
          importId: 'imp-1',
          questionRefs: [sampleQuestionRef],
          activatedAt: null,
        },
      }),
      makeDraftVer({
        id: 'ver-3',
        status: 'closed',
        config: { ...makeDraftVer().config, title: 'Verifica Trigonometria' },
        teacherSnapshot: {
          title: 'Verifica Trigonometria',
          classId: 'cls-1',
          className: 'Classe 3A',
          programId: 'prog-1',
          importId: 'imp-1',
          questionRefs: [],
          activatedAt: null,
        },
      }),
    ]);
    render(<VerificationsView />);

    const table = await screen.findByRole('table');
    const [, createRow, ...bodyRows] = within(table).getAllByRole('row'); // drop header + create row
    expect(within(createRow).getByLabelText(/titolo nuova verifica/i)).toBeTruthy();
    const cellCounts = bodyRows.map((row) => within(row).getAllByRole('cell').length);
    expect(bodyRows).toHaveLength(3);
    expect(new Set(cellCounts).size).toBe(1);
  });

  it('renders creation controls as the first table row', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('table'));

    const form = screen.getByRole('form', { name: 'Nuova verifica' });
    const table = screen.getByRole('table');
    expect(form.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const [, firstBodyRow] = within(table).getAllByRole('row');
    expect(within(firstBodyRow).getByLabelText(/titolo nuova verifica/i)).toBeTruthy();
    expect(within(firstBodyRow).getByText('Nuova')).toBeTruthy();
    expect(within(firstBodyRow).getByRole('button', { name: /crea verifica/i })).toBeTruthy();
  });

  it('opens verification details as a dedicated level and returns to the list', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);

    fireEvent.click(await screen.findByText('Verifica Algebra'));

    expect(screen.getByLabelText('Dettaglio verifica')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /torna alle verifiche/i }));

    expect(screen.getByRole('table')).toBeTruthy();
    expect(screen.queryByLabelText('Dettaglio verifica')).toBeNull();
  });

  it('creates draft verification', async () => {
    setupDefaults();
    mockCreateVerification.mockResolvedValue('ver-new');
    mockListVerifications.mockResolvedValueOnce([]).mockResolvedValue([
      makeDraftVer({
        id: 'ver-new',
        config: { ...makeDraftVer().config, title: 'Nuova Verifica' },
      }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByLabelText(/titolo/i));

    fireEvent.change(screen.getByLabelText(/titolo/i), { target: { value: 'Nuova Verifica' } });
    fireEvent.change(screen.getByLabelText(/programma/i), { target: { value: 'prog-1' } });
    fireEvent.click(screen.getByRole('button', { name: /crea verifica/i }));

    await waitFor(() =>
      expect(mockCreateVerification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Nuova Verifica', programId: 'prog-1' }),
        'owner-uid',
        {},
      ),
    );
  });

  it('loads question index when a draft verification is opened', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => {
      expect(mockListQuestionIndex).toHaveBeenCalledWith('prog-1', 'imp-1', {});
      expect(screen.getByText(/UDA1 \/ lezione1\.md/)).toBeTruthy();
      expect(screen.getByText(/UDA1 \/ lezione2\.md/)).toBeTruthy();
    });
  });

  it('question index entries do NOT expose questionText, answers or solutions', async () => {
    setupDefaults();
    sampleQuestionIndexEntries.forEach((entry) => {
      expect(entry).not.toHaveProperty('questionText');
      expect(entry).not.toHaveProperty('answers');
      expect(entry).not.toHaveProperty('correctAnswer');
      expect(entry).not.toHaveProperty('solution');
    });
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByText(/UDA1 \/ lezione1\.md/));

    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toMatch(/questionText/);
    expect(rendered).not.toMatch(/correctAnswer/);
    expect(rendered).not.toMatch(/solution/);
  });

  it('enables activate button only when questionRefs >= 1', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/attiva verifica/i));

    const activateBtn = screen.getByRole('button', { name: /attiva verifica/i });
    expect(activateBtn).toHaveProperty('disabled', true);

    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /attiva verifica/i })).toHaveProperty(
        'disabled',
        false,
      ),
    );
  });

  it('shows confirmation panel before activation', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /attiva verifica/i })).toHaveProperty(
        'disabled',
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() =>
      expect(screen.getByRole('region', { name: /conferma attivazione/i })).toBeTruthy(),
    );
    expect(screen.getByText(/non sarà più modificabile/)).toBeTruthy();
  });

  it('calls activateVerification on confirm', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({
      status: 'active',
      config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] },
    });
    mockListVerifications.mockResolvedValueOnce([makeDraftVer()]).mockResolvedValue([activeVer]);
    mockActivateVerification.mockResolvedValue(undefined);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma attivazione/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma attivazione/i }));

    await waitFor(() =>
      expect(mockActivateVerification).toHaveBeenCalledWith(
        'ver-1',
        sampleClass,
        'owner-uid',
        {},
        {},
      ),
    );
  });

  it('publishes a hidden active verification to the student on toggle click', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({ status: 'active', visibility: 'hidden' });
    mockListVerifications.mockResolvedValue([activeVer]);
    mockSetVerificationVisibility.mockResolvedValue(undefined);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByRole('button', { name: /pubblica allo studente/i }));

    await waitFor(() =>
      expect(mockSetVerificationVisibility).toHaveBeenCalledWith(
        'ver-1',
        'public',
        'owner-uid',
        {},
      ),
    );
  });

  it('hides a public active verification from the student on toggle click', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({ status: 'active', visibility: 'public' });
    mockListVerifications.mockResolvedValue([activeVer]);
    mockSetVerificationVisibility.mockResolvedValue(undefined);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByRole('button', { name: /nascondi allo studente/i }));

    await waitFor(() =>
      expect(mockSetVerificationVisibility).toHaveBeenCalledWith(
        'ver-1',
        'hidden',
        'owner-uid',
        {},
      ),
    );
  });

  it('does not show the visibility toggle for a draft verification', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer({ status: 'draft' })]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    expect(screen.queryByRole('button', { name: /pubblica allo studente/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /nascondi allo studente/i })).toBeNull();
  });

  it('saves questionRefs with questionIndexEntryId and no question content', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma attivazione/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma attivazione/i }));

    await waitFor(() => expect(mockUpdateVerificationConfig).toHaveBeenCalled());
    const [, configArg] = mockUpdateVerificationConfig.mock.calls[0];
    const ref = configArg.questionRefs[0];
    expect(ref.questionIndexEntryId).toBe('qi-1');
    expect(ref).not.toHaveProperty('questionText');
    expect(ref).not.toHaveProperty('answers');
    expect(ref).not.toHaveProperty('correctAnswer');
    expect(ref).not.toHaveProperty('solution');
    expect(ref).not.toHaveProperty('questionIndex');
  });

  it('activation uses the correct questionRefs after filtering and selecting all filtered', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText('Filtra per tipo'));

    // Narrow to only the 'aperta' question (qi-2) and select all filtered.
    fireEvent.change(screen.getByLabelText('Filtra per tipo'), { target: { value: 'aperta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona tutte le domande filtrate' }));

    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma attivazione/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma attivazione/i }));

    await waitFor(() => expect(mockUpdateVerificationConfig).toHaveBeenCalled());
    const [, configArg] = mockUpdateVerificationConfig.mock.calls[0];
    expect(configArg.questionRefs).toHaveLength(1);
    expect(configArg.questionRefs[0].questionIndexEntryId).toBe('qi-2');
  });

  it('removing a question from the picker summary updates the activation payload', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));

    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q2/i));
    expect(screen.getByLabelText('Domande selezionate (contatore)').textContent).toMatch(
      /2 selezionate/,
    );
    expect(screen.getByLabelText('Punti totali selezionati').textContent).toMatch(/6 punti totali/);

    fireEvent.click(screen.getByLabelText('Rimuovi domanda q1 dal riepilogo'));
    expect(screen.getByLabelText('Domande selezionate (contatore)').textContent).toMatch(
      /1 selezionate/,
    );
    expect(screen.getByLabelText('Punti totali selezionati').textContent).toMatch(/4 punti totali/);

    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma attivazione/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma attivazione/i }));

    await waitFor(() => expect(mockUpdateVerificationConfig).toHaveBeenCalled());
    const [, configArg] = mockUpdateVerificationConfig.mock.calls[0];
    expect(configArg.questionRefs).toHaveLength(1);
    expect(configArg.questionRefs[0].questionIndexEntryId).toBe('qi-2');
  });

  it('draft title/class edit calls updateVerificationConfig', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByLabelText(/titolo bozza/i));
    fireEvent.change(screen.getByLabelText(/titolo bozza/i), {
      target: { value: 'Verifica Modificata' },
    });
    fireEvent.click(screen.getByRole('button', { name: /salva bozza/i }));

    await waitFor(() =>
      expect(mockUpdateVerificationConfig).toHaveBeenCalledWith(
        'ver-1',
        expect.objectContaining({ title: 'Verifica Modificata' }),
        'owner-uid',
        {},
      ),
    );
  });

  it('Salva bozza persists title, class and the current question selection together, no snapshot created (M3F-11C)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByRole('button', { name: /salva bozza/i }));

    await waitFor(() => expect(mockUpdateVerificationConfig).toHaveBeenCalled());
    const [id, configArg, ownerUid] = mockUpdateVerificationConfig.mock.calls[0];
    expect(id).toBe('ver-1');
    expect(ownerUid).toBe('owner-uid');
    expect(configArg.title).toBe('Verifica Algebra');
    expect(configArg.classId).toBe('cls-1');
    expect(configArg.questionRefs).toHaveLength(1);
    expect(configArg.questionRefs[0].questionIndexEntryId).toBe('qi-1');
    // "Salva bozza" never activates the verification — no immutable snapshot.
    expect(mockActivateVerification).not.toHaveBeenCalled();
  });

  it('shows persistent dirty and saved feedback for the draft', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByText('Nessuna modifica da salvare'));
    expect(
      (screen.getByRole('button', { name: /salva bozza/i }) as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.change(screen.getByLabelText(/titolo bozza/i), {
      target: { value: 'Verifica aggiornata' },
    });
    expect(screen.getByText(/modifiche non salvate/i)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /salva bozza/i }));
    await waitFor(() => expect(screen.getByText(/bozza salvata alle \d{2}:\d{2}/i)).toBeTruthy());
    expect(screen.queryByText(/modifiche non salvate/i)).toBeNull();

    fireEvent.change(screen.getByLabelText(/titolo bozza/i), {
      target: { value: 'Verifica aggiornata ancora' },
    });
    expect(screen.getByText(/modifiche non salvate/i)).toBeTruthy();
    expect(screen.queryByText(/bozza salvata alle/i)).toBeNull();
  });

  it('keeps a readable draft-save error and allows retry', async () => {
    setupDefaults();
    mockUpdateVerificationConfig.mockRejectedValueOnce(new Error('Connessione non disponibile'));
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByLabelText(/titolo bozza/i));
    fireEvent.change(screen.getByLabelText(/titolo bozza/i), {
      target: { value: 'Verifica aggiornata' },
    });
    fireEvent.click(screen.getByRole('button', { name: /salva bozza/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('Connessione non disponibile');
    expect(
      (screen.getByRole('button', { name: /riprova salvataggio/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('reopening a draft restores the previously selected questions from config.questionRefs', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({ config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] } }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    expect((screen.getByLabelText(/seleziona domanda q1/i) as HTMLInputElement).checked).toBe(true);
  });

  it('activation still freezes the immutable teacherSnapshot regardless of prior draft saves', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByRole('button', { name: /salva bozza/i }));
    await waitFor(() => expect(mockUpdateVerificationConfig).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma attivazione/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma attivazione/i }));

    await waitFor(() =>
      expect(mockActivateVerification).toHaveBeenCalledWith(
        'ver-1',
        sampleClass,
        'owner-uid',
        {},
        {},
      ),
    );
  });

  it('activation persists the currently edited title, class and questions before freezing', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByLabelText(/titolo bozza/i));
    fireEvent.change(screen.getByLabelText(/titolo bozza/i), {
      target: { value: 'Verifica pronta' },
    });
    fireEvent.change(screen.getByLabelText('Classe', { exact: true }), { target: { value: '' } });
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));

    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma attivazione/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma attivazione/i }));

    await waitFor(() =>
      expect(mockUpdateVerificationConfig).toHaveBeenCalledWith(
        'ver-1',
        expect.objectContaining({
          title: 'Verifica pronta',
          classId: null,
          questionRefs: [expect.objectContaining({ questionIndexEntryId: 'qi-1' })],
        }),
        'owner-uid',
        {},
      ),
    );
    expect(mockActivateVerification).toHaveBeenCalledWith('ver-1', null, 'owner-uid', {}, {});
  });

  it('Salva bozza and Attiva verifica are adjacent, in this order, and neither is duplicated elsewhere', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getByRole('button', { name: /salva bozza/i }));
    const saveBtns = screen.getAllByRole('button', { name: /salva bozza/i });
    const activateBtns = screen.getAllByRole('button', { name: /attiva verifica/i });
    expect(saveBtns).toHaveLength(1);
    expect(activateBtns).toHaveLength(1);

    const container = saveBtns[0].closest('div');
    expect(container?.contains(activateBtns[0])).toBe(true);
    const buttonsInBar = Array.from(container?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    expect(buttonsInBar.indexOf(saveBtns[0] as HTMLButtonElement)).toBeLessThan(
      buttonsInBar.indexOf(activateBtns[0] as HTMLButtonElement),
    );
  });

  // ─── Draft PDF download (M3F-11C) ──────────────────────────────────────────

  it('downloads the normal PDF from a draft using the current saved selection, no Firestore write', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({ config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] } }),
    ]);
    const fakeQuestion = { ref: sampleQuestionRef, testo: 'Domanda?', tipo: 'aperta' as const };
    mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [fakeQuestion] });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());
    expect(mockLoadSelectedQuestions).toHaveBeenCalledWith([sampleQuestionRef], {});
    expect(mockDownloadStudentPdf).toHaveBeenCalledWith(
      { title: 'Verifica Algebra' },
      [fakeQuestion],
      'Classe 3A',
    );
    expect(mockUpdateVerificationConfig).not.toHaveBeenCalled();
    expect(mockActivateVerification).not.toHaveBeenCalled();
  });

  it('downloads the solutions PDF from a draft using the current saved selection, no Firestore write', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({ config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] } }),
    ]);
    const fakeQuestion = {
      ref: sampleQuestionRef,
      testo: 'Domanda?',
      tipo: 'aperta' as const,
      soluzione: 'R.',
    };
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: true,
      questions: [fakeQuestion],
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf soluzioni/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf soluzioni/i }));

    await waitFor(() => expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalled());
    expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalledWith(
      { title: 'Verifica Algebra' },
      [fakeQuestion],
      'Classe 3A',
    );
    expect(mockUpdateVerificationConfig).not.toHaveBeenCalled();
  });

  it('shows a clear error and does not generate a PDF when the draft has no questions', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]); // questionRefs: []
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/non ha domande selezionate/i);
    expect(mockLoadSelectedQuestions).not.toHaveBeenCalled();
    expect(mockDownloadStudentPdf).not.toHaveBeenCalled();
  });

  // ─── Row actions: visibility by status ────────────────────────────────────

  const activeVerWithSnapshot = () =>
    makeDraftVer({
      status: 'active',
      config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] },
      teacherSnapshot: {
        title: 'Verifica Algebra',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [sampleQuestionRef],
        activatedAt: null,
      },
    });

  const closedVer = () =>
    makeDraftVer({
      status: 'closed',
      config: { ...makeDraftVer().config, questionRefs: [] },
      teacherSnapshot: {
        title: 'Verifica Algebra',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [sampleQuestionRef],
        activatedAt: null,
      },
    });

  // ─── New-contract fixtures: teacherSnapshot.questions present (M-immutable-snapshot) ──
  const embeddedSnapshotQuestion = {
    order: 0,
    tipo: 'aperta' as const,
    maxPoints: 4,
    testo: 'Domanda congelata?',
    soluzione: 'Risposta congelata.',
  };

  const activeVerWithEmbeddedSnapshot = () =>
    makeDraftVer({
      status: 'active',
      config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] },
      teacherSnapshot: {
        title: 'Verifica Algebra',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [sampleQuestionRef],
        questions: [embeddedSnapshotQuestion],
        activatedAt: null,
      },
    });

  const closedVerWithEmbeddedSnapshot = () =>
    makeDraftVer({
      status: 'closed',
      config: { ...makeDraftVer().config, questionRefs: [] },
      teacherSnapshot: {
        title: 'Verifica Algebra',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [sampleQuestionRef],
        questions: [embeddedSnapshotQuestion],
        activatedAt: null,
      },
    });

  it('shows Scarica PDF studenti, Scarica PDF soluzioni and Chiudi verifica row actions only for active verifications', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    expect(screen.getByRole('button', { name: /scarica pdf studenti/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /scarica pdf soluzioni/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /chiudi verifica/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /elimina verifica/i })).toBeNull();
  });

  it('draft verification shows the PDF-enabled toggle, Elimina and PDF download actions (M3F-11C), never Chiudi', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    expect(screen.getByRole('button', { name: /scarica pdf studenti/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /scarica pdf soluzioni/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /chiudi verifica/i })).toBeNull();
    expect(screen.getByRole('button', { name: /elimina verifica/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /abilita pdf studente/i })).toBeTruthy();
  });

  it('closed verification shows Scarica PDF studenti, Scarica PDF soluzioni and Elimina (never Chiudi)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    expect(screen.getByRole('button', { name: /scarica pdf studenti/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /scarica pdf soluzioni/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /chiudi verifica/i })).toBeNull();
    expect(screen.getByRole('button', { name: /elimina verifica/i })).toBeTruthy();
  });

  it('the row delete icon button is neutral (not styled with the danger class)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    const deleteIconBtn = screen.getByRole('button', { name: /elimina verifica/i });
    expect(deleteIconBtn.classList.contains('btn-danger')).toBe(false);
  });

  it('the "Elimina definitivamente" destructive confirm button stays red (btn-danger)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByRole('button', { name: /elimina verifica/i }));
    const confirmBtn = await screen.findByRole('button', { name: 'Elimina definitivamente' });
    expect(confirmBtn.classList.contains('btn-danger')).toBe(true);
  });

  it('detail panel for a non-draft verification is a compact read-only summary', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => expect(screen.getByLabelText('Dettaglio verifica')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /attiva verifica/i })).toBeNull();
    // PDF/Chiudi are row actions now, not duplicated inside the detail panel.
    const detail = screen.getByLabelText('Dettaglio verifica');
    expect(within(detail).queryByRole('button', { name: /scarica pdf studenti/i })).toBeNull();
    expect(within(detail).queryByRole('button', { name: /scarica pdf soluzioni/i })).toBeNull();
    expect(within(detail).queryByRole('button', { name: /chiudi verifica/i })).toBeNull();
  });

  // ─── PDF download (row action) ─────────────────────────────────────────────

  it('clicking Scarica PDF studenti calls loadSelectedQuestions and downloadStudentPdf', async () => {
    setupDefaults();
    const teacherSnapshot = activeVerWithSnapshot().teacherSnapshot;
    const activeVer = activeVerWithSnapshot();
    mockListVerifications.mockResolvedValue([activeVer]);
    const fakeQuestion = { ref: sampleQuestionRef, testo: 'Domanda?', tipo: 'aperta' as const };
    mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [fakeQuestion] });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());
    expect(mockLoadSelectedQuestions).toHaveBeenCalledWith([sampleQuestionRef], {});
    expect(mockDownloadStudentPdf).toHaveBeenCalledWith(
      { title: (teacherSnapshot as unknown as { title: string }).title },
      [fakeQuestion],
      'Classe 3A',
    );
  });

  it('shows error and does not call services when active verification has no teacherSnapshot', async () => {
    setupDefaults();
    const activeVerNoSnapshot = makeDraftVer({
      status: 'active',
      config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] },
      teacherSnapshot: null,
    });
    mockListVerifications.mockResolvedValue([activeVerNoSnapshot]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(
      /snapshot della verifica non disponibile/i,
    );
    expect(mockLoadSelectedQuestions).not.toHaveBeenCalled();
    expect(mockDownloadStudentPdf).not.toHaveBeenCalled();
  });

  it('shows error message when loadSelectedQuestions fails', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithSnapshot()]);
    mockLoadSelectedQuestions.mockResolvedValue({ ok: false, error: 'Pool non trovato: gs://...' });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/pool non trovato/i);
  });

  // ─── Solutions PDF download (row action) ────────────────────────────────────

  it('clicking Scarica PDF soluzioni calls loadSelectedQuestionsWithSolutions and downloadTeacherSolutionsPdf', async () => {
    setupDefaults();
    const teacherSnapshot = activeVerWithSnapshot().teacherSnapshot;
    mockListVerifications.mockResolvedValue([activeVerWithSnapshot()]);
    const fakeQuestion = {
      ref: sampleQuestionRef,
      testo: 'Domanda?',
      tipo: 'aperta' as const,
      soluzione: 'Risposta attesa.',
    };
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: true,
      questions: [fakeQuestion],
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf soluzioni/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf soluzioni/i }));

    await waitFor(() => expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalled());
    expect(mockLoadSelectedQuestionsWithSolutions).toHaveBeenCalledWith([sampleQuestionRef], {});
    expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalledWith(
      { title: (teacherSnapshot as unknown as { title: string }).title },
      [fakeQuestion],
      'Classe 3A',
    );
    // Never calls the student-PDF path for this action.
    expect(mockLoadSelectedQuestions).not.toHaveBeenCalled();
    expect(mockDownloadStudentPdf).not.toHaveBeenCalled();
  });

  it('allows downloading the solutions PDF for a closed verification', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: true,
      questions: [
        { ref: sampleQuestionRef, testo: 'Domanda?', tipo: 'aperta' as const, soluzione: 'R.' },
      ],
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf soluzioni/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf soluzioni/i }));

    await waitFor(() => expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalled());
  });

  it('allows downloading the student PDF for a closed verification', async () => {
    setupDefaults();
    const cv = closedVer();
    mockListVerifications.mockResolvedValue([cv]);
    const fakeQuestion = { ref: sampleQuestionRef, testo: 'Domanda?', tipo: 'aperta' as const };
    mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [fakeQuestion] });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());
    expect(mockLoadSelectedQuestions).toHaveBeenCalledWith([sampleQuestionRef], {});
    expect(mockDownloadStudentPdf).toHaveBeenCalledWith(
      { title: (cv.teacherSnapshot as unknown as { title: string }).title },
      [fakeQuestion],
      'Classe 3A',
    );
    // Never calls the solutions-PDF path for this action.
    expect(mockLoadSelectedQuestionsWithSolutions).not.toHaveBeenCalled();
    expect(mockDownloadTeacherSolutionsPdf).not.toHaveBeenCalled();
  });

  it('shows error and does not download when the active verification has no teacherSnapshot', async () => {
    setupDefaults();
    const activeVerNoSnapshot = makeDraftVer({
      status: 'active',
      config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] },
      teacherSnapshot: null,
    });
    mockListVerifications.mockResolvedValue([activeVerNoSnapshot]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf soluzioni/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf soluzioni/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(
      /snapshot della verifica non disponibile/i,
    );
    expect(mockLoadSelectedQuestionsWithSolutions).not.toHaveBeenCalled();
    expect(mockDownloadTeacherSolutionsPdf).not.toHaveBeenCalled();
  });

  it('shows an error message when loadSelectedQuestionsWithSolutions fails', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithSnapshot()]);
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: false,
      error: 'Pool non trovato: gs://...',
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf soluzioni/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf soluzioni/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/pool non trovato/i);
  });

  // ─── PDF from embedded teacherSnapshot.questions (immutable snapshot fix) ──

  it('active with embedded snapshot.questions generates the normal PDF with zero Storage reads', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithEmbeddedSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());
    expect(mockLoadSelectedQuestions).not.toHaveBeenCalled();
    expect(mockDownloadStudentPdf).toHaveBeenCalledWith(
      { title: 'Verifica Algebra' },
      [{ ref: { maxPoints: 4 }, testo: 'Domanda congelata?', tipo: 'aperta' }],
      'Classe 3A',
    );
  });

  it('active with embedded snapshot.questions generates the solutions PDF with zero Storage reads', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithEmbeddedSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf soluzioni/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf soluzioni/i }));

    await waitFor(() => expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalled());
    expect(mockLoadSelectedQuestionsWithSolutions).not.toHaveBeenCalled();
    expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalledWith(
      { title: 'Verifica Algebra' },
      [
        {
          ref: { maxPoints: 4 },
          testo: 'Domanda congelata?',
          tipo: 'aperta',
          soluzione: 'Risposta congelata.',
        },
      ],
      'Classe 3A',
    );
  });

  it('closed with embedded snapshot.questions generates both PDFs with zero Storage reads', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVerWithEmbeddedSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));
    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /scarica pdf soluzioni/i }));
    await waitFor(() => expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalled());

    expect(mockLoadSelectedQuestions).not.toHaveBeenCalled();
    expect(mockLoadSelectedQuestionsWithSolutions).not.toHaveBeenCalled();
  });

  it('a simulated pool edit/deletion never changes the PDF built from an embedded snapshot', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithEmbeddedSnapshot()]);
    // Simulate the pool having been edited/deleted after activation: any
    // Storage loader call would now fail or return different content.
    mockLoadSelectedQuestions.mockResolvedValue({ ok: false, error: 'Pool non trovato' });
    mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({
      ok: false,
      error: 'Pool non trovato',
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf studenti/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf studenti/i }));

    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());
    // No error surfaced despite the (irrelevant, simulated) Storage failure —
    // the embedded snapshot never touches Storage at all.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mockDownloadStudentPdf).toHaveBeenCalledWith(
      { title: 'Verifica Algebra' },
      [{ ref: { maxPoints: 4 }, testo: 'Domanda congelata?', tipo: 'aperta' }],
      'Classe 3A',
    );
  });

  // ─── Close (row action) ─────────────────────────────────────────────────────

  it('calls closeVerification on close confirm', async () => {
    setupDefaults();
    const activeVer = activeVerWithSnapshot();
    const closed = { ...activeVer, status: 'closed' as const };
    mockListVerifications.mockResolvedValueOnce([activeVer]).mockResolvedValue([closed]);
    mockCloseVerification.mockResolvedValue(undefined);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /chiudi verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /chiudi verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma chiusura/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma chiusura/i }));

    await waitFor(() =>
      expect(mockCloseVerification).toHaveBeenCalledWith('ver-1', 'owner-uid', {}),
    );
  });

  it('close confirm panel can be cancelled', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /chiudi verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /chiudi verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma chiusura/i }));
    fireEvent.click(screen.getByRole('button', { name: /annulla/i }));

    expect(screen.queryByRole('region', { name: /conferma chiusura/i })).toBeNull();
    expect(mockCloseVerification).not.toHaveBeenCalled();
  });

  // ─── Delete (row action, draft or closed) ────────────────────────────────────

  it('delete confirm panel requires explicit confirmation before calling the service', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /elimina verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /elimina verifica/i }));

    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    expect(within(region).getByText(/irreversibile/i)).toBeTruthy();
    expect(mockDeleteVerification).not.toHaveBeenCalled();
  });

  it('calls deleteVerification when a closed verification delete is confirmed', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValueOnce([closedVer()]).mockResolvedValue([]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /elimina verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /elimina verifica/i }));
    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    fireEvent.click(within(region).getByRole('button', { name: /elimina definitivamente/i }));

    await waitFor(() =>
      expect(mockDeleteVerification).toHaveBeenCalledWith('ver-1', 'owner-uid', {}),
    );
    await waitFor(() => expect(screen.queryByText('Verifica Algebra')).toBeNull());
  });

  it('calls deleteVerification when a draft verification delete is confirmed', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValueOnce([makeDraftVer()]).mockResolvedValue([]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /elimina verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /elimina verifica/i }));
    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    fireEvent.click(within(region).getByRole('button', { name: /elimina definitivamente/i }));

    await waitFor(() =>
      expect(mockDeleteVerification).toHaveBeenCalledWith('ver-1', 'owner-uid', {}),
    );
    await waitFor(() => expect(screen.queryByText('Verifica Algebra')).toBeNull());
  });

  it('delete confirm panel can be cancelled without calling the service', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /elimina verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /elimina verifica/i }));
    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    fireEvent.click(within(region).getByRole('button', { name: /annulla/i }));

    expect(screen.queryByRole('region', { name: /conferma eliminazione/i })).toBeNull();
    expect(mockDeleteVerification).not.toHaveBeenCalled();
    expect(screen.getByText('Verifica Algebra')).toBeTruthy();
  });

  it('shows a readable error when deleteVerification fails', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    mockDeleteVerification.mockRejectedValue(new Error('Verifica non eliminabile: non è chiusa'));
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('button', { name: /elimina verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /elimina verifica/i }));
    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    fireEvent.click(within(region).getByRole('button', { name: /elimina definitivamente/i }));

    await waitFor(() => expect(within(region).getByRole('alert')).toBeTruthy());
    expect(within(region).getByRole('alert').textContent).toMatch(/non è chiusa/i);
    expect(screen.getByText('Verifica Algebra')).toBeTruthy();
  });
});

describe('VerificationsView — online toggle (M3F-05)', () => {
  const activeVerOnline = (overrides = {}) =>
    makeDraftVer({ status: 'active', onlineEnabled: false, ...overrides });

  it('enables online with no confirmation required', async () => {
    setupDefaults();
    const activeVer = activeVerOnline();
    mockListVerifications
      .mockResolvedValueOnce([activeVer])
      .mockResolvedValue([{ ...activeVer, onlineEnabled: true }]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByRole('switch', { name: /attiva online/i }));

    await waitFor(() =>
      expect(mockSetVerificationOnlineEnabled).toHaveBeenCalledWith('ver-1', true, 'owner-uid', {}),
    );
    expect(screen.queryByRole('region', { name: /conferma disattivazione online/i })).toBeNull();
  });

  it('requires confirmation before disabling online, with the exact warning message', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerOnline({ onlineEnabled: true })]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByRole('switch', { name: /disattiva online/i }));

    const region = await screen.findByRole('region', { name: /conferma disattivazione online/i });
    expect(
      within(region).getByText(
        /le bozze esistenti non potranno essere salvate o consegnate finché l.online resta disabilitato/i,
      ),
    ).toBeTruthy();
    expect(mockSetVerificationOnlineEnabled).not.toHaveBeenCalled();

    fireEvent.click(within(region).getByRole('button', { name: /disattiva online/i }));
    await waitFor(() =>
      expect(mockSetVerificationOnlineEnabled).toHaveBeenCalledWith(
        'ver-1',
        false,
        'owner-uid',
        {},
      ),
    );
  });

  it('disabling online can be cancelled without calling the service', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerOnline({ onlineEnabled: true })]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByRole('switch', { name: /disattiva online/i }));
    const region = await screen.findByRole('region', { name: /conferma disattivazione online/i });
    fireEvent.click(within(region).getByRole('button', { name: /annulla/i }));

    expect(screen.queryByRole('region', { name: /conferma disattivazione online/i })).toBeNull();
    expect(mockSetVerificationOnlineEnabled).not.toHaveBeenCalled();
  });

  it('disables the online switch with an explanation when the verification has no class', async () => {
    setupDefaults();
    const noClassVer = activeVerOnline({
      config: { ...makeDraftVer().config, classId: null },
    });
    mockListVerifications.mockResolvedValue([noClassVer]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    const toggle = screen.getByRole('switch', { name: /attiva online/i });
    expect(toggle).toHaveProperty('disabled', true);
    // The online status label reads "Nessuna classe" (distinct from the class
    // filter's option of the same text, which also appears now).
    const table = screen.getByRole('table');
    expect(within(table).getByText('Nessuna classe')).toBeTruthy();
  });

  it('shows a readable error when enabling online fails, without crashing', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerOnline()]);
    mockSetVerificationOnlineEnabled.mockRejectedValue(
      new Error("Assegnare una classe prima di attivare l'online"),
    );
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByRole('switch', { name: /attiva online/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/assegnare una classe/i);
  });
});

describe('VerificationsView — consegne online monitor (M3F-05)', () => {
  const activeVerWithClass = (overrides = {}) =>
    makeDraftVer({
      status: 'active',
      onlineEnabled: true,
      teacherSnapshot: {
        title: 'Verifica Algebra',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [sampleQuestionRef],
        activatedAt: null,
      },
      ...overrides,
    });

  const approvedStudents = [
    {
      id: 'stud-b',
      ownerUid: 'owner-uid',
      uid: 'stud-b',
      email: 'b@x.it',
      displayName: 'Bruno',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
    {
      id: 'stud-a',
      ownerUid: 'owner-uid',
      uid: 'stud-a',
      email: 'a@x.it',
      displayName: 'Anna',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
    {
      id: 'stud-c',
      ownerUid: 'owner-uid',
      uid: 'stud-c',
      email: 'c@x.it',
      displayName: 'Carla',
      status: 'approved' as const,
      classId: 'other-class',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
  ];

  it('opens exactly one submissions listener scoped to ownerUid + verificationId, joins by studentUid, sorted alphabetically', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue(approvedStudents);
    let pushItems: (items: unknown[]) => void = () => {};
    const unsubscribe = vi.fn();
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      pushItems = onChange;
      return unsubscribe;
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() =>
      expect(mockWatchSubmissions).toHaveBeenCalledWith(
        'ver-1',
        'owner-uid',
        {},
        expect.any(Function),
        expect.any(Function),
      ),
    );
    // Simulates the initial (empty) onSnapshot delivery, same as watchSubmissions
    // would fire in production before any submission exists yet.
    pushItems([]);

    // Only the same-class approved students appear; Carla (other-class) is excluded.
    await waitFor(() => expect(screen.getByText('Anna')).toBeTruthy());
    const names = screen.getAllByText(/^(Anna|Bruno|Carla)$/).map((n) => n.textContent);
    expect(names).toEqual(['Anna', 'Bruno']);

    pushItems([
      {
        studentUid: 'stud-a',
        status: 'submitted',
        lastSavedAt: { seconds: 100, nanoseconds: 0 },
        submittedAt: { seconds: 200, nanoseconds: 0 },
        deliveryCode: 'SF-2026-A1B2',
        attentionEventsCount: 3,
      },
    ]);

    await waitFor(() => expect(screen.getByText('Consegnata')).toBeTruthy());
    expect(screen.getByText('Non iniziata')).toBeTruthy(); // Bruno has no submission
    expect(screen.getByText('SF-2026-A1B2')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('shows "In corso" for a draft submission', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue([approvedStudents[1]]); // Anna only
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'draft',
          lastSavedAt: { seconds: 100, nanoseconds: 0 },
          submittedAt: null,
          deliveryCode: null,
          attentionEventsCount: 0,
          attentionEvents: [],
        },
      ]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => expect(screen.getByText('In corso')).toBeTruthy());
  });

  it('keeps showing the loading state — never "Non iniziata" — while students are loaded but the first submissions snapshot has not arrived yet', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue([approvedStudents[1]]); // Anna only
    let pushItems: (items: unknown[]) => void = () => {};
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      pushItems = onChange;
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    // Students resolved (mockListStudents is a resolved promise), but the
    // submissions listener has not delivered its first snapshot yet: the
    // monitor must stay in the loading state, never claim "Non iniziata"
    // before it actually knows whether a submission exists.
    await waitFor(() => expect(screen.getByText(/caricamento consegne/i)).toBeTruthy());
    expect(screen.queryByText('Non iniziata')).toBeNull();
    expect(screen.queryByText('Anna')).toBeNull();

    pushItems([]);

    await waitFor(() => expect(screen.getByText('Non iniziata')).toBeTruthy());
    expect(screen.getByText('Anna')).toBeTruthy();
  });

  it('never renders answer content — only compact monitor fields', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue([approvedStudents[1]]);
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'submitted',
          lastSavedAt: { seconds: 100, nanoseconds: 0 },
          submittedAt: { seconds: 200, nanoseconds: 0 },
          deliveryCode: 'SF-2026-A1B2',
          attentionEventsCount: 1,
          attentionEvents: [{ type: 'tab_blur', ts: 1 }],
        },
      ]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => expect(screen.getByText('Consegnata')).toBeTruthy());
    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toMatch(/risposta/i);
    expect(rendered).not.toMatch(/answers/i);
  });

  it('the monitor is shown automatically as soon as a non-draft verification is selected — no separate toggle button', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue([]);
    mockWatchSubmissions.mockReturnValue(vi.fn());
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    expect(screen.queryByRole('button', { name: /consegne online/i })).toBeNull();
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() =>
      expect(screen.getByRole('region', { name: /consegne online/i })).toBeTruthy(),
    );
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalledTimes(1));
  });

  it('closes the listener when a different (draft) verification is selected, and opens a new one for the previous selection again', async () => {
    setupDefaults();
    const draftVer = makeDraftVer({
      id: 'ver-draft',
      config: { ...makeDraftVer().config, title: 'Verifica Bozza' },
    });
    mockListVerifications.mockResolvedValue([activeVerWithClass(), draftVer]);
    mockListStudents.mockResolvedValue([]);
    const unsubscribe = vi.fn();
    mockWatchSubmissions.mockReturnValue(unsubscribe);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /torna alle verifiche/i }));
    fireEvent.click(screen.getByText(draftVer.config.title));
    await waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
    // Draft renders no monitor region at all (M3F-11C), no listener.
    expect(screen.queryByRole('region', { name: /consegne online/i })).toBeNull();
    expect(mockWatchSubmissions).toHaveBeenCalledTimes(1);
  });

  it('closes the listener on unmount', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue([]);
    const unsubscribe = vi.fn();
    mockWatchSubmissions.mockReturnValue(unsubscribe);
    const { unmount } = render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalledTimes(1));

    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('shows the monitor for a closed verification too', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      activeVerWithClass({ status: 'closed', onlineEnabled: false }),
    ]);
    mockListStudents.mockResolvedValue([]);
    mockWatchSubmissions.mockReturnValue(vi.fn());
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalledTimes(1));
  });

  it('a selected draft verification renders no monitor region at all and opens no listener (M3F-11C)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => expect(screen.getByLabelText('Dettaglio verifica')).toBeTruthy());
    expect(screen.queryByRole('region', { name: /consegne online/i })).toBeNull();
    expect(screen.queryByText(/monitor consegne/i)).toBeNull();
    expect(mockWatchSubmissions).not.toHaveBeenCalled();
  });
});

describe('VerificationsView — correction workspace action (M4-02)', () => {
  const activeVerWithClass = (overrides = {}) =>
    makeDraftVer({
      status: 'active',
      onlineEnabled: true,
      teacherSnapshot: {
        title: 'Verifica Algebra',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [sampleQuestionRef],
        activatedAt: null,
      },
      ...overrides,
    });

  const oneApprovedStudent = [
    {
      id: 'stud-a',
      ownerUid: 'owner-uid',
      uid: 'stud-a',
      email: 'a@x.it',
      displayName: 'Anna Bianchi',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
  ];

  async function renderSelectedWithMonitor(items: unknown[]) {
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue(oneApprovedStudent);
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange(items);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(screen.getByLabelText('Consegne online')).toBeTruthy());
  }

  it('shows the "Apri correzione" action only for a submitted submission', async () => {
    setupDefaults();
    await renderSelectedWithMonitor([
      {
        studentUid: 'stud-a',
        status: 'submitted',
        lastSavedAt: null,
        submittedAt: null,
        deliveryCode: 'SF-1',
        attentionEventsCount: 0,
        attentionEvents: [],
      },
    ]);

    expect(screen.getByLabelText('Apri correzione — Anna Bianchi')).toBeTruthy();
  });

  it('shows no correction action for a draft (in-progress) submission', async () => {
    setupDefaults();
    await renderSelectedWithMonitor([
      {
        studentUid: 'stud-a',
        status: 'draft',
        lastSavedAt: null,
        submittedAt: null,
        deliveryCode: null,
        attentionEventsCount: 0,
        attentionEvents: [],
      },
    ]);

    expect(screen.queryByLabelText('Apri correzione — Anna Bianchi')).toBeNull();
  });

  it('shows no correction action for a student with no submission at all', async () => {
    setupDefaults();
    await renderSelectedWithMonitor([]);

    expect(screen.queryByLabelText(/apri correzione/i)).toBeNull();
  });

  it('opens the correction workspace with the deterministic submissionId and student name, and returns to the table on close', async () => {
    setupDefaults();
    await renderSelectedWithMonitor([
      {
        studentUid: 'stud-a',
        status: 'submitted',
        lastSavedAt: null,
        submittedAt: null,
        deliveryCode: 'SF-1',
        attentionEventsCount: 0,
        attentionEvents: [],
      },
    ]);

    fireEvent.click(screen.getByLabelText('Apri correzione — Anna Bianchi'));

    const workspace = await screen.findByTestId('correction-workspace');
    expect(within(workspace).getByText('Correzione — Anna Bianchi')).toBeTruthy();
    expect(within(workspace).getByText('ver-1_stud-a')).toBeTruthy();
    // The table underneath is not rendered while the workspace has taken over.
    expect(screen.queryByLabelText('Consegne online')).toBeNull();

    fireEvent.click(within(workspace).getByText('Chiudi workspace'));
    await waitFor(() => expect(screen.getByLabelText('Consegne online')).toBeTruthy());
  });
});

describe('VerificationsView — attention events dialog (M3F-09)', () => {
  const activeVerWithClass = (overrides = {}) =>
    makeDraftVer({
      status: 'active',
      onlineEnabled: true,
      teacherSnapshot: {
        title: 'Verifica Algebra',
        classId: 'cls-1',
        className: 'Classe 3A',
        programId: 'prog-1',
        importId: 'imp-1',
        questionRefs: [sampleQuestionRef],
        activatedAt: null,
      },
      ...overrides,
    });

  const oneApprovedStudent = [
    {
      id: 'stud-a',
      ownerUid: 'owner-uid',
      uid: 'stud-a',
      email: 'a@x.it',
      displayName: 'Anna',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
  ];

  it('the events count is not a button when there are zero events', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue(oneApprovedStudent);
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'submitted',
          lastSavedAt: { seconds: 100, nanoseconds: 0 },
          submittedAt: { seconds: 200, nanoseconds: 0 },
          deliveryCode: 'SF-2026-A1B2',
          attentionEventsCount: 0,
          attentionEvents: [],
        },
      ]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => expect(screen.getByText('Consegnata')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /eventi di attenzione/i })).toBeNull();
  });

  it('clicking the events count opens a dialog with the chronological, human-readable event list — no new listener', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue(oneApprovedStudent);
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'submitted',
          lastSavedAt: { seconds: 100, nanoseconds: 0 },
          submittedAt: { seconds: 200, nanoseconds: 0 },
          deliveryCode: 'SF-2026-A1B2',
          attentionEventsCount: 2,
          attentionEvents: [
            { type: 'copy_attempt', ts: 2000 },
            { type: 'fullscreen_exit', ts: 1000 },
          ],
        },
      ]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => expect(screen.getByText('Consegnata')).toBeTruthy());
    const watchCallsBefore = mockWatchSubmissions.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /eventi di attenzione — anna/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Eventi di attenzione (2)')).toBeTruthy();
    expect(within(dialog).getByText('Anna')).toBeTruthy();
    expect(within(dialog).getByText('Uscita schermo intero')).toBeTruthy();
    expect(within(dialog).getByText('Copia')).toBeTruthy();
    expect(within(dialog).getByText(/segnalazioni di attenzione/i)).toBeTruthy();
    expect(mockWatchSubmissions.mock.calls.length).toBe(watchCallsBefore);

    // Chronological order: fullscreen_exit (ts 1000) before copy_attempt (ts 2000).
    const rows = within(dialog).getAllByRole('row').slice(1); // skip header row
    const eventCells = rows.map((row) => within(row).getAllByRole('cell')[1].textContent);
    expect(eventCells).toEqual(['Uscita schermo intero', 'Copia']);
  });

  it('shows a readable fallback for an unrecognized event type', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue(oneApprovedStudent);
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'submitted',
          lastSavedAt: { seconds: 100, nanoseconds: 0 },
          submittedAt: { seconds: 200, nanoseconds: 0 },
          deliveryCode: 'SF-2026-A1B2',
          attentionEventsCount: 1,
          attentionEvents: [{ type: 'future_unknown_event', ts: 1000 }],
        },
      ]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(screen.getByText('Consegnata')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /eventi di attenzione — anna/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/evento non riconosciuto/i)).toBeTruthy();
    expect(within(dialog).getByText(/tipo non riconosciuto/i)).toBeTruthy();
  });

  it('closes the dialog with the close button, Escape, and a click on the backdrop', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue(oneApprovedStudent);
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'submitted',
          lastSavedAt: { seconds: 100, nanoseconds: 0 },
          submittedAt: { seconds: 200, nanoseconds: 0 },
          deliveryCode: 'SF-2026-A1B2',
          attentionEventsCount: 1,
          attentionEvents: [{ type: 'copy_attempt', ts: 1000 }],
        },
      ]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(screen.getByText('Consegnata')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /eventi di attenzione — anna/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /eventi di attenzione — anna/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /eventi di attenzione — anna/i }));
    const dialogForBackdrop = await screen.findByRole('dialog');
    fireEvent.click(dialogForBackdrop.parentElement!);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never renders answers or flagged in the dialog', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue(oneApprovedStudent);
    mockWatchSubmissions.mockImplementation((_verId, _ownerUid, _db, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'submitted',
          lastSavedAt: { seconds: 100, nanoseconds: 0 },
          submittedAt: { seconds: 200, nanoseconds: 0 },
          deliveryCode: 'SF-2026-A1B2',
          attentionEventsCount: 1,
          attentionEvents: [{ type: 'copy_attempt', ts: 1000 }],
        },
      ]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(screen.getByText('Consegnata')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /eventi di attenzione — anna/i }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).not.toMatch(/risposta/i);
    expect(dialog.textContent).not.toMatch(/answers/i);
    expect(dialog.textContent).not.toMatch(/flagged/i);
  });
});

describe('VerificationsView — sort order', () => {
  function titlesInOrder() {
    return screen
      .getAllByRole('button', { name: /^Apri dettaglio verifica/ })
      .map((btn) => btn.textContent);
  }

  it('orders active verifications by activatedAt descending (most recent first)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        id: 'ver-older',
        status: 'active',
        activatedAt: { seconds: 1000, nanoseconds: 0 },
        config: { ...makeDraftVer().config, title: 'Verifica Vecchia' },
      }),
      makeDraftVer({
        id: 'ver-newer',
        status: 'active',
        activatedAt: { seconds: 2000, nanoseconds: 0 },
        config: { ...makeDraftVer().config, title: 'Verifica Recente' },
      }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Recente'));
    expect(titlesInOrder()).toEqual(['Verifica Recente', 'Verifica Vecchia']);
  });

  it('puts drafts without any relevant date at the bottom', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        id: 'ver-draft',
        config: { ...makeDraftVer().config, title: 'Verifica Bozza' },
      }),
      makeDraftVer({
        id: 'ver-active',
        status: 'active',
        activatedAt: { seconds: 1000, nanoseconds: 0 },
        config: { ...makeDraftVer().config, title: 'Verifica Attiva' },
      }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Attiva'));
    expect(titlesInOrder()).toEqual(['Verifica Attiva', 'Verifica Bozza']);
  });

  it('falls back to closedAt, then updatedAt, when activatedAt is missing', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        id: 'ver-updated-only',
        updatedAt: { seconds: 500, nanoseconds: 0 },
        config: { ...makeDraftVer().config, title: 'Verifica Solo Aggiornata' },
      }),
      makeDraftVer({
        id: 'ver-closed',
        status: 'closed',
        activatedAt: null,
        closedAt: { seconds: 800, nanoseconds: 0 },
        config: { ...makeDraftVer().config, title: 'Verifica Chiusa Senza Attivazione' },
      }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Chiusa Senza Attivazione'));
    expect(titlesInOrder()).toEqual([
      'Verifica Chiusa Senza Attivazione',
      'Verifica Solo Aggiornata',
    ]);
  });
});

describe('VerificationsView — school year + archive filters (VUX-01)', () => {
  const cls3a = { ...sampleClass, id: 'cls-1', name: 'Classe 3A' };
  const cls3b = { ...sampleClass, id: 'cls-2', name: 'Classe 3B' };

  function verWith(id: string, title: string, importId: string, classId: string | null) {
    return makeDraftVer({
      id,
      config: { ...makeDraftVer().config, title, importId, classId },
    });
  }

  /** Returns a year per importId (imp-1 recent, imp-old legacy year, else null). */
  function yearByImport(_programId: string, importId: string) {
    if (importId === 'imp-1') return Promise.resolve({ annoScolastico: '2025/2026' });
    if (importId === 'imp-old') return Promise.resolve({ annoScolastico: '2019/2020' });
    return Promise.resolve(null);
  }

  it('calls getImportMeta once per distinct (programId, importId) pair and uses the verification’s own importId', async () => {
    setupDefaults();
    mockGetImportMeta.mockImplementation(yearByImport);
    mockListVerifications.mockResolvedValue([
      verWith('v1', 'Alfa', 'imp-1', 'cls-1'),
      verWith('v2', 'Beta', 'imp-1', 'cls-1'),
      verWith('v3', 'Gamma', 'imp-old', 'cls-1'), // historical import, not the active one
    ]);
    render(<VerificationsView />);
    await screen.findByText('Alfa');

    // Two distinct pairs → exactly two reads (imp-1 deduped across v1+v2).
    await waitFor(() => expect(mockGetImportMeta).toHaveBeenCalledTimes(2));
    expect(mockGetImportMeta).toHaveBeenCalledWith('prog-1', 'imp-1', expect.anything());
    expect(mockGetImportMeta).toHaveBeenCalledWith('prog-1', 'imp-old', expect.anything());
  });

  it('shows "—" and a "Senza anno" filter option when the import metadata is absent', async () => {
    setupDefaults();
    mockGetImportMeta.mockResolvedValue(null);
    mockListVerifications.mockResolvedValue([verWith('v1', 'Alfa', 'imp-1', 'cls-1')]);
    render(<VerificationsView />);
    await screen.findByText('Alfa');

    const table = screen.getByRole('table');
    // Anno column present, rendered as "—" for this row.
    expect(within(table).getByRole('columnheader', { name: 'Anno' })).toBeTruthy();
    await waitFor(() =>
      expect(mockGetImportMeta).toHaveBeenCalledWith('prog-1', 'imp-1', expect.anything()),
    );
    expect(screen.getByRole('option', { name: 'Senza anno' })).toBeTruthy();
  });

  it('auto-selects the most recent year on first load and hides older-year verifications', async () => {
    setupDefaults();
    mockListClasses.mockResolvedValue([cls3a]);
    mockGetImportMeta.mockImplementation(yearByImport);
    mockListVerifications.mockResolvedValue([
      verWith('v1', 'Recente', 'imp-1', 'cls-1'),
      verWith('v2', 'Storica', 'imp-old', 'cls-1'),
    ]);
    render(<VerificationsView />);
    await screen.findByText('Recente');

    const yearSelect = screen.getByLabelText('Filtro anno scolastico') as HTMLSelectElement;
    await waitFor(() => expect(yearSelect.value).toBe('2025/2026'));
    // The older-year verification is filtered out by the auto-selected year.
    expect(screen.queryByText('Storica')).toBeNull();
    expect(screen.getByText('Recente')).toBeTruthy();
  });

  it('combines year, class and text filters client-side', async () => {
    setupDefaults();
    mockListClasses.mockResolvedValue([cls3a, cls3b]);
    mockGetImportMeta.mockImplementation(yearByImport);
    mockListVerifications.mockResolvedValue([
      verWith('v1', 'Algebra', 'imp-1', 'cls-1'), // 2025/2026, 3A
      verWith('v2', 'Geometria', 'imp-1', 'cls-2'), // 2025/2026, 3B
    ]);
    render(<VerificationsView />);
    await screen.findByText('Algebra');
    // Year auto-selected to 2025/2026 → both visible.
    await waitFor(() => expect(screen.getByText('Geometria')).toBeTruthy());

    // Class filter → only 3B.
    fireEvent.change(screen.getByLabelText('Filtro classe'), { target: { value: 'Classe 3B' } });
    expect(screen.queryByText('Algebra')).toBeNull();
    expect(screen.getByText('Geometria')).toBeTruthy();

    // Text search on the title, on top of the class filter.
    fireEvent.change(screen.getByLabelText('Cerca verifica'), { target: { value: 'geom' } });
    expect(screen.getByText('Geometria')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Cerca verifica'), { target: { value: 'algebra' } });
    // Algebra is 3A, filtered out by the class filter → no match.
    expect(screen.getByText(/nessuna verifica corrisponde ai filtri/i)).toBeTruthy();

    // No extra Firestore reads happened while filtering.
    expect(mockListVerifications).toHaveBeenCalledTimes(1);
  });

  it('does not reset a manual year choice on a later list update', async () => {
    setupDefaults();
    mockListClasses.mockResolvedValue([cls3a]);
    mockGetImportMeta.mockImplementation(yearByImport);
    mockListVerifications.mockResolvedValue([
      verWith('v1', 'Recente', 'imp-1', 'cls-1'),
      verWith('v2', 'Storica', 'imp-old', 'cls-1'),
    ]);
    render(<VerificationsView />);
    await screen.findByText('Recente');
    const yearSelect = screen.getByLabelText('Filtro anno scolastico') as HTMLSelectElement;
    await waitFor(() => expect(yearSelect.value).toBe('2025/2026'));

    // Manually widen to all years.
    fireEvent.change(yearSelect, { target: { value: '__all__' } });
    expect(screen.getByText('Storica')).toBeTruthy();

    // A later list update (enabling the student PDF re-writes the list state).
    const pdfButtons = screen.getAllByRole('button', { name: /Abilita PDF studente/i });
    fireEvent.click(pdfButtons[0]!);
    await waitFor(() => expect(mockSetVerificationStudentPdfEnabled).toHaveBeenCalled());

    // The manual "all years" choice is preserved (not snapped back to 2025/2026).
    expect(yearSelect.value).toBe('__all__');
    expect(screen.getByText('Storica')).toBeTruthy();
  });

  it('shows a filtered-empty state with a reset button that restores the list', async () => {
    setupDefaults();
    mockGetImportMeta.mockImplementation(yearByImport);
    mockListVerifications.mockResolvedValue([verWith('v1', 'Alfa', 'imp-1', 'cls-1')]);
    render(<VerificationsView />);
    await screen.findByText('Alfa');

    fireEvent.change(screen.getByLabelText('Cerca verifica'), {
      target: { value: 'zzz-nessun-match' },
    });
    expect(screen.getByText(/nessuna verifica corrisponde ai filtri/i)).toBeTruthy();
    expect(screen.queryByText('Alfa')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Azzera filtri' }));
    expect(screen.getByText('Alfa')).toBeTruthy();
  });

  it('does not lose any pair when concurrent resolutions land out of order', async () => {
    setupDefaults();
    mockListClasses.mockResolvedValue([cls3a]);
    const resolvers = new Map<string, (v: { annoScolastico: string }) => void>();
    mockGetImportMeta.mockImplementation(
      (_programId: string, importId: string) =>
        new Promise((resolve) => resolvers.set(importId, resolve)),
    );
    mockListVerifications.mockResolvedValue([
      verWith('v1', 'Recente', 'imp-1', 'cls-1'),
      verWith('v2', 'Storica', 'imp-old', 'cls-1'),
    ]);
    render(<VerificationsView />);
    await screen.findByText('Recente');
    await waitFor(() => expect(resolvers.size).toBe(2));

    // Resolve out of order (older pair first, then the recent one).
    resolvers.get('imp-old')!({ annoScolastico: '2019/2020' });
    resolvers.get('imp-1')!({ annoScolastico: '2025/2026' });

    // Both years survived the merge → both appear as year-filter options.
    await waitFor(() => expect(screen.getByRole('option', { name: '2019/2020' })).toBeTruthy());
    expect(screen.getByRole('option', { name: '2025/2026' })).toBeTruthy();
  });

  it('never matches technical programId/classId in the text search', async () => {
    setupDefaults();
    mockGetImportMeta.mockResolvedValue(null);
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        id: 'v1',
        config: {
          ...makeDraftVer().config,
          title: 'Alfa',
          programId: 'prog-secret',
          classId: 'cls-secret',
          importId: 'imp-1',
        },
      }),
    ]);
    render(<VerificationsView />);
    await screen.findByText('Alfa');

    // Searching a technical id substring finds nothing (ids are not in the haystack).
    fireEvent.change(screen.getByLabelText('Cerca verifica'), { target: { value: 'secret' } });
    expect(screen.getByText(/nessuna verifica corrisponde ai filtri/i)).toBeTruthy();
    expect(screen.queryByText('Alfa')).toBeNull();

    // The readable title still matches.
    fireEvent.change(screen.getByLabelText('Cerca verifica'), { target: { value: 'alfa' } });
    expect(screen.getByText('Alfa')).toBeTruthy();
  });

  it('does not freeze a transient getImportMeta error as "Senza anno" and retries on a refresh', async () => {
    setupDefaults();
    mockListClasses.mockResolvedValue([cls3a]);
    mockGetImportMeta
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue({ annoScolastico: '2025/2026' });
    mockListVerifications.mockResolvedValue([verWith('v1', 'Alfa', 'imp-1', 'cls-1')]);
    render(<VerificationsView />);
    await screen.findByText('Alfa');

    // First resolution threw → year not cached, not shown yet.
    await waitFor(() => expect(mockGetImportMeta).toHaveBeenCalledTimes(1));
    expect(within(screen.getByRole('table')).queryByText('2025/2026')).toBeNull();

    // A later list update re-runs the effect; the freed key is retried.
    fireEvent.click(screen.getAllByRole('button', { name: /Abilita PDF studente/i })[0]!);
    await waitFor(() => expect(mockSetVerificationStudentPdfEnabled).toHaveBeenCalled());
    await waitFor(() => expect(mockGetImportMeta).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(within(screen.getByRole('table')).getByText('2025/2026')).toBeTruthy(),
    );
  });
});
