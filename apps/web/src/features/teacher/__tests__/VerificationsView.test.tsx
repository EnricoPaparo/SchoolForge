import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as CorrectionRegisterExportModule from '../../repository/corrections/correctionRegisterExport.js';
import type * as CorrectionArchiveExportModule from '../../repository/corrections/correctionArchiveExport.js';
import type * as CorrectionProgressModule from '../../repository/corrections/correctionProgressService.js';
import type * as CorrectionReturnVisibilityModule from '../../repository/corrections/correctionReturnVisibilityService.js';
import type * as TeacherAiPrefsModule from '../../repository/corrections/teacherAiPreferencesService.js';
import type * as ForceCloseClientModule from '../../repository/verifications/forceCloseClient.js';
import { PdfModuleLoadError } from '../../../lib/pdfModuleLoader.js';

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
const mockReopenVerification = vi.fn();
const mockDeleteVerification = vi.fn();
const mockListQuestionIndex = vi.fn();
const mockListDifferentiationLabels = vi.fn();
const mockListPrograms = vi.fn();
const mockGetImportMeta = vi.fn();
const mockListClasses = vi.fn();
const mockListStudents = vi.fn();
const mockWatchSubmissions = vi.fn();
const mockDeleteSubmissionData = vi.fn();
const mockDownloadCorrectionRegisterCsv = vi.fn();
const mockDownloadCorrectionRegisterPdf = vi.fn();
const mockRunCorrectionArchiveExport = vi.fn();
const mockLoadCorrectionReturnVisibilityBySubmission = vi.fn(
  async (..._args: unknown[]) => new Map<string, unknown>(),
);

const mockLoadSelectedQuestions = vi.fn();
const mockDownloadStudentPdf = vi.fn();
const mockLoadSelectedQuestionsWithSolutions = vi.fn();
const mockDownloadTeacherSolutionsPdf = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
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
  VERIFICATION_TITLE_MAX_LENGTH: 100,
  listVerifications: (...args: unknown[]) => mockListVerifications(...args),
  createVerification: (...args: unknown[]) => mockCreateVerification(...args),
  updateVerificationConfig: (...args: unknown[]) => mockUpdateVerificationConfig(...args),
  activateVerification: (...args: unknown[]) => mockActivateVerification(...args),
  setVerificationVisibility: (...args: unknown[]) => mockSetVerificationVisibility(...args),
  setVerificationOnlineEnabled: (...args: unknown[]) => mockSetVerificationOnlineEnabled(...args),
  setVerificationStudentPdfEnabled: (...args: unknown[]) =>
    mockSetVerificationStudentPdfEnabled(...args),
  closeVerification: (...args: unknown[]) => mockCloseVerification(...args),
  reopenVerification: (...args: unknown[]) => mockReopenVerification(...args),
  deleteVerification: (...args: unknown[]) => mockDeleteVerification(...args),
}));
vi.mock('../../repository/verifications/questionIndexService.js', () => ({
  listQuestionIndex: (...args: unknown[]) => mockListQuestionIndex(...args),
}));
vi.mock('../../repository/differentiation/differentiationLabelsService.js', () => ({
  listDifferentiationLabels: (...args: unknown[]) => mockListDifferentiationLabels(...args),
}));
vi.mock('../../repository/verifications/submissionsMonitorService.js', () => ({
  watchSubmissions: (...args: unknown[]) => mockWatchSubmissions(...args),
}));
vi.mock('../../repository/verifications/deleteSubmissionData.js', () => ({
  deleteSubmissionData: (...args: unknown[]) => mockDeleteSubmissionData(...args),
}));
// FORCE-SUBMIT-02 — solo la callable è sostituita: le funzioni pure
// (`planForceClose`, i messaggi) restano quelle reali, così l'eleggibilità
// testata qui è esattamente quella usata in produzione.
const mockScheduleForceClose = vi.hoisted(() =>
  vi.fn(async (..._args: unknown[]) => ({
    graceSeconds: 60,
    results: [] as { studentUid: string; outcome: string }[],
  })),
);
vi.mock('../../repository/verifications/forceCloseClient.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ForceCloseClientModule>();
  return {
    ...actual,
    createScheduleForceClose: () => mockScheduleForceClose,
  };
});
vi.mock('../../repository/corrections/correctionRegisterExport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CorrectionRegisterExportModule>();
  return {
    ...actual,
    downloadCorrectionRegisterCsv: (...args: unknown[]) =>
      mockDownloadCorrectionRegisterCsv(...args),
  };
});
vi.mock('../../repository/corrections/correctionRegisterPdf.js', () => ({
  downloadCorrectionRegisterPdf: (...args: unknown[]) => mockDownloadCorrectionRegisterPdf(...args),
}));
vi.mock('../../repository/corrections/correctionArchiveExport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CorrectionArchiveExportModule>();
  return {
    ...actual,
    runCorrectionArchiveExport: (...args: unknown[]) => mockRunCorrectionArchiveExport(...args),
  };
});
vi.mock('../../repository/classes/classesService.js', () => ({
  listClasses: (...args: unknown[]) => mockListClasses(...args),
}));
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();
vi.mock('../../repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
  getImportMeta: (...args: unknown[]) => mockGetImportMeta(...args),
  // UI-VERIFICHE-06B — albero canonico letto una sola volta all'apertura della
  // bozza, insieme al pool, per comporre il perimetro didattico.
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));
vi.mock('../../repository/students/studentsService.js', () => ({
  listStudents: (...args: unknown[]) => mockListStudents(...args),
}));
// M5-03 — «Valutate» targeted read + batch AI dialog. Defaults keep unrelated
// suites unaffected (empty progress → "—", dialog is a passive stub).
const mockLoadCorrectionProgressByStudent = vi.fn(
  async (..._args: unknown[]) => new Map<string, unknown>(),
);
vi.mock('../../repository/corrections/correctionProgressService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof CorrectionProgressModule>();
  return {
    ...actual, // keep real pure progress helpers
    loadCorrectionProgressByStudent: (...args: unknown[]) =>
      mockLoadCorrectionProgressByStudent(...args),
  };
});
vi.mock(
  '../../repository/corrections/correctionReturnVisibilityService.js',
  async (importOriginal) => {
    const actual = await importOriginal<typeof CorrectionReturnVisibilityModule>();
    return {
      ...actual,
      loadCorrectionReturnVisibilityBySubmission: (...args: unknown[]) =>
        mockLoadCorrectionReturnVisibilityBySubmission(...args),
    };
  },
);
// TWU-02 — the AI-preferences load resolves to the application defaults so the
// dialogs reach the `ready` state (the fail-closed error path is covered by the
// service unit tests and dedicated cases below).
const mockLoadTeacherAiPreferences = vi.fn(async (..._args: unknown[]) => ({
  modelProfile: 'quality' as const,
  gradingMode: 'balanced' as const,
  teacherGuidance: '',
}));
vi.mock('../../repository/corrections/teacherAiPreferencesService.js', async (importOriginal) => {
  const actual = await importOriginal<typeof TeacherAiPrefsModule>();
  return {
    ...actual,
    loadTeacherAiPreferences: (...args: unknown[]) => mockLoadTeacherAiPreferences(...args),
  };
});
const mockAiDialog = vi.fn();
vi.mock('../AiBatchCorrectionDialog.js', () => ({
  AiBatchCorrectionDialog: (props: {
    submissionIds: string[];
    onClose: () => void;
    onApplied: (result: unknown) => void;
  }) => {
    mockAiDialog(props);
    return (
      <div data-testid="ai-batch-dialog">
        <span>IDs: {props.submissionIds.join(',')}</span>
        <button type="button" onClick={props.onClose}>
          Chiudi IA
        </button>
      </div>
    );
  },
}));
// M5-04 — batch actions dialog stub: exposes the received rows and lets a test
// drive the typed server-confirmed result while selection stays persistent.
const mockBatchDialog = vi.fn();
vi.mock('../BatchCorrectionActionsDialog.js', () => ({
  BatchCorrectionActionsDialog: (props: {
    action: string;
    rows: { studentUid: string }[];
    onClose: () => void;
    onApplied: (action: string, results: unknown[]) => void;
  }) => {
    mockBatchDialog(props);
    return (
      <div data-testid="batch-actions-dialog">
        <span>action: {props.action}</span>
        <span>rows: {props.rows.map((r) => r.studentUid).join(',')}</span>
        <button
          type="button"
          onClick={() =>
            props.onApplied(props.action, [
              {
                studentUid: 'stud-a',
                submissionId: 'ver-1_stud-a',
                outcome: 'succeeded',
              },
              {
                studentUid: 'stud-b',
                submissionId: 'ver-1_stud-b',
                outcome: 'failed',
              },
            ])
          }
        >
          Applica
        </button>
        <button type="button" onClick={props.onClose}>
          Chiudi azioni
        </button>
      </div>
    );
  },
}));
const mockVisibilityDialog = vi.fn();
vi.mock('../BatchReturnVisibilityDialog.js', () => ({
  BatchReturnVisibilityDialog: (props: {
    action: string;
    rows: { studentUid: string }[];
    onClose: () => void;
    onApplied: (action: string, results: unknown[]) => void;
  }) => {
    mockVisibilityDialog(props);
    return (
      <div data-testid="batch-visibility-dialog">
        <span>visibility action: {props.action}</span>
        <span>visibility rows: {props.rows.map((row) => row.studentUid).join(',')}</span>
        <button type="button" onClick={props.onClose}>
          Chiudi visibilità
        </button>
        <button
          type="button"
          onClick={() =>
            props.onApplied(props.action, [
              {
                studentUid: 'stud-a',
                submissionId: 'ver-1_stud-a',
                outcome: 'succeeded',
                visibleToStudent: true,
                solutionsVisible: true,
              },
              {
                studentUid: 'stud-b',
                submissionId: 'ver-1_stud-b',
                outcome: 'noop',
                visibleToStudent: true,
                solutionsVisible: true,
              },
            ])
          }
        >
          Applica visibilità
        </button>
      </div>
    );
  },
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

/**
 * UI-VERIFICHE-06A — le sei azioni della card vivono nel menu «Azioni». Questo
 * helper apre il menu della card indicata (se non è già aperto) e restituisce la
 * voce richiesta, così i test restano espressi in termini di azione.
 */
function menuItem(name: RegExp | string, cardIndex = 0): HTMLButtonElement {
  const triggers = screen.getAllByRole('button', { name: /^Azioni verifica/ });
  const trigger = triggers[cardIndex]!;
  if (trigger.getAttribute('aria-expanded') !== 'true') fireEvent.click(trigger);
  return screen.getByRole('menuitem', { name }) as HTMLButtonElement;
}

/** Attende che almeno una card sia renderizzata (trigger «Azioni» presente). */
function actionsTriggers(): HTMLElement[] {
  return screen.getAllByRole('button', { name: /^Azioni verifica/ });
}

const sampleQuestionIndexEntries = [
  {
    id: 'qi-1',
    udaDir: 'UDA1',
    lessonFilename: 'lezione1.md',
    poolStorageRef: 'gs://bucket/imports/imp-1/UDA1/lezione1.pool.md',
    questionLocalId: 'q1',
    tipo: 'chiusa_singola' as const,
    difficolta: 2 as const,
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
  maxPoints: 2,
};

function setupDefaults() {
  vi.clearAllMocks();
  mockListVerifications.mockResolvedValue([]);
  mockListPrograms.mockResolvedValue([sampleProgram]);
  mockGetImportMeta.mockResolvedValue(null);
  mockListClasses.mockResolvedValue([sampleClass]);
  mockListQuestionIndex.mockResolvedValue(sampleQuestionIndexEntries);
  mockListDifferentiationLabels.mockResolvedValue([]);
  mockListUdas.mockResolvedValue([{ dir: 'UDA1', titolo: 'Il Web' }]);
  mockListLessons.mockResolvedValue([
    { udaDir: 'UDA1', filename: 'lezione1.md', titolo: 'Come funziona Internet' },
    { udaDir: 'UDA1', filename: 'lezione2.md', titolo: 'Il protocollo HTTP' },
  ]);
  mockUpdateVerificationConfig.mockResolvedValue(undefined);
  mockActivateVerification.mockResolvedValue(undefined);
  mockCloseVerification.mockResolvedValue(undefined);
  mockReopenVerification.mockResolvedValue(undefined);
  mockDeleteVerification.mockResolvedValue(undefined);
  mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [] });
  mockDownloadStudentPdf.mockResolvedValue(undefined);
  mockLoadSelectedQuestionsWithSolutions.mockResolvedValue({ ok: true, questions: [] });
  mockDownloadTeacherSolutionsPdf.mockResolvedValue(undefined);
  mockSetVerificationOnlineEnabled.mockResolvedValue(undefined);
  mockSetVerificationStudentPdfEnabled.mockResolvedValue(undefined);
  mockListStudents.mockResolvedValue([]);
  mockWatchSubmissions.mockReturnValue(vi.fn());
  mockLoadCorrectionReturnVisibilityBySubmission.mockResolvedValue(new Map());
  mockRunCorrectionArchiveExport.mockResolvedValue({
    ok: true,
    kind: 'pdf',
    filenames: ['Anna_Verifica.pdf'],
  });
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

  it('renders the archive as full-width record cards with preserved data and status', async () => {
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

    const list = await screen.findByRole('list', { name: 'Archivio verifiche' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByText('Verifica Algebra')).toBeTruthy();
    expect(within(list).getByText('Verifica Geometria')).toBeTruthy();
    expect(within(list).getByText('Verifica Trigonometria')).toBeTruthy();
    expect(within(list).getByText('Bozza')).toBeTruthy();
    expect(within(list).getByText('Nascosta')).toBeTruthy();
    // «Chiusa» resta solo come stato della verifica chiusa.
    expect(within(list).getAllByText('Chiusa')).toHaveLength(1);
    // Classe e programma vivono ora nella riga unica di metadati.
    expect(within(list).getAllByText(/Classe 3A/).length).toBeGreaterThanOrEqual(1);
    expect(within(list).getAllByText(/Matematica/).length).toBeGreaterThanOrEqual(1);
    // UI-VERIFICHE-05 — restano soltanto i riquadri Stato e Online.
    expect(within(list).getAllByText('Stato')).toHaveLength(3);
    expect(within(list).getAllByText('Online')).toHaveLength(3);
    expect(within(list).queryByText('Domande')).toBeNull();
    expect(within(list).queryByText('Documento')).toBeNull();
    expect(within(list).queryByText('Corso')).toBeNull();
    expect(within(list).queryByText('Disponibilità')).toBeNull();
    expect(within(list).getAllByRole('switch')).toHaveLength(1);
    // Nessuna pill/etichetta Classe, Anno, Attivata o Chiusa.
    for (const card of within(list).getAllByRole('listitem')) {
      for (const label of ['Classe', 'Anno', 'Attivata']) {
        expect(within(card).queryAllByText(label, { selector: 'strong' })).toHaveLength(0);
      }
    }
    const statusValue = within(list).getByText('Bozza').closest('dd');
    expect(statusValue?.querySelector('[class*="badge"]')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('no longer shows activatedAt/closedAt in the card (data preserved, presentation removed)', async () => {
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

    const list = await screen.findByRole('list', { name: 'Archivio verifiche' });
    expect(within(list).queryByText('Attivata')).toBeNull();
    // «Chiusa» resta solo come stato, non più come etichetta di data.
    expect(within(list).getAllByText('Chiusa')).toHaveLength(1);
    // Nessuna data formattata nella card.
    expect(within(list).queryByText(/\d{2}\/\d{2}\/\d{4}/)).toBeNull();
  });

  it('keeps a draft card free of activation/closure slots', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);

    const list = await screen.findByRole('list', { name: 'Archivio verifiche' });
    expect(within(list).queryByText('Attivata')).toBeNull();
    expect(within(list).queryByText('Chiusa')).toBeNull();
    expect(within(list).getByText('Bozza')).toBeTruthy();
  });

  it('renders one record card per verification regardless of status', async () => {
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

    const list = await screen.findByRole('list', { name: 'Archivio verifiche' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  });

  it('opens creation controls from the toolbar in DialogShell', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await screen.findByRole('list', { name: 'Archivio verifiche' });
    fireEvent.click(screen.getByRole('button', { name: 'Nuova verifica' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuova verifica' });
    expect(within(dialog).getByLabelText('Titolo')).toBeTruthy();
    expect(within(dialog).getByLabelText('Corso')).toBeTruthy();
    expect(within(dialog).getByLabelText('Classe (opzionale)')).toBeTruthy();
    expect(within(dialog).getByLabelText('Titolo').getAttribute('maxlength')).toBe('100');
    expect(within(dialog).getByText('0/100')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Crea verifica' })).toBeTruthy();
  });

  it('rejects a 101-character title in the creation dialog without calling the service', async () => {
    setupDefaults();
    render(<VerificationsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nuova verifica' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuova verifica' });

    fireEvent.change(within(dialog).getByLabelText('Titolo'), {
      target: { value: 'T'.repeat(101) },
    });
    fireEvent.change(within(dialog).getByLabelText('Corso'), { target: { value: 'prog-1' } });
    fireEvent.submit(within(dialog).getByLabelText('Titolo').closest('form')!);

    expect((await within(dialog).findByRole('alert')).textContent).toContain('superare 100');
    expect(mockCreateVerification).not.toHaveBeenCalled();
  });

  it('opens verification details as a dedicated level and returns to the list', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);

    fireEvent.click(await screen.findByText('Verifica Algebra'));

    expect(screen.getByLabelText('Dettaglio verifica')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Archivio verifiche' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /torna alle verifiche/i }));

    expect(screen.getByRole('list', { name: 'Archivio verifiche' })).toBeTruthy();
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
    fireEvent.click(await screen.findByRole('button', { name: 'Nuova verifica' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuova verifica' });

    fireEvent.change(within(dialog).getByLabelText('Titolo'), {
      target: { value: 'Nuova Verifica' },
    });
    fireEvent.change(within(dialog).getByLabelText('Corso'), { target: { value: 'prog-1' } });
    // UI-VERIFICHE-06B — la data è obbligatoria: senza, «Crea verifica» resta
    // disabilitato (coperto da un test dedicato più sotto).
    fireEvent.change(within(dialog).getByLabelText('Data'), { target: { value: '2026-02-02' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /crea verifica/i }));

    await waitFor(() =>
      expect(mockCreateVerification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Nuova Verifica',
          programId: 'prog-1',
          verificationDate: '2026-02-02',
        }),
        'owner-uid',
        {},
      ),
    );
  });

  it('excludes programs without an active import from the creation picker', async () => {
    setupDefaults();
    mockListPrograms.mockResolvedValue([
      sampleProgram,
      { ...sampleProgram, id: 'prog-empty', title: 'Corso vuoto', activeImportId: null },
    ]);
    render(<VerificationsView />);

    fireEvent.click(await screen.findByRole('button', { name: 'Nuova verifica' }));
    const picker = screen.getByLabelText('Corso');
    expect(within(picker).getByRole('option', { name: 'Matematica' })).toBeTruthy();
    expect(within(picker).queryByRole('option', { name: 'Corso vuoto' })).toBeNull();
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

  it('returns to the list after a successful activation, showing the refreshed status', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({
      status: 'active',
      visibility: 'public',
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

    // Back on the list: the draft detail is closed and the archive toolbar is
    // immediately available again.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /attiva verifica/i })).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Nuova verifica' })).toBeTruthy();
    // The row now reflects the refreshed active status.
    expect(screen.getByText('Pubblica')).toBeTruthy();
  });

  it('stays in the detail with the error visible when activation fails', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    mockActivateVerification.mockRejectedValue(new Error('Attivazione fallita'));
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByRole('button', { name: /attiva verifica/i }));
    await waitFor(() => screen.getByRole('region', { name: /conferma attivazione/i }));
    fireEvent.click(screen.getByRole('button', { name: /conferma attivazione/i }));

    // Error shown, still in the detail: the confirm panel remains open and the
    // list surface (new-verification title input) is absent.
    await waitFor(() => expect(screen.getByText('Attivazione fallita')).toBeTruthy());
    expect(screen.getByRole('region', { name: /conferma attivazione/i })).toBeTruthy();
    expect(screen.queryByPlaceholderText('Titolo nuova verifica')).toBeNull();
  });

  it('publishes a hidden active verification to the student on toggle click', async () => {
    setupDefaults();
    const activeVer = makeDraftVer({ status: 'active', visibility: 'hidden' });
    mockListVerifications.mockResolvedValue([activeVer]);
    mockSetVerificationVisibility.mockResolvedValue(undefined);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    fireEvent.click(menuItem(/pubblica allo studente/i));

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

    fireEvent.click(menuItem(/nascondi allo studente/i));

    await waitFor(() =>
      expect(mockSetVerificationVisibility).toHaveBeenCalledWith(
        'ver-1',
        'hidden',
        'owner-uid',
        {},
      ),
    );
  });

  it('shows the visibility action disabled for a draft verification', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer({ status: 'draft' })]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));

    expect((menuItem(/pubblica allo studente/i) as HTMLButtonElement).disabled).toBe(true);
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

    const titleInput = await waitFor(() => screen.getByLabelText(/titolo bozza/i));
    expect(titleInput.getAttribute('maxlength')).toBe('100');
    fireEvent.change(titleInput, {
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

  it('VDIF-03 — salva le varianti soltanto insieme alla bozza esplicita', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    mockListDifferentiationLabels.mockResolvedValue([
      {
        labelId: 'label-a',
        ownerUid: 'owner-uid',
        name: 'Percorso A',
        nameKey: 'percorso a',
        assignedCount: 1,
        draftUsageCount: 0,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    mockListQuestionIndex.mockResolvedValue([
      sampleQuestionIndexEntries[0],
      {
        ...sampleQuestionIndexEntries[1],
        id: 'qi-alt',
        questionLocalId: 'q-alt',
        lessonFilename: 'lezione1.md',
        questionPreview: 'Alternativa della stessa lezione.',
      },
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByRole('button', { name: /^Varianti$/i }));

    await waitFor(() => screen.getByRole('dialog', { name: /varianti della domanda/i }));
    fireEvent.click(screen.getByLabelText('Alternativa'));
    fireEvent.click(screen.getByRole('button', { name: /scegli alternativa per percorso a/i }));
    fireEvent.click(screen.getByRole('option', { name: /alternativa della stessa lezione/i }));
    fireEvent.click(screen.getByRole('button', { name: /salva varianti/i }));

    expect(mockUpdateVerificationConfig).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /salva bozza/i }));
    await waitFor(() => expect(mockUpdateVerificationConfig).toHaveBeenCalledOnce());
    expect(mockUpdateVerificationConfig.mock.calls[0]![1]).toEqual(
      expect.objectContaining({
        differentiation: {
          version: 1,
          questions: [
            {
              baseQuestionIndexEntryId: 'qi-1',
              choices: {
                'label-a': { kind: 'alternative', questionIndexEntryId: 'qi-alt' },
              },
            },
          ],
        },
      }),
    );
  });

  it('VDIF-03 — una bozza differenziata resta salvabile ma non attivabile', async () => {
    setupDefaults();
    const differentiation = {
      version: 1 as const,
      questions: [
        {
          baseQuestionIndexEntryId: 'qi-1',
          choices: { 'label-a': { kind: 'none' as const } },
        },
      ],
    };
    mockListVerifications.mockResolvedValue([
      makeDraftVer({
        config: {
          ...makeDraftVer().config,
          questionRefs: [sampleQuestionRef],
          differentiation,
        },
      }),
    ]);
    mockListDifferentiationLabels.mockResolvedValue([
      {
        labelId: 'label-a',
        ownerUid: 'owner-uid',
        name: 'Percorso A',
        nameKey: 'percorso a',
        assignedCount: 1,
        draftUsageCount: 1,
        createdAt: null,
        updatedAt: null,
      },
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    const activate = await waitFor(() => screen.getByRole('button', { name: /attiva verifica/i }));
    expect(activate).toHaveProperty('disabled', true);
    expect(screen.getByText(/attivazione sarà disponibile dopo la configurazione/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /salva bozza/i })).toBeTruthy();
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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf soluzioni/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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

  it('keeps six action slots on active verifications and disables Elimina', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    expect(menuItem(/scarica pdf studenti/i)).toBeTruthy();
    expect(menuItem(/scarica pdf soluzioni/i)).toBeTruthy();
    expect(menuItem(/chiudi verifica/i)).toBeTruthy();
    expect((menuItem(/elimina verifica/i) as HTMLButtonElement).disabled).toBe(true);
    // UI-VERIFICHE-06A/06B — sulla card restano superficie apribile, «Azioni» e
    // il controllo «Argomenti»: nessun pulsante azione sciolto.
    const card = screen.getByRole('listitem', { name: /verifica verifica algebra/i });
    expect(within(card).getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  });

  it('keeps six action slots on drafts, disabling visibility and lifecycle controls', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    expect(menuItem(/scarica pdf studenti/i)).toBeTruthy();
    expect(menuItem(/scarica pdf soluzioni/i)).toBeTruthy();
    expect((menuItem(/chiudi verifica/i) as HTMLButtonElement).disabled).toBe(true);
    expect((menuItem(/pubblica allo studente/i) as HTMLButtonElement).disabled).toBe(true);
    expect((menuItem(/elimina verifica/i) as HTMLButtonElement).disabled).toBe(false);
    expect(menuItem(/abilita pdf studente/i)).toBeTruthy();
    const card = screen.getByRole('listitem', { name: /verifica verifica algebra/i });
    expect(within(card).getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  });

  it('shows Riapri instead of Chiudi on closed verifications while keeping six slots', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    expect(menuItem(/scarica pdf studenti/i)).toBeTruthy();
    expect(menuItem(/scarica pdf soluzioni/i)).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /chiudi verifica/i })).toBeNull();
    expect(menuItem(/riapri verifica/i)).toBeTruthy();
    expect(menuItem(/elimina verifica/i)).toBeTruthy();
    const card = screen.getByRole('listitem', { name: /verifica verifica algebra/i });
    expect(within(card).getAllByRole('button')).toHaveLength(3);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
  });

  it('keeps the card delete action visually destructive', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    const deleteIconBtn = menuItem(/elimina verifica/i);
    expect(deleteIconBtn.className).toMatch(/menuDanger/);
  });

  it('the "Elimina definitivamente" destructive confirm button stays red (btn-danger)', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(menuItem(/elimina verifica/i));
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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf soluzioni/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf soluzioni/i));

    await waitFor(() => expect(mockDownloadTeacherSolutionsPdf).toHaveBeenCalled());
  });

  it('allows downloading the student PDF for a closed verification', async () => {
    setupDefaults();
    const cv = closedVer();
    mockListVerifications.mockResolvedValue([cv]);
    const fakeQuestion = { ref: sampleQuestionRef, testo: 'Domanda?', tipo: 'aperta' as const };
    mockLoadSelectedQuestions.mockResolvedValue({ ok: true, questions: [fakeQuestion] });
    render(<VerificationsView />);
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf soluzioni/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf soluzioni/i));

    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('alert').textContent).toMatch(/pool non trovato/i);
  });

  // ─── PDF from embedded teacherSnapshot.questions (immutable snapshot fix) ──

  it('active with embedded snapshot.questions generates the normal PDF with zero Storage reads', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithEmbeddedSnapshot()]);
    render(<VerificationsView />);
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf soluzioni/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));
    await waitFor(() => expect(mockDownloadStudentPdf).toHaveBeenCalled());

    fireEvent.click(menuItem(/scarica pdf soluzioni/i));
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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/scarica pdf studenti/i));

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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/chiudi verifica/i));
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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/chiudi verifica/i));
    await waitFor(() => screen.getByRole('region', { name: /conferma chiusura/i }));
    fireEvent.click(screen.getByRole('button', { name: /annulla/i }));

    expect(screen.queryByRole('region', { name: /conferma chiusura/i })).toBeNull();
    expect(mockCloseVerification).not.toHaveBeenCalled();
  });

  it('calls reopenVerification after an explicit reopen confirmation', async () => {
    setupDefaults();
    const closed = closedVer();
    const reopened = { ...closed, status: 'active' as const, closedAt: null };
    mockListVerifications.mockResolvedValueOnce([closed]).mockResolvedValue([reopened]);
    render(<VerificationsView />);

    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/riapri verifica/i));
    const region = await screen.findByRole('region', { name: /conferma riapertura/i });
    fireEvent.click(within(region).getByRole('button', { name: 'Riapri verifica' }));

    await waitFor(() =>
      expect(mockReopenVerification).toHaveBeenCalledWith('ver-1', 'owner-uid', {}),
    );
    await waitFor(() => expect(menuItem(/chiudi verifica/i)).toBeTruthy());
  });

  it('uses the same separator-free action footer for reopen and delete confirmations', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    render(<VerificationsView />);

    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/riapri verifica/i));
    const reopenRegion = await screen.findByRole('region', { name: /conferma riapertura/i });
    expect(reopenRegion.querySelector('[class*="dialogActions"]')).toBeTruthy();
    fireEvent.click(within(reopenRegion).getByRole('button', { name: 'Annulla' }));

    fireEvent.click(menuItem(/elimina verifica/i));
    const deleteRegion = await screen.findByRole('region', { name: /conferma eliminazione/i });
    expect(deleteRegion.querySelector('[class*="dialogActions"]')).toBeTruthy();
  });

  // ─── Delete (row action, draft or closed) ────────────────────────────────────

  it('delete confirm panel requires explicit confirmation before calling the service', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    render(<VerificationsView />);
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/elimina verifica/i));

    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    expect(within(region).getByText(/irreversibile/i)).toBeTruthy();
    expect(mockDeleteVerification).not.toHaveBeenCalled();
  });

  it('calls deleteVerification when a closed verification delete is confirmed', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValueOnce([closedVer()]).mockResolvedValue([]);
    render(<VerificationsView />);
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/elimina verifica/i));
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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/elimina verifica/i));
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
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/elimina verifica/i));
    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    fireEvent.click(within(region).getByRole('button', { name: /annulla/i }));

    expect(screen.queryByRole('region', { name: /conferma eliminazione/i })).toBeNull();
    expect(mockDeleteVerification).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole('list', { name: 'Archivio verifiche' })).getByText(
        'Verifica Algebra',
      ),
    ).toBeTruthy();
  });

  it('shows a readable error when deleteVerification fails', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([closedVer()]);
    mockDeleteVerification.mockRejectedValue(new Error('Verifica non eliminabile: non è chiusa'));
    render(<VerificationsView />);
    await waitFor(() => actionsTriggers());
    fireEvent.click(menuItem(/elimina verifica/i));
    const region = await screen.findByRole('region', { name: /conferma eliminazione/i });
    fireEvent.click(within(region).getByRole('button', { name: /elimina definitivamente/i }));

    await waitFor(() => expect(within(region).getByRole('alert')).toBeTruthy());
    expect(within(region).getByRole('alert').textContent).toMatch(/non è chiusa/i);
    expect(
      within(screen.getByRole('list', { name: 'Archivio verifiche' })).getByText(
        'Verifica Algebra',
      ),
    ).toBeTruthy();
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
    expect(mockSetVerificationOnlineEnabled).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Dettaglio verifica')).toBeNull();
    expect(screen.queryByText('Attivo')).toBeNull();
    expect(screen.queryByText('Disattivato')).toBeNull();
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
    expect(screen.queryByText('Attivo')).toBeNull();
    expect(screen.queryByText('Disattivato')).toBeNull();
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
    // `deliveryCode` remains in the submission contract/export, but TWU-03A
    // intentionally removes it from this table UI.
    expect(screen.queryByText('SF-2026-A1B2')).toBeNull();
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

  // ── TWU-01 — manual «Aggiorna» button ──────────────────────────────
  async function openMonitor() {
    setupDefaults();
    mockListVerifications.mockResolvedValue([activeVerWithClass()]);
    mockListStudents.mockResolvedValue([approvedStudents[1]]); // Anna only
    mockWatchSubmissions.mockImplementation((_v, _o, _db, onChange) => {
      onChange([]);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(screen.getByText('Anna')).toBeTruthy());
  }

  it('runs a single refresh orchestration on a double click (double-click guard)', async () => {
    await openMonitor();
    const initialProgressCalls = mockLoadCorrectionProgressByStudent.mock.calls.length;
    const initialStudentCalls = mockListStudents.mock.calls.length;
    const initialVisibilityCalls = mockLoadCorrectionReturnVisibilityBySubmission.mock.calls.length;

    const btn = screen.getByRole('button', { name: 'Aggiorna consegne' });
    fireEvent.click(btn);
    fireEvent.click(btn); // second click in the same tick must be ignored

    await waitFor(() => expect(screen.getByText(/Aggiornato alle/)).toBeTruthy());
    // Exactly one extra invocation of each of the three scoped loads.
    expect(mockLoadCorrectionProgressByStudent.mock.calls.length).toBe(initialProgressCalls + 1);
    expect(mockListStudents.mock.calls.length).toBe(initialStudentCalls + 1);
    expect(mockLoadCorrectionReturnVisibilityBySubmission.mock.calls.length).toBe(
      initialVisibilityCalls + 1,
    );
  });

  it('TWU-02A — shows the refresh status inline in the «Consegne online» header (no separate row, aria-live)', async () => {
    await openMonitor();
    screen.getByRole('region', { name: 'Consegne online' });
    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna consegne' }));

    const status = await screen.findByText(/Aggiornato alle \d{2}:\d{2}:\d{2}/);
    // The old standalone "Aggiornato ora" line is gone.
    expect(screen.queryByText('Aggiornato ora')).toBeNull();
    // The status is a polite live region…
    const live = status.closest('[aria-live="polite"]');
    expect(live).not.toBeNull();
    // …and lives in the same header group as the «Consegne online» title.
    const heading = screen.getByRole('heading', { name: 'Consegne online' });
    expect(live!.parentElement).toBe(heading.parentElement);
    // Exactly one status element (no duplicate).
    expect(screen.getAllByText(/Aggiornato alle/)).toHaveLength(1);
  });

  it('preserves selection and sort while refreshing, updating «Valutate» after success', async () => {
    await openMonitor();
    // Refresh delivers fresh progress for Anna.
    mockLoadCorrectionProgressByStudent.mockResolvedValueOnce(
      new Map([['stud-a', { evaluated: 2, total: 2 }]]),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna consegne' }));

    await waitFor(() => expect(screen.getByText(/Aggiornato alle/)).toBeTruthy());
    // The refreshed «Valutate» value is shown; Anna's row is still present.
    expect(screen.getByText('2/2')).toBeTruthy();
    expect(screen.getByText('Anna')).toBeTruthy();
  });

  it('keeps the current data and shows an inline error when the refresh fails', async () => {
    await openMonitor();
    mockLoadCorrectionProgressByStudent.mockRejectedValueOnce(new Error('network'));

    fireEvent.click(screen.getByRole('button', { name: 'Aggiorna consegne' }));

    await waitFor(() => expect(screen.getByText('Aggiornamento non riuscito')).toBeTruthy());
    // Data is preserved — the row is still rendered.
    expect(screen.getByText('Anna')).toBeTruthy();
    // No misleading success text on failure.
    expect(screen.queryByText(/Aggiornato alle/)).toBeNull();
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
    mockLoadCorrectionProgressByStudent.mockResolvedValueOnce(new Map()).mockResolvedValueOnce(
      new Map([
        [
          'stud-a',
          {
            status: 'in_progress',
            evaluated: 1,
            total: 3,
            totalPoints: 2,
            maxPoints: 6,
            percentage: 33,
            hasContent: true,
          },
        ],
      ]),
    );
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
    await waitFor(() => expect(mockLoadCorrectionProgressByStudent).toHaveBeenCalledTimes(2));
    expect(screen.getByText('1/3')).toBeTruthy();

    const monitor = screen.getByLabelText('Consegne online');
    fireEvent.click(
      within(monitor).getByRole('checkbox', { name: 'Seleziona consegna — Anna Bianchi' }),
    );
    fireEvent.click(within(monitor).getByRole('button', { name: 'Azzera' }));
    expect(mockBatchDialog.mock.calls.at(-1)?.[0].rows[0].progress).toMatchObject({
      evaluated: 1,
      hasContent: true,
    });
  });
});

describe('VerificationsView — monitor score and client-side sorting (M4-MON-01)', () => {
  it('shows the compact columns, formats scores and toggles an accessible ordering', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
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
      }),
    ]);
    mockListStudents.mockResolvedValue([
      {
        id: 'stud-a',
        ownerUid: 'owner-uid',
        uid: 'stud-a',
        email: 'anna@example.test',
        displayName: 'Anna',
        status: 'approved',
        classId: 'cls-1',
        createdAt: null,
        updatedAt: null,
        lastLoginAt: null,
      },
      {
        id: 'stud-b',
        ownerUid: 'owner-uid',
        uid: 'stud-b',
        email: 'bruno@example.test',
        displayName: 'Bruno',
        status: 'approved',
        classId: 'cls-1',
        createdAt: null,
        updatedAt: null,
        lastLoginAt: null,
      },
    ]);
    mockWatchSubmissions.mockImplementation((_v, _o, _d, onChange) => {
      onChange([
        {
          studentUid: 'stud-a',
          status: 'submitted',
          submittedAt: { seconds: 20, nanoseconds: 0 },
          deliveryCode: 'SF-A',
          correctionStatus: 'completed',
          correctionSummary: { totalPoints: 8.5, maxPoints: 10, percentage: 85 },
          attentionEventsCount: 2,
          attentionEvents: [],
        },
        {
          studentUid: 'stud-b',
          status: 'submitted',
          submittedAt: { seconds: 10, nanoseconds: 0 },
          deliveryCode: 'SF-B',
          correctionStatus: 'in_progress',
          correctionSummary: { totalPoints: 4, maxPoints: 10, percentage: 40 },
          attentionEventsCount: 0,
          attentionEvents: [],
        },
      ]);
      return vi.fn();
    });

    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    const region = await screen.findByRole('region', { name: 'Consegne online' });
    const table = within(region).getByRole('table');

    expect(within(table).queryByText('Ultimo salvataggio')).toBeNull();
    // M5-03: the score column is replaced by «Valutate» (n/total, sourced from a
    // targeted corrections read — absent here, so "—"); percentage stays separate.
    expect(within(table).getByRole('columnheader', { name: 'Valutate' })).toBeTruthy();
    expect(within(table).getByText('85%')).toBeTruthy();
    expect(within(table).getByText('Corretta')).toBeTruthy();

    const studentHeader = within(table).getByRole('columnheader', { name: /studente/i });
    expect(studentHeader.getAttribute('aria-sort')).toBe('ascending');
    // Cell 0 is the M5-03 selection checkbox; the student name is cell 1.
    const initialNames = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
    expect(initialNames).toEqual(['Anna', 'Bruno']);

    fireEvent.click(
      within(table).getByRole('button', { name: 'Ordina per percentuale crescente' }),
    );
    expect(
      within(table)
        .getByRole('columnheader', { name: /percentuale/i })
        .getAttribute('aria-sort'),
    ).toBe('ascending');
    const pctAscending = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
    expect(pctAscending).toEqual(['Bruno', 'Anna']);

    fireEvent.click(
      within(table).getByRole('button', { name: 'Ordina per percentuale decrescente' }),
    );
    const pctDescending = within(table)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[1]?.textContent);
    expect(pctDescending).toEqual(['Anna', 'Bruno']);
  });
});

describe('VerificationsView — correction register CSV (M4-03A)', () => {
  const selectedVerification = makeDraftVer({
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
  });
  const students = [
    {
      id: 'stud-a',
      uid: 'stud-a',
      ownerUid: 'owner-uid',
      email: 'anna@example.test',
      displayName: 'Anna',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
    {
      id: 'stud-b',
      uid: 'stud-b',
      ownerUid: 'owner-uid',
      email: 'bruno@example.test',
      displayName: 'Bruno',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
  ];
  const submissions = [
    {
      studentUid: 'stud-a',
      status: 'submitted',
      submittedAt: { seconds: 20, nanoseconds: 0 },
      deliveryCode: 'SF-A',
      correctionStatus: 'completed',
      correctionSummary: { totalPoints: 8.5, maxPoints: 10, percentage: 85 },
      attentionEventsCount: 0,
      attentionEvents: [],
    },
    {
      studentUid: 'stud-b',
      status: 'submitted',
      submittedAt: { seconds: 10, nanoseconds: 0 },
      deliveryCode: 'SF-B',
      correctionStatus: 'in_progress',
      correctionSummary: { totalPoints: 4, maxPoints: 10, percentage: 40 },
      attentionEventsCount: 0,
      attentionEvents: [],
    },
  ];

  async function openMonitor(
    onChange: (callback: (items: unknown[]) => void) => void,
    studentRows = students,
  ) {
    setupDefaults();
    mockListVerifications.mockResolvedValue([selectedVerification]);
    mockListStudents.mockResolvedValue(studentRows);
    mockWatchSubmissions.mockImplementation((_v, _o, _d, callback) => {
      onChange(callback);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    return screen.findByRole('region', { name: 'Consegne online' });
  }

  it('keeps export disabled while loading, then enables it for the visible student rows', async () => {
    let deliver!: (items: unknown[]) => void;
    await openMonitor((callback) => {
      deliver = callback;
    });
    const exportButton = screen.getByRole('button', { name: 'Esporta CSV' });
    expect((exportButton as HTMLButtonElement).disabled).toBe(true);
    deliver([]);
    await waitFor(() => expect((exportButton as HTMLButtonElement).disabled).toBe(false));
  });

  it('keeps export disabled when the register has no student rows', async () => {
    await openMonitor(() => {}, []);
    expect(
      (screen.getByRole('button', { name: 'Esporta CSV' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('exports the currently sorted rows without performing new reads or listeners', async () => {
    const region = await openMonitor((callback) => callback(submissions));
    const table = within(region).getByRole('table');
    fireEvent.click(
      within(table).getByRole('button', { name: 'Ordina per percentuale crescente' }),
    );
    const readsBefore = mockListStudents.mock.calls.length;
    const listenersBefore = mockWatchSubmissions.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Esporta CSV' }));

    expect(mockDownloadCorrectionRegisterCsv).toHaveBeenCalledOnce();
    const [csv, filename] = mockDownloadCorrectionRegisterCsv.mock.calls[0] as [string, string];
    expect(csv.indexOf('Bruno;bruno@example.test')).toBeLessThan(
      csv.indexOf('Anna;anna@example.test'),
    );
    expect(filename).toMatch(/^\d{8}-Classe-3A-Verifica-Algebra-registro-correzioni\.csv$/);
    expect(mockListStudents).toHaveBeenCalledTimes(readsBefore);
    expect(mockWatchSubmissions).toHaveBeenCalledTimes(listenersBefore);
  });

  it('shows an export error without breaking the monitor', async () => {
    mockDownloadCorrectionRegisterCsv.mockImplementationOnce(() => {
      throw new Error('download failed');
    });
    const region = await openMonitor((callback) => callback(submissions));
    fireEvent.click(screen.getByRole('button', { name: 'Esporta CSV' }));
    expect((await within(region).findByRole('alert')).textContent).toBe(
      'Impossibile esportare il Registro Correzioni. Riprova.',
    );
    expect(within(region).getByRole('table')).toBeTruthy();
  });

  // ── PDF export (M4-03B) ──────────────────────────────────────────────
  it('keeps Esporta PDF disabled while loading, then enables it for the visible rows', async () => {
    let deliver!: (items: unknown[]) => void;
    await openMonitor((callback) => {
      deliver = callback;
    });
    const pdfButton = screen.getByRole('button', { name: 'Esporta PDF' });
    expect((pdfButton as HTMLButtonElement).disabled).toBe(true);
    deliver([]);
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Esporta PDF' }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it('keeps Esporta PDF disabled when there are no student rows', async () => {
    await openMonitor(() => {}, []);
    expect(
      (screen.getByRole('button', { name: 'Esporta PDF' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('enables Esporta PDF with rows and exports them in the current sort order, no new reads/listeners', async () => {
    mockDownloadCorrectionRegisterPdf.mockResolvedValue(undefined);
    const region = await openMonitor((callback) => callback(submissions));
    const table = within(region).getByRole('table');
    fireEvent.click(
      within(table).getByRole('button', { name: 'Ordina per percentuale crescente' }),
    );
    const readsBefore = mockListStudents.mock.calls.length;
    const listenersBefore = mockWatchSubmissions.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Esporta PDF' }));

    await waitFor(() => expect(mockDownloadCorrectionRegisterPdf).toHaveBeenCalledOnce());
    const [params] = mockDownloadCorrectionRegisterPdf.mock.calls[0] as [
      { rows: { studentName: string }[]; verificationTitle: string; className: string | null },
    ];
    // Rows are the sorted rows: Bruno before Anna after the ascending-score sort.
    const names = params.rows.map((r) => r.studentName);
    expect(names.indexOf('Bruno')).toBeLessThan(names.indexOf('Anna'));
    expect(params.verificationTitle).toBe('Verifica Algebra');
    expect(mockListStudents).toHaveBeenCalledTimes(readsBefore);
    expect(mockWatchSubmissions).toHaveBeenCalledTimes(listenersBefore);
  });

  it('prevents a double click from generating the PDF twice', async () => {
    let resolve: () => void = () => {};
    mockDownloadCorrectionRegisterPdf.mockImplementation(
      () => new Promise<void>((r) => (resolve = r)),
    );
    await openMonitor((callback) => callback(submissions));
    const pdfButton = screen.getByRole('button', { name: /Esporta PDF|Generazione/ });
    fireEvent.click(pdfButton);
    fireEvent.click(pdfButton);
    resolve();
    await waitFor(() => expect(mockDownloadCorrectionRegisterPdf).toHaveBeenCalledOnce());
  });

  it('shows a PDF error without breaking the monitor; CSV still works', async () => {
    mockDownloadCorrectionRegisterPdf.mockRejectedValueOnce(new Error('pdf failed'));
    const region = await openMonitor((callback) => callback(submissions));
    fireEvent.click(screen.getByRole('button', { name: 'Esporta PDF' }));
    expect((await within(region).findByRole('alert')).textContent).toBe(
      'Impossibile generare il PDF del riepilogo. Riprova.',
    );
    expect(within(region).getByRole('table')).toBeTruthy();
    // CSV export still works after a PDF failure.
    fireEvent.click(screen.getByRole('button', { name: 'Esporta CSV' }));
    expect(mockDownloadCorrectionRegisterCsv).toHaveBeenCalledOnce();
  });

  it('shows explicit stale-chunk recovery for the correction register without auto reload', async () => {
    mockDownloadCorrectionRegisterPdf.mockRejectedValueOnce(new PdfModuleLoadError('stale_chunk'));
    const region = await openMonitor((callback) => callback(submissions));
    fireEvent.click(screen.getByRole('button', { name: 'Esporta PDF' }));
    expect(
      await within(region).findByText(
        'SchoolForge è stato aggiornato. Ricarica la pagina e riprova.',
      ),
    ).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Ricarica pagina' })).toBeTruthy();
  });
});

describe('VerificationsView — delete submission (M4-LIFE-02)', () => {
  const submittedItem = {
    studentUid: 'stud-a',
    status: 'submitted',
    lastSavedAt: null,
    submittedAt: null,
    deliveryCode: 'SF-1',
    correctionStatus: 'to_correct',
    attentionEventsCount: 0,
    attentionEvents: [],
  };

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

  function verWithStatus(status: 'active' | 'closed') {
    return makeDraftVer({
      status,
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
    });
  }

  async function renderMonitor(status: 'active' | 'closed', items: unknown[]) {
    mockListVerifications.mockResolvedValue([verWithStatus(status)]);
    mockListStudents.mockResolvedValue(oneApprovedStudent);
    mockWatchSubmissions.mockImplementation((_v, _o, _d, onChange) => {
      onChange(items);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(screen.getByLabelText('Consegne online')).toBeTruthy());
  }

  const returnedItem = { ...submittedItem, correctionStatus: 'returned' };

  it('offers delete for an eligible submission while the verification is still active (M5-06B)', async () => {
    setupDefaults();
    await renderMonitor('active', [submittedItem]);
    expect(screen.getByLabelText('Elimina consegna — Anna Bianchi')).toBeTruthy();
  });

  it('offers delete for an existing submission once the verification is closed', async () => {
    setupDefaults();
    await renderMonitor('closed', [submittedItem]);
    expect(screen.getByLabelText('Elimina consegna — Anna Bianchi')).toBeTruthy();
  });

  it('does NOT offer an actionable delete for a returned submission (disabled, explained)', async () => {
    setupDefaults();
    await renderMonitor('active', [returnedItem]);
    // No enabled "Elimina consegna" affordance…
    expect(screen.queryByLabelText('Elimina consegna — Anna Bianchi')).toBeNull();
    // …but a disabled trash with an accessible explanation keeps the column stable.
    const disabled = screen.getByLabelText(
      'Consegna non eliminabile (correzione restituita) — Anna Bianchi',
    ) as HTMLButtonElement;
    expect(disabled.disabled).toBe(true);
  });

  it('requires explicit confirmation listing everything that will be removed', async () => {
    setupDefaults();
    await renderMonitor('closed', [submittedItem]);
    fireEvent.click(screen.getByLabelText('Elimina consegna — Anna Bianchi'));

    expect(
      screen.getByRole('alertdialog', { name: /conferma eliminazione consegna/i }),
    ).toBeTruthy();
    expect(
      screen.getByText(/consegna, le risposte, la correzione e lo storico della correzione/i),
    ).toBeTruthy();
    expect(mockDeleteSubmissionData).not.toHaveBeenCalled();
  });

  it('explains that a prior hidden return is deleted after a true reopen', async () => {
    setupDefaults();
    await renderMonitor('closed', [{ ...submittedItem, correctionStatus: 'in_progress' }]);
    fireEvent.click(screen.getByLabelText('Elimina consegna — Anna Bianchi'));
    expect(screen.getByText(/precedente restituzione ora nascosta allo studente/i)).toBeTruthy();
  });

  it('explains that the student can re-attempt when the verification is active', async () => {
    setupDefaults();
    await renderMonitor('active', [submittedItem]);
    fireEvent.click(screen.getByLabelText('Elimina consegna — Anna Bianchi'));
    expect(
      screen.getByText(/potrà svolgerla di nuovo finché resta online e visibile/i),
    ).toBeTruthy();
  });

  it('explains that a closed verification stays closed', async () => {
    setupDefaults();
    await renderMonitor('closed', [submittedItem]);
    fireEvent.click(screen.getByLabelText('Elimina consegna — Anna Bianchi'));
    expect(screen.getByText(/la verifica resterà chiusa/i)).toBeTruthy();
  });

  it('a double click on confirm triggers exactly one deletion', async () => {
    setupDefaults();
    let resolve: () => void = () => {};
    mockDeleteSubmissionData.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    await renderMonitor('closed', [submittedItem]);
    fireEvent.click(screen.getByLabelText('Elimina consegna — Anna Bianchi'));

    const confirm = screen.getByRole('button', { name: 'Elimina consegna' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    resolve();

    await waitFor(() => expect(mockDeleteSubmissionData).toHaveBeenCalledTimes(1));
    expect(mockDeleteSubmissionData).toHaveBeenCalledWith('ver-1_stud-a', 'owner-uid', {});
  });

  it('on success removes the submission row data (delete + correction actions gone)', async () => {
    setupDefaults();
    mockDeleteSubmissionData.mockResolvedValue(undefined);
    await renderMonitor('closed', [submittedItem]);
    fireEvent.click(screen.getByLabelText('Elimina consegna — Anna Bianchi'));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina consegna' }));

    await waitFor(() =>
      expect(screen.queryByLabelText('Elimina consegna — Anna Bianchi')).toBeNull(),
    );
    expect(screen.queryByLabelText('Apri correzione — Anna Bianchi')).toBeNull();
  });

  it('on error keeps the row and shows a readable message', async () => {
    setupDefaults();
    mockDeleteSubmissionData.mockRejectedValue(new Error('Rete non disponibile'));
    await renderMonitor('closed', [submittedItem]);
    fireEvent.click(screen.getByLabelText('Elimina consegna — Anna Bianchi'));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina consegna' }));

    await waitFor(() => expect(screen.getByText(/rete non disponibile/i)).toBeTruthy());
    // Dialog still open, row still deletable after closing the dialog.
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    expect(screen.getByLabelText('Elimina consegna — Anna Bianchi')).toBeTruthy();
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
      .map((button) => button.getAttribute('aria-label')?.replace('Apri dettaglio verifica ', ''));
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

    // L'etichetta «Anno» non esiste più: l'anno vive nella riga di metadati e,
    // quando assente, viene semplicemente omesso (nessun `·` isolato).
    const list = screen.getByRole('list', { name: 'Archivio verifiche' });
    expect(within(list).queryByText('Anno')).toBeNull();
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
    fireEvent.click(menuItem(/Abilita PDF studente/i));
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
    expect(
      within(screen.getByRole('list', { name: 'Archivio verifiche' })).queryByText(/2025\/2026/),
    ).toBeNull();

    // A later list update re-runs the effect; the freed key is retried.
    fireEvent.click(menuItem(/Abilita PDF studente/i, 0));
    await waitFor(() => expect(mockSetVerificationStudentPdfEnabled).toHaveBeenCalled());
    await waitFor(() => expect(mockGetImportMeta).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'Archivio verifiche' })).getByText(/2025\/2026/),
      ).toBeTruthy(),
    );
  });

  // ── TWU-02A — filter-bar layout of «Impostazioni correzione IA» ──────
  it('keeps creation and AI settings in the filter toolbar after archive filters', async () => {
    setupDefaults();
    mockGetImportMeta.mockResolvedValue({ annoScolastico: '2025/2026' });
    mockListVerifications.mockResolvedValue([verWith('v1', 'Alfa', 'imp-1', 'cls-1')]);
    render(<VerificationsView />);
    await screen.findByText('Alfa');

    const toolbar = screen.getByLabelText('Filtri archivio verifiche');
    const anno = within(toolbar).getByLabelText('Filtro anno scolastico');
    const classe = within(toolbar).getByLabelText('Filtro classe');
    const cerca = within(toolbar).getByLabelText('Cerca verifica');
    const create = within(toolbar).getByRole('button', { name: 'Nuova verifica' });
    const settings = within(toolbar).getByRole('button', { name: /Impostazioni correzione IA/ });

    for (const el of [anno, classe, cerca, create, settings]) {
      expect(el.closest(`[aria-label="Filtri archivio verifiche"]`)).toBe(toolbar);
    }
    const order = [anno, classe, cerca, create, settings];
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  it('renders the AI-settings action once, with its icon and accessible name, and opens the dialog', async () => {
    setupDefaults();
    mockGetImportMeta.mockResolvedValue({ annoScolastico: '2025/2026' });
    mockListVerifications.mockResolvedValue([verWith('v1', 'Alfa', 'imp-1', 'cls-1')]);
    render(<VerificationsView />);
    await screen.findByText('Alfa');

    const buttons = screen.getAllByRole('button', { name: /Impostazioni correzione IA/ });
    expect(buttons).toHaveLength(1); // no duplicate
    const button = buttons[0]!;
    // Primary-action styling reused from «Nuovo corso» (btn-primary) + a decorative SVG icon.
    expect(button.className).toContain('btn-primary');
    expect(button.querySelector('svg')).not.toBeNull();

    fireEvent.click(button);
    // No functional regression: the settings dialog opens.
    expect(await screen.findByRole('heading', { name: /Impostazioni correzione IA/ })).toBeTruthy();
  });
});

describe('VerificationsView — batch AI selection & «Correggi con IA» (M5-03)', () => {
  const activeVer = () =>
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
    });

  const twoApproved = [
    {
      id: 'stud-a',
      ownerUid: 'owner-uid',
      uid: 'stud-a',
      email: 'anna@example.test',
      displayName: 'Anna',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
    {
      id: 'stud-b',
      ownerUid: 'owner-uid',
      uid: 'stud-b',
      email: 'bruno@example.test',
      displayName: 'Bruno',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
  ];

  const twoSubmissions = [
    {
      studentUid: 'stud-a',
      status: 'submitted',
      submittedAt: { seconds: 20, nanoseconds: 0 },
      deliveryCode: 'SF-A',
      correctionStatus: 'in_progress',
      correctionSummary: { totalPoints: 8.5, maxPoints: 10, percentage: 85 },
      attentionEventsCount: 0,
      attentionEvents: [],
    },
    {
      studentUid: 'stud-b',
      status: 'draft',
      submittedAt: null,
      deliveryCode: null,
      attentionEventsCount: 0,
      attentionEvents: [],
    },
  ];

  async function openWith(items: unknown[], progress?: Map<string, unknown>) {
    mockListVerifications.mockResolvedValue([activeVer()]);
    mockListStudents.mockResolvedValue(twoApproved);
    if (progress) mockLoadCorrectionProgressByStudent.mockResolvedValue(progress as never);
    mockWatchSubmissions.mockImplementation((_v, _o, _d, onChange) => {
      onChange(items);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    return screen.findByRole('region', { name: 'Consegne online' });
  }

  it('disables «Correzione IA» until a row is selected and there is no per-row AI button', async () => {
    setupDefaults();
    const region = await openWith(twoSubmissions);
    const button = within(region).getByRole('button', { name: 'Correzione IA' });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // No per-row AI button.
    expect(within(region).queryByRole('button', { name: /Correggi con IA — /i })).toBeNull();

    const annaBox = within(region).getByRole('checkbox', {
      name: 'Seleziona consegna — Anna',
    }) as HTMLInputElement;
    fireEvent.click(annaBox);
    expect(annaBox.checked).toBe(true);
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('uses a compact semantic selection column and keeps the Actions column rendered', async () => {
    setupDefaults();
    const region = await openWith(twoSubmissions);
    const table = within(region).getByRole('table');
    const selectAll = within(table).getByRole('checkbox', {
      name: 'Seleziona tutte le consegne',
    });
    const annaBox = within(table).getByRole('checkbox', {
      name: 'Seleziona consegna — Anna',
    });

    expect(selectAll.closest('th')?.className).toMatch(/selectionHeader/);
    expect(annaBox.closest('td')?.className).toMatch(/selectionCell/);
    expect(table.querySelector('colgroup col')?.className).toMatch(/selectionColumn/);
    expect(table.parentElement?.className).toMatch(/submissionsTableWrap/);
    expect(within(table).getByRole('columnheader', { name: 'Azioni' })).toBeTruthy();
    expect(within(table).getByRole('button', { name: 'Apri correzione — Anna' })).toBeTruthy();
  });

  it.each([
    [true, true, 'Restituzione visibile allo studente', 'Soluzioni visibili allo studente'],
    [true, false, 'Restituzione visibile allo studente', 'Soluzioni nascoste allo studente'],
    [false, true, 'Restituzione nascosta allo studente', 'Soluzioni visibili allo studente'],
    [false, false, 'Restituzione nascosta allo studente', 'Soluzioni nascoste allo studente'],
  ] as const)(
    'shows return visibility icons for flags %s/%s',
    async (visibleToStudent, solutionsVisible, returnLabel, solutionsLabel) => {
      setupDefaults();
      mockLoadCorrectionReturnVisibilityBySubmission.mockResolvedValueOnce(
        new Map([
          [
            'ver-1_stud-a',
            {
              submissionId: 'ver-1_stud-a',
              studentUid: 'stud-a',
              visibleToStudent,
              solutionsVisible,
            },
          ],
        ]),
      );
      const region = await openWith(
        twoSubmissions,
        new Map([
          [
            'stud-a',
            {
              status: 'returned',
              evaluated: 1,
              total: 1,
              totalPoints: 2,
              maxPoints: 2,
              percentage: 100,
              hasContent: true,
            },
          ],
        ]),
      );
      const table = within(region).getByRole('table');
      expect(within(table).queryByRole('columnheader', { name: 'Codice' })).toBeNull();
      expect(within(table).getByRole('columnheader', { name: 'Visibilità' })).toBeTruthy();
      expect(
        within(table)
          .getAllByRole('columnheader')
          .slice(-4)
          .map((header) => header.textContent?.trim()),
      ).toEqual(['Consegna', 'Visibilità', 'Eventi', 'Azioni']);
      expect(within(table).queryByText('SF-A')).toBeNull();
      const annaRow = within(table).getByText('Anna').closest('tr')!;
      expect(within(annaRow).getByLabelText(returnLabel)).toBeTruthy();
      expect(within(annaRow).getByLabelText(solutionsLabel)).toBeTruthy();
    },
  );

  it('shows an accessible dash when the correction is not currently returned', async () => {
    setupDefaults();
    mockLoadCorrectionReturnVisibilityBySubmission.mockResolvedValueOnce(
      new Map([
        [
          'ver-1_stud-a',
          {
            submissionId: 'ver-1_stud-a',
            studentUid: 'stud-a',
            visibleToStudent: true,
            solutionsVisible: true,
          },
        ],
      ]),
    );
    const region = await openWith(
      twoSubmissions,
      new Map([
        [
          'stud-a',
          {
            status: 'in_progress',
            evaluated: 0,
            total: 1,
            totalPoints: 0,
            maxPoints: 2,
            percentage: 0,
            hasContent: false,
          },
        ],
      ]),
    );
    const annaRow = within(region).getByText('Anna').closest('tr')!;
    expect(within(annaRow).getByLabelText('Visibilità non disponibile').textContent).toBe('—');
  });

  /*
   * FORCE-SUBMIT-02 — è selezionabile ogni riga con una consegna reale, anche in
   * bozza: «Chiudi consegne» agisce proprio sulle bozze. «Correggi con IA»
   * continua però a contare le sole consegne effettuate.
   */
  it('una bozza è selezionabile, ma la correzione IA conta solo le consegne effettuate', async () => {
    setupDefaults();
    const region = await openWith(twoSubmissions);
    const brunoBox = within(region).getByRole('checkbox', {
      name: 'Seleziona consegna — Bruno',
    }) as HTMLInputElement;
    expect(brunoBox.disabled).toBe(false);

    const selectAll = within(region).getByRole('checkbox', {
      name: 'Seleziona tutte le consegne',
    }) as HTMLInputElement;
    fireEvent.click(selectAll);
    expect(selectAll.checked).toBe(true);
    expect(
      (
        within(region).getByRole('checkbox', {
          name: 'Seleziona consegna — Anna',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    expect(brunoBox.checked).toBe(true);
    // Anna è l'unica consegnata: la correzione IA resta su di lei soltanto.
    expect(
      (within(region).getByRole('button', { name: 'Correzione IA' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('una riga «Non iniziata» resta non selezionabile', async () => {
    setupDefaults();
    // Solo Anna ha iniziato: Bruno non ha alcuna consegna.
    const region = await openWith([twoSubmissions[0]!]);
    expect(
      (
        within(region).getByRole('checkbox', {
          name: 'Seleziona consegna — Bruno',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
  });

  it('keeps the selection stable (by id) across a re-sort', async () => {
    setupDefaults();
    // Two submitted rows so both are selectable and sortable.
    const bothSubmitted = [
      twoSubmissions[0],
      {
        ...twoSubmissions[1],
        status: 'submitted',
        submittedAt: { seconds: 10, nanoseconds: 0 },
        deliveryCode: 'SF-B',
        correctionStatus: 'in_progress',
        correctionSummary: { totalPoints: 4, maxPoints: 10, percentage: 40 },
      },
    ];
    const region = await openWith(bothSubmitted);
    const table = within(region).getByRole('table');
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    fireEvent.click(
      within(table).getByRole('button', { name: 'Ordina per percentuale crescente' }),
    );
    // Anna is still the only selected row after re-sorting.
    expect(
      (within(region).getByRole('button', { name: 'Correzione IA' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    const annaBox = within(region).getByRole('checkbox', {
      name: 'Seleziona consegna — Anna',
    }) as HTMLInputElement;
    expect(annaBox.checked).toBe(true);
  });

  it('opens the dialog with the deterministic submissionIds of the selection', async () => {
    setupDefaults();
    const region = await openWith(twoSubmissions);
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Correzione IA' }));
    const dialog = await screen.findByTestId('ai-batch-dialog');
    expect(within(dialog).getByText('IDs: ver-1_stud-a')).toBeTruthy();
  });

  it('TWU-02 — a preferences LOAD ERROR blocks «Correggi con IA» (no silent default) and «Riprova» recovers', async () => {
    setupDefaults();
    // The first (auto) load fails; the retry resolves to the defaults.
    mockLoadTeacherAiPreferences.mockRejectedValueOnce(new Error('permission-denied'));
    const region = await openWith(twoSubmissions);

    // Persistent accessible error message is shown.
    expect(
      await within(region).findByText('Impossibile caricare le impostazioni IA. Riprova.'),
    ).toBeTruthy();

    // Even with a row selected, the AI action stays disabled (never runs on defaults).
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    const aiButton = within(region).getByRole('button', {
      name: 'Correzione IA',
    }) as HTMLButtonElement;
    expect(aiButton.disabled).toBe(true);
    expect(screen.queryByTestId('ai-batch-dialog')).toBeNull();

    // A single explicit retry re-loads; on success the action becomes available.
    fireEvent.click(within(region).getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(aiButton.disabled).toBe(false));
    expect(mockLoadTeacherAiPreferences).toHaveBeenCalledTimes(2);
  });

  it('renders «Valutate» as n/total from the targeted read, and «—» when absent', async () => {
    setupDefaults();
    const region = await openWith(
      twoSubmissions,
      new Map([['stud-a', { evaluated: 2, total: 3 }]]),
    );
    const table = within(region).getByRole('table');
    await waitFor(() => expect(within(table).getByText('2/3')).toBeTruthy());
    // Bruno has no correction doc → "—".
    expect(within(table).getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('VerificationsView — batch actions Completa/Riapri/Restituisci/Azzera (M5-04)', () => {
  const activeVer = () =>
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
    });

  const twoApproved = [
    {
      id: 'stud-a',
      ownerUid: 'owner-uid',
      uid: 'stud-a',
      email: 'anna@example.test',
      displayName: 'Anna',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
    {
      id: 'stud-b',
      ownerUid: 'owner-uid',
      uid: 'stud-b',
      email: 'bruno@example.test',
      displayName: 'Bruno',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
  ];

  const bothSubmitted = [
    {
      studentUid: 'stud-a',
      status: 'submitted',
      submittedAt: { seconds: 20, nanoseconds: 0 },
      deliveryCode: 'SF-A',
      correctionStatus: 'in_progress',
      correctionSummary: { totalPoints: 8.5, maxPoints: 10, percentage: 85 },
      attentionEventsCount: 0,
      attentionEvents: [],
    },
    {
      studentUid: 'stud-b',
      status: 'submitted',
      submittedAt: { seconds: 10, nanoseconds: 0 },
      deliveryCode: 'SF-B',
      correctionStatus: 'in_progress',
      correctionSummary: { totalPoints: 4, maxPoints: 10, percentage: 40 },
      attentionEventsCount: 0,
      attentionEvents: [],
    },
  ];

  async function openWith(progress?: Map<string, unknown>) {
    mockListVerifications.mockResolvedValue([activeVer()]);
    mockListStudents.mockResolvedValue(twoApproved);
    if (progress) mockLoadCorrectionProgressByStudent.mockResolvedValue(progress as never);
    mockWatchSubmissions.mockImplementation((_v, _o, _d, onChange) => {
      onChange(bothSubmitted);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    return screen.findByRole('region', { name: 'Consegne online' });
  }

  it('disables batch buttons until a row is selected, with no per-row buttons', async () => {
    setupDefaults();
    const region = await openWith();
    for (const name of [
      'Completa',
      'Riapri',
      'Restituisci',
      'Azzera',
      'Visibilità',
      'PDF correzioni',
    ]) {
      const btn = within(region).getByRole('button', { name }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    }
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    for (const name of [
      'Completa',
      'Riapri',
      'Restituisci',
      'Azzera',
      'Visibilità',
      'PDF correzioni',
    ]) {
      const btn = within(region).getByRole('button', { name }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    }
    // No per-row batch buttons.
    const rows = within(within(region).getByRole('table')).getAllByRole('row').slice(1);
    for (const r of rows) {
      expect(within(r).queryByRole('button', { name: 'Completa' })).toBeNull();
      expect(within(r).queryByRole('button', { name: /Azzera correzione/ })).toBeNull();
    }
  });

  it('renders the exact batch action order and only Azzera as destructive', async () => {
    setupDefaults();
    const region = await openWith();
    const toolbar = within(region).getByRole('group', {
      name: 'Azioni sulle consegne selezionate',
    });
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Correzione IA',
      'Completa',
      'Restituisci',
      'Visibilità',
      'PDF correzioni',
      'Riapri',
      'Azzera',
      'Chiudi consegne',
    ]);
    // Azzera resta l'unica azione distruttiva; «Chiudi consegne» è warning.
    expect(buttons.filter((button) => button.classList.contains('btn-danger'))).toEqual([
      buttons[6],
    ]);
    expect(buttons[7]!.className).toMatch(/btn-warning/);
  });

  it('exports one completed selection directly and preserves its checkbox', async () => {
    setupDefaults();
    const region = await openWith(
      new Map([
        [
          'stud-a',
          {
            status: 'completed',
            evaluated: 1,
            total: 1,
            totalPoints: 2,
            maxPoints: 2,
            percentage: 100,
          },
        ],
      ]),
    );
    const checkbox = within(region).getByRole('checkbox', {
      name: 'Seleziona consegna — Anna',
    }) as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(within(region).getByRole('button', { name: 'PDF correzioni' }));
    await waitFor(() => expect(mockRunCorrectionArchiveExport).toHaveBeenCalledTimes(1));
    expect(checkbox.checked).toBe(true);
    expect(screen.queryByRole('dialog', { name: 'PDF correzioni' })).toBeNull();
  });

  it('shows compact ZIP confirmation for multiple completed selections', async () => {
    setupDefaults();
    const progress = new Map(
      ['stud-a', 'stud-b'].map((uid) => [
        uid,
        {
          status: 'returned',
          evaluated: 1,
          total: 1,
          totalPoints: 2,
          maxPoints: 2,
          percentage: 100,
        },
      ]),
    );
    const region = await openWith(progress);
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona tutte le consegne' }));
    fireEvent.click(within(region).getByRole('button', { name: 'PDF correzioni' }));
    expect(await screen.findByText('Verrà creato uno ZIP con 2 PDF separati.')).toBeTruthy();
    expect(mockRunCorrectionArchiveExport).not.toHaveBeenCalled();
  });

  it('opens the dialog with the selected rows and the chosen action', async () => {
    setupDefaults();
    const region = await openWith();
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Restituisci' }));
    const dialog = await screen.findByTestId('batch-actions-dialog');
    expect(within(dialog).getByText('action: return')).toBeTruthy();
    expect(within(dialog).getByText('rows: stud-a')).toBeTruthy();
    for (const name of [
      'Correzione IA',
      'Completa',
      'Riapri',
      'Restituisci',
      'Azzera',
      'Visibilità',
      'PDF correzioni',
    ]) {
      expect(
        (within(region).getByRole('button', { name: new RegExp(`^${name}`) }) as HTMLButtonElement)
          .disabled,
      ).toBe(true);
    }
  });

  it('opens the visibility menu and preserves selection when its dialog closes', async () => {
    setupDefaults();
    const region = await openWith();
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona tutte le consegne' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Visibilità' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mostra soluzioni' }));

    const dialog = await screen.findByTestId('batch-visibility-dialog');
    expect(within(dialog).getByText('visibility action: show_solutions')).toBeTruthy();
    expect(within(dialog).getByText('visibility rows: stud-a,stud-b')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Chiudi visibilità' }));

    for (const name of ['Anna', 'Bruno']) {
      expect(
        (
          within(region).getByRole('checkbox', {
            name: `Seleziona consegna — ${name}`,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
    }
  });

  it('updates succeeded/noop visibility locally, ignores failures and performs no final read', async () => {
    setupDefaults();
    const returnedProgress = {
      status: 'returned' as const,
      evaluated: 1,
      total: 1,
      totalPoints: 2,
      maxPoints: 2,
      percentage: 100,
      hasContent: true,
    };
    mockLoadCorrectionReturnVisibilityBySubmission.mockResolvedValueOnce(
      new Map([
        [
          'ver-1_stud-a',
          {
            submissionId: 'ver-1_stud-a',
            studentUid: 'stud-a',
            visibleToStudent: false,
            solutionsVisible: false,
          },
        ],
        [
          'ver-1_stud-b',
          {
            submissionId: 'ver-1_stud-b',
            studentUid: 'stud-b',
            visibleToStudent: false,
            solutionsVisible: false,
          },
        ],
      ]),
    );
    const region = await openWith(
      new Map([
        ['stud-a', returnedProgress],
        ['stud-b', returnedProgress],
      ]),
    );
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona tutte le consegne' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Visibilità' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mostra soluzioni' }));
    const dialog = await screen.findByTestId('batch-visibility-dialog');
    const readsBefore = mockLoadCorrectionReturnVisibilityBySubmission.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Applica visibilità' }));

    for (const name of ['Anna', 'Bruno']) {
      const row = within(region).getByText(name).closest('tr')!;
      expect(within(row).getByLabelText('Restituzione visibile allo studente')).toBeTruthy();
      expect(within(row).getByLabelText('Soluzioni visibili allo studente')).toBeTruthy();
      expect(
        (
          within(row).getByRole('checkbox', {
            name: `Seleziona consegna — ${name}`,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
    }
    expect(mockLoadCorrectionReturnVisibilityBySubmission).toHaveBeenCalledTimes(readsBefore);

    const props = mockVisibilityDialog.mock.calls.at(-1)?.[0];
    props.onApplied('show_return', [
      {
        studentUid: 'stud-a',
        submissionId: 'ver-1_stud-a',
        outcome: 'failed',
        error: 'failed',
      },
    ]);
    const annaRow = within(region).getByText('Anna').closest('tr')!;
    expect(within(annaRow).getByLabelText('Restituzione visibile allo studente')).toBeTruthy();
  });

  it('M5-04A: keeps the full selection after applying and performs one targeted re-read', async () => {
    setupDefaults();
    const region = await openWith();
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona tutte le consegne' }));
    expect(
      (within(region).getByRole('button', { name: 'Correzione IA' }) as HTMLButtonElement).disabled,
    ).toBe(false);

    const readsBefore = mockLoadCorrectionProgressByStudent.mock.calls.length;
    fireEvent.click(within(region).getByRole('button', { name: 'Azzera' }));
    const dialog = await screen.findByTestId('batch-actions-dialog');
    expect(within(dialog).getByText('action: clear')).toBeTruthy();
    fireEvent.click(within(dialog).getByText('Applica'));

    // Exactly one extra targeted re-read after the batch (no reload/polling).
    await waitFor(() =>
      expect(mockLoadCorrectionProgressByStudent.mock.calls.length).toBe(readsBefore + 1),
    );
    // Selection is unchanged: both rows stay selected (persistent selection).
    for (const name of ['Anna', 'Bruno']) {
      const box = within(region).getByRole('checkbox', {
        name: `Seleziona consegna — ${name}`,
      }) as HTMLInputElement;
      expect(box.checked).toBe(true);
    }
  });

  it('M5-04A: keeps the selection when the dialog is dismissed without applying', async () => {
    setupDefaults();
    const region = await openWith();
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona tutte le consegne' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Riapri' }));
    const dialog = await screen.findByTestId('batch-actions-dialog');
    fireEvent.click(within(dialog).getByText('Chiudi azioni'));
    // Selection untouched.
    expect(
      (within(region).getByRole('button', { name: 'Correzione IA' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('M5-04A: manual selection and deselection still work', async () => {
    setupDefaults();
    const region = await openWith();
    const anna = within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' });
    fireEvent.click(anna);
    expect(
      (within(region).getByRole('button', { name: 'Correzione IA' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(anna);
    // Back to no selection → the stable label remains and the actions disable.
    expect(
      (within(region).getByRole('button', { name: 'Correzione IA' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (within(region).getByRole('button', { name: 'Completa' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('M5-04A: all toolbar buttons render an icon before their accessible label', async () => {
    setupDefaults();
    const region = await openWith();
    for (const name of [
      'Correzione IA',
      'Completa',
      'Riapri',
      'Restituisci',
      'Azzera',
      'Visibilità',
      'PDF correzioni',
    ]) {
      const btn = within(region).getByRole('button', { name: new RegExp(`^${name}`) });
      // Decorative inline SVG icon rendered inside the button.
      expect(btn.querySelector('svg')).not.toBeNull();
    }
  });

  it('updates return visibility locally only for succeeded rows and preserves selection', async () => {
    setupDefaults();
    const completed = {
      status: 'completed' as const,
      evaluated: 1,
      total: 1,
      totalPoints: 2,
      maxPoints: 2,
      percentage: 100,
      hasContent: true,
    };
    const region = await openWith(
      new Map([
        ['stud-a', completed],
        ['stud-b', completed],
      ]),
    );
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona tutte le consegne' }));
    mockLoadCorrectionProgressByStudent.mockResolvedValue(
      new Map([
        ['stud-a', { ...completed, status: 'returned' }],
        ['stud-b', { ...completed, status: 'returned' }],
      ]),
    );

    fireEvent.click(within(region).getByRole('button', { name: 'Restituisci' }));
    fireEvent.click(within(await screen.findByTestId('batch-actions-dialog')).getByText('Applica'));

    const annaRow = within(region).getByText('Anna').closest('tr')!;
    const brunoRow = within(region).getByText('Bruno').closest('tr')!;
    await waitFor(() =>
      expect(within(annaRow).getByLabelText('Restituzione visibile allo studente')).toBeTruthy(),
    );
    expect(within(annaRow).getByLabelText('Soluzioni visibili allo studente')).toBeTruthy();
    expect(within(brunoRow).getByLabelText('Visibilità non disponibile')).toBeTruthy();
    for (const name of ['Anna', 'Bruno']) {
      expect(
        (
          within(region).getByRole('checkbox', {
            name: `Seleziona consegna — ${name}`,
          }) as HTMLInputElement
        ).checked,
      ).toBe(true);
    }
  });
});

describe('VerificationsView — Azzera correzione (M5-04C)', () => {
  const activeVer = () =>
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
    });

  const approved = [
    {
      id: 'stud-a',
      ownerUid: 'owner-uid',
      uid: 'stud-a',
      email: 'anna@example.test',
      displayName: 'Anna',
      status: 'approved' as const,
      classId: 'cls-1',
      createdAt: null,
      updatedAt: null,
      lastLoginAt: null,
    },
  ];

  function submissions(correctionStatus: string) {
    return [
      {
        studentUid: 'stud-a',
        status: 'submitted',
        submittedAt: { seconds: 20, nanoseconds: 0 },
        deliveryCode: 'SF-A',
        correctionStatus,
        correctionSummary: { totalPoints: 6, maxPoints: 10, percentage: 60 },
        attentionEventsCount: 0,
        attentionEvents: [],
      },
    ];
  }

  async function openWith(items: unknown[], progress: Map<string, unknown>) {
    mockListVerifications.mockResolvedValue([activeVer()]);
    mockListStudents.mockResolvedValue(approved);
    mockLoadCorrectionProgressByStudent.mockResolvedValue(progress as never);
    mockWatchSubmissions.mockImplementation((_v, _o, _d, onChange) => {
      onChange(items);
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    return screen.findByRole('region', { name: 'Consegne online' });
  }

  const clearableProgress = new Map<string, unknown>([
    [
      'stud-a',
      {
        status: 'in_progress',
        evaluated: 2,
        total: 3,
        totalPoints: 6,
        maxPoints: 10,
        percentage: 60,
        hasContent: true,
      },
    ],
  ]);

  it('moves the eraser from the row to the batch toolbar', async () => {
    setupDefaults();
    const region = await openWith(submissions('in_progress'), clearableProgress);
    expect(within(region).queryByRole('button', { name: 'Azzera correzione — Anna' })).toBeNull();
    const eraser = within(region).getByRole('button', { name: 'Azzera' });
    expect((eraser as HTMLButtonElement).disabled).toBe(true);
    expect(eraser.className).toContain('btn-danger');
    expect(eraser.querySelector('svg [fill="#fb7185"]')).not.toBeNull();
    expect(eraser.querySelector('svg [fill="#60a5fa"]')).not.toBeNull();
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    expect((eraser as HTMLButtonElement).disabled).toBe(false);
  });

  it('passes an empty selected correction to the shared dialog for a readable exclusion', async () => {
    setupDefaults();
    const emptyProgress = new Map<string, unknown>([
      [
        'stud-a',
        {
          status: 'in_progress',
          evaluated: 0,
          total: 3,
          totalPoints: 0,
          maxPoints: 10,
          percentage: 0,
          hasContent: false,
        },
      ],
    ]);
    const region = await openWith(submissions('submitted'), emptyProgress);
    fireEvent.click(within(region).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    fireEvent.click(within(region).getByRole('button', { name: 'Azzera' }));
    const dialog = await screen.findByTestId('batch-actions-dialog');
    expect(within(dialog).getByText('action: clear')).toBeTruthy();
    expect(within(dialog).getByText('rows: stud-a')).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Azzera correzione — Anna' })).toBeNull();
  });

  it('after batch clear performs one targeted re-read and keeps the selection', async () => {
    setupDefaults();
    const region = await openWith(submissions('in_progress'), clearableProgress);
    const checkbox = within(region).getByRole('checkbox', {
      name: 'Seleziona consegna — Anna',
    }) as HTMLInputElement;
    fireEvent.click(checkbox);
    const readsBefore = mockLoadCorrectionProgressByStudent.mock.calls.length;
    fireEvent.click(within(region).getByRole('button', { name: 'Azzera' }));
    const dialog = await screen.findByTestId('batch-actions-dialog');
    fireEvent.click(within(dialog).getByText('Applica'));
    await waitFor(() =>
      expect(mockLoadCorrectionProgressByStudent.mock.calls.length).toBe(readsBefore + 1),
    );
    expect(checkbox.checked).toBe(true);
  });
});

// ─── UI-VERIFICHE-05 — card docente semplificata ────────────────────────────
describe('VerificationsView — simplified teacher verification card (UI-VERIFICHE-05)', () => {
  async function renderCards(verifications: unknown[]) {
    setupDefaults();
    mockListVerifications.mockResolvedValue(verifications);
    render(<VerificationsView />);
    return await screen.findByRole('list', { name: 'Archivio verifiche' });
  }

  it('shows title and question count on the same semantic line', async () => {
    const list = await renderCards([
      makeDraftVer({
        config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef, sampleQuestionRef] },
      }),
    ]);
    const heading = within(list).getByRole('heading', { name: /Verifica Algebra/ });
    // Titolo e conteggio vivono nello stesso elemento di intestazione.
    expect(heading.textContent).toContain('Verifica Algebra');
    expect(heading.textContent).toContain('2 Domande');
    expect(heading.textContent).toContain('·');
  });

  it('uses the singular for exactly one question', async () => {
    const list = await renderCards([
      makeDraftVer({ config: { ...makeDraftVer().config, questionRefs: [sampleQuestionRef] } }),
    ]);
    const heading = within(list).getByRole('heading', { name: /Verifica Algebra/ });
    expect(heading.textContent).toContain('1 Domanda');
    expect(heading.textContent).not.toContain('1 domande');
  });

  it('uses the plural for zero questions', async () => {
    const list = await renderCards([
      makeDraftVer({ config: { ...makeDraftVer().config, questionRefs: [] } }),
    ]);
    expect(within(list).getByRole('heading', { name: /Verifica Algebra/ }).textContent).toContain(
      '0 Domande',
    );
  });

  it('renders a single «Classe · Anno · Programma» metadata line without labels', async () => {
    const list = await renderCards([makeDraftVer()]);
    // Una sola riga con i valori disponibili, nessuna etichetta visibile.
    const meta = within(list).getByText(/Classe 3A/);
    expect(meta.textContent).toMatch(/Classe 3A · .*Matematica/);
    for (const label of ['Classe', 'Anno', 'Corso']) {
      expect(within(list).queryAllByText(label, { selector: 'strong' })).toHaveLength(0);
    }
  });

  it('adds the document icon to metadata only when the student PDF is enabled', async () => {
    const list = await renderCards([
      makeDraftVer({ id: 'pdf-off', studentPdfEnabled: false }),
      makeDraftVer({ id: 'pdf-on', studentPdfEnabled: true }),
    ]);
    const cards = within(list).getAllByRole('listitem', { name: 'Verifica Verifica Algebra' });
    expect(cards).toHaveLength(2);
    expect(
      within(cards[0]!).queryByRole('img', { name: 'PDF disponibile agli studenti' }),
    ).toBeNull();
    expect(
      within(cards[1]!).getByRole('img', { name: 'PDF disponibile agli studenti' }),
    ).toBeTruthy();
  });

  it('omits a missing class gracefully, never leaving a dangling separator', async () => {
    const list = await renderCards([
      makeDraftVer({ config: { ...makeDraftVer().config, classId: null } }),
    ]);
    const meta = within(list).getByText(/Nessuna classe/);
    expect(meta.textContent?.startsWith('·')).toBe(false);
    expect(meta.textContent?.trim().endsWith('·')).toBe(false);
  });

  it('keeps the Stato, Online and Argomenti panels', async () => {
    const list = await renderCards([makeDraftVer()]);
    const labels = within(list)
      .getAllByRole('listitem')
      .flatMap((card) => [...card.querySelectorAll('dt')].map((dt) => dt.textContent));
    // UI-VERIFICHE-06B — il terzo riquadro «Argomenti» si affianca ai due esistenti.
    expect(labels).toEqual(['Stato', 'Online', 'Argomenti']);
  });

  it('keeps the online switch independent from the card surface', async () => {
    const list = await renderCards([
      makeDraftVer({ id: 'ver-2', status: 'active', onlineEnabled: false }),
    ]);
    const switchEl = within(list).getByRole('switch');
    fireEvent.click(switchEl);
    // Lo switch agisce da solo: chiama il servizio online e NON apre il dettaglio
    // (l'archivio resta montato).
    await waitFor(() => expect(mockSetVerificationOnlineEnabled).toHaveBeenCalled());
    expect(screen.getByRole('list', { name: 'Archivio verifiche' })).toBeTruthy();
  });

  it('keeps the six actions in the approved order inside the menu', async () => {
    await renderCards([makeDraftVer()]);
    fireEvent.click(actionsTriggers()[0]!);
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(labels).toEqual([
      'Scarica PDF studenti',
      'Scarica PDF soluzioni',
      'Pubblica allo studente',
      'Abilita PDF studente',
      'Chiudi verifica',
      'Elimina verifica',
    ]);
  });

  it('shares one slot between «Chiudi» and «Riapri»', async () => {
    await renderCards([makeDraftVer({ id: 'ver-3', status: 'closed' })]);
    fireEvent.click(actionsTriggers()[0]!);
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(labels).toHaveLength(6);
    expect(labels[4]).toBe('Riapri verifica');
    expect(labels).not.toContain('Chiudi verifica');
  });

  it('always renders «Elimina», disabled while the verification is active', async () => {
    await renderCards([makeDraftVer({ id: 'ver-2', status: 'active' })]);
    const del = menuItem(/Elimina verifica/) as HTMLButtonElement;
    expect(del).toBeTruthy();
    expect(del.disabled).toBe(true);
  });

  it('keeps the «Apri verifica →» CTA in the DOM, hidden at rest by CSS', async () => {
    const list = await renderCards([makeDraftVer()]);
    // Il testo resta nel DOM (spazio riservato ⇒ nessun layout shift); la
    // visibilità è governata da hover/focus della superficie apribile — vedi il
    // contratto CSS in `VerificationRecordCard.test.tsx`.
    const cta = within(list).getByText('Apri verifica →');
    expect(cta.className).toMatch(/openCtaBand/);
  });
});

// ─── UI-VERIFICHE-06A — menu Azioni e CTA ───────────────────────────────────
describe('VerificationsView — Azioni menu and CTA (UI-VERIFICHE-06A)', () => {
  async function renderOne(over: Record<string, unknown> = {}) {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer(over)]);
    render(<VerificationsView />);
    return await screen.findByRole('list', { name: 'Archivio verifiche' });
  }

  it('exposes exactly one «Azioni» button on the card, and no loose action buttons', async () => {
    const list = await renderOne();
    const card = within(list).getAllByRole('listitem')[0]!;
    const buttons = within(card).getAllByRole('button');
    // Superficie apribile + «Azioni» + «Argomenti»: nessun pulsante azione sciolto.
    expect(buttons).toHaveLength(3);
    expect(within(card).getByRole('button', { name: /^Azioni verifica/ })).toBeTruthy();
    for (const name of [/Scarica PDF/i, /Elimina verifica/i, /Chiudi verifica/i]) {
      expect(within(card).queryByRole('button', { name })).toBeNull();
    }
    // Il menu è chiuso finché non lo si apre.
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('renders the menu outside the card, so the card overflow cannot clip it', async () => {
    const list = await renderOne();
    fireEvent.click(actionsTriggers()[0]!);
    const menu = screen.getByRole('menu', { name: /^Azioni verifica/ });
    // Portalato su document.body: non è discendente della card né della lista.
    expect(list.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });

  it('marks the trigger with aria-haspopup and reflects the open state', async () => {
    await renderOne();
    const trigger = actionsTriggers()[0]!;
    expect(trigger.getAttribute('aria-haspopup')).toBe('true');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('opening the menu does not open the verification detail', async () => {
    await renderOne();
    fireEvent.click(actionsTriggers()[0]!);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    // L'archivio resta montato: nessuna navigazione al dettaglio.
    expect(screen.getByRole('list', { name: 'Archivio verifiche' })).toBeTruthy();
  });

  it('a menu item runs only its own handler and closes the menu', async () => {
    await renderOne();
    fireEvent.click(menuItem(/Abilita PDF studente/i));
    await waitFor(() => expect(mockSetVerificationStudentPdfEnabled).toHaveBeenCalled());
    // Nessuna azione collaterale, e il menu si chiude dopo la selezione.
    expect(mockSetVerificationVisibility).not.toHaveBeenCalled();
    expect(mockDeleteVerification).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
    expect(screen.getByRole('list', { name: 'Archivio verifiche' })).toBeTruthy();
  });

  it('Escape closes the menu and restores focus to the trigger', async () => {
    await renderOne();
    const trigger = actionsTriggers()[0]!;
    fireEvent.click(trigger);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
    expect(document.activeElement).toBe(trigger);
  });

  it('an outside click closes the menu', async () => {
    await renderOne();
    fireEvent.click(actionsTriggers()[0]!);
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryAllByRole('menuitem')).toHaveLength(0));
  });

  it('keeps the online toggle outside the menu and independent from the card', async () => {
    await renderOne({ id: 'ver-2', status: 'active', onlineEnabled: false });
    const list = screen.getByRole('list', { name: 'Archivio verifiche' });
    const card = within(list).getAllByRole('listitem')[0]!;
    // Il toggle vive nella card, non nel menu.
    const toggle = within(card).getByRole('switch');
    fireEvent.click(toggle);
    await waitFor(() => expect(mockSetVerificationOnlineEnabled).toHaveBeenCalled());
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
    expect(screen.getByRole('list', { name: 'Archivio verifiche' })).toBeTruthy();
  });

  it('keeps «Elimina» present, destructive and disabled while the verification is active', async () => {
    await renderOne({ id: 'ver-2', status: 'active' });
    const del = menuItem(/Elimina verifica/i);
    expect(del.disabled).toBe(true);
    expect(del.className).toMatch(/menuDanger/);
    // Spiegazione accessibile del perché è disabilitata.
    expect(del.getAttribute('title')).toBe('Chiudi prima la verifica');
  });

  it('gives disabled items a coherent explanation', async () => {
    await renderOne(); // draft
    expect(menuItem(/Pubblica allo studente/i).disabled).toBe(true);
    expect(menuItem(/Pubblica allo studente/i).getAttribute('title')).toBe(
      'Attiva prima la verifica',
    );
    expect(menuItem(/Chiudi verifica/i).disabled).toBe(true);
    expect(menuItem(/Chiudi verifica/i).getAttribute('title')).toBe('Attiva prima la verifica');
  });

  it('keeps each card menu independent', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer(),
      makeDraftVer({
        id: 'ver-2',
        config: { ...makeDraftVer().config, title: 'Verifica Geometria' },
      }),
    ]);
    render(<VerificationsView />);
    await screen.findByRole('list', { name: 'Archivio verifiche' });
    const triggers = actionsTriggers();
    expect(triggers).toHaveLength(2);
    fireEvent.click(triggers[0]!);
    // Un solo menu aperto alla volta: sei voci, non dodici.
    expect(screen.getAllByRole('menuitem')).toHaveLength(6);
    expect(triggers[1]!.getAttribute('aria-expanded')).toBe('false');
  });
});

// ─── UI-VERIFICHE-06B — data, testata e riquadro Argomenti ───────────────────

describe('VerificationsView — data e Argomenti (UI-VERIFICHE-06B)', () => {
  const OUTLINE = [
    { udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet', 'Il protocollo HTTP'] },
  ];

  async function renderCards(verifications: unknown[]) {
    setupDefaults();
    mockListVerifications.mockResolvedValue(verifications);
    render(<VerificationsView />);
    return await screen.findByRole('list', { name: 'Archivio verifiche' });
  }

  it('compone la testata «data · titolo · N Domande» in ordine e con i separatori giusti', async () => {
    const base = makeDraftVer();
    const list = await renderCards([
      makeDraftVer({
        config: {
          ...base.config,
          verificationDate: '2026-02-02',
          questionRefs: [sampleQuestionRef, sampleQuestionRef],
        },
      }),
    ]);
    const heading = within(list).getByRole('heading', { name: /Verifica Algebra/ });
    expect(heading.textContent).toBe('02/02/2026 · Verifica Algebra · 2 Domande');
  });

  it('usa il singolare per una sola domanda', async () => {
    const base = makeDraftVer();
    const list = await renderCards([
      makeDraftVer({
        config: {
          ...base.config,
          verificationDate: '2026-12-31',
          questionRefs: [sampleQuestionRef],
        },
      }),
    ]);
    const heading = within(list).getByRole('heading', { name: /Verifica Algebra/ });
    expect(heading.textContent).toBe('31/12/2026 · Verifica Algebra · 1 Domanda');
  });

  it('omette la data sulle verifiche legacy, senza separatore iniziale né trattino', async () => {
    const list = await renderCards([makeDraftVer()]);
    const heading = within(list).getByRole('heading', { name: /Verifica Algebra/ });
    expect(heading.textContent).toBe('Verifica Algebra · 0 Domande');
    expect(heading.textContent!.startsWith('·')).toBe(false);
    expect(heading.textContent).not.toContain('—');
  });

  it('preferisce la data congelata nello snapshot a quella della config', async () => {
    const base = makeDraftVer();
    const list = await renderCards([
      makeDraftVer({
        status: 'active',
        config: { ...base.config, verificationDate: '2026-02-02' },
        teacherSnapshot: {
          ...base.config,
          verificationDate: '2026-01-10',
          questionRefs: [sampleQuestionRef],
          activatedAt: null,
        },
      }),
    ]);
    const heading = within(list).getByRole('heading', { name: /Verifica Algebra/ });
    expect(heading.textContent).toContain('10/01/2026');
    expect(heading.textContent).not.toContain('02/02/2026');
  });

  it('apre gli Argomenti dal riquadro senza aprire la card e senza nuove letture', async () => {
    const base = makeDraftVer();
    const list = await renderCards([
      makeDraftVer({ config: { ...base.config, topicOutline: OUTLINE } }),
    ]);
    const readsBefore = mockListQuestionIndex.mock.calls.length;

    const trigger = within(list).getByRole('button', { name: /^Argomenti della verifica/ });
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog', { name: 'Argomenti della verifica' })).toBeTruthy();
    expect(screen.getByText('Il Web')).toBeTruthy();
    expect(screen.getByText('Come funziona Internet')).toBeTruthy();
    // La lista resta montata: il click NON ha aperto il dettaglio verifica.
    expect(screen.getByRole('list', { name: 'Archivio verifiche' })).toBeTruthy();
    // Nessuna lettura aggiuntiva innescata dall'apertura.
    expect(mockListQuestionIndex.mock.calls.length).toBe(readsBefore);
  });

  it('disabilita Argomenti sulle verifiche legacy senza perimetro', async () => {
    const list = await renderCards([makeDraftVer()]);
    const trigger = within(list).getByRole('button', { name: /Argomenti non disponibili/ });
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('richiede una data valida prima di abilitare «Crea verifica»', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([]);
    render(<VerificationsView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nuova verifica' }));
    const dialog = screen.getByRole('dialog', { name: 'Nuova verifica' });
    const submit = within(dialog).getByRole('button', { name: /crea verifica/i });

    // Campo data inizialmente vuoto: nessun «oggi» scelto in silenzio.
    const dateInput = within(dialog).getByLabelText('Data') as HTMLInputElement;
    expect(dateInput.value).toBe('');
    expect(dateInput.className).toMatch(/dateInput/);

    fireEvent.change(within(dialog).getByLabelText('Titolo'), { target: { value: 'V' } });
    fireEvent.change(within(dialog).getByLabelText('Corso'), { target: { value: 'prog-1' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(dateInput, { target: { value: '2026-02-02' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    expect(mockCreateVerification).not.toHaveBeenCalled();
  });
});

describe('VerificationsView — bozza: data e perimetro in un solo salvataggio (UI-VERIFICHE-06B)', () => {
  async function openDraft() {
    setupDefaults();
    mockListVerifications.mockResolvedValue([
      makeDraftVer({ config: { ...makeDraftVer().config, verificationDate: '2026-02-02' } }),
    ]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => screen.getByLabelText(/seleziona domanda q1/i));
  }

  it('salva data e perimetro nello stesso update di titolo, classe e domande', async () => {
    await openDraft();
    // La data della bozza è modificabile e precompilata con quella salvata.
    const dateInput = screen.getByLabelText('Data') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-02-02');
    fireEvent.change(dateInput, { target: { value: '2026-03-15' } });
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByRole('button', { name: /salva bozza/i }));

    await waitFor(() => expect(mockUpdateVerificationConfig).toHaveBeenCalled());
    // Una sola scrittura: nessun update dedicato per data o argomenti.
    expect(mockUpdateVerificationConfig).toHaveBeenCalledTimes(1);
    const [, configArg] = mockUpdateVerificationConfig.mock.calls[0];
    expect(configArg.verificationDate).toBe('2026-03-15');
    expect(configArg.topicOutline).toEqual([
      { udaTitle: 'Il Web', lessonTitles: ['Come funziona Internet'] },
    ]);
    expect(configArg.title).toBe('Verifica Algebra');
    expect(configArg.questionRefs).toHaveLength(1);
  });

  it('legge l’albero del corso una sola volta, insieme al pool, e mai riaprendo gli argomenti', async () => {
    await openDraft();
    expect(mockListUdas).toHaveBeenCalledTimes(1);
    expect(mockListLessons).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    fireEvent.click(screen.getByLabelText(/seleziona domanda q1/i));
    expect(mockListUdas).toHaveBeenCalledTimes(1);
    expect(mockListLessons).toHaveBeenCalledTimes(1);
  });
});

// ─── UI-CONSEGNE-01 — fixture condivise dalle suite consegne ─────────────────

/** Verifica attiva con classe assegnata: apre il monitor consegne. */
const consegneVer = (overrides = {}) =>
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

const consegneStudents = [
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
];

// ─── UI-CONSEGNE-01 — consegne: tabella desktop, card mobile ─────────────────

describe('VerificationsView — consegne responsive (UI-CONSEGNE-01)', () => {
  /** Attiva la viewport mobile per il montaggio successivo. */
  function useMobileViewport(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  afterEach(() => {
    // Ripristina il default jsdom (matchMedia assente ⇒ variante desktop).
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  const SUBMITTED = {
    studentUid: 'stud-a',
    status: 'submitted' as const,
    lastSavedAt: { seconds: 100, nanoseconds: 0 },
    submittedAt: { seconds: 200, nanoseconds: 0 },
    deliveryCode: 'SF-2026-A1B2',
    attentionEventsCount: 3,
  };

  async function openMonitor(mobile: boolean, items: unknown[] = [SUBMITTED]) {
    useMobileViewport(mobile);
    setupDefaults();
    mockListVerifications.mockResolvedValue([consegneVer()]);
    mockListStudents.mockResolvedValue(consegneStudents);
    let pushItems: (rows: unknown[]) => void = () => {};
    mockWatchSubmissions.mockImplementation((_v, _o, _db, onChange) => {
      pushItems = onChange;
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalled());
    pushItems(items);
    await waitFor(() => expect(screen.getByLabelText('Consegne online')).toBeTruthy());
  }

  function submissionCard(name: string): HTMLElement {
    return screen.getByRole('listitem', { name: `Consegna ${name}` });
  }

  it('desktop: mostra la tabella con le sue intestazioni e nessuna card', async () => {
    await openMonitor(false);

    const table = screen.getByRole('table');
    expect(table).toBeTruthy();
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.replace(/[▲▼↕↑↓]/g, '').trim());
    expect(headers).toEqual([
      '',
      'Studente',
      'Stato',
      'Valutate',
      'Percentuale',
      'Consegna',
      'Visibilità',
      'Eventi',
      'Azioni',
    ]);
    expect(screen.queryByRole('list', { name: 'Consegne online' })).toBeNull();
  });

  it('mobile: sostituisce la tabella con una card per consegna', async () => {
    await openMonitor(true);

    expect(screen.queryByRole('table')).toBeNull();
    const list = screen.getByRole('list', { name: 'Consegne online' });
    const cards = within(list).getAllByRole('listitem');
    // Stessa collezione filtrata e ordinata della tabella: Anna e Bruno.
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByRole('heading').textContent).toBe('Anna');
  });

  it('mobile: metriche disposte in due righe da due', async () => {
    await openMonitor(true);

    const card = submissionCard('Anna');
    const labels = [...card.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(labels).toEqual(['Punteggio', 'Visibilità', 'Stato', 'Consegna']);
    // Lo stato è testo, non solo colore.
    expect(within(card).getByText('Consegnata')).toBeTruthy();
    // Visibilità non disponibile ⇒ «—», mai un valore inventato.
    expect(within(card).getByLabelText('Visibilità non disponibile')).toBeTruthy();
    // Mobile mostra soltanto l'orario: la data completa resta nella tabella desktop.
    const deliveryMetric = [...card.querySelectorAll('dd')].at(3);
    expect(deliveryMetric?.textContent).toMatch(/^\d{2}:\d{2}$/);
    expect(deliveryMetric?.textContent).not.toContain('/');
  });

  it('mobile: la checkbox condivide la selezione e aggiorna le azioni massive', async () => {
    await openMonitor(true);

    expect(screen.getByRole('button', { name: 'Azioni consegne' })).toBeTruthy();

    const checkbox = within(submissionCard('Anna')).getByRole('checkbox', {
      name: 'Seleziona consegna — Anna',
    }) as HTMLInputElement;
    fireEvent.click(checkbox);

    expect(checkbox.checked).toBe(true);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Azioni consegne (1)' })).toBeTruthy(),
    );
    // Deselezionando, le azioni massive tornano disabilitate.
    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Azioni consegne' })).toBeTruthy(),
    );
  });

  it('mobile: la checkbox non apre la correzione', async () => {
    await openMonitor(true);

    fireEvent.click(
      within(submissionCard('Anna')).getByRole('checkbox', { name: 'Seleziona consegna — Anna' }),
    );
    // Il workspace di correzione non è montato: la lista consegne resta visibile.
    expect(screen.getByRole('list', { name: 'Consegne online' })).toBeTruthy();
  });

  it('mobile: gli eventi sono cliccabili nella riga informativa e non nel menu', async () => {
    await openMonitor(true);

    const card = submissionCard('Anna');
    fireEvent.click(within(card).getByRole('button', { name: '3 eventi' }));
    expect(screen.getByRole('list', { name: 'Consegne online' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Chiudi' }));
    fireEvent.click(within(card).getByRole('button', { name: /^Azioni consegna/ }));
    expect(screen.queryByRole('menuitem', { name: /event/i })).toBeNull();
  });

  it('mobile: la superficie è neutra e la correzione si apre soltanto dal menu Azioni', async () => {
    await openMonitor(true);

    const card = submissionCard('Anna');
    fireEvent.click(card);
    expect(screen.getByRole('list', { name: 'Consegne online' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: 'Apri correzione — Anna' })).toBeNull();

    fireEvent.click(within(card).getByRole('button', { name: /^Azioni consegna/ }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Apri correzione — Anna' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Consegne online' })).toBeNull());
  });

  it('mobile: una consegna non apribile non espone l’azione di correzione', async () => {
    await openMonitor(true);
    // Bruno non ha consegnato e non ha altre azioni: nessun trigger o superficie.
    expect(
      within(submissionCard('Bruno')).queryByRole('button', { name: /Apri correzione|Azioni/ }),
    ).toBeNull();
  });

  it('nessuna interattività annidata nelle card consegna', async () => {
    await openMonitor(true);
    for (const button of screen.getAllByRole('button')) {
      expect(button.querySelector('button')).toBeNull();
    }
  });
});

describe('VerificationsView — toolbar azioni massive (UI-CONSEGNE-01)', () => {
  function useMobileViewport(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  });

  async function openMonitor(mobile: boolean) {
    useMobileViewport(mobile);
    setupDefaults();
    mockListVerifications.mockResolvedValue([consegneVer()]);
    mockListStudents.mockResolvedValue(consegneStudents);
    let pushItems: (rows: unknown[]) => void = () => {};
    mockWatchSubmissions.mockImplementation((_v, _o, _db, onChange) => {
      pushItems = onChange;
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalled());
    pushItems([
      {
        studentUid: 'stud-a',
        status: 'submitted',
        lastSavedAt: { seconds: 100, nanoseconds: 0 },
        submittedAt: { seconds: 200, nanoseconds: 0 },
        deliveryCode: 'SF-2026-A1B2',
        attentionEventsCount: 0,
      },
    ]);
    await waitFor(() => expect(screen.getByLabelText('Consegne online')).toBeTruthy());
  }

  it('desktop: otto comandi nell’ordine approvato, con «Chiudi consegne» dopo «Azzera»', async () => {
    await openMonitor(false);

    const toolbar = screen.getByRole('group', { name: 'Azioni sulle consegne selezionate' });
    const labels = within(toolbar)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual([
      'Correzione IA',
      'Completa',
      'Restituisci',
      'Visibilità',
      'PDF correzioni',
      'Riapri',
      'Azzera',
      'Chiudi consegne',
    ]);
    // FORCE-SUBMIT-02 — immediatamente a destra di «Azzera», stile warning.
    expect(labels[labels.indexOf('Azzera') + 1]).toBe('Chiudi consegne');
    const azzera = within(toolbar).getByRole('button', { name: 'Azzera' });
    expect(azzera.className).toMatch(/btn-danger/);
    expect(within(toolbar).getByRole('button', { name: /^Chiudi consegne/ }).className).toMatch(
      /btn-warning/,
    );
  });

  it('mobile: espone un solo menu «Azioni»', async () => {
    await openMonitor(true);

    const toolbar = screen.getByRole('group', { name: 'Azioni sulle consegne selezionate' });
    const buttons = within(toolbar).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]!.textContent).toBe('Azioni');
    expect(buttons[0]!.getAttribute('aria-label')).toMatch(/^Azioni consegne/);
  });

  it('mobile: il menu contiene selezione, IA e le altre azioni nello stesso ordine', async () => {
    await openMonitor(true);

    fireEvent.click(
      within(
        screen
          .getByRole('checkbox', { name: 'Seleziona consegna — Anna' })
          .closest('[role="listitem"]') as HTMLElement,
      ).getByRole('checkbox'),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Azioni consegne/ }));

    const items = screen.getAllByRole('menuitem').map((i) => i.textContent?.trim());
    expect(items).toEqual([
      'Deseleziona tutte',
      'Correggi con IA',
      'Completa',
      'Restituisci',
      'Visibilità',
      'PDF correzioni',
      'Riapri',
      'Azzera',
      'Chiudi consegne',
    ]);
    // FORCE-SUBMIT-02 — ultima voce: nessun ottavo pulsante visibile su mobile.
    expect(items.at(-1)).toBe('Chiudi consegne');
    const azzera = screen.getByRole('menuitem', { name: 'Azzera' });
    expect(azzera.className).toMatch(/menuDanger/);
  });

  it('mobile: «Visibilità» apre il secondo livello senza chiudere il menu', async () => {
    await openMonitor(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    fireEvent.click(screen.getByRole('button', { name: /^Azioni consegne/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Visibilità' }));

    const items = screen.getAllByRole('menuitem').map((i) => i.textContent?.trim());
    expect(items).toEqual([
      'Visibilità',
      'Rendi visibili',
      'Nascondi allo studente',
      'Mostra soluzioni',
      'Nascondi soluzioni',
    ]);
  });

  it('mobile: senza selezione il menu resta disponibile per «Seleziona tutte»', async () => {
    await openMonitor(true);

    const trigger = screen.getByRole('button', { name: /^Azioni consegne/ });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(trigger);
    expect(
      (screen.getByRole('menuitem', { name: 'Correggi con IA' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('menuitem', { name: 'Seleziona tutte' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Seleziona tutte' }));
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Seleziona consegna — Anna',
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it('mobile: una voce del menu invoca lo stesso flusso della toolbar desktop', async () => {
    await openMonitor(true);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Seleziona consegna — Anna' }));
    fireEvent.click(screen.getByRole('button', { name: /^Azioni consegne/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Completa' }));

    // Stesso dialog di conferma batch della toolbar desktop: nessuna nuova popup.
    await waitFor(() => expect(screen.getByTestId('batch-actions-dialog')).toBeTruthy());
    expect(screen.getByText('action: complete')).toBeTruthy();
  });
});

describe('VerificationsView — controllo di ritorno (UI-CONSEGNE-01)', () => {
  it('«← Verifiche» conserva l’handler di navigazione', async () => {
    setupDefaults();
    mockListVerifications.mockResolvedValue([makeDraftVer()]);
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));

    const back = await screen.findByRole('button', { name: 'Torna alle verifiche' });
    expect(back.textContent).toBe('Torna alle verifiche');
    fireEvent.click(back);

    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Archivio verifiche' })).toBeTruthy(),
    );
  });
});

// ─── FORCE-SUBMIT-02 — «Chiudi consegne» (azione batch) ─────────────────────

describe('VerificationsView — chiusura multipla (FORCE-SUBMIT-02)', () => {
  function useMobileViewport(matches: boolean) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    mockScheduleForceClose.mockReset();
  });

  const DRAFT_A = {
    studentUid: 'stud-a',
    status: 'draft' as const,
    lastSavedAt: { seconds: 100, nanoseconds: 0 },
    submittedAt: null,
    deliveryCode: null,
    attentionEventsCount: 0,
  };
  const SUBMITTED_B = {
    studentUid: 'stud-b',
    status: 'submitted' as const,
    lastSavedAt: { seconds: 100, nanoseconds: 0 },
    submittedAt: { seconds: 200, nanoseconds: 0 },
    deliveryCode: 'SF-2026-A1B2',
    attentionEventsCount: 0,
  };

  async function openMonitor(mobile: boolean, items: unknown[]) {
    useMobileViewport(mobile);
    setupDefaults();
    mockLoadCorrectionProgressByStudent.mockResolvedValue(new Map());
    mockListVerifications.mockResolvedValue([consegneVer()]);
    mockListStudents.mockResolvedValue(consegneStudents);
    let pushItems: (rows: unknown[]) => void = () => {};
    mockWatchSubmissions.mockImplementation((_v, _o, _db, onChange) => {
      pushItems = onChange;
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalled());
    pushItems(items);
    await waitFor(() => expect(screen.getByLabelText('Consegne online')).toBeTruthy());
  }

  /** Seleziona la riga indicata (tabella o card, stessa checkbox accessibile). */
  function selectRow(name: string) {
    fireEvent.click(screen.getByRole('checkbox', { name: `Seleziona consegna — ${name}` }));
  }

  function toolbarButton() {
    return screen.getByRole('button', { name: /^Chiudi consegne/ }) as HTMLButtonElement;
  }

  it('nessuna azione «Chiudi e consegna» per singola riga', async () => {
    await openMonitor(false, [DRAFT_A, SUBMITTED_B]);

    expect(screen.queryByRole('button', { name: /Chiudi e consegna/ })).toBeNull();
    // Nemmeno nel menu della card mobile.
    cleanup();
    await openMonitor(true, [DRAFT_A]);
    fireEvent.click(
      within(screen.getByRole('listitem', { name: 'Consegna Anna' })).getByRole('button', {
        name: /^Azioni consegna/,
      }),
    );
    expect(screen.queryByRole('menuitem', { name: /Chiudi e consegna/ })).toBeNull();
  });

  it('disabilitata senza selezione e con una selezione senza bozze', async () => {
    await openMonitor(false, [DRAFT_A, SUBMITTED_B]);

    expect(toolbarButton().disabled).toBe(true);
    expect(toolbarButton().getAttribute('aria-label')).toMatch(/non disponibile/);

    // Solo una consegna già effettuata: nessuna riga eleggibile.
    selectRow('Bruno');
    expect(toolbarButton().disabled).toBe(true);

    // Aggiungendo la bozza l'azione diventa disponibile e conta 1.
    selectRow('Anna');
    expect(toolbarButton().disabled).toBe(false);
    expect(toolbarButton().getAttribute('aria-label')).toBe('Chiudi consegne (1)');
  });

  it('la conferma mostra eleggibili, escluse e la durata fissa', async () => {
    await openMonitor(false, [DRAFT_A, SUBMITTED_B]);
    selectRow('Anna');
    selectRow('Bruno');
    fireEvent.click(toolbarButton());

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Chiudere le consegne selezionate?')).toBeTruthy();
    expect(within(dialog).getByText(/60 secondi/)).toBeTruthy();
    expect(within(dialog).getByText('Consegne da chiudere').nextSibling?.textContent).toBe('1');
    expect(within(dialog).getByText('Selezioni escluse').nextSibling?.textContent).toBe('1');
    expect(within(dialog).getByText(/Già consegnata: 1/)).toBeTruthy();
    expect(within(dialog).getByText(/non ancora salvate/)).toBeTruthy();
  });

  it('invia solo le righe eleggibili, una sola volta', async () => {
    mockScheduleForceClose.mockResolvedValue({
      graceSeconds: 60,
      results: [{ studentUid: 'stud-a', outcome: 'scheduled' }],
    });
    await openMonitor(false, [DRAFT_A, SUBMITTED_B]);
    selectRow('Anna');
    selectRow('Bruno');
    fireEvent.click(toolbarButton());

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avvia chiusura' }));

    await waitFor(() => expect(mockScheduleForceClose).toHaveBeenCalledTimes(1));
    expect(mockScheduleForceClose).toHaveBeenCalledWith({
      verificationId: 'ver-1',
      studentUids: ['stud-a'],
    });
    // Il dialog resta aperto e mostra gli esiti raggruppati.
    await waitFor(() => expect(within(dialog).getByText(/Programmate: 1/)).toBeTruthy());
    // Nessun nuovo listener: il monitor esistente converge da solo.
    expect(mockWatchSubmissions).toHaveBeenCalledTimes(1);
  });

  it('doppio click su «Avvia chiusura» ⇒ una sola chiamata', async () => {
    let resolveCall: (v: {
      graceSeconds: number;
      results: { studentUid: string; outcome: string }[];
    }) => void = () => {};
    mockScheduleForceClose.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        }),
    );
    await openMonitor(false, [DRAFT_A]);
    selectRow('Anna');
    fireEvent.click(toolbarButton());

    const dialog = await screen.findByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: /Avvia chiusura|Avvio/ });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(mockScheduleForceClose).toHaveBeenCalledTimes(1);

    resolveCall({ graceSeconds: 60, results: [{ studentUid: 'stud-a', outcome: 'scheduled' }] });
    await waitFor(() => expect(within(dialog).getByText(/Programmate: 1/)).toBeTruthy());
    expect(mockScheduleForceClose).toHaveBeenCalledTimes(1);
  });

  it('annullare non esegue nulla', async () => {
    await openMonitor(false, [DRAFT_A]);
    selectRow('Anna');
    fireEvent.click(toolbarButton());
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annulla' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mockScheduleForceClose).not.toHaveBeenCalled();
  });

  it('errore: messaggio leggibile, dialog aperto e operazione ritentabile', async () => {
    mockScheduleForceClose.mockRejectedValueOnce({ code: 'functions/permission-denied' });
    await openMonitor(false, [DRAFT_A]);
    selectRow('Anna');
    fireEvent.click(toolbarButton());

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avvia chiusura' }));
    await waitFor(() => expect(within(dialog).getByText(/questo account/)).toBeTruthy());

    mockScheduleForceClose.mockResolvedValueOnce({
      graceSeconds: 60,
      results: [{ studentUid: 'stud-a', outcome: 'scheduled' }],
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avvia chiusura' }));
    await waitFor(() => expect(within(dialog).getByText(/Programmate: 1/)).toBeTruthy());
    expect(mockScheduleForceClose).toHaveBeenCalledTimes(2);
  });

  /*
   * FORCE-SUBMIT-02 — una chiusura già programmata resta eleggibile: ripetere
   * l'operazione è la procedura di recupero di una programmazione rimasta senza
   * task, e il dialog lo dichiara esplicitamente.
   */
  it('una consegna già programmata è recuperabile ripetendo l’operazione', async () => {
    mockScheduleForceClose.mockResolvedValue({
      graceSeconds: 60,
      results: [{ studentUid: 'stud-a', outcome: 'already_scheduled' }],
    });
    await openMonitor(false, [
      { ...DRAFT_A, forceCloseDeadline: { seconds: 999, nanoseconds: 0 } },
    ]);
    selectRow('Anna');

    expect(toolbarButton().disabled).toBe(false);
    fireEvent.click(toolbarButton());

    const dialog = await screen.findByRole('alertdialog');
    // Il dialog dichiara che non si apre una nuova finestra (testo interpolato,
    // quindi spezzato su più nodi: si confronta il contenuto del dialog).
    expect(dialog.textContent).toMatch(/già una chiusura programmata/);
    expect(dialog.textContent).toMatch(/scadenza originale e senza un nuovo preavviso/);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Avvia chiusura' }));
    await waitFor(() =>
      expect(within(dialog).getByText(/Già programmate \(task ripristinata\): 1/)).toBeTruthy(),
    );
  });

  it('mobile: stessa azione come ultima voce del menu batch, stesso handler', async () => {
    mockScheduleForceClose.mockResolvedValue({
      graceSeconds: 60,
      results: [{ studentUid: 'stud-a', outcome: 'scheduled' }],
    });
    await openMonitor(true, [DRAFT_A]);
    selectRow('Anna');
    fireEvent.click(screen.getByRole('button', { name: /^Azioni consegne/ }));

    const items = screen.getAllByRole('menuitem');
    const last = items.at(-1)!;
    expect(last.textContent?.trim()).toBe('Chiudi consegne');
    expect((last as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(last);

    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Avvia chiusura' }));
    await waitFor(() => expect(mockScheduleForceClose).toHaveBeenCalledTimes(1));
    expect(mockScheduleForceClose).toHaveBeenCalledWith({
      verificationId: 'ver-1',
      studentUids: ['stud-a'],
    });
  });
});

// ─── UI-CONSEGNE-02 — colonna Azioni e colonna Eventi ───────────────────────

describe('VerificationsView — tabella desktop (UI-CONSEGNE-02)', () => {
  async function openTable(items: unknown[]) {
    setupDefaults();
    mockLoadCorrectionProgressByStudent.mockResolvedValue(new Map());
    mockListVerifications.mockResolvedValue([consegneVer()]);
    mockListStudents.mockResolvedValue(consegneStudents);
    let pushItems: (rows: unknown[]) => void = () => {};
    mockWatchSubmissions.mockImplementation((_v, _o, _db, onChange) => {
      pushItems = onChange;
      return vi.fn();
    });
    render(<VerificationsView />);
    await waitFor(() => screen.getByText('Verifica Algebra'));
    fireEvent.click(screen.getByText('Verifica Algebra'));
    await waitFor(() => expect(mockWatchSubmissions).toHaveBeenCalled());
    pushItems(items);
    await waitFor(() => expect(screen.getByLabelText('Consegne online')).toBeTruthy());
    return screen.getByRole('table');
  }

  /** L'ultima cella di una riga è la colonna «Azioni». */
  function actionsCell(studentName: string): HTMLElement {
    const row = screen
      .getAllByRole('row')
      .find((r) => within(r).queryByText(studentName) !== null)!;
    return within(row).getAllByRole('cell').at(-1)!;
  }

  it('una riga con azioni non mostra alcun «—»', async () => {
    await openTable([
      {
        studentUid: 'stud-a',
        status: 'draft',
        lastSavedAt: { seconds: 1, nanoseconds: 0 },
        submittedAt: null,
        deliveryCode: null,
        attentionEventsCount: 0,
      },
    ]);

    const cell = actionsCell('Anna');
    expect(within(cell).getAllByRole('button').length).toBeGreaterThan(0);
    expect(cell.textContent).not.toContain('—');
  });

  it('una riga senza consegna mostra esattamente un «—»', async () => {
    await openTable([]);

    const cell = actionsCell('Anna');
    expect(within(cell).queryAllByRole('button')).toHaveLength(0);
    expect(cell.textContent?.match(/—/g) ?? []).toHaveLength(1);
  });

  it('header e cella «Eventi» condividono la stessa classe compatta', async () => {
    const table = await openTable([
      {
        studentUid: 'stud-a',
        status: 'submitted',
        lastSavedAt: { seconds: 1, nanoseconds: 0 },
        submittedAt: { seconds: 2, nanoseconds: 0 },
        deliveryCode: 'SF-2026-A1B2',
        attentionEventsCount: 3,
      },
    ]);

    const header = within(table)
      .getAllByRole('columnheader')
      .find((h) => h.textContent?.includes('Eventi'))!;
    expect(header.className).toMatch(/eventsHeader/);
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('Anna') !== null)!;
    const cell = within(row)
      .getAllByRole('cell')
      .find((c) => c.className.includes('eventsCell'))!;
    expect(cell).toBeTruthy();
    // Il conteggio resta accessibile come controllo.
    expect(within(cell).getByRole('button', { name: /Eventi di attenzione/ })).toBeTruthy();
  });
});
