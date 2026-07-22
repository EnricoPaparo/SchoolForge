import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ImportUdaDialog } from '../workspaceDialogs.js';

afterEach(cleanup);

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

const UDA_MD = `---
titolo: "Reti"
competenze:
  - "c"
obiettivi:
  - "o"
---
# Reti`;

async function validZipFile(): Promise<File> {
  const zip = new JSZip();
  zip.file('uda-03-reti/uda-03-reti.md', UDA_MD);
  zip.file('uda-03-reti/lezione-001-http.md', '# HTTP');
  const blob = await zip.generateAsync({ type: 'blob' });
  return new File([blob], 'reti.zip', { type: 'application/zip' });
}

function renderDialog(overrides: Partial<Parameters<typeof ImportUdaDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ImportUdaDialog
      courseTitle="Informatica"
      busy={false}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ImportUdaDialog', () => {
  it('validates locally and shows a summary, then confirms with the read files', async () => {
    const { onConfirm } = renderDialog();

    // Confirm is disabled until a valid archive is selected.
    const confirm = screen.getByRole('button', { name: 'Importa UDA' });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('File ZIP della UDA'), {
      target: { files: [await validZipFile()] },
    });

    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toMatch(/UDA: Reti .*1 lezioni/),
    );
    expect((confirm as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const files = onConfirm.mock.calls[0]?.[0] as Array<{ path: string }>;
    expect(files.map((f) => f.path).sort()).toEqual([
      'uda-03-reti/lezione-001-http.md',
      'uda-03-reti/uda-03-reti.md',
    ]);
  });

  it('shows a specific error for an invalid archive and keeps confirm disabled', async () => {
    renderDialog();
    const zip = new JSZip();
    // Two UDA folders → blocking.
    zip.file('uda-03-reti/uda-03-reti.md', UDA_MD);
    zip.file('uda-03-reti/lezione-001-x.md', '# x');
    zip.file('uda-04-sic/uda-04-sic.md', UDA_MD);
    zip.file('uda-04-sic/lezione-001-y.md', '# y');
    const blob = await zip.generateAsync({ type: 'blob' });

    fireEvent.change(screen.getByLabelText('File ZIP della UDA'), {
      target: { files: [new File([blob], 'due.zip', { type: 'application/zip' })] },
    });

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/esattamente una UDA/),
    );
    expect(
      (screen.getByRole('button', { name: 'Importa UDA' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('disables the confirm button while busy (double-click guard)', () => {
    renderDialog({ busy: true });
    expect(
      (screen.getByRole('button', { name: 'Importazione…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
