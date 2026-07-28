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

  it('keeps verification archives full-width and the teacher menu compact on mobile', () => {
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
    // UI-VERIFICHE-05 — desktop: identity | metrics | actions su tre colonne.
    expect(recordCardCss).toMatch(
      /@media\s*\(min-width:\s*44\.01rem\)[\s\S]*?\.cardActionsVerification\s*\{[^}]*'identity metrics actions'[^}]*'cta metrics actions'/,
    );
    // Mobile: trigger in alto a destra; la CTA touch non riserva spazio.
    expect(recordCardCss).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsVerification\s*\{[^}]*'identity actions'[^}]*'metrics metrics'[^}]*'progress progress'[^}]*'errors errors'/,
    );
    expect(recordCardCss).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsVerification\s+\.actions\s*\{[^}]*grid-template-columns:\s*auto[^}]*justify-self:\s*end/,
    );
    // Target touch accessibile (≥ 44px) sul trigger condiviso.
    expect(recordCardCss).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.cardActionsVerification\s+\.actions button\s*\{[^}]*min-width:\s*2\.75rem[^}]*min-height:\s*2\.75rem/,
    );
  });

  it('keeps creation controls compact and responsive down to 320px', () => {
    expect(css).toMatch(/\.filterActions\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.filterActions\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*20rem\)[\s\S]*?\.filterActions\s*\{[^}]*grid-template-columns:\s*1fr/,
    );
    expect(css).toMatch(
      /\.createDialogForm\s*\{[^}]*width:\s*100%[^}]*min-width:\s*0[^}]*box-sizing:\s*border-box/s,
    );
    expect(css).toMatch(
      /\.createDialogForm input,[\s\S]*?\.createDialogForm select\s*\{[^}]*max-width:\s*100%[^}]*box-sizing:\s*border-box/s,
    );
    expect(css).toMatch(
      /\.dialogActions\s*\{[^}]*gap:\s*0\.6rem[^}]*margin-top:\s*0\.25rem[^}]*padding-top:\s*0\.9rem/s,
    );
    expect(css).not.toMatch(/\.dialogActions\s*\{[^}]*border-top\s*:/s);
    expect(css).not.toMatch(/\.createDialogForm\s+\.dialogActions/);
    expect(css).not.toMatch(/\.onlineDisableDialog\s+\.dialogActions/);
  });
});
