import {
  gradingModeDescription,
  modelProfileDescription,
  GRADING_MODE_OPTIONS,
  MAX_TEACHER_GUIDANCE_CHARS,
  MODEL_PROFILE_OPTIONS,
  type GradingMode,
  type ModelProfile,
} from '../repository/corrections/aiCorrectionClient.js';
import styles from './AiCorrectionSettingsFields.module.css';

/**
 * TWU-02 — campi condivisi della correzione IA (profilo modello, stile di
 * valutazione, indicazioni), estratti in un **unico** componente controllato
 * riusato sia dal dialog «Impostazioni correzione IA» sia dalla fase configure
 * di `AiBatchCorrectionDialog`. Nessuna logica di rete o persistenza qui: solo
 * campi controllati; il contenitore decide cosa farne (salvare o inviare).
 */

export interface AiCorrectionSettingsValue {
  modelProfile: ModelProfile;
  gradingMode: GradingMode;
  teacherGuidance: string;
}

export function AiCorrectionSettingsFields({
  value,
  onChange,
  disabled = false,
  idPrefix = 'ai-settings',
}: {
  value: AiCorrectionSettingsValue;
  onChange: (next: AiCorrectionSettingsValue) => void;
  disabled?: boolean;
  /** Prefisso per gli id degli aria-describedby (unico per istanza del dialog). */
  idPrefix?: string;
}) {
  const profileOption = MODEL_PROFILE_OPTIONS.find((o) => o.value === value.modelProfile)!;
  const profileDescId = `${idPrefix}-profile-desc`;
  const gradingDescId = `${idPrefix}-grading-desc`;
  const guidanceHelpId = `${idPrefix}-guidance-help`;

  return (
    <div className={styles.fields}>
      {/* Profilo modello. */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Profilo modello</span>
        <select
          aria-label="Profilo modello"
          aria-describedby={profileDescId}
          value={value.modelProfile}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, modelProfile: e.target.value as ModelProfile })}
        >
          {MODEL_PROFILE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p id={profileDescId} className={styles.description}>
        <span className={styles.modelId}>{profileOption.modelId}</span>
        <span>{modelProfileDescription(value.modelProfile)}</span>
      </p>

      {/* Stile di valutazione. */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Stile di valutazione</span>
        <select
          aria-label="Stile di valutazione"
          aria-describedby={gradingDescId}
          value={value.gradingMode}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, gradingMode: e.target.value as GradingMode })}
        >
          {GRADING_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <p id={gradingDescId} className={styles.description}>
        {gradingModeDescription(value.gradingMode)}
      </p>

      {/* Indicazioni aggiuntive. */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Indicazioni aggiuntive per la correzione</span>
        <textarea
          aria-label="Indicazioni aggiuntive per la correzione"
          aria-describedby={guidanceHelpId}
          rows={3}
          maxLength={MAX_TEACHER_GUIDANCE_CHARS}
          value={value.teacherGuidance}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, teacherGuidance: e.target.value })}
        />
      </label>
      <small id={guidanceHelpId} className={styles.counter}>
        {value.teacherGuidance.length}/{MAX_TEACHER_GUIDANCE_CHARS} caratteri
      </small>
    </div>
  );
}
