import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = resolve(process.cwd(), 'src');
const directStorageCall = /\b(?:getBytes|uploadBytes|deleteObject|listAll)\s*\(/;

function runtimeSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'rules' || entry.name === '__tests__') return [];
      return runtimeSources(path);
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [path];
  });
}

describe('Repository Storage Gateway — copertura runtime', () => {
  it('non lascia operazioni dati Firebase Storage dirette nel client web', () => {
    const offenders = runtimeSources(sourceRoot)
      .filter((path) => directStorageCall.test(readFileSync(path, 'utf8')))
      .map((path) => relative(sourceRoot, path).replaceAll('\\', '/'));

    expect(offenders).toEqual([]);
  });
});
