import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportUdaStructureDialog } from '../ImportUdaStructureDialog.js';
import { UDA_METADATA_TEMPLATE } from '../../repository/structureImport/index.js';

/**
 * STRUCTURE-IMPORT-02A + STRUCTURE-IMPORT-UI-PASTE-01 — il dialog «Importa
 * struttura UDA».
 *
 * Il docente incolla lo YAML: non esiste più un file da scegliere. Ciò che va
 * difeso è che il testo incollato arrivi **intatto** al validatore byte-first
 * già esistente — accenti, apostrofi tipografici e soprattutto indentazione, che
 * in YAML è sintassi — e che la fase di riepilogo non venga saltata.
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

const area = (): HTMLTextAreaElement =>
  screen.getByLabelText('Struttura UDA in YAML') as HTMLTextAreaElement;

const verifyButton = (): HTMLButtonElement =>
  screen.getByRole('button', { name: 'Verifica struttura' }) as HTMLButtonElement;

/** Incolla il testo e chiede la verifica: le due azioni del docente. */
function paste(text: string): void {
  fireEvent.change(area(), { target: { value: text } });
}

function verify(): void {
  fireEvent.click(verifyButton());
}

describe('anatomia della finestra', () => {
  it('offre una textarea etichettata con il testo di supporto, e nient’altro', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    const textarea = area();
    expect(textarea.tagName).toBe('TEXTAREA');
    expect(textarea.value).toBe('');
    expect(Number(textarea.getAttribute('rows'))).toBeGreaterThanOrEqual(12);
    expect(
      screen.getByText(
        'Incolla qui la struttura YAML. Puoi copiare un esempio dalla sezione Template.',
      ),
    ).toBeTruthy();
    // Il testo di supporto è associato al controllo, non solo vicino.
    expect(textarea.getAttribute('aria-describedby')).toBe('import-uda-structure-help');
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

  it('dichiara ancora che non importa contenuti e non tocca le UDA esistenti', () => {
    renderDialog();
    expect(screen.getByText(/non importa lezioni, contenuti o pool/i)).toBeTruthy();
    expect(screen.getByText(/le uda esistenti non vengono modificate/i)).toBeTruthy();
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

  it('uno YAML valido porta al riepilogo esistente, non all’importazione', async () => {
    const { onConfirm } = renderDialog();
    paste(VALID_YAML);
    verify();
    expect(await screen.findByText(/2 UDA verranno aggiunte/)).toBeTruthy();
    expect(screen.getByText('Introduzione alle reti')).toBeTruthy();
    expect(screen.getByText(/Fondamenti della comunicazione/)).toBeTruthy();
    expect(screen.getByText(/2 competenze/)).toBeTruthy();
    expect(screen.getAllByText(/1 obiettivo/)).toHaveLength(2);
    const voci = screen.getAllByRole('listitem');
    expect(voci).toHaveLength(2);
    expect(voci[1]!.textContent ?? '').toContain('Nessuna descrizione');
    expect(
      screen.getByText(/Nessuna UDA esistente verrà modificata, rinominata o sovrascritta/),
    ).toBeTruthy();
    // La verifica non importa: serve una conferma esplicita.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('accenti, apostrofi tipografici e indentazione attraversano intatti la codifica', async () => {
    const { onConfirm } = renderDialog();
    const yaml = `schema: schoolforge-uda-metadata/v1
udas:
  - titolo: Perché l’unità è già così
    descrizione: Città, però, à-è-ì-ò-ù — e un trattino lungo.
    competenze:
      - Usare l’apostrofo tipografico
    obiettivi:
      - Distinguere l’unità
`;
    paste(yaml);
    verify();
    expect(await screen.findByText('Perché l’unità è già così')).toBeTruthy();
    expect(screen.getByText(/Città, però, à-è-ì-ò-ù — e un trattino lungo/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [bytes] = onConfirm.mock.calls[0] as unknown as [Uint8Array];
    // I byte sono esattamente la codifica UTF-8 del testo incollato: nessuna
    // correzione, normalizzazione o riformattazione per strada.
    expect(ArrayBuffer.isView(bytes)).toBe(true);
    expect(Array.from(bytes)).toEqual(Array.from(new TextEncoder().encode(yaml)));
    expect(new TextDecoder().decode(bytes)).toBe(yaml);
  });

  it('l’indentazione è significativa e viene conservata', async () => {
    const { onConfirm } = renderDialog();
    paste(VALID_YAML);
    verify();
    await screen.findByText(/2 UDA verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const [bytes] = onConfirm.mock.calls[0] as unknown as [Uint8Array];
    const roundTrip = new TextDecoder().decode(bytes);
    expect(roundTrip).toBe(VALID_YAML);
    expect(roundTrip).toContain('\n  - titolo: Introduzione alle reti');
    expect(roundTrip).toContain('\n      - Comprendere una rete');

    // Contro-prova: la stessa struttura senza indentazione non è valida, quindi
    // se l'indentazione si perdesse il test precedente non potrebbe passare.
    cleanup();
    renderDialog();
    paste(VALID_YAML.replace(/^ +/gm, ''));
    verify();
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('il modello canonico della sezione Template completa il round-trip', async () => {
    renderDialog();
    paste(UDA_METADATA_TEMPLATE);
    verify();
    // Il modello è pensato per essere copiato e incollato così com'è.
    expect(await screen.findByText(/UDA verranno aggiunte/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('errore di validazione', () => {
  it('conserva il testo, non chiama l’import e riporta il focus nella textarea', async () => {
    const { onConfirm } = renderDialog();
    const broken = 'schema: schoolforge-uda-metadata/v1\nudas: []\n';
    paste(broken);
    verify();
    expect(await screen.findByRole('alert')).toBeTruthy();
    // Il testo resta esattamente com'era: si corregge, non si reincolla.
    expect(area().value).toBe(broken);
    expect(area()).toBe(document.activeElement);
    expect(area().getAttribute('aria-invalid')).toBe('true');
    // Nessun tentativo, lease, upload o scrittura: l'import non è mai partito.
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Importa UDA' })).toBeNull();
  });

  it('rifiuta uno YAML malformato e permette di correggerlo sul posto', async () => {
    const { onConfirm } = renderDialog();
    paste('schema: sbagliato\nudas:\n  - titolo: [non chiusa\n');
    verify();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();

    paste(VALID_YAML);
    verify();
    expect(await screen.findByText(/2 UDA verranno aggiunte/)).toBeTruthy();
  });

  it('rifiuta una struttura oltre il limite, misurato sui byte', async () => {
    const { onConfirm } = renderDialog();
    paste(`${VALID_YAML}# ${'à'.repeat(200_000)}\n`);
    verify();
    expect((await screen.findByRole('alert')).textContent ?? '').toMatch(/limite/i);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('l’errore mostrato non contiene stack, path, UID o hash', () => {
    renderDialog({
      error: 'Importazione non applicata: il corso è rimasto invariato. Puoi riprovare.',
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).not.toMatch(/repository\/|firestore|\.ts:|[0-9a-f]{64}/i);
  });
});

describe('importazione', () => {
  it('il riepilogo confermato consegna i byte allo stesso runtime', async () => {
    const { onConfirm } = renderDialog();
    paste(VALID_YAML);
    verify();
    await screen.findByText(/2 UDA verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    const call = onConfirm.mock.calls[0] as unknown as unknown[];
    // Un solo argomento: non esiste più un nome file da trasmettere.
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
    await screen.findByText(/2 UDA verranno aggiunte/);
    const submit = screen.getByRole('button', { name: 'Importa UDA' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    resolveImport(2);
  });

  it('durante l’importazione i comandi sono disabilitati e lo stato è accessibile', () => {
    renderDialog({ busy: true });
    expect((screen.getByRole('button', { name: 'Annulla' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(verifyButton().disabled).toBe(true);
    expect(screen.getByRole('status').textContent ?? '').toMatch(/Importazione in corso/);
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
  });

  it('mostra l’esito con il numero di UDA aggiunte', async () => {
    renderDialog({ onConfirm: vi.fn(async () => 3) });
    paste(VALID_YAML);
    verify();
    await screen.findByText(/2 UDA verranno aggiunte/);
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    expect(await screen.findByText(/3 UDA aggiunte al corso/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Chiudi' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByRole('button', { name: 'Importa UDA' })).toBeNull();
  });

  it('un errore pre-commit conserva il riepilogo per il retry', async () => {
    const onConfirm = vi.fn(async () => null);
    const { rerender } = renderDialog({ onConfirm });
    paste(VALID_YAML);
    verify();
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
    expect(screen.getByText('Introduzione alle reti')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Importa UDA' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2));
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
