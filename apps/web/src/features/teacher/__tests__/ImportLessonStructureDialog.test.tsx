import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportLessonStructureDialog } from '../ImportLessonStructureDialog.js';
import { LESSON_METADATA_TEMPLATE } from '../../repository/structureImport/index.js';

/**
 * STRUCTURE-IMPORT-02B + STRUCTURE-IMPORT-UI-PASTE-01 — il dialog «Importa
 * lezioni».
 *
 * Il docente incolla lo YAML; il punto specifico di 02B resta che la **UDA di
 * destinazione** sia visibile, perché la struttura non la contiene ed è l'unico
 * modo che il docente ha per accorgersi di aver aperto il menu sbagliato prima
 * di confermare.
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

const area = (): HTMLTextAreaElement =>
  screen.getByLabelText('Struttura lezioni in YAML') as HTMLTextAreaElement;

const verifyButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Verifica struttura' }) as HTMLButtonElement;

function paste(text: string): void {
  fireEvent.change(area(), { target: { value: text } });
}

function verify(): void {
  fireEvent.click(verifyButton());
}

describe('anatomia della finestra', () => {
  it('offre una sola textarea etichettata, con il testo di supporto associato', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const textarea = area();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('');
    expect(Number(textarea.getAttribute('rows'))).toBeGreaterThanOrEqual(12);
    expect(textarea.getAttribute('aria-describedby')).toBe('import-lesson-structure-help');
    expect(
      screen.getByText(
        'Incolla qui la struttura YAML. Puoi copiare un esempio dalla sezione Template.',
      ),
    ).toBeTruthy();
    expect(dialog.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('non c’è più alcun input file, drag and drop o download del modello', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('input[type="file"]')).toBeNull();
    expect(dialog.querySelector('input')).toBeNull();
    expect(screen.queryByRole('button', { name: /scarica modello/i })).toBeNull();
    expect(screen.queryByText(/file yaml/i)).toBeNull();
    expect(screen.queryByText(/trascina/i)).toBeNull();
    expect(dialog.innerHTML).not.toContain('accept=');
  });

  it('nomina la UDA di destinazione e dichiara che le lezioni nascono vuote', () => {
    renderDialog();
    expect(screen.getByText(/UDA «Le reti»/)).toBeTruthy();
    expect(screen.getByText(/non crea domande o pool/i)).toBeTruthy();
  });
});

describe('verifica della struttura', () => {
  it('il pulsante è disabilitato su vuoto e su soli spazi', () => {
    renderDialog();
    expect(verifyButton().disabled).toBe(true);
    for (const blank of [' ', '   ', '\n', '\t\n  ']) {
      paste(blank);
      expect(verifyButton().disabled).toBe(true);
    }
    paste(VALID_YAML);
    expect(verifyButton().disabled).toBe(false);
  });

  it('uno YAML valido porta al riepilogo esistente, con la destinazione', async () => {
    const { onConfirm } = renderDialog();
    paste(VALID_YAML);
    verify();
    expect(await screen.findByText(/2 lezioni verranno aggiunte/)).toBeTruthy();
    expect(screen.getAllByText(/UDA «Le reti»/).length).toBeGreaterThanOrEqual(2);
    const voci = screen.getAllByRole('listitem');
    expect(voci).toHaveLength(2);
    expect(voci[0]!.textContent ?? '').toContain("Che cos'è una rete");
    expect(voci[0]!.textContent ?? '').toContain('Dispositivi e comunicazione');
    expect(voci[0]!.textContent ?? '').toContain('introduttiva');
    expect(voci[0]!.textContent ?? '').toContain('nodo, protocollo');
    expect(voci[1]!.textContent ?? '').toContain('Nessun sottotitolo');
    expect(screen.getByText(/corpo Markdown vuoto e senza pool/i)).toBeTruthy();
    expect(screen.getByText(/Nessuna lezione esistente verrà modificata/i)).toBeTruthy();
    // Verificare non importa: la conferma resta un atto separato.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('accenti, apostrofi e indentazione attraversano intatti la codifica', async () => {
    const { onConfirm } = renderDialog();
    const yaml = `schema: schoolforge-lesson-metadata/v1
lessons:
  - titolo: Che cos’è un’unità didattica
    sottotitolo: Perché città, però, à-è-ì-ò-ù
    difficolta: introduttiva
    concettiChiave:
      - unità
    obiettivi:
      - Definire un’unità
`;
    paste(yaml);
    verify();
    expect(await screen.findByText('Che cos’è un’unità didattica')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [bytes] = onConfirm.mock.calls[0] as unknown as [Uint8Array];
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(yaml)));
    expect(new TextDecoder().decode(bytes)).toBe(yaml);
  });

  it('l’indentazione è significativa e viene conservata', async () => {
    const { onConfirm } = renderDialog();
    paste(VALID_YAML);
    verify();
    await screen.findByText(/2 lezioni verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [bytes] = onConfirm.mock.calls[0] as unknown as [Uint8Array];
    const roundTrip = new TextDecoder().decode(bytes);
    expect(roundTrip).toBe(VALID_YAML);
    expect(roundTrip).toContain('\n    concettiChiave:\n      - nodo');

    cleanup();
    renderDialog();
    paste(VALID_YAML.replace(/^ +/gm, ''));
    verify();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('il modello canonico della sezione Template completa il round-trip', async () => {
    renderDialog();
    paste(LESSON_METADATA_TEMPLATE);
    verify();
    expect(await screen.findByText(/lezioni verranno aggiunte/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('errore di validazione', () => {
  it('conserva il testo, non chiama l’import e riporta il focus nella textarea', async () => {
    const { onConfirm } = renderDialog();
    const broken = 'schema: schoolforge-lesson-metadata/v1\nlessons: []\n';
    paste(broken);
    verify();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(area().value).toBe(broken);
    expect(area()).toBe(document.activeElement);
    expect(area().getAttribute('aria-invalid')).toBe('true');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Importa lezioni' })).toBeNull();
  });

  it('YAML malformato e struttura oltre limite: nessuna importazione, testo correggibile', async () => {
    const { onConfirm } = renderDialog();
    paste('schema: sbagliato\nlessons:\n  - titolo: [non chiusa\n');
    verify();
    expect(await screen.findByRole('alert')).toBeTruthy();

    paste(`${VALID_YAML}# ${'à'.repeat(200_000)}\n`);
    verify();
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(/limite/i);
    expect(onConfirm).not.toHaveBeenCalled();

    paste(VALID_YAML);
    verify();
    expect(await screen.findByText(/2 lezioni verranno aggiunte/)).toBeTruthy();
  });
});

describe('importazione', () => {
  it('il riepilogo confermato consegna i byte allo stesso runtime', async () => {
    const { onConfirm } = renderDialog();
    paste(VALID_YAML);
    verify();
    await screen.findByText(/2 lezioni verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const call = onConfirm.mock.calls[0] as unknown as unknown[];
    expect(call).toHaveLength(1);
    expect(new TextDecoder().decode(call[0] as Uint8Array)).toBe(VALID_YAML);
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
    paste(VALID_YAML);
    verify();
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
    expect(verifyButton().disabled).toBe(true);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('mostra l’esito e ricorda che le lezioni sono vuote', async () => {
    renderDialog({ onConfirm: vi.fn(async () => 5) });
    paste(VALID_YAML);
    verify();
    await screen.findByText(/2 lezioni verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa lezioni' }));
    expect(await screen.findByText(/5 lezioni aggiunte alla UDA/)).toBeTruthy();
    expect(screen.getByText(/nasce vuota/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Importa lezioni' })).toBeNull();
  });

  it('un errore pre-commit conserva il riepilogo per il retry', async () => {
    const onConfirm = vi.fn(async () => null);
    const { rerender } = renderDialog({ onConfirm });
    paste(VALID_YAML);
    verify();
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
