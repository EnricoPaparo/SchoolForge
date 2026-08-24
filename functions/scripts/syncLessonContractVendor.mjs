import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, '../../packages/lesson-contract');
const target = resolve(here, '../vendor/lesson-contract');

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
cpSync(resolve(source, 'dist'), resolve(target, 'dist'), {
  recursive: true,
  filter: (path) => !path.includes('.test.') && !path.endsWith('.map'),
});

const packageJson = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
delete packageJson.scripts;
delete packageJson.devDependencies;
writeFileSync(resolve(target, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
