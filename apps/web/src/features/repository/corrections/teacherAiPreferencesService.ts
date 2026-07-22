import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import type { FieldValue, Firestore, Timestamp } from 'firebase/firestore';
import {
  DEFAULT_GRADING_MODE,
  DEFAULT_MODEL_PROFILE,
  MAX_TEACHER_GUIDANCE_CHARS,
  type GradingMode,
  type ModelProfile,
} from './aiCorrectionClient.js';

/**
 * TWU-02 — preferenze predefinite **owner-only** della correzione IA, un solo
 * documento `teacherAiPreferences/{ownerUid}`. Precompilano il dialog «Correggi
 * con IA»; le modifiche nella singola operazione non le sovrascrivono. Contratto
 * **chiuso**: solo profilo modello, stile di valutazione e indicazioni.
 *
 * **Fail-closed:** un documento presente ma malformato (enum sconosciuti,
 * guidance vuota/non-stringa/oltre limite, `ownerUid` incoerente) **non** viene
 * silenziosamente normalizzato né ricondotto ai default: solleva un errore
 * tipizzato ({@link TeacherAiPreferencesError}). Solo il documento **assente**
 * dà i default applicativi.
 *
 * Costo: **una** get puntuale all'ingresso in Verifiche / prima apertura delle
 * impostazioni, **una** write solo al «Salva». Nessun listener, nessun polling.
 */

/** Errore tipizzato e leggibile per preferenze malformate o input non validi. */
export class TeacherAiPreferencesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeacherAiPreferencesError';
  }
}

/** Documento Firestore (contratto chiuso). */
export interface TeacherAiPreferencesDoc {
  ownerUid: string;
  modelProfile: ModelProfile;
  gradingMode: GradingMode;
  teacherGuidance?: string;
  updatedAt: Timestamp | FieldValue;
}

/** Valori applicativi risolti (con default) usati dalla UI. */
export interface TeacherAiPreferences {
  modelProfile: ModelProfile;
  gradingMode: GradingMode;
  teacherGuidance: string;
}

/** Default applicativi quando il documento è assente (nessuna migrazione). */
export const DEFAULT_TEACHER_AI_PREFERENCES: TeacherAiPreferences = {
  modelProfile: DEFAULT_MODEL_PROFILE,
  gradingMode: DEFAULT_GRADING_MODE,
  teacherGuidance: '',
};

const MODEL_PROFILES: readonly ModelProfile[] = ['economy', 'quality'];
const GRADING_MODES: readonly GradingMode[] = ['compassionate', 'balanced', 'rigorous'];

function isModelProfile(value: unknown): value is ModelProfile {
  return typeof value === 'string' && (MODEL_PROFILES as readonly string[]).includes(value);
}

function isGradingMode(value: unknown): value is GradingMode {
  return typeof value === 'string' && (GRADING_MODES as readonly string[]).includes(value);
}

/**
 * Legge le preferenze dell'owner **fail-closed**:
 * - documento **assente** ⇒ default applicativi;
 * - documento **presente**: `modelProfile` e `gradingMode` devono essere
 *   esattamente i valori enum ammessi; `ownerUid` deve coincidere con quello
 *   richiesto; `teacherGuidance`, se presente, deve essere una stringa non vuota
 *   dopo `trim` e ≤ {@link MAX_TEACHER_GUIDANCE_CHARS}. Qualsiasi valore null,
 *   sconosciuto o malformato ⇒ {@link TeacherAiPreferencesError} (mai default
 *   silenzioso, mai troncamento).
 * Un errore di lettura della `get` **propaga** (non è mai interpretato come
 * documento assente).
 */
export async function loadTeacherAiPreferences(
  ownerUid: string,
  db: Firestore,
): Promise<TeacherAiPreferences> {
  const snap = await getDoc(doc(db, 'teacherAiPreferences', ownerUid));
  if (!snap.exists()) return { ...DEFAULT_TEACHER_AI_PREFERENCES };

  const data = snap.data() as Record<string, unknown>;
  if (data.ownerUid !== ownerUid) {
    throw new TeacherAiPreferencesError('Preferenze IA con proprietario incoerente.');
  }
  if (!isModelProfile(data.modelProfile)) {
    throw new TeacherAiPreferencesError('Profilo modello delle preferenze IA non valido.');
  }
  if (!isGradingMode(data.gradingMode)) {
    throw new TeacherAiPreferencesError('Stile di valutazione delle preferenze IA non valido.');
  }

  let teacherGuidance = '';
  if (data.teacherGuidance !== undefined) {
    if (typeof data.teacherGuidance !== 'string') {
      throw new TeacherAiPreferencesError('Indicazioni delle preferenze IA non valide.');
    }
    const trimmed = data.teacherGuidance.trim();
    if (trimmed.length === 0 || data.teacherGuidance.length > MAX_TEACHER_GUIDANCE_CHARS) {
      throw new TeacherAiPreferencesError('Indicazioni delle preferenze IA non valide.');
    }
    teacherGuidance = trimmed;
  }

  return { modelProfile: data.modelProfile, gradingMode: data.gradingMode, teacherGuidance };
}

/**
 * Salva le preferenze dell'owner (una write) **fail-closed**. `teacherGuidance`
 * è normalizzata con `trim`: stringa vuota ⇒ campo **omesso**; una guidance che
 * dopo il trim supera {@link MAX_TEACHER_GUIDANCE_CHARS} ⇒
 * {@link TeacherAiPreferencesError} (nessun `slice`). Enum non validi o `ownerUid`
 * vuoto/non valido ⇒ errore, **nessuna** scrittura. Payload chiuso; `ownerUid` e
 * `updatedAt` (serverTimestamp) impostati dal service, coerenti con la Rule.
 */
export async function saveTeacherAiPreferences(
  ownerUid: string,
  prefs: TeacherAiPreferences,
  db: Firestore,
): Promise<void> {
  if (typeof ownerUid !== 'string' || ownerUid.length === 0) {
    throw new TeacherAiPreferencesError('Proprietario non valido.');
  }
  if (!isModelProfile(prefs.modelProfile)) {
    throw new TeacherAiPreferencesError('Profilo modello non valido.');
  }
  if (!isGradingMode(prefs.gradingMode)) {
    throw new TeacherAiPreferencesError('Stile di valutazione non valido.');
  }
  const guidance = (prefs.teacherGuidance ?? '').trim();
  if (guidance.length > MAX_TEACHER_GUIDANCE_CHARS) {
    throw new TeacherAiPreferencesError(
      `Le indicazioni superano il limite di ${MAX_TEACHER_GUIDANCE_CHARS} caratteri.`,
    );
  }

  const payload: TeacherAiPreferencesDoc = {
    ownerUid,
    modelProfile: prefs.modelProfile,
    gradingMode: prefs.gradingMode,
    ...(guidance ? { teacherGuidance: guidance } : {}),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'teacherAiPreferences', ownerUid), payload);
}
