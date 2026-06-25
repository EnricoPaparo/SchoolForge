import { type FormEvent, useEffect, useState } from 'react';
import {
  activateVerification,
  closeVerification,
  createVerification,
  listVerifications,
  updateVerificationConfig,
  type VerificationItem,
} from '../repository/verifications/verificationsService.js';
import {
  listQuestionIndex,
  type QuestionIndexEntry,
} from '../repository/verifications/questionIndexService.js';
import { listClasses, type ClassItem } from '../repository/classes/classesService.js';
import { listPrograms, type ProgramItem } from '../repository/programs/programsService.js';
import { loadSelectedQuestions } from '../repository/verifications/loadSelectedQuestions.js';
import { downloadStudentPdf } from '../repository/verifications/verificationPdf.js';
import { db, storage } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import styles from './VerificationsView.module.css';

function StatusBadge({ status }: { status: 'draft' | 'active' | 'closed' }) {
  const labels = { draft: 'bozza', active: 'attiva', closed: 'chiusa' };
  const cls = {
    draft: styles.badgeDraft,
    active: styles.badgeActive,
    closed: styles.badgeClosed,
  };
  return <span className={`${styles.badge} ${cls[status]}`}>{labels[status]}</span>;
}

export function VerificationsView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  // ── List state ──────────────────────────────────────────────────
  const [verifications, setVerifications] = useState<VerificationItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [programs, setPrograms] = useState<ProgramItem[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);

  // ── Create form state ───────────────────────────────────────────
  const [newTitle, setNewTitle] = useState('');
  const [newProgramId, setNewProgramId] = useState('');
  const [newClassId, setNewClassId] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // ── Detail state ────────────────────────────────────────────────
  const [selectedVer, setSelectedVer] = useState<VerificationItem | null>(null);
  const [questionIndex, setQuestionIndex] = useState<QuestionIndexEntry[] | null>(null);
  const [questionIndexError, setQuestionIndexError] = useState<string | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());

  // ── Draft edit state ────────────────────────────────────────────
  const [editDraftTitle, setEditDraftTitle] = useState('');
  const [editDraftClassId, setEditDraftClassId] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  // ── Activation / close state ────────────────────────────────────
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // ── PDF state ───────────────────────────────────────────────────
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);

  useEffect(() => {
    void loadAll();
  }, []);

  async function loadAll() {
    setLoadError(null);
    try {
      const [verList, progList, classList] = await Promise.all([
        listVerifications(ownerUid, db),
        listPrograms(db),
        listClasses(ownerUid, db),
      ]);
      setVerifications(verList);
      setPrograms(progList);
      setClasses(classList);
    } catch {
      setLoadError('Impossibile caricare i dati.');
    }
  }

  async function handleSelectVer(v: VerificationItem) {
    setSelectedVer(v);
    setShowActivateConfirm(false);
    setShowCloseConfirm(false);
    setActivateError(null);
    setCloseError(null);
    setQuestionIndex(null);
    setQuestionIndexError(null);
    setSelectedQuestionIds(new Set(v.config.questionRefs.map((r) => r.questionIndexEntryId)));
    setEditDraftTitle(v.config.title);
    setEditDraftClassId(v.config.classId ?? '');

    if (v.config.programId && v.config.importId) {
      try {
        const entries = await listQuestionIndex(v.config.programId, v.config.importId, db);
        setQuestionIndex(entries);
      } catch {
        setQuestionIndexError('Impossibile caricare il pool di domande.');
      }
    }
  }

  async function handleSaveDraftMeta(e: FormEvent) {
    e.preventDefault();
    if (!selectedVer || selectedVer.status !== 'draft') return;
    const title = editDraftTitle.trim();
    if (!title) return;
    setSavingDraft(true);
    try {
      const classId = editDraftClassId || null;
      await updateVerificationConfig(selectedVer.id, { title, classId }, ownerUid, db);
      const updated = { ...selectedVer, config: { ...selectedVer.config, title, classId } };
      setSelectedVer(updated);
      setVerifications((prev) => prev?.map((v) => (v.id === updated.id ? updated : v)) ?? null);
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title || !newProgramId) return;
    setCreating(true);
    setCreateError(null);
    try {
      const program = programs.find((p) => p.id === newProgramId);
      const importId = program?.activeImportId ?? '';
      const newId = await createVerification(
        { title, classId: newClassId || null, programId: newProgramId, importId },
        ownerUid,
        db,
      );
      setNewTitle('');
      setNewProgramId('');
      setNewClassId('');
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      const created = updated.find((v) => v.id === newId);
      if (created) {
        await handleSelectVer(created);
      }
    } catch {
      setCreateError('Impossibile creare la verifica.');
    } finally {
      setCreating(false);
    }
  }

  function handleToggleQuestion(entryId: string) {
    setSelectedQuestionIds((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  }

  async function handleSaveQuestionRefs() {
    if (!selectedVer || !questionIndex) return;
    const entryMap = new Map(questionIndex.map((e) => [e.id, e]));
    const questionRefs = Array.from(selectedQuestionIds)
      .map((id) => {
        const entry = entryMap.get(id);
        if (!entry) return null;
        return {
          questionIndexEntryId: entry.id,
          questionLocalId: entry.questionLocalId,
          udaDir: entry.udaDir,
          lessonFilename: entry.lessonFilename,
          poolStorageRef: entry.poolStorageRef,
          tipo: entry.tipo,
          difficolta: entry.difficolta,
          peso: entry.peso,
          maxPoints: entry.maxPoints,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    await updateVerificationConfig(selectedVer.id, { questionRefs }, ownerUid, db);
    setSelectedVer((prev) => (prev ? { ...prev, config: { ...prev.config, questionRefs } } : prev));
    setVerifications(
      (prev) =>
        prev?.map((v) =>
          v.id === selectedVer.id ? { ...v, config: { ...v.config, questionRefs } } : v,
        ) ?? null,
    );
  }

  async function handleConfirmActivate() {
    if (!selectedVer) return;
    setActivating(true);
    setActivateError(null);
    try {
      await handleSaveQuestionRefs();
      const classItem = classes.find((c) => c.id === selectedVer.config.classId) ?? null;
      await activateVerification(selectedVer.id, classItem, ownerUid, db);
      setShowActivateConfirm(false);
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      const refreshed = updated.find((v) => v.id === selectedVer.id);
      if (refreshed) setSelectedVer(refreshed);
    } catch (err) {
      setActivateError(err instanceof Error ? err.message : "Errore durante l'attivazione.");
    } finally {
      setActivating(false);
    }
  }

  async function handleDownloadPdf() {
    if (!selectedVer || selectedVer.status !== 'active') return;
    setPdfLoading(true);
    setPdfError(null);
    try {
      const snapshot = selectedVer.teacherSnapshot;
      if (!snapshot) return;
      const refs = snapshot.questionRefs;
      const result = await loadSelectedQuestions(refs, storage);
      if (!result.ok) {
        setPdfError(result.error);
        return;
      }
      const classNameResolved =
        classes.find((c) => c.id === snapshot.classId)?.name ?? snapshot.className ?? null;
      await downloadStudentPdf(snapshot, result.questions, classNameResolved);
    } finally {
      setPdfLoading(false);
    }
  }

  async function handleConfirmClose() {
    if (!selectedVer) return;
    setClosing(true);
    setCloseError(null);
    try {
      await closeVerification(selectedVer.id, ownerUid, db);
      setShowCloseConfirm(false);
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      const refreshed = updated.find((v) => v.id === selectedVer.id);
      if (refreshed) setSelectedVer(refreshed);
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Errore durante la chiusura.');
    } finally {
      setClosing(false);
    }
  }

  if (loadError)
    return (
      <p role="alert" className="text-error">
        {loadError}
      </p>
    );
  if (verifications === null)
    return (
      <p aria-busy="true" className="state-loading">
        Caricamento…
      </p>
    );

  const canActivate = selectedQuestionIds.size >= 1;

  return (
    <section aria-label="Verifiche" className={styles.container}>
      {/* ── Verification list ── */}
      <div>
        {verifications.length === 0 ? (
          <p className="state-empty">Nessuna verifica. Creane una.</p>
        ) : (
          <ul className={styles.verList}>
            {verifications.map((v) => (
              <li
                key={v.id}
                className={styles.verRow}
                onClick={() => void handleSelectVer(v)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && void handleSelectVer(v)}
                aria-pressed={selectedVer?.id === v.id}
              >
                <span className={styles.verTitle}>{v.config.title}</span>
                <StatusBadge status={v.status} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── Create form ── */}
      <form
        aria-label="Nuova verifica"
        className={styles.createForm}
        onSubmit={(e) => void handleCreate(e)}
      >
        <span className={styles.createTitle}>Crea nuova verifica</span>

        <div className={styles.formRow}>
          <label htmlFor="new-ver-title">Titolo</label>
          <input
            id="new-ver-title"
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
        </div>

        <div className={styles.formRow}>
          <label htmlFor="new-ver-program">Programma</label>
          <select
            id="new-ver-program"
            value={newProgramId}
            onChange={(e) => setNewProgramId(e.target.value)}
          >
            <option value="">— Seleziona programma —</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.formRow}>
          <label htmlFor="new-ver-class">Classe (opzionale)</label>
          <select
            id="new-ver-class"
            value={newClassId}
            onChange={(e) => setNewClassId(e.target.value)}
          >
            <option value="">— Nessuna classe —</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        {createError && (
          <p role="alert" className="text-error">
            {createError}
          </p>
        )}

        <button type="submit" disabled={creating || !newTitle.trim() || !newProgramId}>
          {creating ? 'Creazione…' : 'Crea verifica'}
        </button>
      </form>

      {/* ── Detail panel ── */}
      {selectedVer && (
        <div className={styles.detail} aria-label="Dettaglio verifica">
          <div className={styles.detailHeader}>
            <h2 className={styles.detailTitle}>{selectedVer.config.title}</h2>
            <StatusBadge status={selectedVer.status} />
          </div>

          <div>
            <p className={styles.detailMeta}>
              Programma:{' '}
              {programs.find((p) => p.id === selectedVer.config.programId)?.title ??
                selectedVer.config.programId}
            </p>
            {selectedVer.config.classId && (
              <p className={styles.detailMeta}>
                Classe:{' '}
                {classes.find((c) => c.id === selectedVer.config.classId)?.name ??
                  selectedVer.config.classId}
              </p>
            )}
          </div>

          {/* ── Draft: edit title/class ── */}
          {selectedVer.status === 'draft' && (
            <form onSubmit={(e) => void handleSaveDraftMeta(e)} className={styles.draftEditForm}>
              <label htmlFor="draft-title">Titolo bozza</label>
              <input
                id="draft-title"
                type="text"
                value={editDraftTitle}
                onChange={(e) => setEditDraftTitle(e.target.value)}
              />
              <label htmlFor="draft-class">Classe</label>
              <select
                id="draft-class"
                value={editDraftClassId}
                onChange={(e) => setEditDraftClassId(e.target.value)}
              >
                <option value="">— Nessuna classe —</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="submit" disabled={savingDraft || !editDraftTitle.trim()}>
                {savingDraft ? 'Salvataggio…' : 'Salva bozza'}
              </button>
            </form>
          )}

          {/* ── Draft: question selection + activate ── */}
          {selectedVer.status === 'draft' && (
            <>
              <div>
                <h3 className={styles.createTitle}>Selezione domande</h3>
                {questionIndexError && (
                  <p role="alert" className="text-error">
                    {questionIndexError}
                  </p>
                )}
                {questionIndex === null && !questionIndexError && (
                  <p aria-busy="true" className="state-loading">
                    Caricamento domande…
                  </p>
                )}
                {questionIndex !== null && questionIndex.length === 0 && (
                  <p className="state-empty">Nessuna domanda disponibile per questo programma.</p>
                )}
                {questionIndex !== null && questionIndex.length > 0 && (
                  <>
                    <ul className={styles.questionList}>
                      {questionIndex.map((entry) => (
                        <li key={entry.id} className={styles.questionRow}>
                          <input
                            type="checkbox"
                            id={`q-${entry.id}`}
                            checked={selectedQuestionIds.has(entry.id)}
                            onChange={() => handleToggleQuestion(entry.id)}
                            aria-label={`Seleziona domanda ${entry.questionLocalId}`}
                          />
                          <label htmlFor={`q-${entry.id}`}>
                            <span>
                              {entry.udaDir} / {entry.lessonFilename}
                            </span>
                          </label>
                          <span className={styles.questionMeta}>
                            tipo: {entry.tipo} | diff: {entry.difficolta} | peso: {entry.peso} |
                            max: {entry.maxPoints}pt
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className={styles.selectedCount}>
                      {selectedQuestionIds.size} domanda/e selezionata/e
                    </p>
                  </>
                )}
              </div>

              {/* Activate */}
              {!showActivateConfirm ? (
                <div className={styles.actionBar}>
                  <button
                    type="button"
                    disabled={!canActivate}
                    onClick={() => setShowActivateConfirm(true)}
                    aria-label="Attiva verifica"
                  >
                    Attiva verifica
                  </button>
                </div>
              ) : (
                <div
                  className={styles.confirmPanel}
                  role="region"
                  aria-label="Conferma attivazione"
                >
                  <p className={styles.confirmMsg}>
                    Dopo l&apos;attivazione la configurazione non sarà più modificabile. Continuare?
                  </p>
                  {activateError && (
                    <p role="alert" className="text-error">
                      {activateError}
                    </p>
                  )}
                  <div className={styles.confirmRow}>
                    <button
                      type="button"
                      disabled={activating}
                      onClick={() => void handleConfirmActivate()}
                    >
                      {activating ? 'Attivazione…' : 'Conferma attivazione'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowActivateConfirm(false)}
                      disabled={activating}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Active: read-only + close ── */}
          {selectedVer.status === 'active' && (
            <>
              <p className={styles.detailMeta}>
                Domande configurate: {selectedVer.config.questionRefs.length}
              </p>
              <div className={styles.actionBar}>
                <button
                  type="button"
                  disabled={pdfLoading}
                  onClick={() => void handleDownloadPdf()}
                  aria-label="Scarica PDF"
                >
                  {pdfLoading ? 'Generazione PDF…' : 'Scarica PDF'}
                </button>
              </div>
              {pdfError && (
                <p role="alert" className="text-error">
                  {pdfError}
                </p>
              )}
              {!showCloseConfirm ? (
                <div className={styles.actionBar}>
                  <button
                    type="button"
                    onClick={() => setShowCloseConfirm(true)}
                    aria-label="Chiudi verifica"
                  >
                    Chiudi verifica
                  </button>
                </div>
              ) : (
                <div className={styles.confirmPanel} role="region" aria-label="Conferma chiusura">
                  <p className={styles.confirmMsg}>
                    Chiudere la verifica? Questa operazione non è reversibile.
                  </p>
                  {closeError && (
                    <p role="alert" className="text-error">
                      {closeError}
                    </p>
                  )}
                  <div className={styles.confirmRow}>
                    <button
                      type="button"
                      disabled={closing}
                      onClick={() => void handleConfirmClose()}
                    >
                      {closing ? 'Chiusura…' : 'Conferma chiusura'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCloseConfirm(false)}
                      disabled={closing}
                    >
                      Annulla
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── Closed: read-only, no actions ── */}
          {selectedVer.status === 'closed' && (
            <p className={styles.detailMeta}>
              Verifica chiusa. Domande configurate: {selectedVer.config.questionRefs.length}.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
