import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AIGEN-UI-03-FOLLOW-UP — nessuna textarea di SchoolForge è ridimensionabile a
 * mano. La regola è **una sola**, globale, in `index.css`; questo test è la
 * protezione contro la reintroduzione di un override in un CSS module (che
 * vincerebbe per specificità) e rende superfluo `!important`.
 */
const SRC = resolve(process.cwd(), 'src');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return full.endsWith('.css') ? [full] : [];
  });
}

/** Dichiarazioni `resize: <valore>` (non i commenti che contengono "resize"). */
function resizeDeclarations(css: string): string[] {
  return [...css.matchAll(/(?<![-\w])resize\s*:\s*([a-z-]+)/g)].map((m) => m[1]);
}

describe('textarea resize — regola globale unica', () => {
  const globalCss = readFileSync(join(SRC, 'index.css'), 'utf8');

  it('declares the global `textarea { resize: none }` rule in the shared stylesheet', () => {
    expect(globalCss).toMatch(/(^|\n)textarea\s*\{[^}]*resize:\s*none/s);
  });

  it('never uses a resize value other than none anywhere in the app CSS', () => {
    const offenders: string[] = [];
    for (const file of cssFiles(SRC)) {
      for (const value of resizeDeclarations(readFileSync(file, 'utf8'))) {
        if (value !== 'none') offenders.push(`${relative(SRC, file)}: resize: ${value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the rule in one place: no CSS module redeclares resize', () => {
    const redeclaring: string[] = [];
    for (const file of cssFiles(SRC)) {
      if (file.endsWith(`${join('src', 'index.css')}`) || relative(SRC, file) === 'index.css') {
        continue;
      }
      if (resizeDeclarations(readFileSync(file, 'utf8')).length > 0) {
        redeclaring.push(relative(SRC, file));
      }
    }
    expect(redeclaring).toEqual([]);
  });

  it('does not need !important to win', () => {
    const rule = /(^|\n)textarea\s*\{[^}]*\}/s.exec(globalCss)?.[0] ?? '';
    expect(rule).not.toMatch(/!important/);
  });
});
