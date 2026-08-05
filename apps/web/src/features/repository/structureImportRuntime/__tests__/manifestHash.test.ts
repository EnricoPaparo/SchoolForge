import { afterEach, describe, expect, it } from 'vitest';
import { computeManifestHash, ManifestHashUnavailableError } from '../manifestHash.js';
import { planUdaMetadataAppend } from '../../structureImport/index.js';

/**
 * STRUCTURE-IMPORT-02A — l'identità autorevole di un tentativo.
 *
 * Ciò che conta qui non è solo che l'hash sia corretto, ma che sia *l'unico*
 * digest sul percorso: nessun FNV, nessun ripiego più debole quando Web Crypto
 * non è disponibile.
 */

const realCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, 'crypto', { value: realCrypto, configurable: true });
});

describe('vettori noti', () => {
  it('riproduce SHA-256 della stringa vuota', async () => {
    await expect(computeManifestHash('')).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('riproduce SHA-256 di «abc»', async () => {
    await expect(computeManifestHash('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('tratta l’input come UTF-8, non come Latin-1', async () => {
    // SHA-256 di «à» codificato UTF-8 (C3 A0), non Latin-1 (E0).
    await expect(computeManifestHash('à')).resolves.toBe(
      'b3fc9de526e253e7ac1b8d94ed2374c627ca7abfbca3d91bd1214a5a2df53ffe',
    );
    expect(await computeManifestHash('à')).not.toBe(
      '7d8c5da7fd418379048e430b33dc8ffcda739e44326b8a5d647dc0ad81ed2157',
    );
  });
});

describe('forma e stabilità', () => {
  it('è esadecimale minuscolo di 64 caratteri', async () => {
    const hash = await computeManifestHash('qualcosa');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('è stabile a parità di input', async () => {
    const [a, b] = await Promise.all([
      computeManifestHash('stesso input'),
      computeManifestHash('stesso input'),
    ]);
    expect(a).toBe(b);
  });

  it('cambia quando cambia l’input, nei casi verificati', async () => {
    const [a, b, c] = await Promise.all([
      computeManifestHash('a'),
      computeManifestHash('b'),
      computeManifestHash('a '),
    ]);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});

describe('input: la serializzazione canonica del manifest', () => {
  it('l’hash si calcola su `manifestCanonical` e non su altro', async () => {
    const plan = planUdaMetadataAppend({
      ownerUid: 'owner-1',
      programId: 'prog-1',
      importId: 'imp-1',
      udas: [{ titolo: 'Le reti', descrizione: null, competenze: ['c'], obiettivi: ['o'] }],
      existingUdas: [],
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const fromManifest = await computeManifestHash(plan.value.manifestCanonical);
    const direct = await computeManifestHash(plan.value.manifestCanonical);
    expect(fromManifest).toBe(direct);
    // Non è l'hash di una qualunque serializzazione del manifest.
    expect(fromManifest).not.toBe(await computeManifestHash(JSON.stringify(plan.value)));
  });

  it('due piani diversi producono hash diversi', async () => {
    const build = (titolo: string) => {
      const plan = planUdaMetadataAppend({
        ownerUid: 'owner-1',
        programId: 'prog-1',
        importId: 'imp-1',
        udas: [{ titolo, descrizione: null, competenze: ['c'], obiettivi: ['o'] }],
        existingUdas: [],
      });
      if (!plan.ok) throw new Error(plan.error.code);
      return computeManifestHash(plan.value.manifestCanonical);
    };
    expect(await build('Le reti')).not.toBe(await build('Le altre reti'));
  });
});

describe('fail-closed', () => {
  it('senza Web Crypto solleva un errore invece di ripiegare su un digest più debole', async () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    await expect(computeManifestHash('x')).rejects.toBeInstanceOf(ManifestHashUnavailableError);
  });

  it('un digest che fallisce non produce comunque un hash', async () => {
    Object.defineProperty(globalThis, 'crypto', {
      value: {
        subtle: {
          digest: () => {
            throw new Error('boom');
          },
        },
      },
      configurable: true,
    });
    await expect(computeManifestHash('x')).rejects.toBeInstanceOf(ManifestHashUnavailableError);
  });

  it('il messaggio di errore è leggibile e non tecnico', async () => {
    const error = new ManifestHashUnavailableError();
    expect(error.message).toContain('browser');
    expect(error.message).not.toMatch(/SHA|crypto|subtle/i);
  });
});
