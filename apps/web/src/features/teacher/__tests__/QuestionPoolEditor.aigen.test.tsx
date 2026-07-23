import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuestionPoolEditor } from '../QuestionPoolEditor.js';
import type { LessonItem } from '../../repository/programs/programsService.js';

const mockLoadPool = vi.fn();
const mockSavePool = vi.fn();
const mockDeletePool = vi.fn();

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));
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

function lesson(): LessonItem {
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
  } as LessonItem;
}

function renderEditor() {
  return render(
    <QuestionPoolEditor
      programId="p1"
      importId="imp1"
      lesson={lesson()}
      ownerUid="owner"
      lessonSource="Le reti collegano dispositivi."
    />,
  );
}

describe('AIGEN-02 — «Genera con IA» button placement', () => {
  it('shows «Genera con IA» next to «Crea pool» when the pool is absent', async () => {
    mockLoadPool.mockResolvedValue({ status: 'absent' });
    renderEditor();
    await screen.findByRole('button', { name: 'Crea pool' });
    expect(screen.getByRole('button', { name: /Genera con IA/ })).toBeTruthy();
  });

  it('shows «Genera con IA» in the toolbar alongside the existing actions when the pool exists', async () => {
    mockLoadPool.mockResolvedValue({
      status: 'valid',
      pool: {
        schema: 'schoolforge-pool/v2',
        questions: [
          {
            id: 'q1',
            tipo: 'aperta',
            difficolta: 2,
            testo: 'T',
            soluzione: 'S',
            maxPoints: 2,
            maxCharacters: 2000,
          },
        ],
      },
    });
    renderEditor();
    await screen.findByRole('button', { name: 'Nuova domanda' });
    expect(screen.getByRole('button', { name: /Genera con IA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Modifica YAML' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Elimina pool' })).toBeTruthy();
  });

  it('opens the generation dialog from the absent state', async () => {
    mockLoadPool.mockResolvedValue({ status: 'absent' });
    renderEditor();
    const btn = await screen.findByRole('button', { name: /Genera con IA/ });
    btn.click();
    await waitFor(() => expect(screen.getByText('Genera pool con IA')).toBeTruthy());
    // No write happened just by opening.
    expect(mockSavePool).not.toHaveBeenCalled();
  });
});
