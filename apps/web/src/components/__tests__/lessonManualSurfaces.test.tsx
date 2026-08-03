import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MarkdownRenderer } from '../MarkdownRenderer.js';

/**
 * LESSON-MANUAL-01 — quali superfici adottano la variante e quali restano
 * legacy. Le due viste lezione sono verificate staticamente sul sorgente: sono
 * componenti enormi, e ciò che conta qui è **quale prop viene passata**, non
 * il loro rendering (già coperto dalle rispettive suite).
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (path: string) => readFileSync(resolve(__dirname, '../../', path), 'utf8');

afterEach(cleanup);

describe('variante opt-in del renderer', () => {
  it('senza `variant` il percorso legacy è invariato', () => {
    const { container } = render(
      <MarkdownRenderer markdown={'## Uno\n\n> [!DEFINITION]\n> x\n'} />,
    );
    // Nessuna struttura della variante.
    expect(container.querySelector('.lesson-manual')).toBeNull();
    expect(container.querySelector('.prose--manual')).toBeNull();
    expect(container.querySelector('.lm-callout')).toBeNull();
    // Prose legacy, heading senza id, marcatore letterale.
    expect(container.querySelector('.prose')).not.toBeNull();
    expect(container.querySelector('h2')!.getAttribute('id')).toBeNull();
    expect(container.textContent).toContain('[!DEFINITION]');
  });

  it('con `variant="lesson"` si attiva la variante', () => {
    const { container } = render(
      <MarkdownRenderer markdown={'## Uno\n\n> [!DEFINITION]\n> x\n'} variant="lesson" />,
    );
    expect(container.querySelector('.prose--manual')).not.toBeNull();
    expect(container.querySelector('.lm-callout--definition')).not.toBeNull();
    expect(container.querySelector('h2')!.getAttribute('id')).toBe('uno');
  });

  it('usare la variante non contamina un successivo render legacy', () => {
    render(<MarkdownRenderer markdown={'> [!WARNING]\n> x\n'} variant="lesson" />);
    cleanup();
    const { container } = render(<MarkdownRenderer markdown={'> [!WARNING]\n> x\n'} />);
    expect(container.querySelector('.lm-callout')).toBeNull();
    expect(container.textContent).toContain('[!WARNING]');
  });
});

describe('superfici', () => {
  it('la vista lezione del docente usa la variante', () => {
    const code = src('features/teacher/CourseWorkspace.tsx');
    expect(code).toMatch(/<MarkdownRenderer markdown=\{content\} variant="lesson" \/>/);
    // Una sola occorrenza del renderer in questa vista.
    expect(code.match(/<MarkdownRenderer/g)).toHaveLength(1);
  });

  it('la vista lezione dello studente usa la variante', () => {
    const code = src('features/student/StudentDidatticaView.tsx');
    expect(code).toMatch(/<MarkdownRenderer markdown=\{lesson\.content\} variant="lesson" \/>/);
    expect(code.match(/<MarkdownRenderer/g)).toHaveLength(1);
  });

  it('l’anteprima dell’editor resta legacy', () => {
    const code = src('features/teacher/lessonEditors.tsx');
    expect(code).toContain('<MarkdownRenderer');
    expect(code).not.toContain('variant="lesson"');
  });

  it('l’anteprima della generazione IA resta legacy', () => {
    const code = src('features/teacher/AiLessonGenerationDialog.tsx');
    expect(code).toContain('<MarkdownRenderer');
    expect(code).not.toContain('variant="lesson"');
  });

  it('nessuna altra superficie adotta la variante', () => {
    const optIn = [
      'features/teacher/CourseWorkspace.tsx',
      'features/student/StudentDidatticaView.tsx',
    ];
    for (const path of [
      'features/teacher/lessonEditors.tsx',
      'features/teacher/AiLessonGenerationDialog.tsx',
      'features/teacher/MarkdownRenderer.tsx',
    ]) {
      expect(optIn).not.toContain(path);
      expect(src(path)).not.toContain('variant="lesson"');
    }
  });
});

describe('testata: nessuna duplicazione e nessun dato inventato', () => {
  it('il renderer non emette titolo, sottotitolo o metadati', () => {
    const { container } = render(
      <MarkdownRenderer markdown={'Solo il corpo della lezione.'} variant="lesson" />,
    );
    // La testata resta quella delle viste: il renderer non la ripete.
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent!.trim()).toBe('Solo il corpo della lezione.');
  });

  it('non inventa tempo di lettura né conteggi', () => {
    const { container } = render(<MarkdownRenderer markdown={'testo'} variant="lesson" />);
    expect(container.textContent).not.toMatch(/minut|lettura|parole/i);
  });

  it('le viste continuano a mostrare titolo e sottotitolo una sola volta', () => {
    // Il titolo vive nella testata della vista, fuori dal renderer.
    expect(src('features/teacher/CourseWorkspace.tsx')).toContain('styles.lessonMainTitle');
    expect(src('features/student/StudentDidatticaView.tsx')).toContain('styles.lessonHeader');
  });
});

describe('nessuna nuova operazione Firebase', () => {
  it('i moduli della variante non importano Firebase né servizi di lettura', () => {
    for (const path of ['components/LessonManualBody.tsx', 'components/lessonManualMarkdown.ts']) {
      const code = readFileSync(resolve(__dirname, '../../', path), 'utf8');
      expect(code).not.toMatch(/from 'firebase|firestore|onSnapshot\(|getDocs?\(/i);
    }
  });
});
