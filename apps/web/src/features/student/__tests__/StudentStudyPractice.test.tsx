import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  listeners: new Map<string, { next: (v: unknown) => void; error: (e: unknown) => void }>(),
  unsubscribe: vi.fn(),
}));
vi.mock('../../../lib/firebase.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  onSnapshot: (path: string, next: (v: unknown) => void, error: (e: unknown) => void) => {
    mocks.listeners.set(path, { next, error });
    return mocks.unsubscribe;
  },
}));
import { StudentStudyPractice } from '../StudentStudyPractice.js';
import { STUDY_BODY, studyFixture } from '../../repository/programs/__tests__/studyFixture.js';
afterEach(() => {
  cleanup();
  mocks.listeners.clear();
  vi.clearAllMocks();
});
const snap = (data: unknown) => ({ exists: () => !!data, data: () => data });
describe('live practice invalidation', () => {
  it('does not read until opened, resets answers on artifact replacement and clears on revocation', () => {
    render(<StudentStudyPractice publicLessonId="i1_l1" body={STUDY_BODY} />);
    expect(mocks.listeners.size).toBe(0);
    fireEvent.click(screen.getByText('Apri esercitazione'));
    act(() => {
      mocks.listeners
        .get('publicLessons/i1_l1')!
        .next(snap({ completed: true, content: STUDY_BODY }));
      mocks.listeners.get('publicLessonPractice/i1_l1')!.next(snap({ practice: studyFixture() }));
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Risposta privata' } });
    const changed = studyFixture();
    changed.plan.steps[1]!.hints[0] = 'Un nuovo suggerimento.';
    act(() => mocks.listeners.get('publicLessonPractice/i1_l1')!.next(snap({ practice: changed })));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
    act(() => mocks.listeners.get('publicLessons/i1_l1')!.error({ code: 'permission-denied' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/Nessuna esercitazione/)).toBeTruthy();
  });
  it('hides old source immediately and unsubscribes both listeners on close', () => {
    render(<StudentStudyPractice publicLessonId="i1_l1" body={STUDY_BODY} />);
    fireEvent.click(screen.getByText('Apri esercitazione'));
    act(() => {
      mocks.listeners
        .get('publicLessons/i1_l1')!
        .next(snap({ completed: true, content: STUDY_BODY }));
      mocks.listeners.get('publicLessonPractice/i1_l1')!.next(snap({ practice: studyFixture() }));
    });
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() =>
      mocks.listeners
        .get('publicLessons/i1_l1')!
        .next(snap({ completed: true, content: STUDY_BODY + ' edit' })),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByText('Chiudi esercitazione'));
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(2);
  });
});
