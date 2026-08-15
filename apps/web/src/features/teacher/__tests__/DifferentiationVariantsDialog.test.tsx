import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DifferentiationVariantsDialog } from '../DifferentiationVariantsDialog.js';

afterEach(cleanup);

const entries = [
  {
    id: 'base',
    udaDir: 'UDA1',
    lessonFilename: 'l1.md',
    poolStorageRef: 'p',
    questionLocalId: 'q1',
    tipo: 'aperta' as const,
    difficolta: 2 as const,
    maxPoints: 2,
    questionPreview: 'Domanda base?',
  },
  {
    id: 'alt',
    udaDir: 'UDA1',
    lessonFilename: 'l1.md',
    poolStorageRef: 'p',
    questionLocalId: 'q2',
    tipo: 'aperta' as const,
    difficolta: 2 as const,
    maxPoints: 2,
    questionPreview: 'Domanda alternativa?',
  },
  {
    id: 'other-lesson',
    udaDir: 'UDA1',
    lessonFilename: 'l2.md',
    poolStorageRef: 'p',
    questionLocalId: 'q3',
    tipo: 'aperta' as const,
    difficolta: 2 as const,
    maxPoints: 2,
    questionPreview: 'Altra lezione?',
  },
];
const labels = [
  {
    labelId: 'b',
    ownerUid: 'o',
    name: 'Percorso B',
    nameKey: 'percorso b',
    assignedCount: 0,
    draftUsageCount: 0,
  },
  {
    labelId: 'a',
    ownerUid: 'o',
    name: 'Percorso A',
    nameKey: 'percorso a',
    assignedCount: 0,
    draftUsageCount: 0,
  },
];

function renderDialog(onSave = vi.fn(), onCancel = vi.fn()) {
  render(
    <DifferentiationVariantsDialog
      baseEntry={entries[0]!}
      labels={labels}
      questionIndex={entries}
      selectedIds={new Set(['base'])}
      equivalentGroups={[]}
      onCancel={onCancel}
      onSave={onSave}
    />,
  );
  return { onSave, onCancel };
}

describe('DifferentiationVariantsDialog', () => {
  it('mostra intestazione, anteprima, etichette alfabetiche e tre scelte accessibili', () => {
    renderDialog();
    expect(screen.getByText('Domanda #q1')).toBeTruthy();
    expect(screen.getByText('Domanda base?')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 4 });
    expect(headings.map((item) => item.textContent?.trim())).toEqual(['Percorso A', 'Percorso B']);
    expect(screen.getAllByRole('radio')).toHaveLength(6);
  });

  it('seleziona una alternativa reale della stessa lezione e salva solo il draft locale', () => {
    const { onSave } = renderDialog();
    fireEvent.click(screen.getAllByLabelText('Alternativa')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /scegli alternativa per percorso a/i }));
    fireEvent.click(screen.getByRole('option', { name: /domanda alternativa/i }));
    fireEvent.click(screen.getByRole('button', { name: /salva varianti/i }));
    expect(onSave).toHaveBeenCalledWith({
      version: 1,
      questions: [
        {
          baseQuestionIndexEntryId: 'base',
          choices: { a: { kind: 'alternative', questionIndexEntryId: 'alt' } },
        },
      ],
    });
  });

  it('usa una conferma nello stesso DialogShell per chiusura dirty', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getAllByLabelText('Nessuna')[0]!);
    fireEvent.click(screen.getByRole('button', { name: /annulla/i }));
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /continua a modificare/i }));
    expect(screen.getByText('Domanda base?')).toBeTruthy();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('centra soltanto su desktop i tre comandi della conferma con larghezza uguale', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/DifferentiationVariantsDialog.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*641px\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.confirmActions\s*\{[^}]*justify-content:\s*center/s,
    );
    expect(css).toMatch(
      /\.confirmActions button\s*\{[^}]*flex:\s*0\s+1\s+12\.5rem[^}]*min-width:\s*12\.5rem/s,
    );
    expect(css).not.toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.confirmActions button\s*\{/s);
  });

  it('chiude subito quando non è dirty', () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: /annulla/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
