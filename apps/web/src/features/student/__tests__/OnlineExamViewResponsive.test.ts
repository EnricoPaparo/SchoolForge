import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/student/OnlineExamView.module.css'),
  'utf8',
);

describe('OnlineExamView — desktop action layout', () => {
  it('keeps status separate from a centered equal-width action row on desktop', () => {
    expect(css).toMatch(
      /@media\s*\(min-width:\s*641px\)[\s\S]*?\.controlRow\s*\{[^}]*'header status'[^}]*'actions actions'/s,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*641px\)[\s\S]*?\.examActions\s*\{[^}]*grid-area:\s*actions[^}]*flex-wrap:\s*nowrap[^}]*justify-content:\s*center/s,
    );
    expect(css).toMatch(
      /@media\s*\(min-width:\s*641px\)[\s\S]*?\.examActions button\s*\{[^}]*flex:\s*0 1 12rem[^}]*width:\s*12rem/s,
    );
  });

  it('preserves the existing mobile action layout and hides desktop-only icons', () => {
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.controlRow\s*\{[^}]*flex-direction:\s*column[^}]*align-items:\s*stretch/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.examActions button\s*\{[^}]*flex:\s*1/s,
    );
    expect(css).toMatch(
      /@media\s*\(max-width:\s*640px\)[\s\S]*?\.desktopActionIcon\s*\{[^}]*display:\s*none/s,
    );
  });
});
