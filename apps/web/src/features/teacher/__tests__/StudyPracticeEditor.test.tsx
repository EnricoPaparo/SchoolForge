import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  preview: vi.fn(),
  generate: vi.fn(),
  save: vi.fn(),
  load: vi.fn(),
  withdraw: vi.fn(),
  privateLoad: vi.fn(),
}));
vi.mock('../../../lib/firebase.js', () => ({ db: {}, functions: {} }));
vi.mock('../../repository/pools/aiContentClient.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAiContentCallables: () => ({ preview: mocks.preview, generate: mocks.generate }),
}));
vi.mock('../../repository/programs/studyPracticeService.js', () => ({
  saveStudyPractice: (...a: unknown[]) => mocks.save(...a),
  loadPublicStudyPractice: (...a: unknown[]) => mocks.load(...a),
  loadPrivateStudyPractice: (...a: unknown[]) => mocks.privateLoad(...a),
  withdrawStudyPractice: (...a: unknown[]) => mocks.withdraw(...a),
}));
import { StudyPracticeEditor } from '../StudyPracticeEditor.js';
import type { LessonItem } from '../../repository/programs/programsService.js';
import { STUDY_BODY, studyFixture } from '../../repository/programs/__tests__/studyFixture.js';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(null);
  mocks.privateLoad.mockReset();
  mocks.privateLoad.mockResolvedValue(null);
  mocks.save.mockReset();
  mocks.save.mockResolvedValue(undefined);
  mocks.preview.mockResolvedValue({ estimatedCostMicroUsd: 100, reservationCostMicroUsd: 200 });
  mocks.generate.mockResolvedValue({
    output: { questions: studyFixture().questions, studyPlan: studyFixture().plan },
  });
});
const lesson = {
  id: 'l1',
  ownerUid: 'owner',
  importId: 'i1',
  publicLessonId: 'i1_l1',
  completed: true,
  obiettivi: ['Prevedere output'],
} as LessonItem;
describe('teacher practice workflow', () => {
  it('ignores a late initial approval read after explicit withdrawal', async () => {
    let resolve!: (value: ReturnType<typeof studyFixture>) => void;
    mocks.load.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const approved = vi.fn();
    render(
      <StudyPracticeEditor
        lesson={{ ...lesson, studyPractice: studyFixture() }}
        body={STUDY_BODY}
        programId="p1"
        importId="i1"
        ownerUid="owner"
        onDirtyChange={vi.fn()}
        onApprovedChange={approved}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Stima nuova esercitazione').hasAttribute('disabled')).toBe(false),
    );
    fireEvent.click(screen.getByText('Ritira pubblicazione'));
    await waitFor(() => expect(mocks.withdraw).toHaveBeenCalledTimes(1));
    resolve(studyFixture());
    await waitFor(() => expect(approved).toHaveBeenLastCalledWith(undefined));
  });

  it('estimates and generates only on explicit actions, then saves editable draft and publishes separately', async () => {
    const approved = vi.fn();
    render(
      <StudyPracticeEditor
        lesson={lesson}
        body={STUDY_BODY}
        programId="p1"
        importId="i1"
        ownerUid="owner"
        onDirtyChange={vi.fn()}
        onApprovedChange={approved}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText('Stima nuova esercitazione').hasAttribute('disabled')).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('Estensione del percorso'), { target: { value: '3' } });
    fireEvent.click(screen.getByText('Stima nuova esercitazione'));
    await screen.findByText('Genera proposta');
    expect(mocks.generate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Genera proposta'));
    await screen.findByText('Obiettivi e preparazione effettiva');
    expect(mocks.generate.mock.calls[0]![0]).toMatchObject({
      purpose: 'practice',
      plannedObjectives: ['Prevedere output'],
      counts: { aperta: 2, chiusa_singola: 1, chiusa_multipla: 0 },
    });
    fireEvent.change(screen.getAllByLabelText('Aiuto 1')[0]!, {
      target: { value: 'Aiuto rivisto dal docente' },
    });
    fireEvent.click(screen.getByText('Salva bozza'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    expect(mocks.save.mock.calls[0]![0]).toMatchObject({
      publish: false,
      practice: {
        plan: {
          steps: [
            { hints: ['Aiuto rivisto dal docente', 'Poi aggiorna la variabile.'] },
            expect.anything(),
            expect.anything(),
          ],
        },
      },
    });
    fireEvent.click(screen.getByText('Approva e pubblica'));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1]![0].publish).toBe(true);
    expect(approved).toHaveBeenLastCalledWith(expect.stringContaining('Tracciare un ciclo'));
  });
});

function reopenableEditor(staleLesson: LessonItem) {
  return render(
    <StudyPracticeEditor
      lesson={staleLesson}
      body={STUDY_BODY}
      programId="p1"
      importId="i1"
      ownerUid="owner"
      onDirtyChange={vi.fn()}
      onApprovedChange={vi.fn()}
    />,
  );
}
it('reopens a newly saved draft even while the course tree still has no practice', async () => {
  let stored: ReturnType<typeof studyFixture> | null = null;
  mocks.privateLoad.mockImplementation(async () => stored);
  mocks.save.mockImplementation(async (params: { practice: ReturnType<typeof studyFixture> }) => {
    stored = structuredClone(params.practice);
  });
  const view = reopenableEditor(lesson);
  await waitFor(() =>
    expect(screen.getByText('Stima nuova esercitazione').hasAttribute('disabled')).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Estensione del percorso'), { target: { value: '3' } });
  fireEvent.click(screen.getByText('Stima nuova esercitazione'));
  await screen.findByText('Genera proposta');
  fireEvent.click(screen.getByText('Genera proposta'));
  await screen.findByText('Obiettivi e preparazione effettiva');
  fireEvent.change(screen.getAllByLabelText('Aiuto 1')[0]!, {
    target: { value: 'Bozza nuova salvata' },
  });
  fireEvent.click(screen.getByText('Salva bozza'));
  await screen.findByText('Bozza salvata. Pubblicazione ritirata.');
  view.unmount();
  reopenableEditor(lesson);
  await screen.findByDisplayValue('Bozza nuova salvata');
  expect(mocks.privateLoad).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByText('Salva bozza'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0].practice.plan.steps[0].hints[0]).toBe('Bozza nuova salvata');
});
it('reopens edited published practice from its private document instead of the stale lesson snapshot', async () => {
  const original = studyFixture();
  let stored = structuredClone(original);
  mocks.privateLoad.mockImplementation(async () => structuredClone(stored));
  mocks.save.mockImplementation(async (params: { practice: ReturnType<typeof studyFixture> }) => {
    stored = structuredClone(params.practice);
  });
  const staleLesson = { ...lesson, studyPractice: original };
  const view = reopenableEditor(staleLesson);
  await screen.findAllByDisplayValue(original.plan.steps[0]!.hints[0]!);
  fireEvent.change(screen.getAllByLabelText('Aiuto 1')[0]!, {
    target: { value: 'Pratica esistente aggiornata' },
  });
  fireEvent.click(screen.getByText('Approva e pubblica'));
  await screen.findByText('Esercitazione pubblicata.');
  view.unmount();
  reopenableEditor(staleLesson);
  await screen.findByDisplayValue('Pratica esistente aggiornata');
  expect(staleLesson.studyPractice.plan.steps[0]!.hints[0]).toBe(original.plan.steps[0]!.hints[0]);
  fireEvent.click(screen.getByText('Salva bozza'));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[1]![0].practice.plan.steps[0].hints[0]).toBe(
    'Pratica esistente aggiornata',
  );
});
it('blocks editing and saving until the private read resolves', async () => {
  let resolve!: (value: ReturnType<typeof studyFixture>) => void;
  mocks.privateLoad.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  reopenableEditor({ ...lesson, studyPractice: studyFixture() });
  expect(screen.queryByText('Obiettivi e preparazione effettiva')).toBeNull();
  expect(screen.getByText('Stima nuova esercitazione').hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByText('Stima nuova esercitazione'));
  expect(mocks.preview).not.toHaveBeenCalled();
  expect(mocks.save).not.toHaveBeenCalled();
  const newest = studyFixture();
  newest.plan.steps[0]!.hints[0] = 'Documento privato aggiornato';
  resolve(newest);
  await screen.findByDisplayValue('Documento privato aggiornato');
});
