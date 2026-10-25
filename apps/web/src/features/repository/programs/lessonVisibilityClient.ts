import { httpsCallable, type Functions } from 'firebase/functions';
export interface LessonVisibilityResult {
  hiddenFromStudents: boolean;
  completed: boolean;
  publicLessonId: string;
}
export function createLessonVisibilityClient(functions: Functions) {
  const update = httpsCallable<
    { programId: string; importId: string; lessonId: string; hiddenFromStudents: boolean },
    LessonVisibilityResult
  >(functions, 'setLessonVisibility');
  return {
    set: async (input: {
      programId: string;
      importId: string;
      lessonId: string;
      hiddenFromStudents: boolean;
    }) => (await update(input)).data,
  };
}
