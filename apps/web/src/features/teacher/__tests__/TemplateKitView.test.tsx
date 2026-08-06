import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LESSON_SIMPLE_TEMPLATE,
  UDA_SIMPLE_TEMPLATE,
} from '../../repository/structureImport/index.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

vi.mock('../templateKit.js', () => ({
  TEMPLATES: [
    {
      name: 'Programma',
      filename: 'programma-template.md',
      url: '/templates/programma-template.md',
    },
    { name: 'UDA', filename: 'uda-template.md', url: '/templates/uda-template.md' },
    { name: 'Lezione', filename: 'lezione-template.md', url: '/templates/lezione-template.md' },
    {
      name: 'Pool domande',
      filename: 'pool-template.pool.md',
      url: '/templates/pool-template.pool.md',
    },
  ],
  downloadTemplate: vi.fn(),
  downloadKitZip: vi.fn().mockResolvedValue(undefined),
}));

import { downloadTemplate } from '../templateKit.js';
import { TemplateKitView } from '../TemplateKitView.js';

describe('TemplateKitView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it('renders download buttons for each template with aria-label', () => {
    render(<TemplateKitView />);
    expect(screen.getByRole('button', { name: /Scarica template Programma/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template UDA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template Lezione/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template Pool domande/ })).toBeTruthy();
  });

  it('renders the complete template workspace and the three ready-to-use examples', () => {
    render(<TemplateKitView />);
    expect(screen.getByRole('heading', { name: 'Kit completo' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Template singoli' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Guida compatta' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Esempi pronti all’uso' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Struttura ZIP' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Struttura UDA' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Struttura lezioni' })).toBeTruthy();
    expect(screen.getByLabelText('Esempio Struttura ZIP').textContent).toContain(
      '01-modello-osi.pool.md',
    );
  });

  it('offre la sola azione Copia per gli esempi strutturali', () => {
    // STRUCTURE-IMPORT-UI-PASTE-01 — i dialog di importazione hanno perso
    // «Scarica modello YAML»: da qui in poi gli esempi si prendono solo di qui,
    // e la copia diretta è l'unico flusso necessario per incollarli.
    render(<TemplateKitView />);
    for (const nome of ['Struttura UDA', 'Struttura lezioni']) {
      expect(screen.getByRole('button', { name: `Copia ${nome}` })).toBeTruthy();
      expect(screen.queryByRole('button', { name: `Scarica ${nome}` })).toBeNull();
    }
    expect(screen.getAllByRole('button', { name: /^Copia / })).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Scarica kit completo (ZIP)' })).toBeTruthy();
  });

  it('shows the exact canonical YAML templates instead of duplicating example strings', () => {
    render(<TemplateKitView />);
    expect(screen.getByLabelText('Esempio Struttura UDA').textContent).toBe(UDA_SIMPLE_TEMPLATE);
    expect(screen.getByLabelText('Esempio Struttura lezioni').textContent).toBe(
      LESSON_SIMPLE_TEMPLATE,
    );
  });

  it('copies the canonical example and announces the real outcome', async () => {
    render(<TemplateKitView />);
    fireEvent.click(screen.getByRole('button', { name: 'Copia Struttura UDA' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(UDA_SIMPLE_TEMPLATE);
    expect(
      (await screen.findByRole('button', { name: 'Struttura UDA: copiato' })).textContent,
    ).toContain('Copiato');
  });

  it('visualizzazione e copia consegnano gli stessi identici byte della costante', async () => {
    // STRUCTURE-TEMPLATE-GENERIC-01 — visualizzazione e copia hanno un'unica
    // fonte, così il docente incolla esattamente il testo che ha letto.
    render(<TemplateKitView />);

    for (const [nome, canonical] of [
      ['Struttura UDA', UDA_SIMPLE_TEMPLATE],
      ['Struttura lezioni', LESSON_SIMPLE_TEMPLATE],
    ] as const) {
      fireEvent.click(screen.getByRole('button', { name: `Copia ${nome}` }));
      expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(canonical);
      const copiato = vi.mocked(navigator.clipboard.writeText).mock.lastCall![0] as string;
      expect(Array.from(new TextEncoder().encode(copiato))).toEqual(
        Array.from(new TextEncoder().encode(canonical)),
      );
      expect(screen.getByLabelText(`Esempio ${nome}`).textContent).toBe(canonical);
    }
  });

  it('uses icon-only controls for single-template downloads', () => {
    render(<TemplateKitView />);
    const button = screen.getByRole('button', { name: 'Scarica template Programma' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).toBeTruthy();
    expect(button.getAttribute('title')).toBe('Scarica template Programma');
  });

  it('renders Scarica kit completo (ZIP) button', () => {
    render(<TemplateKitView />);
    expect(screen.getByRole('button', { name: 'Scarica kit completo (ZIP)' })).toBeTruthy();
  });

  it('clicking a download button calls downloadTemplate with the correct filename', () => {
    render(<TemplateKitView />);
    fireEvent.click(screen.getByRole('button', { name: /Scarica template Programma/ }));
    expect(downloadTemplate).toHaveBeenCalledWith('programma-template.md');
  });
});
