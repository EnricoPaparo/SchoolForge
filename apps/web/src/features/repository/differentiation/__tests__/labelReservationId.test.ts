import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LabelReservationIdUnavailableError,
  computeLabelReservationId,
} from '../labelReservationId.js';
import { computeNameKey, normalizeLabelName } from '../labelName.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

const HEX_64 = /^[0-9a-f]{64}$/;

describe('computeLabelReservationId', () => {
  it('produce 64 caratteri esadecimali minuscoli', async () => {
    const id = await computeLabelReservationId('owner-uid', 'percorso a');
    expect(id).toMatch(HEX_64);
  });

  it('è deterministico: stessa coppia, stesso id', async () => {
    const a = await computeLabelReservationId('owner-uid', 'percorso a');
    const b = await computeLabelReservationId('owner-uid', 'percorso a');
    expect(a).toBe(b);
  });

  it('separa gli owner: stesso nome, docenti diversi, id diversi', async () => {
    const mine = await computeLabelReservationId('owner-1', 'percorso a');
    const theirs = await computeLabelReservationId('owner-2', 'percorso a');
    expect(mine).not.toBe(theirs);
  });

  it('nomi diversi dello stesso owner producono id diversi', async () => {
    const a = await computeLabelReservationId('owner-uid', 'percorso a');
    const b = await computeLabelReservationId('owner-uid', 'percorso b');
    expect(a).not.toBe(b);
  });

  it('il separatore impedisce le collisioni per concatenazione', async () => {
    // Senza U+0000, ('ab','c') e ('a','bc') genererebbero lo stesso input.
    const first = await computeLabelReservationId('ab', 'c');
    const second = await computeLabelReservationId('a', 'bc');
    expect(first).not.toBe(second);
  });

  it('nomi equivalenti dopo la normalizzazione condividono l’id', async () => {
    const one = computeNameKey(normalizeLabelName('  Percorso   A '));
    const two = computeNameKey(normalizeLabelName('PERCORSO a'));
    expect(await computeLabelReservationId('owner-uid', one)).toBe(
      await computeLabelReservationId('owner-uid', two),
    );
  });

  it('riproduce SHA-256 di un vettore noto', async () => {
    // SHA-256 di «a» + U+0000 + «b» in UTF-8, calcolabile con qualunque
    // strumento esterno: fissa il contratto, non solo la stabilita.
    const id = await computeLabelReservationId('a', 'b');
    expect(id).toBe('59b271ae1bbcb1d31d41929817f4b16fb439eb4f31520b5ad1d5ce98920a7138');
  });

  it('il nome non compare mai nell’id', async () => {
    const id = await computeLabelReservationId('owner-uid', 'obiettivi essenziali');
    expect(id).not.toContain('obiettivi');
    expect(id).not.toContain('essenziali');
    expect(id).toMatch(HEX_64);
  });

  it('fail-closed quando Web Crypto non è disponibile', async () => {
    vi.stubGlobal('crypto', {});
    await expect(computeLabelReservationId('owner-uid', 'percorso a')).rejects.toBeInstanceOf(
      LabelReservationIdUnavailableError,
    );
  });

  it('fail-closed quando digest fallisce: nessun ripiego su un hash più debole', async () => {
    vi.stubGlobal('crypto', {
      subtle: {
        digest: () => {
          throw new Error('boom');
        },
      },
    });
    await expect(computeLabelReservationId('owner-uid', 'percorso a')).rejects.toBeInstanceOf(
      LabelReservationIdUnavailableError,
    );
  });
});
