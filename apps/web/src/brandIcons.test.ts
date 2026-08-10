import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicRoot = resolve(process.cwd(), 'public');
const indexHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(publicRoot, 'manifest.webmanifest'), 'utf8')) as {
  icons: Array<{ src: string; sizes: string; purpose: string }>;
};

function pngHeader(relativePath: string) {
  const file = readFileSync(resolve(publicRoot, relativePath));
  return {
    signature: file.subarray(0, 8).toString('hex'),
    width: file.readUInt32BE(16),
    height: file.readUInt32BE(20),
    bitDepth: file[24],
    colorType: file[25],
  };
}

describe('icone brand SchoolForge', () => {
  it.each([
    ['icons/favicon-schoolforge-32.png', 32],
    ['icons/icon-schoolforge-192.png', 192],
    ['icons/icon-schoolforge-512.png', 512],
  ] as const)('%s è un PNG quadrato RGBA della misura dichiarata', (path, size) => {
    expect(existsSync(resolve(publicRoot, path))).toBe(true);
    expect(pngHeader(path)).toEqual({
      signature: '89504e470d0a1a0a',
      width: size,
      height: size,
      bitDepth: 8,
      colorType: 6,
    });
  });

  it('la favicon usa il nuovo URL trasparente, così il browser non conserva quella opaca', () => {
    expect(indexHtml).toContain('href="/icons/favicon-schoolforge-32.png"');
    expect(indexHtml).not.toContain('href="/icons/favicon-32.png"');
  });

  it('il manifest usa le icone trasparenti per purpose any e conserva la maskable opaca', () => {
    expect(manifest.icons).toEqual([
      {
        src: '/icons/icon-schoolforge-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-schoolforge-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ]);
  });
});
