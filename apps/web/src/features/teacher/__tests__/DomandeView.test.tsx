import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// We need parsePool and serializePool to work for the YAML editor tests.
// Use real implementations from the package.
vi.mock('@schoolforge/lesson-contract', async (importOriginal) => {
  const real = await importOriginal<typeof import('@schoolforge/lesson-contract')>();
  return { ...real };
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
      mockLoadPool.mockResolvedValue({ status: 'invalid', errors: VALIDATION_ERRORS });
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
