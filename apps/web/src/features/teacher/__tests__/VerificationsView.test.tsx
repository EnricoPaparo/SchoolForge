import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

import { VerificationsView } from '../VerificationsView.js';

const mockListVerifications = vi.fn();
const mockCreateVerification = vi.fn();
const mockUpdateVerificationConfig = vi.fn();
const mockActivateVerification = vi.fn();
const mockCloseVerification = vi.fn();
const mockListQuestionIndex = vi.fn();
const mockListPrograms = vi.fn();
const mockListClasses = vi.fn();

const mockLoadSelectedQuestions = vi.fn();
const mockDownloadStudentPdf = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../repository/verifications/loadSelectedQuestions.js', () => ({
  loadSelectedQuestions: (...args: unknown[]) => mockLoadSelectedQuestions(...args),
}));
vi.mock('../../repository/verifications/verificationPdf.js', () => ({
  downloadStudentPdf: (...args: unknown[]) => mockDownloadStudentPdf(...args),
}));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'owner-uid' } }),
}));
vi.mock('../../repository/verifications/verificationsService.js', () => ({
  listVerifications: (...args: unknown[]) => mockListVerifications(...args),
  createVerification: (...args: unknown[]) => mockCreateVerification(...args),
  updateVerificationConfig: (...args: unknown[]) => mockUpdateVerificationConfig(...args),
  activateVerification: (...args: unknown[]) => mockActivateVerification(...args),
  closeVerification: (...args: unknown[]) => mockCloseVerification(...args),
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
  mockListVerifications.mockResolvedValue([]);
  mockListPrograms.mockResolvedValue([sampleProgram]);
  mockListClasses.mockResolvedValue([sampleClass]);
  mockListQuestionIndex.mockResolvedValue(sampleQuestionIndexEntries);
  mockUpdateVerificationConfig.mockResolvedValue(undefined);
  mockActivateVerification.mockResolvedValue(undefined);
  mockCloseVerification.mockResolvedValue(undefined);
  mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [] });
  mockDownloadStudentPdf.mockResolvedValue(undefined);
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

  it('renders verification list with status badges', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer(),
      makeDraftVer({
        id: 'ver-2',
        status: 'active',
        config: { ...makeDraftVer().config, title: 'Verifica Geometria' },
      }),
      makeDraftVer({
        id: 'ver-3',
        status: 'closed',
        config: { ...makeDraftVer().config, title: 'Verifica Trigonometria' },
      }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => {
      expect(screen.getByText('Verifica Algebra')).toBeTruthy();
      expect(screen.getByText('Verifica Geometria')).toBeTruthy();
      expect(screen.getByText('Verifica Trigonometria')).toBeTruthy();
      expect(screen.getByText('bozza')).toBeTruthy();
      expect(screen.getByText('attiva')).toBeTruthy();
      expect(screen.getByText('chiusa')).toBeTruthy();
    });
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

  it('loads question index when verification with program is selected', async () => {
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
    // Verify the mock entries only have metadata fields
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

    // Ensure rendered text contains no question content keywords
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

    // No questions selected → disabled
    const activateBtn = screen.getByRole('button', { name: /attiva verifica/i });
    expect(activateBtn).toHaveProperty('disabled', true);

    // Select one question
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
      expect(mockActivateVerification).toHaveBeenCalledWith('ver-1', sampleClass, 'owner-uid', {}),
    );
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

  it('shows active verification as read-only after activation', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        status: 'active',
        config: {
          ...makeDraftVer().config,
          questionRefs: [sampleQuestionRef],
        },
      }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => {
      // Both list badge and detail badge show 'attiva'
      expect(screen.getAllByText('attiva').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByRole('button', { name: /chiudi verifica/i })).toBeTruthy();
    });
    // No activate button in active state
    expect(screen.queryByRole('button', { name: /attiva verifica/i })).toBeNull();
  });

  it('shows close button for active verification', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        status: 'active',
        config: {
          ...makeDraftVer().config,
          questionRefs: [sampleQuestionRef],
        },
      }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByRole('button', { name: /chiudi verifica/i }));
    expect(screen.getByRole('button', { name: /chiudi verifica/i })).toBeTruthy();
  });

  it('calls closeVerification on close confirm', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({
      status: 'active',
      config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] },
    });
    const closedVer = { ...activeVer, status: 'closed' as const };
    mockListVerifications.mockResolvedValueOnce([activeVer]).mockResolvedValue([closedVer]);
    mockCloseVerification.mockResolvedValue(undefined);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByRole('button', { name: /chiudi verifica/i }));
    fireEvent.click(screen.getByRole('button', { name: /chiudi verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma chiusura/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma chiusura/i }));

    await waitFor(() =>
      expect(mockCloseVerification).toHaveBeenCalledWith('ver-1', 'owner-uid', {}),
    );
  });

  it('closed verification shows no action buttons', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({ status: 'closed', config: { ...makeDraftVer().config, questionRefs: [] } }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    await waitFor(() => screen.getAllByText('chiusa').length >= 1);
    expect(screen.queryByRole('button', { name: /attiva verifica/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /chiudi verifica/i })).toBeNull();
  });

  it('active verification shows Scarica PDF button', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({
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
    mockListVerifications.mockResolvedValue([activeVer]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf/i }));
    expect(screen.getByRole('button', { name: /scarica pdf/i })).toBeTruthy();
  });

  it('draft verification does not show Scarica PDF button', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByRole('button', { name: /attiva verifica/i }));
    expect(screen.queryByRole('button', { name: /scarica pdf/i })).toBeNull();
  });

  it('closed verification does not show Scarica PDF button', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({ status: 'closed', config: { ...makeDraftVer().config, questionRefs: [] } }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getAllByText('chiusa').length >= 1);
    expect(screen.queryByRole('button', { name: /scarica pdf/i })).toBeNull();
  });

  it('clicking Scarica PDF calls loadSelectedQuestions and downloadStudentPdf', async () => {
    setupDefaults();
    const teacherSnapshot = {
      title: 'Verifica Algebra',
      classId: 'cls-1',
      className: 'Classe 3A',
      programId: 'prog-1',
      importId: 'imp-1',
      questionRefs: [sampleQuestionRef],
      activatedAt: null,
    };
    const activeVer = makeDraftVer({
      status: 'active',
      config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] },
      teacherSnapshot,
    });
    mockListVerifications.mockResolvedValue([activeVer]);
    const fakeQuestion = { ref: sampleQuestionRef, testo: 'Domanda?', tipo: 'aperta' as const };
    mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [fakeQuestion] });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf/i }));

    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());
    expect(mockLoadSelectedQuestions).toHaveBeenCalledWith([sampleQuestionRef], {});
    expect(mockDownloadStudentPdf).toHaveBeenCalledWith(
      teacherSnapshot,
      [fakeQuestion],
      'Classe 3A',
    );
  });

  it('shows error message when loadSelectedQuestions fails', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({
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
    mockListVerifications.mockResolvedValue([activeVer]);
    mockLoadSelectedQuestions.mockResolvedValue({ ok: false, error: 'Pool non trovato: gs://...' });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByRole('button', { name: /scarica pdf/i }));
    fireEvent.click(screen.getByRole('button', { name: /scarica pdf/i }));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/pool non trovato/i);
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
});
