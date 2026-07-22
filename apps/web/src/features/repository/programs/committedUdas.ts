/**
 * Reader coherence for the staged "Importa UDA" append (uda-import-contract
 * §5.1). A UDA's lessons and questionIndex are written to Firestore *before*
 * the commit that creates the `UdaDoc`. Until that commit, those lesson/index
 * documents are logically staged and MUST be invisible to ordinary readers:
 * a lesson/questionIndex whose `udaDir` has no matching `UdaDoc` is orphaned
 * (either mid-attempt or crash residue) and is ignored.
 *
 * Pure and read-free: callers already hold both the UDA set and the lessons
 * (library, workspace, export, question picker), so this adds NO extra query
 * on an ordinary course open — it just intersects two lists already in hand.
 */

/** Set of committed UDA directories (each has a real `UdaDoc`). */
export function committedUdaDirSet(udas: Array<{ dir: string }>): Set<string> {
  return new Set(udas.map((u) => u.dir));
}

/**
 * Keeps only the lessons whose `udaDir` belongs to a committed UDA. Staged
 * lessons for a not-yet-committed UDA (no `UdaDoc`) are dropped.
 */
export function filterCommittedLessons<T extends { udaDir: string }>(
  udas: Array<{ dir: string }>,
  lessons: T[],
): T[] {
  const committed = committedUdaDirSet(udas);
  return lessons.filter((l) => committed.has(l.udaDir));
}
