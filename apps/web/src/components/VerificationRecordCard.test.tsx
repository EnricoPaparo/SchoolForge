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

  it('keeps an interactive metric above the overlay and invokes only its control', () => {
    const onOpen = vi.fn();
    const onToggle = vi.fn();
    render(
      <VerificationRecordCard
        title="Reti"
        openLabel="Apri dettaglio verifica Reti"
        onOpen={onOpen}
        metrics={[
          {
            label: 'Online',
            value: (
              <button type="button" role="switch" aria-checked="false" onClick={onToggle}>
                Cambia online
              </button>
            ),
            interactive: true,
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('switch'));
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('defines verification/grid/footer layouts and reduced-motion on the shared shell', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/components/RecordCard.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.cardActionsGrid\s+\.actions\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /\.cardActionsVerification\s+\.metrics\s*\{[^}]*grid-template-columns:\s*repeat\(5,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsVerification\s+\.metrics\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsVerification\s+\.metrics\s*>\s*:last-child\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
    expect(css).toMatch(
      /\.cardActionsVerification\s*\{[^}]*'identity actions'[^}]*'metrics metrics'/s,
    );
    expect(css).toMatch(/\.metricInteractive\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*auto/s);
    expect(css).not.toMatch(/\.card:focus-within\s*\{/);
    expect(css).toMatch(/\.card:has\(\[data-record-card-cue\]:focus-visible\)\s+\.openCta\s*\{/);
    expect(css).toMatch(
      /\.cardActionsVerification\s+\.openCta\s*\{[^}]*bottom:\s*0\.55rem[^}]*left:\s*1\.1rem/s,
    );
    expect(css).toMatch(
      /\.cardActionsVerification\s+\.details span\s*\{[^}]*border-radius:[^}]*background:/s,
    );
    expect(css).toMatch(
      /\.cardActionsVerification\s+\.metrics\s*>\s*:last-child\s+dd\s*\{[^}]*text-overflow:\s*ellipsis/s,
    );
    expect(css).toMatch(/\.cardActionsFooter\s+\.actions\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transform:\s*none/);
  });
});
