import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../..');

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function filesBelow(root: string, prefix = ''): string[] {
  return readdirSync(resolve(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      return entry.isDirectory() ? filesBelow(root, relative) : [relative];
    })
    .sort();
}

describe('Functions deployment package', () => {
  it('uses a deployable file dependency instead of the unsupported workspace protocol', () => {
    const packageJson = readJson(resolve(repositoryRoot, 'functions/package.json'));
    const dependencies = packageJson.dependencies as Record<string, unknown>;

    expect(dependencies['@schoolforge/lesson-contract']).toBe('file:./vendor/lesson-contract');
  });

  it('builds and synchronizes the shared contract before packaging Functions', () => {
    const firebase = readJson(resolve(repositoryRoot, 'firebase.json'));
    const functions = firebase.functions as { predeploy?: unknown };

    expect(functions.predeploy).toEqual([
      'pnpm --dir packages/lesson-contract build',
      'node functions/scripts/syncLessonContractVendor.mjs',
      'pnpm --dir "$RESOURCE_DIR" build',
    ]);
  });

  it('keeps the vendored package byte-identical to the built workspace package', () => {
    const source = resolve(repositoryRoot, 'packages/lesson-contract/dist');
    const vendored = resolve(repositoryRoot, 'functions/vendor/lesson-contract/dist');
    const files = filesBelow(source).filter(
      (file) => !file.includes('.test.') && !file.endsWith('.map'),
    );

    expect(filesBelow(vendored)).toEqual(files);
    for (const file of files) {
      expect(readFileSync(resolve(vendored, file))).toEqual(readFileSync(resolve(source, file)));
    }
  });
});
