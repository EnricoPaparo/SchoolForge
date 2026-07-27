import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VerificationRecordCard } from './VerificationRecordCard.js';

afterEach(cleanup);

describe('VerificationRecordCard', () => {
  it('opens once from the teacher surface and keeps actions independent', () => {
    const onOpen = vi.fn();
    const onAction = vi.fn();
    render(
      <VerificationRecordCard
        title="Reti"
        openLabel="Apri dettaglio verifica Reti"
        onOpen={onOpen}
        defaultCue="Apri verifica →"
        metrics={[{ label: 'Domande', value: 12 }]}
        actions={
          <button type="button" data-record-card-cue="Scarica PDF studenti →" onClick={onAction}>
            PDF studenti
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apri dettaglio verifica Reti' }));
    expect(onOpen).toHaveBeenCalledOnce();

    const action = screen.getByRole('button', { name: 'PDF studenti' });
    fireEvent.pointerOver(action);
    expect(screen.getByText('Scarica PDF studenti →')).toBeTruthy();
    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledOnce();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('supports a student card without a primary overlay', () => {
    render(
      <VerificationRecordCard
        title="Compito"
        actionLayout="footer"
        metrics={[{ label: 'Stato', value: 'Attiva' }]}
        actions={<button type="button">Svolgi online</button>}
      />,
    );

    expect(screen.getByRole('listitem', { name: 'Verifica Compito' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Svolgi online' })).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText(/Apri verifica/)).toBeNull();
  });

  it('defines grid/footer layouts and reduced-motion on the shared shell', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/RecordCard.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.cardActionsGrid\s+\.actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(/\.cardActionsFooter\s+\.actions\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transform:\s*none/);
  });
});
