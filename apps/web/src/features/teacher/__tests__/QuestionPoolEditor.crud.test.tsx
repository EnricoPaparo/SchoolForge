import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionPoolEditor } from '../QuestionPoolEditor.js';
import type { LessonItem } from '../../repository/programs/programsService.js';

// Deep pool-editor coverage (create/edit/delete question, validation, YAML,
// pool delete + blockers). Migrated from the removed `DomandeView.test` in
// DUX-04D and retargeted to the live shared `QuestionPoolEditor`, which is the
// single pool editor mounted by the Didattica workspace.

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));

const mockLoadPool = vi.fn();
const mockSavePool = vi.fn();
const mockDeletePool = vi.fn();

vi.mock('../../repository/pools/poolEditorService.js', () => {
  class PoolDeleteBlockedError extends Error {
    blockers: { verificationId: string; title: string }[];
    constructor(blockers: { verificationId: string; title: string }[]) {
      super('Impossibile eliminare il pool: esistono bozze di verifica collegate.');
      this.name = 'PoolDeleteBlockedError';
      this.blockers = blockers;
    }
  }
  return {
    loadPool: (...a: unknown[]) => mockLoadPool(...a),
    savePool: (...a: unknown[]) => mockSavePool(...a),
    deletePool: (...a: unknown[]) => mockDeletePool(...a),
    PoolDeleteBlockedError,
  };
});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
});

const LESSON: LessonItem = {
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
  poolStatus: 'valid',
  questionCount: 2,
  storageRef: 'repo/owner-uid/imports/imp-1/uda-01-reti/lezione-001.md',
  poolStorageRef: 'repo/owner-uid/imports/imp-1/uda-01-reti/lezione-001.pool.md',
  completed: false,
} as LessonItem;

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
    fileName: 'lezione-001.pool.md',
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

function renderEditor() {
  return render(
    <QuestionPoolEditor programId="prog-1" importId="imp-1" lesson={LESSON} ownerUid="owner-uid" />,
  );
}

describe('QuestionPoolEditor — pool valid', () => {
  beforeEach(() => mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL }));

  it('shows the question list', async () => {
    renderEditor();
    await screen.findByText('Descrivi il modello OSI.');
    await screen.findByText('Quanti livelli ha il modello OSI?');
  });

  it('shows tipo, difficolta and peso', async () => {
    renderEditor();
    await screen.findByText('Aperta');
    await screen.findByText('Chiusa (singola)');
    expect((await screen.findAllByText(/Diff: \d/)).length).toBeGreaterThan(0);
  });

  it('shows soluzione and opzioni', async () => {
    renderEditor();
    await screen.findByText('Il modello OSI ha 7 livelli.');
    await screen.findByText('5');
    await screen.findByText('7');
  });

  it('shows the pool question count and delete action', async () => {
    renderEditor();
    await screen.findByText('2 domande');
    await screen.findByRole('button', { name: /Elimina pool/ });
  });
});

describe('QuestionPoolEditor — pool absent / invalid', () => {
  it('shows the absent state and opens the YAML editor on create', async () => {
    mockLoadPool.mockResolvedValue({ status: 'absent' });
    renderEditor();
    await screen.findByText(/Nessun pool di domande/);
    fireEvent.click(await screen.findByRole('button', { name: 'Crea pool' }));
    await screen.findByLabelText('YAML del pool');
  });

  it('shows validation errors and preserves the raw YAML for repair', async () => {
    mockLoadPool.mockResolvedValue({
      status: 'invalid',
      errors: VALIDATION_ERRORS,
      rawContent: INVALID_POOL_RAW,
    });
    renderEditor();
    await screen.findByText(/Valore non riconosciuto/);
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
    const textarea = (await screen.findByLabelText('YAML del pool')) as HTMLTextAreaElement;
    expect(textarea.value).toBe(INVALID_POOL_RAW);
  });
});

describe('QuestionPoolEditor — YAML save flow', () => {
  beforeEach(() => {
    mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    mockSavePool.mockResolvedValue(undefined);
  });

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

  it('rejects invalid YAML before saving', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
    const textarea = await screen.findByLabelText('YAML del pool');
    fireEvent.change(textarea, { target: { value: '---\nschema: invalid\nquestions: []\n---\n' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => {
      const hasError = screen
        .queryAllByRole('listitem')
        .some((el) => el.textContent?.includes('schema') || el.textContent?.includes('tipo'));
      expect(hasError).toBe(true);
    });
    expect(mockSavePool).not.toHaveBeenCalled();
  });

  it('saves valid YAML and closes the editor', async () => {
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
    fireEvent.change(await screen.findByLabelText('YAML del pool'), {
      target: { value: validYaml },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByLabelText('YAML del pool')).toBeNull());
  });

  it('surfaces a savePool error', async () => {
    mockSavePool.mockRejectedValue(new Error('Firestore error'));
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifica YAML' }));
    fireEvent.change(await screen.findByLabelText('YAML del pool'), {
      target: { value: validYaml },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva' }));
    await screen.findByText('Firestore error');
  });
});

describe('QuestionPoolEditor — pool delete', () => {
  beforeEach(() => mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL }));

  it('deletes the pool and shows the absent state', async () => {
    mockDeletePool.mockResolvedValue(undefined);
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /Elimina pool/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(mockDeletePool).toHaveBeenCalledOnce());
    await screen.findByText(/Nessun pool di domande/);
  });

  it('shows the blockers list when deletion is blocked by verifications', async () => {
    const { PoolDeleteBlockedError } = await import('../../repository/pools/poolEditorService.js');
    mockDeletePool.mockRejectedValue(
      new PoolDeleteBlockedError([{ verificationId: 'v1', title: 'Verifica di Natale' }]),
    );
    renderEditor();
    fireEvent.click(await screen.findByRole('button', { name: /Elimina pool/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Elimina' }));
    await screen.findByText('Verifica di Natale');
  });
});

describe('QuestionPoolEditor — question add / edit / delete', () => {
  beforeEach(() => {
    mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    mockSavePool.mockResolvedValue(undefined);
  });

  async function openNew() {
    renderEditor();
    await screen.findByText('2 domande');
    fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
    await screen.findByRole('heading', { name: 'Nuova domanda' });
  }

  it('adds an aperta question and calls savePool', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Testo domanda'), {
      target: { value: 'Che cosa è TCP?' },
    });
    fireEvent.change(screen.getByLabelText('Soluzione'), { target: { value: 'Un protocollo.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
    const call = mockSavePool.mock.calls[0][0] as { pool: { questions: { id: string }[] } };
    expect(call.pool.questions.some((q) => q.id === 'q3')).toBe(true);
  });

  it('rejects a duplicate question ID', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q1' } });
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Duplicato.' } });
    fireEvent.change(screen.getByLabelText('Soluzione'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await screen.findByText(/già presente nel pool/);
    expect(mockSavePool).not.toHaveBeenCalled();
  });

  it('adds a chiusa_singola question with a radio soluzione', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Tipo domanda'), {
      target: { value: 'chiusa_singola' },
    });
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Quanti bit?' } });
    fireEvent.change(screen.getByLabelText('Risposta A'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
    fireEvent.change(screen.getByLabelText('Risposta B'), { target: { value: '8' } });
    fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta b/));
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
    const call = mockSavePool.mock.calls[0][0] as {
      pool: { questions: { id: string; soluzione: unknown }[] };
    };
    expect(call.pool.questions.find((q) => q.id === 'q3')?.soluzione).toEqual(['b']);
  });

  it('adds a chiusa_multipla question ignoring blank option rows', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Tipo domanda'), {
      target: { value: 'chiusa_multipla' },
    });
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Trasporto?' } });
    fireEvent.change(screen.getByLabelText('Risposta A'), { target: { value: 'TCP' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
    fireEvent.change(screen.getByLabelText('Risposta B'), { target: { value: 'UDP' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
    fireEvent.change(screen.getByLabelText('Risposta C'), { target: { value: 'HTTP' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
    fireEvent.change(screen.getByLabelText('Risposta D'), { target: { value: '' } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta a/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta b/));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
    const call = mockSavePool.mock.calls[0][0] as {
      pool: { questions: { id: string; opzioni?: { id: string }[] }[] };
    };
    expect(call.pool.questions.find((q) => q.id === 'q3')?.opzioni).toHaveLength(3);
  });

  it('edits an existing question (id disabled) and saves', async () => {
    await openNew();
    fireEvent.click(screen.getByRole('button', { name: 'Annulla' }));
    const editBtns = await screen.findAllByRole('button', { name: /Modifica domanda/ });
    fireEvent.click(editBtns[0]);
    await screen.findByText(/Modifica domanda — q1/);
    expect((screen.getByLabelText('ID domanda') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Aggiornato.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
  });

  it('deletes a question after inline confirm', async () => {
    renderEditor();
    await screen.findByText('2 domande');
    const deleteBtns = await screen.findAllByRole('button', { name: /Elimina domanda/ });
    fireEvent.click(deleteBtns[0]);
    await screen.findByText('Eliminare questa domanda?');
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
    const call = mockSavePool.mock.calls[0][0] as { pool: { questions: { id: string }[] } };
    expect(call.pool.questions.some((q) => q.id === 'q1')).toBe(false);
  });

  it('shows the informational note only while editing a question', async () => {
    renderEditor();
    await screen.findByText('2 domande');
    expect(screen.queryByText(/Le modifiche ai pool valgono per le verifiche/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
    await screen.findByText(/Le modifiche ai pool valgono per le verifiche create da ora in poi/);
  });
});

describe('QuestionPoolEditor — UX validation messages', () => {
  beforeEach(() => {
    mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    mockSavePool.mockResolvedValue(undefined);
  });

  async function openNew() {
    renderEditor();
    await screen.findByText('2 domande');
    fireEvent.click(screen.getByRole('button', { name: /Nuova domanda/ }));
    await screen.findByRole('heading', { name: 'Nuova domanda' });
  }

  it('requires an ID', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Testo.' } });
    fireEvent.change(screen.getByLabelText('Soluzione'), { target: { value: 'Risposta.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await screen.findByText('Inserisci un ID domanda.');
    expect(mockSavePool).not.toHaveBeenCalled();
  });

  it('requires the testo', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Soluzione'), { target: { value: 'Risposta.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await screen.findByText('Inserisci il testo della domanda.');
  });

  it('requires the soluzione for aperta', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Testo.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await screen.findByText('Inserisci la soluzione.');
  });

  it('requires at least two answers for a chiusa question', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Tipo domanda'), {
      target: { value: 'chiusa_singola' },
    });
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Testo.' } });
    fireEvent.change(screen.getByLabelText('Risposta A'), { target: { value: 'Unica' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await screen.findByText('Inserisci almeno due risposte.');
  });

  it('requires a selected correct answer', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Tipo domanda'), {
      target: { value: 'chiusa_singola' },
    });
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Testo.' } });
    fireEvent.change(screen.getByLabelText('Risposta A'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
    fireEvent.change(screen.getByLabelText('Risposta B'), { target: { value: 'B' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await screen.findByText('Seleziona almeno una risposta corretta.');
  });

  it('requires at least one wrong answer for chiusa_multipla', async () => {
    await openNew();
    fireEvent.change(screen.getByLabelText('ID domanda'), { target: { value: 'q3' } });
    fireEvent.change(screen.getByLabelText('Tipo domanda'), {
      target: { value: 'chiusa_multipla' },
    });
    fireEvent.change(screen.getByLabelText('Testo domanda'), { target: { value: 'Testo.' } });
    fireEvent.change(screen.getByLabelText('Risposta A'), { target: { value: 'A' } });
    fireEvent.click(screen.getByRole('button', { name: /Aggiungi opzione/ }));
    fireEvent.change(screen.getByLabelText('Risposta B'), { target: { value: 'B' } });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta a/));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/Seleziona come risposta corretta b/));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Salva domanda' }));
    await screen.findByText('Lascia almeno una risposta non corretta.');
  });
});
