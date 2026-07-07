import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuestionPicker } from '../QuestionPicker.js';
import type { QuestionIndexEntry } from '../../repository/verifications/questionIndexService.js';

afterEach(cleanup);

const ENTRIES: QuestionIndexEntry[] = [
  {
    id: 'qi-1',
    udaDir: 'uda-01-reti',
    lessonFilename: 'lezione-001-intro.md',
    poolStorageRef: 'gs://bucket/uda-01-reti/lezione-001-intro.pool.md',
    questionLocalId: 'q1',
    tipo: 'aperta',
    difficolta: 1,
    peso: 2,
    maxPoints: 2,
  },
  {
    id: 'qi-2',
    udaDir: 'uda-01-reti',
    lessonFilename: 'lezione-002-tcp.md',
    poolStorageRef: 'gs://bucket/uda-01-reti/lezione-002-tcp.pool.md',
    questionLocalId: 'q2',
    tipo: 'chiusa_singola',
    difficolta: 2,
    peso: 3,
    maxPoints: 3,
  },
  {
    id: 'qi-3',
    udaDir: 'uda-02-sicurezza',
    lessonFilename: 'lezione-003-firewall.md',
    poolStorageRef: 'gs://bucket/uda-02-sicurezza/lezione-003-firewall.pool.md',
    questionLocalId: 'q3',
    tipo: 'chiusa_multipla',
    difficolta: 3,
    peso: 3,
    maxPoints: 5,
  },
];

function renderPicker(selectedIds: Set<string> = new Set()) {
  const onChange = vi.fn();
  const utils = render(
    <QuestionPicker entries={ENTRIES} selectedIds={selectedIds} onChange={onChange} />,
  );
  return { onChange, ...utils };
}

function questionList() {
  return screen.getByRole('list', { name: 'Elenco domande filtrate' });
}

describe('QuestionPicker — filters', () => {
  it('shows all filter controls', () => {
    renderPicker();
    expect(screen.getByLabelText('Cerca domande')).toBeTruthy();
    expect(screen.getByLabelText('Filtra per UDA')).toBeTruthy();
    expect(screen.getByLabelText('Filtra per lezione')).toBeTruthy();
    expect(screen.getByLabelText('Filtra per tipo')).toBeTruthy();
    expect(screen.getByLabelText('Filtra per difficoltà')).toBeTruthy();
  });

  it('filters by UDA', () => {
    renderPicker();
    expect(within(questionList()).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.change(screen.getByLabelText('Filtra per UDA'), {
      target: { value: 'uda-02-sicurezza' },
    });
    const list = questionList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/lezione-003-firewall\.md/)).toBeTruthy();
  });

  it('filters by lesson', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Filtra per lezione'), {
      target: { value: 'lezione-002-tcp.md' },
    });
    const list = questionList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/lezione-002-tcp\.md/)).toBeTruthy();
  });

  it('filters by tipo', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Filtra per tipo'), {
      target: { value: 'chiusa_multipla' },
    });
    const list = questionList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/lezione-003-firewall\.md/)).toBeTruthy();
  });

  it('filters by difficolta', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Filtra per difficoltà'), {
      target: { value: '2' },
    });
    const list = questionList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/lezione-002-tcp\.md/)).toBeTruthy();
  });

  it('filters by free-text search across UDA, lesson and question id', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Cerca domande'), { target: { value: 'firewall' } });
    let list = questionList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText(/lezione-003-firewall\.md/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Cerca domande'), { target: { value: 'q1' } });
    list = questionList();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('#q1')).toBeTruthy();
  });

  it('shows an empty state when no question matches the filters', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Cerca domande'), {
      target: { value: 'nessuna-corrispondenza' },
    });
    expect(screen.getByText(/Nessuna domanda corrisponde ai filtri/)).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Elenco domande filtrate' })).toBeNull();
  });
});

describe('QuestionPicker — selection', () => {
  it('toggles a single question and calls onChange with the updated set', () => {
    const { onChange } = renderPicker();
    fireEvent.click(screen.getByLabelText('Seleziona domanda q1'));
    expect(onChange).toHaveBeenCalledWith(new Set(['qi-1']));
  });

  it('selects all filtered questions', () => {
    const { onChange } = renderPicker();
    fireEvent.change(screen.getByLabelText('Filtra per UDA'), {
      target: { value: 'uda-01-reti' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Seleziona tutte le domande filtrate' }));
    expect(onChange).toHaveBeenCalledWith(new Set(['qi-1', 'qi-2']));
  });

  it('deselects all filtered questions, keeping selections outside the filter', () => {
    const { onChange } = renderPicker(new Set(['qi-1', 'qi-2', 'qi-3']));
    fireEvent.change(screen.getByLabelText('Filtra per UDA'), {
      target: { value: 'uda-01-reti' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deseleziona tutte le domande filtrate' }));
    expect(onChange).toHaveBeenCalledWith(new Set(['qi-3']));
  });

  it('disables select-all when every filtered question is already selected', () => {
    renderPicker(new Set(['qi-1', 'qi-2', 'qi-3']));
    expect(
      screen.getByRole('button', { name: 'Seleziona tutte le domande filtrate' }),
    ).toHaveProperty('disabled', true);
  });

  it('disables deselect-all when no filtered question is selected', () => {
    renderPicker();
    expect(
      screen.getByRole('button', { name: 'Deseleziona tutte le domande filtrate' }),
    ).toHaveProperty('disabled', true);
  });

  it('updates the live counters (selected count and total points)', () => {
    renderPicker(new Set(['qi-1', 'qi-3']));
    expect(screen.getByText('3 domande trovate')).toBeTruthy();
    // 2 selected, maxPoints 2 + 5 = 7
    expect(screen.getByLabelText('Domande selezionate (contatore)').textContent).toMatch(
      /2 selezionate/,
    );
    expect(screen.getByLabelText('Punti totali selezionati').textContent).toMatch(/7 punti totali/);
  });
});

describe('QuestionPicker — selected summary', () => {
  it('shows an empty summary message when nothing is selected', () => {
    renderPicker();
    expect(screen.getByText('Nessuna domanda selezionata.')).toBeTruthy();
  });

  it('lists selected questions with UDA, lesson, tipo and points', () => {
    renderPicker(new Set(['qi-1', 'qi-3']));
    const region = screen.getByRole('region', { name: 'Domande selezionate' });
    expect(within(region).getByText(/uda-01-reti \/ lezione-001-intro\.md · aperta/)).toBeTruthy();
    expect(
      within(region).getByText(/uda-02-sicurezza \/ lezione-003-firewall\.md · chiusa multipla/),
    ).toBeTruthy();
    expect(within(region).getByText('2pt')).toBeTruthy();
    expect(within(region).getByText('5pt')).toBeTruthy();
  });

  it('removes a question from the summary and calls onChange without it', () => {
    const { onChange } = renderPicker(new Set(['qi-1', 'qi-2']));
    fireEvent.click(screen.getByLabelText('Rimuovi domanda q1 dal riepilogo'));
    expect(onChange).toHaveBeenCalledWith(new Set(['qi-2']));
  });
});

describe('QuestionPicker — content safety', () => {
  it('never renders question text, answers, correctAnswer or solution', () => {
    renderPicker(new Set(['qi-1', 'qi-2', 'qi-3']));
    const rendered = document.body.textContent ?? '';
    expect(rendered).not.toMatch(/questionText/i);
    expect(rendered).not.toMatch(/correctAnswer/i);
    expect(rendered).not.toMatch(/solution/i);
    expect(rendered).not.toMatch(/answers/i);
  });
});
