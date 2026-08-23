import { httpsCallable } from 'firebase/functions';
import type { Functions } from 'firebase/functions';

export interface SetLessonCompletedRequest {
  programId: string;
  importId: string;
  lessonId: string;
  completed: boolean;
}

export interface LessonVisualIdentity {
  programId: string;
  importId: string;
  lessonId: string;
}

export function createVisualLifecycleClient(functions: Functions) {
  const complete = httpsCallable<SetLessonCompletedRequest, { status: string }>(
    functions,
    'setLessonCompleted',
  );
  const remove = httpsCallable<LessonVisualIdentity, { status: string }>(
    functions,
    'aiVisualRemove',
  );
  const abandon = httpsCallable<{ requestId: string }, { status: string }>(
    functions,
    'aiVisualAbandon',
  );
  const cleanupForDelete = httpsCallable<
    { programId: string; importId: string; lessonIds: string[] },
    { status: string; lessons: number; blobs: number }
  >(functions, 'aiVisualCleanupForDelete');
  return {
    setLessonCompleted: async (input: SetLessonCompletedRequest): Promise<void> => {
      await complete(input);
    },
    removeLessonVisual: async (input: LessonVisualIdentity): Promise<void> => {
      await remove(input);
    },
    abandonVisual: async (requestId: string): Promise<void> => {
      await abandon({ requestId });
    },
    cleanupForDelete: async (input: {
      programId: string;
      importId: string;
      lessonIds: string[];
    }): Promise<void> => {
      for (let offset = 0; offset < input.lessonIds.length; offset += 100) {
        await cleanupForDelete({
          ...input,
          lessonIds: input.lessonIds.slice(offset, offset + 100),
        });
      }
    },
  };
}
