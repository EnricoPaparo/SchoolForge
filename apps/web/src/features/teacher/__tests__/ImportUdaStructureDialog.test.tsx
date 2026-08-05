import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportUdaStructureDialog } from '../ImportUdaStructureDialog.js';
import { STRUCTURE_IMPORT_LIMITS } from '../../repository/structureImport/index.js';

/**
 * STRUCTURE-IMPORT-02A — il dialog «Importa struttura UDA».
 *
 * Il punto delicato è che la lettura sia davvero **byte-first**: il dialog deve
 * usare `file.arrayBuffer()` e mai `file.text()`, altrimenti un file con byte
 * UTF-8 non validi verrebbe importato con i titoli rovinati invece di essere
 * rifiutato. jsdom non implementa nessuno dei due, quindi entrambi sono forniti
 * qui e `text()` è volutamente una trappola che fa fallire il test.
 */

afterEach(cleanup);

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

const VALID_YAML = `schema: schoolforge-uda-metadata/v1
udas:
  - titolo: Introduzione alle reti
    descrizione: Fondamenti della comunicazione.
    competenze:
      - Comprendere una rete
      - Distinguere i dispositivi
    obiettivi:
      - Conoscere il protocollo
  - titolo: Il livello di trasporto
    competenze:
      - Analizzare TCP
    obiettivi:
      - Confrontare TCP e UDP
`;

/** A `File` whose bytes are readable, and whose `text()` would fail the test. */
function fileOf(bytes: Uint8Array, name = 'schoolforge-udas.yaml'): File {
  const file = new File([new Uint8Array(bytes)], name, { type: 'text/yaml' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => {
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      return buffer;
    },
  });
  Object.defineProperty(file, 'text', {
    value: async () => {
      throw new Error('File.text() non è una sorgente ammessa: il percorso deve essere byte-first');
    },
  });
  return file;
}

const yamlFile = (text: string, name?: string): File =>
  fileOf(new TextEncoder().encode(text), name);

function renderDialog(overrides: Partial<Parameters<typeof ImportUdaStructureDialog>[0]> = {}) {
  const onConfirm = vi.fn(async () => 2);
  const onCancel = vi.fn();
  const utils = render(
    <ImportUdaStructureDialog
      courseTitle="Informatica"
      busy={false}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...overrides}
    />,
  );
  return { onConfirm, onCancel, ...utils };
}

function pick(file: File): void {
  const input = screen.getByLabelText('File YAML delle UDA');
  fireEvent.change(input, { target: { files: [file] } });
}

describe('selezione e modello', () => {
  it('accetta solo .yaml/.yml e dichiara che non importa contenuti', () => {
    renderDialog();
    expect(screen.getByLabelText('File YAML delle UDA').getAttribute('accept')).toBe('.yaml,.yml');
    expect(screen.getByText(/non importa lezioni, contenuti o pool/i)).toBeTruthy();
    expect(screen.getByText(/le uda esistenti non vengono modificate/i)).toBeTruthy();
  });

  it('scarica il modello canonico interamente lato client', () => {
    const createObjectURL = vi.fn(() => 'blob:modello');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Scarica modello YAML' }));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:modello');
    click.mockRestore();
  });
});

describe('validazione locale byte-first', () => {
  it('mostra il riepilogo completo di un file valido', async () => {
    renderDialog();
    pick(yamlFile(VALID_YAML));
    expect(await screen.findByText(/2 UDA verranno aggiunte/)).toBeTruthy();
    expect(screen.getByText('Introduzione alle reti')).toBeTruthy();
    expect(screen.getByText(/Fondamenti della comunicazione/)).toBeTruthy();
    expect(screen.getByText(/2 competenze/)).toBeTruthy();
    // Entrambe le UDA hanno un solo obiettivo: due occorrenze attese.
    expect(screen.getAllByText(/1 obiettivo/)).toHaveLength(2);
    // La seconda UDA non ha descrizione: l'assenza è dichiarata, non nascosta.
    const voci = screen.getAllByRole('listitem');
    expect(voci).toHaveLength(2);
    expect(voci[1]!.textContent ?? '').toContain('Nessuna descrizione');
    expect(
      screen.getByText(/Nessuna UDA esistente verrà modificata, rinominata o sovrascritta/),
    ).toBeTruthy();
  });

  it('rifiuta un’estensione non ammessa senza chiamare l’import', async () => {
    const { onConfirm } = renderDialog();
    pick(yamlFile(VALID_YAML, 'udas.json'));
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(
      /estensione \.yaml o \.yml/i,
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rifiuta byte UTF-8 non validi invece di ripararli', async () => {
    const { onConfirm } = renderDialog();
    pick(fileOf(new Uint8Array([0x74, 0x3a, 0x20, 0xc3, 0x28])));
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(/UTF-8/i);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rifiuta un file oltre il limite, misurato sui byte', async () => {
    renderDialog();
    pick(fileOf(new Uint8Array(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES + 1).fill(0x20)));
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(/limite/i);
  });

  it('mostra l’errore di validazione del contenuto e non abilita l’invio', async () => {
    renderDialog();
    pick(yamlFile('schema: schoolforge-uda-metadata/v1\nudas: []\n'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Importa UDA' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('selezionare un secondo file sostituisce il riepilogo precedente', async () => {
    renderDialog();
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 UDA verranno aggiunte/);
    pick(yamlFile('schema: sbagliato\n'));
    await waitFor(() => expect(screen.queryByText(/2 UDA verranno aggiunte/)).toBeNull());
  });
});

describe('importazione', () => {
  it('conferma con i byte del file e il nome originale', async () => {
    const { onConfirm } = renderDialog();
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 UDA verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [bytes, filename] = onConfirm.mock.calls[0] as unknown as [Uint8Array, string];
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe(VALID_YAML);
    expect(filename).toBe('schoolforge-udas.yaml');
  });

  it('il doppio click non avvia due importazioni', async () => {
    let resolveImport: (value: number) => void = () => {};
    const onConfirm = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveImport = resolve;
        }),
    );
    renderDialog({ onConfirm });
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 UDA verranno aggiunte/);
    const submit = screen.getByRole('button', { name: 'Importa UDA' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolveImport(2);
  });

  it('durante l’importazione i comandi sono disabilitati e lo stato è accessibile', async () => {
    renderDialog({ busy: true });
    expect((screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(
      (screen.getByRole('button', { name: 'Importazione…' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('status').textContent ?? '').toMatch(/Importazione in corso/);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('mostra l’esito con il numero di UDA aggiunte', async () => {
    renderDialog({ onConfirm: vi.fn(async () => 3) });
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 UDA verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    expect(await screen.findByText(/3 UDA aggiunte al corso/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Chiudi' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByRole('button', { name: 'Importa UDA' })).toBeNull();
  });

  it('un errore conserva file e riepilogo per il retry', async () => {
    const onConfirm = vi.fn(async () => null);
    const { rerender } = renderDialog({ onConfirm });
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 UDA verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    rerender(
      <ImportUdaStructureDialog
        courseTitle="Informatica"
        busy={false}
        error="Importazione non applicata: il corso è rimasto invariato. Puoi riprovare."
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole('alert').textContent ?? '').toMatch(/rimasto invariato/);
    // Il riepilogo è ancora lì: il docente può riprovare senza riscegliere il file.
    expect(screen.getByText('Introduzione alle reti')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });

  it('l’errore mostrato non contiene stack, path, UID o hash', async () => {
    renderDialog({
      error: 'Importazione non applicata: il corso è rimasto invariato. Puoi riprovare.',
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toMatch(/repository\/|firestore|\.ts:|[0-9a-f]{64}/i);
  });
});

describe('chiusura sicura', () => {
  it('Escape chiude quando non si sta importando', () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('Escape non chiude durante l’importazione', () => {
    const { onCancel } = renderDialog({ busy: true });
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
