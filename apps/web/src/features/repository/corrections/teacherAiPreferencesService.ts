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
 * Costo: **una** get puntuale all'ingresso in Verifiche / prima apertura delle
 * impostazioni, **una** write solo al «Salva». Nessun listener, nessun polling.
 */

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
 * Legge le preferenze dell'owner. Documento assente ⇒ default applicativi.
 * Valori enum sconosciuti/malformati in un documento legacy ricadono in modo
 * sicuro sui default (la UI resta usabile; la Rule impedisce comunque scritture
 * malformate). `teacherGuidance` è troncata al limite condiviso per sicurezza.
 */
export async function loadTeacherAiPreferences(
  ownerUid: string,
  db: Firestore,
): Promise<TeacherAiPreferences> {
  const snap = await getDoc(doc(db, 'teacherAiPreferences', ownerUid));
  if (!snap.exists()) return { ...DEFAULT_TEACHER_AI_PREFERENCES };
  const data = snap.data() as Partial<TeacherAiPreferencesDoc>;
  const guidance = typeof data.teacherGuidance === 'string' ? data.teacherGuidance.trim() : '';
  return {
    modelProfile: isModelProfile(data.modelProfile)
      ? data.modelProfile
      : DEFAULT_TEACHER_AI_PREFERENCES.modelProfile,
    gradingMode: isGradingMode(data.gradingMode)
      ? data.gradingMode
      : DEFAULT_TEACHER_AI_PREFERENCES.gradingMode,
    teacherGuidance: guidance.slice(0, MAX_TEACHER_GUIDANCE_CHARS),
  };
}

/**
 * Salva le preferenze dell'owner (una write). `teacherGuidance` è normalizzata
 * con `trim`: stringa vuota ⇒ campo **omesso**. `ownerUid` e `updatedAt`
 * (serverTimestamp) sono impostati dal service, coerenti con la Rule.
 */
export async function saveTeacherAiPreferences(
  ownerUid: string,
  prefs: TeacherAiPreferences,
  db: Firestore,
): Promise<void> {
  const guidance = prefs.teacherGuidance.trim();
  const payload: TeacherAiPreferencesDoc = {
    ownerUid,
    modelProfile: prefs.modelProfile,
    gradingMode: prefs.gradingMode,
    ...(guidance ? { teacherGuidance: guidance.slice(0, MAX_TEACHER_GUIDANCE_CHARS) } : {}),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, 'teacherAiPreferences', ownerUid), payload);
}
