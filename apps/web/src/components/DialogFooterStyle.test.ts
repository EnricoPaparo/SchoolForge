import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');

function sourceFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, extension);
    return extname(entry.name) === extension ? [path] : [];
  });
}

function cssBlocks(css: string): Array<{ selector: string; declarations: string }> {
  return Array.from(css.matchAll(/([^{}]+)\{([^{}]*)\}/g), (match) => ({
    selector: match[1]!.trim(),
    declarations: match[2]!,
  }));
}

const dialogActionSelector =
  /(?:dialog-?actions|dialogActions|confirmActions|actionFooter|dialogFooter|modalFooter|deleteConfirmActions|examModeDialogActions)/i;

describe('SchoolForge dialog footer style contract', () => {
  it('keeps shared action rows free from decorative separators', () => {
    const globalCss = readFileSync(resolve(sourceRoot, 'index.css'), 'utf8');
    const confirmCss = readFileSync(
      resolve(sourceRoot, 'components/ConfirmDialog.module.css'),
      'utf8',
    );
    const shellCss = readFileSync(resolve(sourceRoot, 'components/DialogShell.module.css'), 'utf8');

    const sharedBlocks = [
      ...cssBlocks(globalCss).filter(({ selector }) => selector.includes('.dialog-actions')),
      ...cssBlocks(confirmCss).filter(({ selector }) => selector.includes('.actions')),
    ];

    expect(sharedBlocks.length).toBeGreaterThan(0);
    for (const { declarations } of sharedBlocks) {
      expect(declarations).not.toMatch(/border-top\s*:/i);
      expect(declarations).not.toMatch(/box-shadow\s*:\s*inset/i);
    }
    expect(shellCss).toMatch(/\.dialog\s*\{[^}]*gap:\s*0\.9rem/s);
  });

  it('rejects separators reintroduced by any dialog action class', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(sourceRoot, '.css')) {
      const css = readFileSync(file, 'utf8');
      for (const { selector, declarations } of cssBlocks(css)) {
        if (!dialogActionSelector.test(selector)) continue;
        if (/border-top\s*:/i.test(declarations) || /box-shadow\s*:\s*inset/i.test(declarations)) {
          violations.push(`${file}: ${selector}`);
        }
        if (/::(?:before|after)/i.test(selector)) {
          violations.push(`${file}: ${selector}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('keeps DialogShell consumers free from decorative horizontal rules', () => {
    const violations = sourceFiles(sourceRoot, '.tsx')
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('DialogShell') && /<hr\b/i.test(source);
      })
      .map((file) => file.replace(`${sourceRoot}\\`, ''));

    expect(violations).toEqual([]);
  });

  it('keeps spacing in the verification footer without a border', () => {
    const css = readFileSync(
      resolve(sourceRoot, 'features/teacher/VerificationsView.module.css'),
      'utf8',
    );
    const footer = cssBlocks(css).find(({ selector }) => selector === '.dialogActions');

    expect(footer?.declarations).toMatch(/gap:\s*0\.6rem/);
    expect(footer?.declarations).toMatch(/margin-top:\s*0\.25rem/);
    expect(footer?.declarations).toMatch(/padding-top:\s*0\.9rem/);
    expect(footer?.declarations).not.toMatch(/border-top\s*:/);
    expect(css).not.toMatch(/\.createDialogForm\s+\.dialogActions/);
    expect(css).not.toMatch(/\.onlineDisableDialog\s+\.dialogActions/);
  });
});
