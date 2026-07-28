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
        actionLayout="student-verification"
        metrics={[{ label: 'Stato', value: 'Attiva' }]}
        statusControl={<button type="button">Consegnata — Codice: SF-TEST</button>}
        actions={
          <button type="button" aria-label="Svolgi online — Compito">
            <span aria-hidden="true">→</span>
          </button>
        }
      />,
    );

    expect(screen.getByRole('listitem', { name: 'Verifica Compito' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Svolgi online — Compito' })).toBeTruthy();
    expect(screen.getByText(/Codice: SF-TEST/)).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(2);
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
    // UI-VERIFICHE-05 — desktop: tre aree orizzontali, metrics affiancate al
    // blocco identità e verticalmente centrate, actions in alto a destra.
    expect(css).toMatch(
      /@media\s*\(min-width:\s*44\.01rem\)[\s\S]*?\.cardActionsVerification\s*\{[^}]*'identity metrics actions'[^}]*'cta metrics actions'/s,
    );
    // UI-VERIFICHE-06A — riquadri di dimensione uniforme: tracce fisse e uguali,
    // mai dipendenti dal contenuto, e altezza identica.
    expect(css).toMatch(
      /\.cardActionsVerification\s+\.metrics\s*\{[^}]*grid-auto-columns:\s*var\(--record-metric-size\)[^}]*align-self:\s*center/s,
    );
    expect(css).toMatch(/\.cardActionsVerification\s*\{[^}]*--record-metric-size:\s*[\d.]+rem/s);
    expect(css).toMatch(/\.cardActionsVerification\s+\.metric\s*\{[^}]*height:\s*[\d.]+rem/s);
    expect(css).not.toMatch(/\.cardActionsVerification\s+\.metrics\s*\{[^}]*max-content/s);
    // Mobile: due colonne uguali che si dividono la larghezza.
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsVerification\s+\.metrics\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    // CTA invisibile a riposo, visibile solo su hover/focus della superficie apribile.
    expect(css).toMatch(/\.openCtaBand\s*\{[^}]*position:\s*static[^}]*opacity:\s*0/s);
    expect(css).toMatch(
      /\.cardActionsVerification:has\(> \.openSurface:hover\)\s+\.openCtaBand\s*\{[^}]*opacity:\s*1/s,
    );
    expect(css).toMatch(
      /\.card:has\(> \.openSurface:focus-visible\)\s+\.openCta\s*\{[^}]*opacity:\s*1/s,
    );
    // L'hover generico della card è neutralizzato per la variante verifica, dove
    // conta solo la superficie apribile (contratto della card corso invariato).
    expect(css).toMatch(/\.cardActionsVerification:hover\s+\.openCtaBand\s*\{[^}]*opacity:\s*0/s);
    expect(css).toMatch(/\.card:hover\s+\.openCta\s*\{[^}]*opacity:\s*1/s);
    expect(css).toMatch(/\.cardActionsVerification\s+\.actions\s*\{[^}]*align-self:\s*start/s);
    // Mobile: metrics sotto identity, Stato e Online su due colonne uguali.
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsVerification\s*\{[^}]*'identity'[^}]*'actions'[^}]*'metrics'[^}]*'cta'/s,
    );
    // Azioni mobile: griglia 3 × 2 con target touch ≥ 44px.

    expect(css).toMatch(/\.metricInteractive\s*\{[^}]*z-index:\s*2[^}]*pointer-events:\s*auto/s);
    expect(css).not.toMatch(/\.card:focus-within\s*\{/);
    expect(css).toMatch(/\.card:has\(\[data-record-card-cue\]:focus-visible\)\s+\.openCta\s*\{/);
    expect(css).toMatch(/\.cardActionsFooter\s+\.actions\s*\{[^}]*flex-wrap:\s*wrap/s);
    expect(css).toMatch(
      /@media\s*\(min-width:\s*44\.01rem\)[\s\S]*?\.cardActionsStudentVerification\s*\{[^}]*'identity actions'[^}]*'metrics metrics'[^}]*'status status'/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsStudentVerification\s+\.actions\s*\{[^}]*grid-area:\s*actions[^}]*justify-content:\s*flex-end/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsStudentVerification\s+\.metrics\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsStudentVerification\s+\.metrics\s*>\s*:nth-child\(3\)\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*23rem\)[\s\S]*?\.cardActionsStudentVerification\s+\.actions button\s*\{[^}]*width:\s*2\.75rem[^}]*min-height:\s*2\.75rem/s,
    );
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transform:\s*none/);
  });
});
