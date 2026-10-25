/** Always derive the teacher projection location from the freshly read private lesson. */
export function lessonProjectionPath(
  lesson: { hiddenFromStudents?: unknown } | null,
  publicLessonId: string,
): string {
  return `${lesson?.hiddenFromStudents === true ? 'hiddenLessonProjections' : 'publicLessons'}/${publicLessonId}`;
}
