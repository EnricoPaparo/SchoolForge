/**
 * EXAM-UX-03 — ordine casuale **locale** delle domande durante la verifica
 * online. Deterrente leggero: l'ordine è solo visivo, non viene mai persistito
 * (Firestore/sessionStorage/localStorage) e può cambiare liberamente a ogni
 * mount/refresh. Risposte e flag restano sempre associati all'`order`/ID
 * originale della domanda: questo helper riordina soltanto l'array visivo.
 */

/**
 * Fisher–Yates corretto e imparziale con RNG **iniettabile** (per test
 * deterministici). Non muta l'input: ritorna un nuovo array con gli stessi
 * elementi (nessuna perdita né duplicazione). `rng()` deve restituire un float
 * in `[0, 1)` (default `Math.random`). Array vuoto o di un elemento → copia
 * invariata.
 */
export function shuffleWithRng<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}
