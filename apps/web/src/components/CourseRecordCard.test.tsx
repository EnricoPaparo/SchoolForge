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
        metrics={[{ label: 'Lezioni', value: '12/18' }]}
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
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.metrics\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
  });

  it('defines the approved academic-glow interactions and reduced-motion fallback', () => {
    expect(css).toMatch(/transition:[\s\S]*160ms/);
    expect(css).toMatch(/\.card:hover\s*\{[^}]*translateY\(-2px\)/s);
    expect(css).toMatch(/\.card:active\s*\{[^}]*scale\(0\.995\)/s);
    expect(css).toMatch(/\.openSurface:focus-visible\s*\{[^}]*outline:/s);
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.card:hover,[\s\S]*?transform:\s*none/,
    );
  });
});
