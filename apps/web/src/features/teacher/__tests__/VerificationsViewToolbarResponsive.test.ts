import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/teacher/VerificationsView.module.css'),
  'utf8',
);
const recordCardCss = readFileSync(
  resolve(process.cwd(), 'src/components/RecordCard.module.css'),
  'utf8',
);
const studentCss = readFileSync(
  resolve(process.cwd(), 'src/features/student/StudentVerificationsView.module.css'),
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

  it('gives the title more room by keeping the status column compact', () => {
    expect(css).toMatch(/\.titleColumn\s*\{[^}]*width:\s*25%/s);
    expect(css).toMatch(/\.statusColumn\s*\{[^}]*width:\s*16%/s);
  });

  it('keeps verification archives full-width and teacher actions in a 3-column mobile grid', () => {
    expect(css).toMatch(
      /\.verificationList\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-width:\s*0/s,
    );
    expect(studentCss).toMatch(
      /\.list\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-width:\s*0/s,
    );
    expect(studentCss).not.toMatch(/\.list\s*\{[^}]*grid-template-columns/s);
    expect(recordCardCss).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsGrid\s+\.actions\s*\{[^}]*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(recordCardCss).toMatch(/\.card\s*\{[^}]*width:\s*100%[^}]*overflow:\s*hidden/s);
  });

  it('keeps creation controls compact and responsive down to 320px', () => {
    expect(css).toMatch(/\.filterActions\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.filterActions\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*20rem\)[\s\S]*?\.filterActions\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(/\.createDialogForm\s*\{[^}]*min-width:\s*min\(28rem,/s);
  });
});
