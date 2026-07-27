import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CourseRecordCard } from './CourseRecordCard.js';

afterEach(cleanup);

describe('CourseRecordCard', () => {
  it('uses one native full-card button and opens exactly once', () => {
    const onOpen = vi.fn();
    render(
      <CourseRecordCard
        title="Sistemi e reti"
        openLabel="Apri il corso Sistemi e reti"
        onOpen={onOpen}
        metrics={[{ label: 'UDA', value: 3 }]}
      />,
    );

    const surface = screen.getByRole('button', { name: 'Apri il corso Sistemi e reti' });
    expect(surface.tagName).toBe('BUTTON');
    expect(surface.getAttribute('type')).toBe('button');
    surface.focus();
    expect(document.activeElement).toBe(surface);
    const cta = screen.getByText('Apri programma →');
    expect(cta.getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByText('Corso')).toBeNull();
    fireEvent.click(surface);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('keeps internal actions outside the opening surface', () => {
    const onOpen = vi.fn();
    const onRename = vi.fn();
    render(
      <CourseRecordCard
        title="Titolo molto lungo che deve restare leggibile senza espandere la pagina"
        openLabel="Apri il corso lungo"
        onOpen={onOpen}
        details={[
          {
            label: 'Classi',
            value: 'Quinta A Informatica, Quinta B Informatica, Quinta C Informatica',
          },
        ]}
        metrics={[
          { label: 'UDA', value: 8 },
          { label: 'Lezioni', value: '8/67' },
          { label: 'Domande', value: '1.000' },
        ]}
        actions={
          <button type="button" onClick={onRename}>
            Rinomina
          </button>
        }
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Rinomina' }));
    expect(onRename).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText(/Quinta C Informatica/)).toBeTruthy();
    expect(screen.getByText('1.000')).toBeTruthy();
  });
});

describe('CourseRecordCard responsive and motion contract', () => {
  const css = readFileSync(
    resolve(process.cwd(), 'src/components/CourseRecordCard.module.css'),
    'utf8',
  );
  const teacherCss = readFileSync(
    resolve(process.cwd(), 'src/features/teacher/DidatticaView.module.css'),
    'utf8',
  );
  const studentCss = readFileSync(
    resolve(process.cwd(), 'src/features/student/StudentDidatticaView.module.css'),
    'utf8',
  );

  it('stays full-width and never creates a multi-card grid', () => {
    expect(css).toMatch(/\.card\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.card\s*\{[^}]*min-width:\s*0/s);
    for (const viewCss of [teacherCss, studentCss]) {
      expect(viewCss).toMatch(/\.courseList\s*\{[^}]*display:\s*flex/s);
      expect(viewCss).toMatch(/\.courseList\s*\{[^}]*flex-direction:\s*column/s);
      expect(viewCss).toMatch(/\.courseList\s*\{[^}]*min-width:\s*0/s);
    }
    expect(css).toMatch(/@media\s*\(max-width:\s*44rem\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*23rem\)/);
    expect(css).toMatch(/\.metrics\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
    for (const breakpoint of ['44rem', '23rem']) {
      expect(css).toMatch(
        new RegExp(
          `@media\\s*\\(max-width:\\s*${breakpoint.replace('.', '\\.')}\\)[\\s\\S]*?\\.metrics\\s*\\{[^}]*repeat\\(3,\\s*minmax\\(0,\\s*1fr\\)\\)`,
        ),
      );
    }
    expect(css).not.toMatch(
      /@media\s*\(max-width:[^)]+\)[\s\S]*?\.metrics\s*\{[^}]*(?:repeat\(1,|minmax\(0,\s*1fr\)\s*;)/,
    );
  });

  it('defines the approved academic-glow interactions and reduced-motion fallback', () => {
    expect(css).toMatch(/transition:[\s\S]*160ms/);
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.card:has\(>\s*\.openSurface:hover\)\s*\{[^}]*translateY\(-2px\)/,
    );
    expect(css).toMatch(/\.card:has\(>\s*\.openSurface:active\)\s*\{[^}]*scale\(0\.995\)/s);
    expect(css).toMatch(/\.card:has\(>\s*\.openSurface:focus-visible\)\s*\{[^}]*outline:\s*3px/s);
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.card:has\(>\s*\.openSurface:hover\),[\s\S]*?transform:\s*none/,
    );
  });

  it('keeps the overlay transparent in every interactive state with deliberate specificity', () => {
    const transparentStates =
      css.match(
        /\.card\s*>\s*\.openSurface,[\s\S]*?\.card\s*>\s*\.openSurface:disabled\s*\{[^}]*\}/,
      )?.[0] ?? '';
    for (const state of [
      '.openSurface',
      '.openSurface:hover',
      '.openSurface:hover:not(:disabled)',
      '.openSurface:active',
      '.openSurface:active:not(:disabled)',
      '.openSurface:focus',
      '.openSurface:focus-visible',
      '.openSurface:disabled',
    ]) {
      expect(transparentStates).toContain(state);
    }
    expect(transparentStates).toMatch(/background:\s*transparent/);
    expect(transparentStates).toMatch(/background-color:\s*transparent/);
    expect(transparentStates).toMatch(/border-color:\s*transparent/);
    expect(css).not.toMatch(/!\s*important\s*[;}]/);
  });

  it('reveals the orange CTA and accent only from the opening surface hover or focus', () => {
    const ctaBlock = css.match(/\.openCta\s*\{[^}]*\}/s)?.[0] ?? '';
    const identityBlock = css.match(/\.identity\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(ctaBlock).toMatch(/position:\s*absolute/);
    expect(ctaBlock).toMatch(/opacity:\s*0/);
    expect(ctaBlock).toMatch(/transform:\s*translateX\(-0\.2rem\)/);
    expect(identityBlock).toMatch(/padding-bottom:\s*1\.15rem/);
    expect(css).toMatch(
      /\.card:has\(>\s*\.openSurface:hover\)\s*\.openCta\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translateX\(0\)/s,
    );
    expect(css).toMatch(
      /\.card:has\(>\s*\.openSurface:focus-visible\)\s*\.openCta\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translateX\(0\)/s,
    );
    expect(css).toMatch(
      /\.card:has\(>\s*\.openSurface:hover\)\s*\{[^}]*border-color:[^}]*--color-brand-orange/s,
    );
    expect(css).toMatch(
      /\.card:has\(>\s*\.openSurface:hover\)\s*\.accent\s*\{[^}]*background:\s*var\(--color-brand-orange\)/s,
    );
    expect(css).toMatch(/\.title\s*\{[^}]*color:\s*var\(--color-brand-blue\)/s);
    expect(css).toMatch(
      /\.card:has\(>\s*\.openSurface:hover\)\s*\.title\s*\{[^}]*color:\s*var\(--color-brand-orange\)/s,
    );
    expect(css).toMatch(
      /\.card:has\(>\s*\.openSurface:focus-visible\)\s*\.title\s*\{[^}]*color:\s*var\(--color-brand-orange\)/s,
    );
    expect(css).not.toMatch(/\.eyebrow\s*\{/);
    expect(css).not.toMatch(/\.accent::after\s*\{/);
    expect(css).not.toMatch(/\.card:hover\s/);
  });

  it('never hides content, keeps actions above the overlay and avoids touch overflow', () => {
    const contentBlock = css.match(/\.content\s*\{[^}]*\}/s)?.[0] ?? '';
    expect(contentBlock).not.toMatch(/display:\s*none/);
    expect(contentBlock).not.toMatch(/visibility:\s*hidden/);
    expect(contentBlock).not.toMatch(/opacity:\s*0/);
    expect(css).toMatch(/\.openSurface\s*\{[^}]*z-index:\s*1/s);
    expect(css).toMatch(/\.actions\s*\{[^}]*z-index:\s*2/s);
    expect(css).toMatch(/\.card\s*\{[^}]*overflow:\s*hidden/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*44rem\)/);
    expect(css).toMatch(/@media\s*\(max-width:\s*23rem\)/);
    // Pointer hover effects exist only for devices that actually support
    // hover; focus-visible remains outside this media query.
    expect(css).toMatch(/@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
  });

  it('places actions beside identity and keeps metrics and student progress below on mobile', () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?'identity actions'[\s\S]*?'metrics metrics'[\s\S]*?'progress progress'/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.content\s*\{[^}]*display:\s*contents/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.actions\s*\{[^}]*grid-area:\s*actions/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.metrics\s*\{[^}]*grid-area:\s*metrics/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.progress\s*\{[^}]*grid-area:\s*progress/s,
    );
    expect(css).toMatch(/\.title\s*\{[^}]*-webkit-line-clamp:\s*2/s);
    expect(css).toMatch(/\.metric dd\s*\{[^}]*white-space:\s*nowrap/s);
  });
});
