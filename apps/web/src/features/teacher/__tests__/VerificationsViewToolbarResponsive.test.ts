import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/teacher/VerificationsView.module.css'),
  'utf8',
);

describe('VerificationsView batch toolbar responsive contract', () => {
  it('uses the approved 7 → 2 → 1 grid and keeps the submissions table scrollable', () => {
    expect(css).toMatch(/\.batchToolbar\s*\{[^}]*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*48rem\)[\s\S]*?\.batchToolbar\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*24rem\)[\s\S]*?\.batchToolbar\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(/\.batchToolbar button\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.submissionsTableWrap\s*\{[^}]*overflow-x:\s*auto/s);
  });
});
