import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { VerificationsView } from '../VerificationsView.js';

const mockListVerifications = vi.fn();
const mockCreateVerification = vi.fn();
const mockUpdateVerificationConfig = vi.fn();
const mockActivateVerification = vi.fn();
const mockSetVerificationVisibility = vi.fn();
const mockCloseVerification = vi.fn();
const mockDeleteVerification = vi.fn();
const mockListQuestionIndex = vi.fn();
const mockListPrograms = vi.fn();
const mockListClasses = vi.fn();

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
  closeVerification: (...args: unknown[]) => mockCloseVerification(...args),
  deleteVerification: (...args: unknown[]) => mockDeleteVerification(...args),
}));
vi.mock('../../repository/verifications/questionIndexService.js', () => ({
  listQuestionIndex: (...args: unknown[]) => mockListQuestionIndex(...args),
}));
vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: (...args: unknown[]) => mockListClasses(...args),
}));
vi.mock('../../repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
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
    expect(within(table).getByText('Corso')).toBeTruthy();
    expect(within(table).getByText('Stato')).toBeTruthy();
    expect(within(table).getByText('Domande')).toBeTruthy();

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
    const [, ...bodyRows] = within(table).getAllByRole('row'); // drop header row
    const cellCounts = bodyRows.map((row) => within(row).getAllByRole('cell').length);
    expect(bodyRows).toHaveLength(3);
    expect(new Set(cellCounts).size).toBe(1);
  });

  it('renders the create-verification form before the verification table', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByRole('table'));

    const form = screen.getByRole('form', { name: 'Nuova verifica' });
    const table = screen.getByRole('table');
    expect(form.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('draft verification shows only the Elimina row action, never PDF or Chiudi', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    expect(screen.queryByRole('button', { name: /scarica pdf studenti/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /scarica pdf soluzioni/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /chiudi verifica/i })).toBeNull();
    expect(screen.getByRole('button', { name: /elimina verifica/i })).toBeTruthy();
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
      teacherSnapshot,
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
      teacherSnapshot,
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
      cv.teacherSnapshot,
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
