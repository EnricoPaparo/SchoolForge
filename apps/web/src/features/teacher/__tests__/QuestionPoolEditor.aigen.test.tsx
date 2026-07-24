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

// ─── AIGEN-UI-02 — toolbar del pool ──────────────────────────────────────────
describe('AIGEN-UI-02 — pool toolbar icons and destructive styling', () => {
  const VALID_POOL = {
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
  };

  it('keeps the toolbar order: Nuova domanda, Genera con IA, Modifica YAML, Elimina pool', async () => {
    mockLoadPool.mockResolvedValue(VALID_POOL);
    renderEditor();
    await screen.findByRole('button', { name: 'Nuova domanda' });
    const labels = Array.from(document.querySelectorAll('button'))
      .map((b) => b.textContent?.trim())
      .filter((t) =>
        ['Nuova domanda', 'Genera con IA', 'Modifica YAML', 'Elimina pool'].includes(t ?? ''),
      );
    expect(labels).toEqual(['Nuova domanda', 'Genera con IA', 'Modifica YAML', 'Elimina pool']);
  });

  it('gives «Modifica YAML» an icon (IconFileText) in the valid-pool toolbar', async () => {
    mockLoadPool.mockResolvedValue(VALID_POOL);
    renderEditor();
    const btn = await screen.findByRole('button', { name: 'Modifica YAML' });
    expect(btn.querySelector('svg')).toBeTruthy();
  });

  it('gives «Modifica YAML» an icon also on the invalid-pool surface', async () => {
    mockLoadPool.mockResolvedValue({
      status: 'invalid',
      errors: [{ field: 'schema', message: 'non valido' }],
    });
    renderEditor();
    const btn = await screen.findByRole('button', { name: 'Modifica YAML' });
    expect(btn.querySelector('svg')).toBeTruthy();
  });

  it('gives «Elimina pool» a trash icon and a destructive style already at rest', async () => {
    mockLoadPool.mockResolvedValue(VALID_POOL);
    renderEditor();
    const btn = await screen.findByRole('button', { name: 'Elimina pool' });
    expect(btn.querySelector('svg')).toBeTruthy();
    // Stile distruttivo visibile a riposo (non solo in hover).
    expect(btn.className).toContain('btn-danger');
    // Conferma preservata: nessuna cancellazione immediata.
    btn.click();
    await waitFor(() => expect(screen.getByText(/Eliminare il pool di domande/)).toBeTruthy());
    expect(mockDeletePool).not.toHaveBeenCalled();
  });
});
