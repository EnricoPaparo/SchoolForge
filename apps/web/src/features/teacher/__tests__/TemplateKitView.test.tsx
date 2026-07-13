import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

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
  });

  it('renders download buttons for each template with aria-label', () => {
    render(<TemplateKitView />);
    expect(screen.getByRole('button', { name: /Scarica template Programma/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template UDA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template Lezione/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica template Pool domande/ })).toBeTruthy();
  });

  it('renders the complete four-part template workspace', () => {
    render(<TemplateKitView />);
    expect(screen.getByRole('heading', { name: 'Kit completo' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Template singoli' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Guida compatta' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Struttura ZIP di esempio' })).toBeTruthy();
    expect(screen.getByLabelText('Struttura ZIP di esempio').textContent).toContain(
      '01-modello-osi.pool.md',
    );
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
