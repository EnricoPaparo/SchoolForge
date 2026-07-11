/**
 * Maps `items` through `mapper`, running at most `concurrency` calls in
 * flight at once (a simple worker-pool over a shared cursor). Preserves
 * output order — `results[i]` always corresponds to `items[i]`, regardless
 * of which worker or in which order each promise actually resolves.
 *
 * Extracted from `loadSelectedQuestions.ts` (its original owner) so
 * `loadSelectedQuestionsWithSolutions.ts` can reuse the exact same bounded
 * concurrency instead of reading pool files fully sequentially.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index]!);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
