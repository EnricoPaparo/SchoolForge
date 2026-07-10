import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DomandeView } from '../DomandeView.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../../lib/auth.js', () => ({
  useAuth: () => ({ user: { uid: 'owner-uid', email: 'teacher@test.com' } }),
}));

const mockListPrograms = vi.fn();
const mockListUdas = vi.fn();
const mockListLessons = vi.fn();

vi.mock('../../../features/repository/programs/programsService.js', () => ({
  listPrograms: (...args: unknown[]) => mockListPrograms(...args),
  listUdas: (...args: unknown[]) => mockListUdas(...args),
  listLessons: (...args: unknown[]) => mockListLessons(...args),
}));

const mockLoadPool = vi.fn();
const mockSavePool = vi.fn();
const mockDeletePool = vi.fn();

vi.mock('../../../features/repository/pools/poolEditorService.js', () => {
  class PoolDeleteBlockedError extends Error {
    blockers: { verificationId: string; title: string }[];
    constructor(blockers: { verificationId: string; title: string }[]) {
      super('Impossibile eliminare il pool: esistono bozze di verifica collegate.');
      this.name = 'PoolDeleteBlockedError';
      this.blockers = blockers;
    }
  }
  return {
    loadPool: (...args: unknown[]) => mockLoadPool(...args),
    savePool: (...args: unknown[]) => mockSavePool(...args),
    deletePool: (...args: unknown[]) => mockDeletePool(...args),
    PoolDeleteBlockedError,
  };
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

const PROGRAM = {
  id: 'prog-1',
  ownerUid: 'owner-uid',
  title: 'Informatica',
  activeImportId: 'imp-1',
  classIds: [],
  createdAt: null,
  updatedAt: null,
};

const UDA = {
  id: 'uda-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  dir: 'uda-01-reti',
  filename: 'uda-01-reti.md',
  storageBasePath: 'repo/owner-uid/imports/imp-1/uda-01-reti',
  lessonCount: 1,
  descrizione: null,
  competenze: [],
  obiettivi: [],
};

const LESSON_VALID = {
  id: 'lesson-1',
  ownerUid: 'owner-uid',
  importId: 'imp-1',
  udaDir: 'uda-01-reti',
  path: 'uda-01-reti/lezione-001.md',
  filename: 'lezione-001.md',
  titolo: 'Introduzione alle reti',
  sottotitolo: null,
  difficolta: null,
  concettiChiave: [],
  obiettivi: [],
  poolStatus: 'valid' as const,
  questionCount: 2,
  storageRef: 'repo/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  poolStorageRef: 'repo/owner-uid/imports/imp-1/uda-01-reti/lezione-001.pool.md',
  completed: false,
};

const LESSON_ABSENT = {
  ...LESSON_VALID,
  id: 'lesson-2',
  filename: 'lezione-002.md',
  titolo: 'Protocolli',
  poolStatus: 'absent' as const,
  questionCount: 0,
  poolStorageRef: null,
};

const LESSON_INVALID = {
  ...LESSON_VALID,
  id: 'lesson-3',
  filename: 'lezione-003.md',
  titolo: 'Sicurezza',
  poolStatus: 'invalid' as const,
  questionCount: 0,
};

const VALID_POOL = {
  schema: 'schoolforge-pool/v1' as const,
  questions: [
    {
      id: 'q1',
      tipo: 'aperta' as const,
      difficolta: 2 as const,
      peso: 1 as const,
      maxPoints: 2,
      testo: 'Descrivi il modello OSI.',
      soluzione: 'Il modello OSI ha 7 livelli.',
    },
    {
      id: 'q2',
      tipo: 'chiusa_singola' as const,
      difficolta: 1 as const,
      peso: 1 as const,
      maxPoints: 1,
      testo: 'Quanti livelli ha il modello OSI?',
      opzioni: [
        { id: 'a', testo: '5' },
        { id: 'b', testo: '7' },
        { id: 'c', testo: '4' },
      ],
      soluzione: ['b'] as [string],
    },
  ],
};

const VALIDATION_ERRORS = [
  {
    fileName: 'lezione-003.pool.md',
    questionId: 'q-bad',
    questionIndex: 0,
    field: 'tipo',
    message: 'Valore non riconosciuto.',
  },
];

const INVALID_POOL_RAW = `---
schema: schoolforge-pool/v1
questions:
  - id: q-bad
    tipo: INVALID
    difficolta: 2
    peso: 1
    testo: Domanda da riparare.
    soluzione: Risposta.
---
`;

async function expandCourse() {
  fireEvent.click(await screen.findByRole('button', { name: /Informatica/i }));
}

async function expandUda() {
  fireEvent.click(await screen.findByRole('button', { name: /uda-01-reti/i }));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DomandeView', () => {
  describe('loading', () => {
    it('shows loading state while programs load', () => {
      mockListPrograms.mockReturnValue(new Promise(() => {}));
      render(<DomandeView />);
      expect(screen.getByText('Caricamento…')).toBeTruthy();
    });

    it('shows error when programs fail to load', async () => {
      mockListPrograms.mockRejectedValue(new Error('Network error'));
      render(<DomandeView />);
      await screen.findByText('Impossibile caricare i programmi.');
    });

    it('shows empty state when no programs exist', async () => {
      mockListPrograms.mockResolvedValue([]);
      render(<DomandeView />);
      await screen.findByText('Nessun corso trovato.');
    });
  });

  describe('sidebar navigation', () => {
    beforeEach(() => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      mockListUdas.mockResolvedValue([UDA]);
      mockListLessons.mockResolvedValue([LESSON_VALID, LESSON_ABSENT, LESSON_INVALID]);
    });

    it('renders program in sidebar', async () => {
      render(<DomandeView />);
      await screen.findByText('Informatica');
    });

    it('expands course on click and shows UDA', async () => {
      render(<DomandeView />);
      await expandCourse();
      await screen.findByText('uda-01-reti');
    });

    it('expands UDA on click and shows lessons', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      await screen.findByText('Introduzione alle reti');
      await screen.findByText('Protocolli');
      await screen.findByText('Sicurezza');
    });

    it('shows valid pool badge for valid lessons', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      const badges = await screen.findAllByTitle(/2 domande/);
      expect(badges.length).toBeGreaterThan(0);
    });

    it('shows absent badge for lessons without pool', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      await screen.findByTitle('Nessun pool');
    });

    it('shows invalid badge for lessons with invalid pool', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      await screen.findByTitle('Pool non valido');
    });
  });

  describe('content panel — initial state', () => {
    it('shows empty state when no lesson is selected', async () => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      render(<DomandeView />);
      await screen.findByText(/Seleziona una lezione/);
    });
  });

  describe('content panel — pool valid', () => {
    beforeEach(() => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      mockListUdas.mockResolvedValue([UDA]);
      mockListLessons.mockResolvedValue([LESSON_VALID]);
      mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    });

    it('shows question list after selecting a lesson with valid pool', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      await screen.findByText('Descrivi il modello OSI.');
      await screen.findByText('Quanti livelli ha il modello OSI?');
    });

    it('shows question tipo, difficolta and peso', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      await screen.findByText('Aperta');
      await screen.findByText('Chiusa (singola)');
      const metaSpans = await screen.findAllByText(/Diff: \d/);
      expect(metaSpans.length).toBeGreaterThan(0);
    });

    it('shows soluzione for aperta questions', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      await screen.findByText('Il modello OSI ha 7 livelli.');
    });

    it('shows opzioni for chiusa_singola questions', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      await screen.findByText('5');
      await screen.findByText('7');
      await screen.findByText('4');
    });

    it('shows pool question count', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      await screen.findByText('2 domande');
    });

    it('shows delete button for valid pool', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      await screen.findByRole('button', { name: /Elimina pool/ });
    });
  });

  describe('content panel — pool absent', () => {
    beforeEach(() => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      mockListUdas.mockResolvedValue([UDA]);
      mockListLessons.mockResolvedValue([LESSON_ABSENT]);
      mockLoadPool.mockResolvedValue({ status: 'absent' });
    });

    it('shows absent state with create button', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Protocolli/ }));
      await screen.findByText(/Nessun pool di domande/);
      await screen.findByRole('button', { name: 'Crea pool' });
    });

    it('opens YAML editor when create pool is clicked', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Protocolli/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Crea pool' }));
      await screen.findByLabelText('YAML del pool');
    });
  });

  describe('content panel — pool invalid', () => {
    beforeEach(() => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      mockListUdas.mockResolvedValue([UDA]);
      mockListLessons.mockResolvedValue([LESSON_INVALID]);
      mockLoadPool.mockResolvedValue({
        status: 'invalid',
        errors: VALIDATION_ERRORS,
        rawContent: INVALID_POOL_RAW,
      });
    });

    it('shows validation errors', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Sicurezza/ }));
      await screen.findByText(/Pool non valido|Il pool contiene errori/);
      await screen.findByText(/Valore non riconosciuto/);
    });

    it('opens YAML editor from invalid state', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Sicurezza/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
      await screen.findByLabelText('YAML del pool');
    });

    it('preserves the invalid raw YAML in the editor so it can be repaired', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Sicurezza/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
      const textarea = (await screen.findByLabelText('YAML del pool')) as HTMLTextAreaElement;
      expect(textarea.value).toBe(INVALID_POOL_RAW);
    });
  });

  describe('YAML editor — save flow', () => {
    beforeEach(() => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      mockListUdas.mockResolvedValue([UDA]);
      mockListLessons.mockResolvedValue([LESSON_VALID]);
      mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
      mockSavePool.mockResolvedValue(undefined);
    });

    it('shows parse errors when YAML is invalid', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
      const textarea = await screen.findByLabelText('YAML del pool');
      fireEvent.change(textarea, {
        target: { value: '---\nschema: invalid\nquestions: []\n---\n' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
      // parsePool should reject the invalid schema — error message includes the field name
      await waitFor(() => {
        const items = screen.queryAllByRole('listitem');
        const hasParseError = items.some(
          (el) => el.textContent?.includes('schema') || el.textContent?.includes('tipo'),
        );
        expect(hasParseError).toBe(true);
      });
      expect(mockSavePool).not.toHaveBeenCalled();
    });

    it('calls savePool with valid YAML and closes editor', async () => {
      const validYaml = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: La risposta.
---
`;
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
      const textarea = await screen.findByLabelText('YAML del pool');
      fireEvent.change(textarea, { target: { value: validYaml } });
      fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
      await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
      await waitFor(() => expect(screen.queryByLabelText('YAML del pool')).toBeNull());
    });

    it('shows error when savePool fails', async () => {
      mockSavePool.mockRejectedValue(new Error('Firestore error'));
      const validYaml = `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: Una domanda.
    soluzione: La risposta.
---
`;
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
      const textarea = await screen.findByLabelText('YAML del pool');
      fireEvent.change(textarea, { target: { value: validYaml } });
      fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
      await screen.findByText('Firestore error');
    });
  });

  describe('delete pool', () => {
    beforeEach(() => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      mockListUdas.mockResolvedValue([UDA]);
      mockListLessons.mockResolvedValue([LESSON_VALID]);
      mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    });

    it('shows confirmation dialog when delete is clicked', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Elimina pool/ }));
      await screen.findByText(/Eliminare il pool/);
    });

    it('calls deletePool and shows absent state on success', async () => {
      mockDeletePool.mockResolvedValue(undefined);
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Elimina pool/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Elimina' }));
      await waitFor(() => expect(mockDeletePool).toHaveBeenCalledOnce());
      await screen.findByText(/Nessun pool di domande/);
    });

    it('shows blockers list when PoolDeleteBlockedError is thrown', async () => {
      const { PoolDeleteBlockedError } =
        await import('../../../features/repository/pools/poolEditorService.js');
      mockDeletePool.mockRejectedValue(
        new PoolDeleteBlockedError([{ verificationId: 'v1', title: 'Verifica di Natale' }]),
      );
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Elimina pool/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Elimina' }));
      await screen.findByText('Verifica di Natale');
    });

    it('cancels delete when annulla is clicked', async () => {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      fireEvent.click(await screen.findByRole('button', { name: /Elimina pool/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Annulla' }));
      await waitFor(() => {
        expect(screen.queryByText(/Eliminare il pool/)).toBeNull();
      });
      expect(mockDeletePool).not.toHaveBeenCalled();
    });
  });

  describe('question editor — add / edit / delete', () => {
    beforeEach(() => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      mockListUdas.mockResolvedValue([UDA]);
      mockListLessons.mockResolvedValue([LESSON_VALID]);
      mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
      mockSavePool.mockResolvedValue(undefined);
    });

    async function openLesson() {
      render(<DomandeView />);
      await expandCourse();
      await expandUda();
      fireEvent.click(await screen.findByRole('button', { name: /Introduzione alle reti/ }));
      await screen.findByText('2 domande');
    }

    it('shows "Nuova domanda" button for valid pool', async () => {
      await openLesson();
      expect(screen.getByRole('button', { name: /Nuova domanda/ })).toBeTruthy();
    });

    it('opens the new-question form when "Nuova domanda" is clicked', async () => {
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      await screen.findByText('Nuova domanda');
      expect(screen.getByLabelText('ID domanda')).toBeTruthy();
      expect(screen.getByLabelText('Testo domanda')).toBeTruthy();
    });

    it('closes the new-question form on Annulla', async () => {
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      // The form renders an h3 with role "heading"
      await screen.findByRole('heading', { name: 'Nuova domanda' });
      fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
      await waitFor(() =>
        expect(screen.queryByRole('heading', { name: 'Nuova domanda' })).toBeNull(),
      );
    });

    it('adds an aperta question and calls savePool', async () => {
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      await screen.findByText('Nuova domanda');

      fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
      fireEvent.change(screen.getByLabelText('Testo domanda'), {
        target: { value: 'Che cosa è TCP?' },
      });
      fireEvent.change(screen.getByLabelText('Soluzione'), {
        target: { value: 'Un protocollo di trasporto.' },
      });

      fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
      await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
      const call = mockSavePool.mock.calls[0][0] as { pool: { questions: { id: string }[] } };
      expect(call.pool.questions.some((q) => q.id === 'q3')).toBe(true);
    });

    it('shows error for duplicate question ID', async () => {
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      await screen.findByText('Nuova domanda');

      fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q1' } });
      fireEvent.change(screen.getByLabelText('Testo domanda'), {
        target: { value: 'Duplicato.' },
      });
      fireEvent.change(screen.getByLabelText('Soluzione'), { target: { value: 'x' } });

      fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
      await screen.findByText(/già presente nel pool/);
      expect(mockSavePool).not.toHaveBeenCalled();
    });

    it('adds a chiusa_singola question with radio soluzione and calls savePool', async () => {
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      await screen.findByText('Nuova domanda');

      fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
      fireEvent.change(screen.getByLabelText('Tipo domanda'), {
        target: { value: 'chiusa_singola' },
      });
      fireEvent.change(screen.getByLabelText('Testo domanda'), {
        target: { value: 'Quanti bit ha un byte?' },
      });

      // Fill first option id and testo
      const idInputs = screen.getAllByLabelText(/ID opzione/);
      const testoInputs = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(idInputs[0], { target: { value: 'a' } });
      fireEvent.change(testoInputs[0], { target: { value: '4' } });

      // Add second option
      fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
      const idInputs2 = screen.getAllByLabelText(/ID opzione/);
      const testoInputs2 = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(idInputs2[1], { target: { value: 'b' } });
      fireEvent.change(testoInputs2[1], { target: { value: '8' } });

      // Select radio for option b
      fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta b/));

      fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
      await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
      const call = mockSavePool.mock.calls[0][0] as {
        pool: { questions: { id: string; soluzione: unknown }[] };
      };
      const saved = call.pool.questions.find((q) => q.id === 'q3');
      expect(saved).toBeTruthy();
      expect(saved?.soluzione).toEqual(['b']);
    });

    it('adds a chiusa_multipla question with checkbox soluzioni and calls savePool', async () => {
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      await screen.findByRole('heading', { name: 'Nuova domanda' });

      fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
      fireEvent.change(screen.getByLabelText('Tipo domanda'), {
        target: { value: 'chiusa_multipla' },
      });
      fireEvent.change(screen.getByLabelText('Testo domanda'), {
        target: { value: 'Quali sono protocolli di trasporto?' },
      });

      // Fill first option
      const idInputs = screen.getAllByLabelText(/ID opzione/);
      const testoInputs = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(idInputs[0], { target: { value: 'a' } });
      fireEvent.change(testoInputs[0], { target: { value: 'TCP' } });

      // Add second option
      fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
      const after2 = screen.getAllByLabelText(/ID opzione/);
      const after2t = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(after2[1], { target: { value: 'b' } });
      fireEvent.change(after2t[1], { target: { value: 'UDP' } });

      // Add third option (must keep at least one non-solution option per parsePool rules)
      fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
      const after3 = screen.getAllByLabelText(/ID opzione/);
      const after3t = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(after3[2], { target: { value: 'c' } });
      fireEvent.change(after3t[2], { target: { value: 'HTTP' } });

      // Select a and b as correct — controlled checkboxes need act() to flush React state
      await act(async () => {
        fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta a/));
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta b/));
      });

      fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
      await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
      const call = mockSavePool.mock.calls[0][0] as {
        pool: { questions: { id: string; soluzione: unknown }[] };
      };
      const saved = call.pool.questions.find((q) => q.id === 'q3');
      expect(saved?.soluzione).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('ignores extra empty option rows when saving a chiusa_multipla question', async () => {
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      await screen.findByRole('heading', { name: 'Nuova domanda' });

      fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
      fireEvent.change(screen.getByLabelText('Tipo domanda'), {
        target: { value: 'chiusa_multipla' },
      });
      fireEvent.change(screen.getByLabelText('Testo domanda'), {
        target: { value: 'Quali sono protocolli di trasporto?' },
      });

      const firstIds = screen.getAllByLabelText(/ID opzione/);
      const firstTexts = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(firstIds[0], { target: { value: 'a' } });
      fireEvent.change(firstTexts[0], { target: { value: 'TCP' } });

      fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
      const secondIds = screen.getAllByLabelText(/ID opzione/);
      const secondTexts = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(secondIds[1], { target: { value: 'b' } });
      fireEvent.change(secondTexts[1], { target: { value: 'UDP' } });

      fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
      const thirdIds = screen.getAllByLabelText(/ID opzione/);
      const thirdTexts = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(thirdIds[2], { target: { value: 'c' } });
      fireEvent.change(thirdTexts[2], { target: { value: 'HTTP' } });

      // User adds another row but leaves it empty. This must not be serialized
      // as an empty option, otherwise parsePool reports opzioni[n].testo.
      fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
      const fourthIds = screen.getAllByLabelText(/ID opzione/);
      const fourthTexts = screen.getAllByLabelText(/Testo opzione/);
      fireEvent.change(fourthIds[3], { target: { value: '' } });
      fireEvent.change(fourthTexts[3], { target: { value: '' } });

      await act(async () => {
        fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta a/));
      });
      await act(async () => {
        fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta b/));
      });

      fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
      await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
      const call = mockSavePool.mock.calls[0][0] as {
        pool: { questions: { id: string; opzioni?: { id: string; testo: string }[] }[] };
      };
      const saved = call.pool.questions.find((q) => q.id === 'q3');
      expect(saved?.opzioni).toHaveLength(3);
      expect(saved?.opzioni?.map((o) => o.id)).toEqual(['a', 'b', 'c']);
    });

    it('opens edit form when edit button is clicked', async () => {
      await openLesson();
      const editBtns = await screen.findAllByRole('button', { name: /Modifica domanda/ });
      fireEvent.click(editBtns[0]);
      await screen.findByText(/Modifica domanda — q1/);
    });

    it('id input is disabled when editing existing question', async () => {
      await openLesson();
      const editBtns = await screen.findAllByRole('button', { name: /Modifica domanda/ });
      fireEvent.click(editBtns[0]);
      await screen.findByText(/Modifica domanda — q1/);
      const idInput = screen.getByLabelText('ID domanda') as HTMLInputElement;
      expect(idInput.disabled).toBe(true);
    });

    it('saves edited question and updates the list', async () => {
      await openLesson();
      const editBtns = await screen.findAllByRole('button', { name: /Modifica domanda/ });
      fireEvent.click(editBtns[0]);
      await screen.findByText(/Modifica domanda — q1/);

      fireEvent.change(screen.getByLabelText('Testo domanda'), {
        target: { value: 'Testo aggiornato.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
      await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
    });

    it('shows savePool error for question save', async () => {
      mockSavePool.mockRejectedValue(new Error('Storage error'));
      await openLesson();
      fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
      await screen.findByText('Nuova domanda');

      fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q99' } });
      fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Test.' } });
      fireEvent.change(screen.getByLabelText('Soluzione'), { target: { value: 'Risposta.' } });

      fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
      await screen.findByText('Storage error');
    });

    it('shows inline delete confirm when trash button clicked', async () => {
      await openLesson();
      const deleteBtns = await screen.findAllByRole('button', { name: /Elimina domanda/ });
      fireEvent.click(deleteBtns[0]);
      await screen.findByText('Eliminare questa domanda?');
    });

    it('calls savePool without deleted question on confirm', async () => {
      await openLesson();
      const deleteBtns = await screen.findAllByRole('button', { name: /Elimina domanda/ });
      fireEvent.click(deleteBtns[0]);
      await screen.findByText('Eliminare questa domanda?');
      fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
      await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
      const call = mockSavePool.mock.calls[0][0] as { pool: { questions: { id: string }[] } };
      expect(call.pool.questions.some((q) => q.id === 'q1')).toBe(false);
    });

    it('cancels per-question delete on Annulla', async () => {
      await openLesson();
      const deleteBtns = await screen.findAllByRole('button', { name: /Elimina domanda/ });
      fireEvent.click(deleteBtns[0]);
      await screen.findByText('Eliminare questa domanda?');
      fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
      await waitFor(() => expect(screen.queryByText('Eliminare questa domanda?')).toBeNull());
      expect(mockSavePool).not.toHaveBeenCalled();
    });

    it('shows error when savePool fails during question delete', async () => {
      mockSavePool.mockRejectedValue(new Error('Delete error'));
      await openLesson();
      const deleteBtns = await screen.findAllByRole('button', { name: /Elimina domanda/ });
      fireEvent.click(deleteBtns[0]);
      await screen.findByText('Eliminare questa domanda?');
      fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
      await screen.findByText('Delete error');
    });
  });

  describe('sidebar collapse', () => {
    it('can collapse and re-expand the sidebar', async () => {
      mockListPrograms.mockResolvedValue([PROGRAM]);
      render(<DomandeView />);
      await screen.findByText('Domande');
      fireEvent.click(screen.getByRole('button', { name: /Comprimi barra laterale/ }));
      await waitFor(() => expect(screen.queryByText('Domande')).toBeNull());
      fireEvent.click(screen.getByRole('button', { name: /Espandi barra laterale/ }));
      await screen.findByText('Domande');
    });
  });
});
