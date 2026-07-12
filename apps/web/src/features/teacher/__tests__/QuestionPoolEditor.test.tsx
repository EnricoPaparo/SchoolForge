import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionPoolEditor } from '../QuestionPoolEditor.js';
import type { LessonItem } from '../../repository/programs/programsService.js';

const mockLoadPool = vi.fn();
const mockSavePool = vi.fn();
const mockDeletePool = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {} }));
vi.mock('../../repository/pools/poolEditorService.js', () => {
  class PoolDeleteBlockedError extends Error {}
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

function lesson(over: Partial<LessonItem> = {}): LessonItem {
  return {
    id: 'l1',
    ownerUid: 'owner',
    importId: 'imp1',
    udaDir: 'uda-01',
    path: 'uda-01/lezione-001.md',
    filename: 'lezione-001.md',
    poolStatus: 'valid',
    questionCount: 1,
    storageRef: 'ref/uda-01/l1.md',
    poolStorageRef: null,
    titolo: 'Reti',
    sottotitolo: null,
    difficolta: null,
    concettiChiave: [],
    obiettivi: [],
    ...over,
  } as LessonItem;
}

const VALID_POOL = {
  schema: 'schoolforge-pool/v1' as const,
  questions: [
    {
      id: 'q1',
      tipo: 'aperta' as const,
      difficolta: 1 as const,
      peso: 1 as const,
      maxPoints: 1,
      testo: 'Domanda uno.',
      soluzione: 'Risposta.',
    },
  ],
};

function renderEditor(props: Partial<React.ComponentProps<typeof QuestionPoolEditor>> = {}) {
  return render(
    <QuestionPoolEditor
      programId="p1"
      importId="imp1"
      lesson={lesson()}
      ownerUid="owner"
      {...props}
    />,
  );
}

describe('QuestionPoolEditor', () => {
  it('loads the pool exactly once on mount and renders its questions', async () => {
    mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    renderEditor();

    await waitFor(() => expect(screen.getByText('Domanda uno.')).toBeTruthy());
    expect(mockLoadPool).toHaveBeenCalledTimes(1);
    expect(mockLoadPool).toHaveBeenCalledWith(
      expect.objectContaining({ programId: 'p1', importId: 'imp1', lessonId: 'l1' }),
    );
  });

  it('shows the absent state with a create action when there is no pool', async () => {
    mockLoadPool.mockResolvedValue({ status: 'absent' });
    renderEditor();
    await waitFor(() => expect(screen.getByText(/nessun pool di domande/i)).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Crea pool' })).toBeTruthy();
  });

  it('surfaces a load error and retries on demand', async () => {
    mockLoadPool.mockRejectedValueOnce(new Error('boom'));
    renderEditor();
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    mockLoadPool.mockResolvedValueOnce({ status: 'valid', pool: VALID_POOL });
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.getByText('Domanda uno.')).toBeTruthy());
    expect(mockLoadPool).toHaveBeenCalledTimes(2);
  });

  it('reports the new question count to the parent after a delete-question save', async () => {
    mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    mockSavePool.mockResolvedValue(undefined);
    const onPoolCountChange = vi.fn();
    renderEditor({ onPoolCountChange });

    await waitFor(() => expect(screen.getByText('Domanda uno.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Elimina domanda q1/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Elimina' }));

    await waitFor(() => expect(mockSavePool).toHaveBeenCalledOnce());
    expect(onPoolCountChange).toHaveBeenLastCalledWith(0, 'valid');
  });

  it('reports dirty while the YAML editor has unsaved changes', async () => {
    mockLoadPool.mockResolvedValue({ status: 'valid', pool: VALID_POOL });
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });

    await waitFor(() => expect(screen.getByText('Domanda uno.')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Modifica YAML' }));
    onDirtyChange.mockClear();
    fireEvent.change(screen.getByLabelText('YAML del pool'), {
      target: { value: 'changed content' },
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });
});
