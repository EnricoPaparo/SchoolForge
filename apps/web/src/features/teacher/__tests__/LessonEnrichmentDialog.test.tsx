import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LessonEnrichmentDialog } from '../LessonEnrichmentDialog.js';

vi.mock('../LessonMultiVisualWorkflowDialog.js', () => ({
  LessonMultiVisualWorkflowDialog: () => <div data-testid="generate-workflow">generate</div>,
}));
vi.mock('../LessonVisualUploadDialog.js', () => ({
  LessonVisualUploadDialog: () => <div data-testid="upload-workflow">upload</div>,
}));

afterEach(cleanup);

function renderHub() {
  render(
    <LessonEnrichmentDialog
      functions={{} as never}
      identity={{ programId: 'p', importId: 'i', lessonId: 'l' }}
      lessonAi={{}}
      existingCount={0}
      currentVisuals={[]}
      headings={[{ index: 0, text: 'Sezione' }]}
      onRefresh={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

describe('LessonEnrichmentDialog', () => {
  it('è l’unico hub con le due scelte e apre il caricamento manuale', () => {
    renderHub();
    expect(screen.getByRole('heading', { name: 'Arricchisci la lezione' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Genera con IA/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Carica immagine/ }));
    expect(screen.getByTestId('upload-workflow')).toBeTruthy();
  });

  it('mantiene due colonne desktop e una sotto 640px', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/LessonEnrichmentDialog.module.css'),
      'utf8',
    );
    const uploadCss = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/LessonVisualUploadDialog.module.css'),
      'utf8',
    );
    expect(css).toMatch(/grid-template-columns:\s*repeat\(2,/);
    expect(`${css}\n${uploadCss}`).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*grid-template-columns:\s*1fr/,
    );
  });
});
