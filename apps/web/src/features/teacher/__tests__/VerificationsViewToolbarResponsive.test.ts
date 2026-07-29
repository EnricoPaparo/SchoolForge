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
  it('uses the approved 7 → 2 grid on desktop and keeps the submissions table scrollable', () => {
    expect(css).toMatch(/\.batchToolbar\s*\{[^}]*repeat\(7,\s*minmax\(0,\s*1fr\)\)/s);
    // UI-CONSEGNE-01 — sotto 48rem, ma sopra il breakpoint mobile, la toolbar
    // desktop degrada a due colonne invece di comprimere i sette pulsanti.
    expect(css).toMatch(
      /@media\s*\(max-width:\s*48rem\)[\s\S]*?\.batchToolbarDesktop\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
    );
    expect(css).toMatch(/\.batchToolbar button\s*\{[^}]*width:\s*100%/s);
    expect(css).toMatch(/\.submissionsTableWrap\s*\{[^}]*overflow-x:\s*auto/s);
  });

  it('UI-CONSEGNE-02 — toolbar mobile a un controllo e lista card verticale', () => {
    expect(css).toMatch(
      /\.batchToolbarMobile\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
    );
    // Lista verticale: una card per riga, mai una griglia affiancata.
    expect(css).toMatch(
      /\.submissionCardList\s*\{[^}]*display:\s*flex[^}]*flex-direction:\s*column[^}]*min-width:\s*0/s,
    );
    expect(css).not.toMatch(/\.submissionCardList\s*\{[^}]*grid-template-columns/s);
    // Card consegna: quattro metriche in una griglia 2×2.
    expect(recordCardCss).toMatch(
      /\.cardActionsSubmission\s+\.metrics\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/s,
    );
    expect(recordCardCss).not.toMatch(/\.cardActionsSubmission\s+\.metrics\s*>\s*:nth-child\(3\)/s);
    // Checkbox a sinistra e trigger «…» a destra con target touch pieno.
    expect(recordCardCss).toMatch(
      /\.card\.cardActionsSubmission\s*\{[^}]*'select identity actions'/s,
    );
    expect(recordCardCss).toMatch(
      /\.cardActionsSubmission\s+\.actions\s*\{[^}]*justify-self:\s*end/s,
    );
    expect(recordCardCss).toMatch(
      /\.cardActionsSubmission\s+\.actions button\s*\{[^}]*min-width:\s*2\.75rem[^}]*min-height:\s*2\.75rem/s,
    );
  });

  it('UI-CONSEGNE-02 — «Torna alle verifiche» è un vero pulsante', () => {
    expect(css).toMatch(
      /\.backButton\s*\{[^}]*border:\s*1px solid var\(--color-border\)[^}]*background:\s*var\(--color-surface\)/s,
    );
    expect(css).toMatch(/\.backButton\s*\{[^}]*color:\s*var\(--color-brand-blue\)/s);
    expect(css).toMatch(
      /\.backButton:hover:not\(:disabled\),[\s\S]*?\.backButton:focus-visible\s*\{[^}]*color:\s*var\(--color-brand-interactive\)/s,
    );
    // Spostamento della freccia solo su puntatore fine, annullato in reduced-motion.
    expect(css).toMatch(
      /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)[\s\S]*?\.backButton:hover:not\(:disabled\)\s+svg\s*\{[^}]*translateX\(-2px\)/s,
    );
    expect(css).toMatch(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.backButton:focus-visible\s+svg\s*\{[^}]*transform:\s*none/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*44rem\)[\s\S]*?\.backButton\s*\{[^}]*min-height:\s*2\.75rem/s,
    );
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
