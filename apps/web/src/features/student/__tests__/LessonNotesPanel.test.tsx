import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockLoad = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../studentLessonNotesService.js', async () => {
  const actual = (await vi.importActual('../studentLessonNotesService.js')) as Record<
    string,
    unknown
  >;
  return {
    ...actual,
    loadStudentLessonNote: (...a: unknown[]) => mockLoad(...a),
    createStudentLessonNote: (...a: unknown[]) => mockCreate(...a),
    updateStudentLessonNote: (...a: unknown[]) => mockUpdate(...a),
    deleteStudentLessonNote: (...a: unknown[]) => mockDelete(...a),
  };
});

import { LessonNotesPanel } from '../LessonNotesPanel.js';
import { useLessonNotes } from '../useLessonNotes.js';
import { StudentLessonNoteError } from '../studentLessonNotesService.js';
import type { Firestore } from 'firebase/firestore';

const db = {} as Firestore;
const identity = {
  studentUid: 'student-uid',
  publicLessonId: 'i1_lesson-1',
  programId: 'p1',
  importId: 'i1',
};

function Harness({ isMobile = false }: { isMobile?: boolean }) {
  const controller = useLessonNotes(db);
  return (
    <>
      <button type="button" onClick={() => controller.open(identity)}>
        apri
      </button>
      <LessonNotesPanel controller={controller} isMobile={isMobile} />
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({ state: 'missing' });
  mockCreate.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
  mockDelete.mockResolvedValue(undefined);
});

afterEach(cleanup);

async function openAndLoad() {
  fireEvent.click(screen.getByText('apri'));
  await waitFor(() => expect(screen.getByLabelText('Testo degli appunti')).toBeTruthy());
}

describe('LessonNotesPanel — desktop', () => {
  it('renders a non-modal aside named Appunti (complementary role)', async () => {
    render(<Harness />);
    await openAndLoad();
    const aside = screen.getByRole('complementary', { name: 'Appunti' });
    expect(aside.tagName).toBe('ASIDE');
    // Non-modal: no dialog role, no aria-modal on the panel.
    expect(aside.getAttribute('aria-modal')).toBeNull();
  });

  it('enforces maxLength 20000 and shows a live counter', async () => {
    render(<Harness />);
    await openAndLoad();
    const textarea = screen.getByLabelText('Testo degli appunti') as HTMLTextAreaElement;
    expect(textarea.maxLength).toBe(20000);
    expect(screen.getByText('0/20.000')).toBeTruthy();
    fireEvent.change(textarea, { target: { value: 'ab' } });
    expect(screen.getByText('2/20.000')).toBeTruthy();
  });

  it('saves on blur (create)', async () => {
    render(<Harness />);
    await openAndLoad();
    const textarea = screen.getByLabelText('Testo degli appunti');
    fireEvent.change(textarea, { target: { value: 'nota' } });
    await act(async () => {
      fireEvent.blur(textarea);
    });
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
  });

  it('Escape closes when clean', async () => {
    render(<Harness />);
    await openAndLoad();
    const aside = screen.getByRole('complementary', { name: 'Appunti' });
    fireEvent.keyDown(aside, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Appunti' })).toBeNull(),
    );
  });

  it('Escape when dirty opens the discard confirmation instead of closing', async () => {
    render(<Harness />);
    await openAndLoad();
    const textarea = screen.getByLabelText('Testo degli appunti');
    fireEvent.change(textarea, { target: { value: 'dirty' } });
    fireEvent.keyDown(screen.getByRole('complementary', { name: 'Appunti' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Modifiche non salvate' })).toBeTruthy();
    // still open behind the dialog
    expect(screen.getByLabelText('Testo degli appunti')).toBeTruthy();
    fireEvent.click(screen.getByText('Esci senza salvare'));
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Appunti' })).toBeNull(),
    );
    fireEvent.click(screen.getByText('apri'));
    await waitFor(() => expect(screen.getByLabelText('Testo degli appunti')).toBeTruthy());
    expect((screen.getByLabelText('Testo degli appunti') as HTMLTextAreaElement).value).toBe('');
  });

  it('retries a failed load from the error surface', async () => {
    mockLoad
      .mockRejectedValueOnce(new StudentLessonNoteError('unavailable', 'x'))
      .mockResolvedValueOnce({ state: 'missing' });
    render(<Harness />);
    fireEvent.click(screen.getByText('apri'));
    expect(await screen.findByRole('button', { name: 'Riprova' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Riprova' }));
    await waitFor(() => expect(screen.getByLabelText('Testo degli appunti')).toBeTruthy());
    expect(mockLoad).toHaveBeenCalledTimes(2);
  });

  it('deleting an existing note confirms, keeps the panel open and clears the text', async () => {
    mockLoad.mockResolvedValue({
      state: 'existing',
      note: { ...identity, content: 'da eliminare', createdAt: null, updatedAt: null },
    });
    render(<Harness />);
    await openAndLoad();
    expect((screen.getByLabelText('Testo degli appunti') as HTMLTextAreaElement).value).toBe(
      'da eliminare',
    );
    fireEvent.click(screen.getByText('Elimina appunti'));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledTimes(1));
    // Panel stays open, text cleared.
    expect(screen.getByRole('complementary', { name: 'Appunti' })).toBeTruthy();
    await waitFor(() =>
      expect((screen.getByLabelText('Testo degli appunti') as HTMLTextAreaElement).value).toBe(''),
    );
  });

  it('does not offer delete for a brand-new empty note', async () => {
    render(<Harness />);
    await openAndLoad();
    expect(screen.queryByText('Elimina appunti')).toBeNull();
  });

  it('keeps the delete dialog open and exposes the error when deletion fails', async () => {
    mockLoad.mockResolvedValue({
      state: 'existing',
      note: { ...identity, content: 'importante', createdAt: null, updatedAt: null },
    });
    mockDelete.mockRejectedValue(new StudentLessonNoteError('unavailable', 'x'));
    render(<Harness />);
    await openAndLoad();
    fireEvent.click(screen.getByText('Elimina appunti'));
    fireEvent.click(screen.getByRole('button', { name: 'Elimina' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Elimina appunti' })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getAllByText('Errore. Riprova il salvataggio.').length).toBeGreaterThan(0),
    );
  });
});

describe('LessonNotesPanel — mobile', () => {
  it('renders the dedicated full-width view with a Salva button and back link', async () => {
    render(<Harness isMobile />);
    await openAndLoad();
    const region = screen.getByRole('region', { name: 'Appunti' });
    expect(region.tagName).toBe('SECTION');
    expect(screen.getByText('← Torna alla lezione')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salva' })).toBeTruthy();
    // No structural horizontal overflow: the textarea is width-constrained, not fixed-position.
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
