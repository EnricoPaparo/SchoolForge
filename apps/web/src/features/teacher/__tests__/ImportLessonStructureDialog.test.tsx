import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportLessonStructureDialog } from '../ImportLessonStructureDialog.js';
import { STRUCTURE_IMPORT_LIMITS } from '../../repository/structureImport/index.js';

/**
 * STRUCTURE-IMPORT-02B — il dialog «Importa lezioni».
 *
 * Oltre alla lettura byte-first (`file.arrayBuffer()`, mai `File.text()`, qui
 * reso una trappola), il punto specifico di 02B è che la **UDA di destinazione**
 * sia visibile: il file non la contiene, quindi è l'unico modo che il docente ha
 * per accorgersi di aver aperto il menu sbagliato prima di confermare.
 */

afterEach(cleanup);

vi.mock('../../../lib/firebase.js', () => ({ db: {}, storage: {}, functions: {} }));

const VALID_YAML = `schema: schoolforge-lesson-metadata/v1
lessons:
  - titolo: Che cos'è una rete
    sottotitolo: Dispositivi e comunicazione
    difficolta: introduttiva
    concettiChiave:
      - nodo
      - protocollo
    obiettivi:
      - Definire una rete
  - titolo: Indirizzi IP
    difficolta: intermedia
    concettiChiave:
      - indirizzo IP
    obiettivi:
      - Comprendere l'indirizzo IP
`;

function fileOf(bytes: Uint8Array, name = 'schoolforge-lezioni.yaml'): File {
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
      throw new Error('File.text() non è ammesso: il percorso deve essere byte-first');
    },
  });
  return file;
}

const yamlFile = (text: string, name?: string): File =>
  fileOf(new TextEncoder().encode(text), name);

function renderDialog(overrides: Partial<Parameters<typeof ImportLessonStructureDialog>[0]> = {}) {
  const onConfirm = vi.fn(async () => 2);
  const onCancel = vi.fn();
  const utils = render(
    <ImportLessonStructureDialog
      udaTitle="Le reti"
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
  fireEvent.change(screen.getByLabelText('File YAML delle lezioni'), {
    target: { files: [file] },
  });
}

describe('selezione', () => {
  it('nomina la UDA di destinazione e dichiara che le lezioni nascono vuote', () => {
    renderDialog();
    expect(screen.getByText(/UDA «Le reti»/)).toBeTruthy();
    expect(screen.getByText(/non crea domande o pool/i)).toBeTruthy();
    expect(screen.getByLabelText('File YAML delle lezioni').getAttribute('accept')).toBe(
      '.yaml,.yml',
    );
  });

  it('scarica il modello canonico lato client', () => {
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

describe('validazione byte-first', () => {
  it('mostra il riepilogo completo, con la destinazione', async () => {
    renderDialog();
    pick(yamlFile(VALID_YAML));
    expect(await screen.findByText(/2 lezioni verranno aggiunte/)).toBeTruthy();
    // La destinazione resta nominata anche nel riepilogo, non solo nell'intro.
    expect(screen.getAllByText(/UDA «Le reti»/).length).toBeGreaterThanOrEqual(2);
    const voci = screen.getAllByRole('listitem');
    expect(voci).toHaveLength(2);
    expect(voci[0]!.textContent ?? '').toContain("Che cos'è una rete");
    expect(voci[0]!.textContent ?? '').toContain('Dispositivi e comunicazione');
    expect(voci[0]!.textContent ?? '').toContain('introduttiva');
    expect(voci[0]!.textContent ?? '').toContain('nodo, protocollo');
    expect(voci[0]!.textContent ?? '').toContain('Definire una rete');
    // La seconda lezione non ha sottotitolo: l'assenza è dichiarata.
    expect(voci[1]!.textContent ?? '').toContain('Nessun sottotitolo');
    expect(screen.getByText(/corpo Markdown vuoto e senza pool/i)).toBeTruthy();
    expect(screen.getByText(/Nessuna lezione esistente verrà modificata/i)).toBeTruthy();
  });

  it('rifiuta estensione non ammessa, UTF-8 non valido e file oltre limite', async () => {
    const { onConfirm, rerender } = renderDialog();
    pick(yamlFile(VALID_YAML, 'lezioni.json'));
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(/\.yaml o \.yml/i);

    rerender(
      <ImportLessonStructureDialog
        udaTitle="Le reti"
        busy={false}
        error={null}
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    pick(fileOf(new Uint8Array([0x74, 0x3a, 0x20, 0xc3, 0x28])));
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(/UTF-8/i);

    pick(fileOf(new Uint8Array(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES + 1).fill(0x20)));
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(/limite/i);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('importazione', () => {
  it('conferma con i byte e il nome originale', async () => {
    const { onConfirm } = renderDialog();
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 lezioni verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [bytes, filename] = onConfirm.mock.calls[0] as unknown as [Uint8Array, string];
    expect(new TextDecoder().decode(bytes)).toBe(VALID_YAML);
    expect(filename).toBe('schoolforge-lezioni.yaml');
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
    await screen.findByText(/2 lezioni verranno aggiunte/);
    const submit = screen.getByRole('button', { name: 'Importa lezioni' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolveImport(2);
  });

  it('durante l’importazione i comandi sono disabilitati e non si chiude', () => {
    const { onCancel } = renderDialog({ busy: true });
    expect((screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('mostra l’esito e ricorda che le lezioni sono vuote', async () => {
    renderDialog({ onConfirm: vi.fn(async () => 5) });
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 lezioni verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    expect(await screen.findByText(/5 lezioni aggiunte alla UDA/)).toBeTruthy();
    expect(screen.getByText(/nasce vuota/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Importa lezioni' })).toBeNull();
  });

  it('un errore conserva file e riepilogo per il retry', async () => {
    const onConfirm = vi.fn(async () => null);
    const { rerender } = renderDialog({ onConfirm });
    pick(yamlFile(VALID_YAML));
    await screen.findByText(/2 lezioni verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));

    rerender(
      <ImportLessonStructureDialog
        udaTitle="Le reti"
        busy={false}
        error="Importazione non applicata: la UDA è rimasta invariata. Puoi riprovare."
        onCancel={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent ?? '').toMatch(/rimasta invariata/);
    expect(alert.textContent ?? '').not.toMatch(/repository\/|[0-9a-f]{64}/i);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
  });
});
