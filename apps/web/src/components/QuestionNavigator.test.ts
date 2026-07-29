import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sharedCss = readFileSync(
  resolve(process.cwd(), 'src/components/QuestionNavigator.module.css'),
  'utf8',
);

const correctionCss = readFileSync(
  resolve(process.cwd(), 'src/features/teacher/CorrectionWorkspace.module.css'),
  'utf8',
);
const examCss = readFileSync(
  resolve(process.cwd(), 'src/features/student/OnlineExamView.module.css'),
  'utf8',
);
const reviewCss = readFileSync(
  resolve(process.cwd(), 'src/features/student/StudentCorrectionView.module.css'),
  'utf8',
);

describe('QuestionNavigator visual contract', () => {
  it('reserves vertical room for the complete current-question ring', () => {
    expect(sharedCss).toMatch(/\.nav\s*\{[^}]*padding-block:\s*0\.25rem/s);
    expect(sharedCss).toMatch(/\.nav\s*\{[^}]*padding-inline:\s*0\.25rem/s);
    expect(sharedCss).toMatch(
      /\.current::after\s*\{[^}]*inset:\s*-0\.25rem[^}]*border:\s*2px solid var\(--color-primary\)/s,
    );
  });

  it('uses the SchoolForge orange interaction only on fine pointers', () => {
    expect(sharedCss).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.item:hover:not\(:disabled\)\s*\{[^}]*var\(--color-brand-interactive\)[^}]*translateY\(-2px\) scale\(1\.06\)/s,
    );
    expect(sharedCss).toMatch(/180ms cubic-bezier\(0\.22,\s*1,\s*0\.36,\s*1\)/);
    expect(sharedCss).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?transform:\s*none/s,
    );
  });

  it('keeps state colors local while removing the three duplicated item geometries', () => {
    for (const css of [correctionCss, examCss, reviewCss]) {
      expect(css).not.toMatch(/\.navItem\s*\{/);
      expect(css).not.toMatch(/\.navItemCurrent\s*\{/);
    }
    expect(correctionCss).toMatch(/\.navItemEvaluated\s*\{/);
    expect(examCss).toMatch(/\.navItemFilled\s*\{/);
  });
});
