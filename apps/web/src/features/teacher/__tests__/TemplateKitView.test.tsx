import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LESSON_METADATA_TEMPLATE,
  LESSON_TEMPLATE_FILENAME,
  UDA_METADATA_TEMPLATE,
  UDA_TEMPLATE_FILENAME,
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
    expect(screen.getByRole('heading', { name: 'Struttura UDA — YAML' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Struttura lezioni — YAML' })).toBeTruthy();
    expect(screen.getByLabelText('Esempio Struttura ZIP').textContent).toContain(
      '01-modello-osi.pool.md',
    );
  });

  it('shows the exact canonical YAML templates instead of duplicating example strings', () => {
    render(<TemplateKitView />);
    expect(screen.getByLabelText('Esempio Struttura UDA — YAML').textContent).toBe(
      UDA_METADATA_TEMPLATE,
    );
    expect(screen.getByLabelText('Esempio Struttura lezioni — YAML').textContent).toBe(
      LESSON_METADATA_TEMPLATE,
    );
  });

  it('copies the canonical example and announces the real outcome', async () => {
    render(<TemplateKitView />);
    fireEvent.click(screen.getByRole('button', { name: 'Copia Struttura UDA — YAML' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(UDA_METADATA_TEMPLATE);
    expect(await screen.findByText('Esempio copiato negli appunti.')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Copia Struttura UDA — YAML' }).textContent,
    ).toContain('Copiato');
  });

  it('keeps copy failures visible without claiming success', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(new Error('denied'));
    render(<TemplateKitView />);
    fireEvent.click(screen.getByRole('button', { name: 'Copia Struttura lezioni — YAML' }));
    expect(
      await screen.findByText('Impossibile copiare negli appunti. Seleziona il testo manualmente.'),
    ).toBeTruthy();
    expect(screen.queryByText('Esempio copiato negli appunti.')).toBeNull();
  });

  it('downloads each YAML with its canonical filename', () => {
    render(<TemplateKitView />);
    const click = vi.fn();
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'a') return { href: '', download: '', click } as unknown as HTMLAnchorElement;
      return createElement(tag);
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:yaml'),
      revokeObjectURL: vi.fn(),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Scarica Struttura UDA — YAML' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scarica Struttura lezioni — YAML' }));

    expect(click).toHaveBeenCalledTimes(2);
    const anchors = vi
      .mocked(document.createElement)
      .mock.results.filter((result) => result.value && (result.value as HTMLAnchorElement).download)
      .map((result) => (result.value as HTMLAnchorElement).download);
    expect(anchors).toEqual([UDA_TEMPLATE_FILENAME, LESSON_TEMPLATE_FILENAME]);
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
