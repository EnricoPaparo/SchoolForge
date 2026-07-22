import { useEffect, useRef, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import { DialogShell } from './workspaceDialogs.js';
import {
  AiCorrectionSettingsFields,
  type AiCorrectionSettingsValue,
} from './AiCorrectionSettingsFields.js';
import {
  saveTeacherAiPreferences,
  type TeacherAiPreferences,
} from '../repository/corrections/teacherAiPreferencesService.js';

/**
 * TWU-02 — dialog «Impostazioni correzione IA»: salva i valori predefiniti del
 * docente (profilo modello, stile di valutazione, indicazioni) in
 * `teacherAiPreferences/{ownerUid}`. Riusa il form condiviso
 * `AiCorrectionSettingsFields` (stessi campi del dialog «Correggi con IA»).
 * Una sola write al «Salva»; nessun listener, nessun polling. Feedback
 * persistente durante save/success/error via aria-live; guardia anti doppio
 * click; nessun update dopo unmount.
 */
export function AiCorrectionSettingsDialog({
  ownerUid,
  db,
  initial,
  onClose,
  onSaved,
}: {
  ownerUid: string;
  db: Firestore;
  initial: TeacherAiPreferences;
  onClose: () => void;
  onSaved: (prefs: TeacherAiPreferences) => void;
}) {
  const [value, setValue] = useState<AiCorrectionSettingsValue>({
    modelProfile: initial.modelProfile,
    gradingMode: initial.gradingMode,
    teacherGuidance: initial.teacherGuidance,
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  function change(next: AiCorrectionSettingsValue) {
    setValue(next);
    // A new edit clears the previous success/error feedback.
    if (status !== 'idle') setStatus('idle');
    setErrorMsg(null);
  }

  async function save() {
    if (savingRef.current) return; // synchronous double-click guard
    savingRef.current = true;
    setSaving(true);
    setStatus('idle');
    setErrorMsg(null);
    const prefs: TeacherAiPreferences = {
      modelProfile: value.modelProfile,
      gradingMode: value.gradingMode,
      teacherGuidance: value.teacherGuidance.trim(),
    };
    try {
      await saveTeacherAiPreferences(ownerUid, prefs, db);
      if (!mountedRef.current) return;
      setStatus('saved');
      onSaved(prefs);
    } catch {
      if (!mountedRef.current) return;
      setStatus('error');
      setErrorMsg('Impossibile salvare le impostazioni. Riprova.');
    } finally {
      if (mountedRef.current) setSaving(false);
      savingRef.current = false;
    }
  }

  return (
    <DialogShell title="Impostazioni correzione IA" onCancel={onClose} busy={saving}>
      <p style={{ marginTop: 0, color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
        Questi valori predefiniti precompilano il dialog «Correggi con IA». Potrai comunque
        modificarli per la singola operazione senza cambiare queste preferenze.
      </p>

      <AiCorrectionSettingsFields
        value={value}
        onChange={change}
        disabled={saving}
        idPrefix="ai-prefs"
      />

      {/* Feedback persistente accessibile durante save/success/error. */}
      <p role="status" aria-live="polite" style={{ minHeight: '1.25rem', margin: '0.5rem 0 0' }}>
        {saving ? 'Salvataggio…' : status === 'saved' ? 'Impostazioni salvate.' : ''}
      </p>
      {status === 'error' && errorMsg && (
        <p role="alert" className="text-error" style={{ margin: '0.25rem 0 0' }}>
          {errorMsg}
        </p>
      )}

      <div className="dialog-actions">
        <button type="button" onClick={onClose} disabled={saving}>
          Annulla
        </button>
        <button type="button" className="btn-primary" onClick={() => void save()} disabled={saving}>
          Salva
        </button>
      </div>
    </DialogShell>
  );
}
