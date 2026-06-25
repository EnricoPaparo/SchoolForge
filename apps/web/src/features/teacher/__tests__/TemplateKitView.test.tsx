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

  it('renders download buttons for each template', () => {
    render(<TemplateKitView />);
    expect(screen.getByRole('button', { name: /Scarica Programma/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica UDA/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica Lezione/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Scarica Pool domande/ })).toBeTruthy();
  });

  it('renders Scarica kit completo (ZIP) button', () => {
    render(<TemplateKitView />);
    expect(screen.getByRole('button', { name: 'Scarica kit completo (ZIP)' })).toBeTruthy();
  });

  it('clicking a download button calls downloadTemplate with the correct filename', () => {
    render(<TemplateKitView />);
    fireEvent.click(screen.getByRole('button', { name: /Scarica Programma/ }));
    expect(downloadTemplate).toHaveBeenCalledWith('programma-template.md');
  });
});
