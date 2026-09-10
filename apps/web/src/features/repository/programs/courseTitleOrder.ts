const courseTitleCollator = new Intl.Collator('it', {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true,
});

/** Ordine alfabetico italiano condiviso dalle librerie docente e studente. */
export function compareCourseTitles(left: string, right: string): number {
  return courseTitleCollator.compare(left, right);
}
