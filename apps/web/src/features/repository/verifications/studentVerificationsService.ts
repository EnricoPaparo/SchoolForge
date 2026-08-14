import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import type { Firestore } from 'firebase/firestore';
import type {
  PublicVerificationQuestion,
  PublishedProjectionDoc,
  VerificationTopicUda,
} from '../../../types/firestore.js';
import { isValidVerificationDate } from './verificationDate.js';
import { readTopicOutline } from './topicOutline.js';
import { getOwnStudentDoc } from '../students/studentsService.js';
import { normalizeOnlineEnabled } from './onlineEnabled.js';
import { normalizeStudentPdfEnabled } from './studentPdfEnabled.js';
import { normalizePublishedVerificationStatus } from './publishedVerificationStatus.js';
import { normalizeAssignmentMode } from './assignmentMode.js';
import type { VerificationAssignmentMode } from '../../../types/firestore.js';

export type StudentVerificationItem = {
  id: string;
  title: string;
  className: string | null;
  activatedAt: PublishedProjectionDoc['activatedAt'];
  questionCount: number;
  questions: PublicVerificationQuestion[];
  /** Normalized: a projection written before M3F-04 has no field and reads as false. */
  onlineEnabled: boolean;
  /**
   * Normalized (M3F-09): a projection written before this field existed, or
   * one whose teacher never enabled it, reads as `false` — "Scarica PDF" is
   * hidden whenever this is `false`, never shown by omission.
   */
  studentPdfEnabled: boolean;
  /** Needed by submissionsService (M3F-04) — not sensitive, already read here. */
  ownerUid: string;
  /** Missing on legacy projections and normalized to `active`. */
  status: 'active' | 'closed';
  /**
   * UI-VERIFICHE-06B — giorno didattico `YYYY-MM-DD` dalla sola proiezione
   * pubblica. `null` su proiezione legacy o valore malformato: la card omette la
   * data, non inventa un fallback.
   */
  verificationDate: string | null;
  /**
   * UI-VERIFICHE-06B — perimetro didattico (soli titoli UDA/lezione) dalla sola
   * proiezione pubblica. `null` quando assente o malformato: «Argomenti» resta
   * disabilitato, senza alcuna lettura aggiuntiva.
   */
  topicOutline: VerificationTopicUda[] | null;
  /**
   * VDIF-04 — **unico** campo su cui il portale studente instrada l'avvio.
   * `same_questions` resta interamente client-side; `server_resolved` passa
   * dalla callable. Normalizzato fail-closed, con la compatibilità legacy
   * concentrata in `normalizeAssignmentMode` e in nessun altro punto.
   */
  assignmentMode: VerificationAssignmentMode;
};

export type StudentVerificationsResult =
  | { status: 'no-class' }
  | { status: 'ok'; verifications: StudentVerificationItem[] };

/** Epoch seconds from a Firestore Timestamp-like value, or null if absent. */
function timestampSeconds(ts: unknown): number | null {
  if (!ts || typeof ts !== 'object' || !('seconds' in ts)) return null;
  return (ts as { seconds: number }).seconds;
}

/**
 * Reads only what an approved student is allowed to see (Security Rules
 * enforce the same class-matching independently — this mirrors, not
 * replaces, that check): their own classId, then every `publishedProjection`
 * across all verifications whose `classId` matches AND `visibility ==
 * 'public'`, via a single `collectionGroup` query — the parent
 * `verifications/{id}` document is never read (it holds
 * `config.questionRefs`/`teacherSnapshot`, which a student must never see);
 * the projection already carries everything needed to list the
 * verification and render the student PDF. Never reads `teacherSnapshot`,
 * `publishedSnapshot`, `config.questionRefs`, `questionIndex` or a pool
 * file.
 *
 * Both filters are required, not just the classId one: the Security Rule
 * can only authorize a `list`/collectionGroup request on fields the query
 * itself filters on (a cross-document get() back to the parent, needed to
 * check `status`, does not validate for this kind of query — see
 * firestore.rules) — so `visibility` is checked here as the query's own
 * filter, standing in for "active + public" (see `PublishedProjectionDoc`).
 */
export async function loadStudentVerifications(
  uid: string,
  db: Firestore,
): Promise<StudentVerificationsResult> {
  const studentDoc = await getOwnStudentDoc(uid, db);
  const classId = studentDoc?.classId ?? null;
  if (!classId) return { status: 'no-class' };

  const snap = await getDocs(
    query(
      collectionGroup(db, 'publishedProjection'),
      where('classId', '==', classId),
      where('visibility', '==', 'public'),
    ),
  );

  const verifications: StudentVerificationItem[] = snap.docs
    .map((d) => {
      const data = d.data() as PublishedProjectionDoc;
      const verificationId = d.ref.parent.parent?.id;
      if (!verificationId) return null;
      return {
        id: verificationId,
        title: data.title,
        className: data.className,
        activatedAt: data.activatedAt,
        questionCount: data.questions.length,
        questions: data.questions,
        onlineEnabled: normalizeOnlineEnabled(data.onlineEnabled),
        studentPdfEnabled: normalizeStudentPdfEnabled(data.studentPdfEnabled),
        assignmentMode: normalizeAssignmentMode(data.assignmentMode, data.distributionMode),
        ownerUid: data.ownerUid,
        status: normalizePublishedVerificationStatus(data.status),
        verificationDate: isValidVerificationDate(data.verificationDate)
          ? data.verificationDate
          : null,
        topicOutline: readTopicOutline(data.topicOutline),
      };
    })
    .filter((item): item is StudentVerificationItem => item !== null)
    .sort((a, b) => {
      const secondsA = timestampSeconds(a.activatedAt);
      const secondsB = timestampSeconds(b.activatedAt);
      if (secondsA != null && secondsB != null) return secondsB - secondsA;
      if (secondsA != null) return -1;
      if (secondsB != null) return 1;
      return a.title.localeCompare(b.title);
    });

  return { status: 'ok', verifications };
}
