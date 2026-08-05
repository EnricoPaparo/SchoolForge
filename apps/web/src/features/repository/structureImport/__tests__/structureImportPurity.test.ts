import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * STRUCTURE-IMPORT-01 — confine di purezza, verificato staticamente.
 *
 * Il valore di questo strato è che parser, validatori e planner possano essere
 * eseguiti e testati senza Firebase, senza DOM e senza rete. Un `import` di
 * troppo lo distruggerebbe silenziosamente, quindi il confine è un test, non
 * una convenzione: la regola vale sui moduli nuovi **e** su tutto ciò che
 * raggiungono, transitivamente, dentro `src/`.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const moduleDir = resolve(__dirname, '..');
const srcRoot = resolve(__dirname, '../../../..');

/** Specificatori che questo strato non può raggiungere, nemmeno indirettamente. */
const FORBIDDEN_IMPORT_PATTERNS: Array<{ label: string; test: (spec: string) => boolean }> = [
  { label: 'Firebase', test: (s) => s === 'firebase' || s.startsWith('firebase/') },
  { label: 'Firebase Admin', test: (s) => s.startsWith('firebase-admin') },
  { label: 'Cloud Functions', test: (s) => s.startsWith('firebase-functions') },
  { label: 'React', test: (s) => s === 'react' || s.startsWith('react/') || s === 'react-dom' },
  { label: 'React Router', test: (s) => s.startsWith('react-router') },
  { label: 'gateway Storage', test: (s) => s.includes('gateway') },
  {
    label: 'client Functions',
    test: (s) => s.includes('functionsClient') || s.includes('callable'),
  },
  { label: 'inizializzazione Firebase', test: (s) => s.includes('/firebase') },
];

function sourceFilesIn(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFilesIn(full);
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [full] : [];
  });
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+'([^']+)'/g;
const DYNAMIC_IMPORT_RE = /\bimport\(\s*'([^']+)'\s*\)/g;

function importsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) specifiers.push(match[1]!);
  for (const match of source.matchAll(DYNAMIC_IMPORT_RE)) specifiers.push(match[1]!);
  return specifiers;
}

/** Resolves a relative specifier written with the `.js` extension to its `.ts` source. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(fromFile), specifier).replace(/\.js$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    try {
      readFileSync(candidate, 'utf8');
      return candidate;
    } catch {
      /* not this one */
    }
  }
  return null;
}

/** Every source file reachable from the structure-import modules, inside `src/`. */
function transitiveClosure(): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const queue = sourceFilesIn(moduleDir);

  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const specifiers = importsOf(file);
    seen.set(file, specifiers);
    for (const specifier of specifiers) {
      const local = resolveLocal(file, specifier);
      if (local && local.startsWith(srcRoot) && !seen.has(local)) queue.push(local);
    }
  }

  return seen;
}

describe('confine puro dei moduli STRUCTURE-IMPORT', () => {
  const closure = transitiveClosure();

  it('include i moduli attesi e li raggiunge davvero', () => {
    const names = [...closure.keys()].map((file) => file.replace(`${srcRoot}/`, ''));
    for (const expected of [
      'features/repository/structureImport/parseStructureYaml.ts',
      'features/repository/structureImport/validateUdaMetadataFile.ts',
      'features/repository/structureImport/validateLessonMetadataFile.ts',
      'features/repository/structureImport/planUdaMetadataAppend.ts',
      'features/repository/structureImport/planLessonMetadataAppend.ts',
      // Helper canonici condivisi: fanno parte del confine, non un'eccezione.
      'features/repository/canonicalNaming.ts',
      'features/repository/validation/frontMatter.ts',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('nessun modulo raggiunto importa Firebase, React, gateway o Functions', () => {
    const violations: string[] = [];
    for (const [file, specifiers] of closure) {
      for (const specifier of specifiers) {
        const forbidden = FORBIDDEN_IMPORT_PATTERNS.find((rule) => rule.test(specifier));
        if (forbidden) {
          violations.push(`${file.replace(`${srcRoot}/`, '')} → ${specifier} (${forbidden.label})`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('le uniche dipendenze esterne sono quelle già presenti nel progetto', () => {
    const external = new Set<string>();
    for (const [, specifiers] of closure) {
      for (const specifier of specifiers) {
        if (!specifier.startsWith('.')) external.add(specifier);
      }
    }
    // `yaml` era già una dipendenza del progetto: STRUCTURE-IMPORT-01 non ne
    // aggiunge nessuna.
    expect([...external].sort()).toEqual(['yaml']);
  });

  it('nessun modulo tocca API del browser o temporizzatori', () => {
    const banned = [
      'document.',
      'window.',
      'localStorage',
      'sessionStorage',
      'fetch(',
      'XMLHttpRequest',
      'setTimeout(',
      'setInterval(',
      'navigator.',
      'URL.createObjectURL',
    ];
    for (const file of sourceFilesIn(moduleDir)) {
      // I commenti sono prosa: «never the whole document.» non è una chiamata
      // al DOM, e un falso positivo insegnerebbe a disattivare il test.
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      for (const token of banned) {
        expect(`${file.replace(`${srcRoot}/`, '')}:${source.includes(token)}`).toBe(
          `${file.replace(`${srcRoot}/`, '')}:false`,
        );
      }
    }
  });

  it('nessun modulo definisce componenti o hook React', () => {
    for (const file of sourceFilesIn(moduleDir)) {
      expect(file.endsWith('.tsx')).toBe(false);
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/\buseState\b|\buseEffect\b|\bJSX\b/);
    }
  });
});
