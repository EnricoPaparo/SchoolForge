import { expect, it } from 'vitest';
import { compareVerificationCards } from '../verificationDate.js';
it('orders dates descending, same-day Italian titles ignoring accents/case, missing last, stable IDs', () => {
  const cards = [
    { id: 'missing', title: 'AAA' },
    { id: 'old', title: 'AAA', verificationDate: '2026-01-01' },
    { id: 'z', title: 'Zebra', verificationDate: '2026-10-12' },
    { id: 'b', title: 'Àlgebra', verificationDate: '2026-10-12' },
    { id: 'a', title: 'algebra', verificationDate: '2026-10-12' },
    { id: 'bad', title: 'zzz', verificationDate: '2026-02-30' },
  ];
  expect(cards.sort(compareVerificationCards).map((x) => x.id)).toEqual([
    'a',
    'b',
    'z',
    'old',
    'missing',
    'bad',
  ]);
});
