import { Fragment, type FormEvent, useEffect, useState } from 'react';
import {
  activateVerification,
  closeVerification,
  createVerification,
  deleteClosedVerification,
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

  // ── Detail state (draft configuration only) ─────────────────────
  const [selectedVer, setSelectedVer] = useState<VerificationItem | null>(null);
  const [questionIndex, setQuestionIndex] = useState<QuestionIndexEntry[] | null>(null);
  const [questionIndexError, setQuestionIndexError] = useState<string | null>(null);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<Set<string>>(new Set());

  // ── Draft edit state ────────────────────────────────────────────
  const [editDraftTitle, setEditDraftTitle] = useState('');
  const [editDraftClassId, setEditDraftClassId] = useState('');
  const [savingDraft, setSavingDraft] = useState(false);

  // ── Activation state (draft detail flow) ────────────────────────
  const [showActivateConfirm, setShowActivateConfirm] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  // ── Row actions: PDF / close / delete ────────────────────────────
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);
  const [pdfErrors, setPdfErrors] = useState<Record<string, string | null>>({});

  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    setActivateError(null);
    setQuestionIndex(null);
    setQuestionIndexError(null);
    setSelectedQuestionIds(new Set(v.config.questionRefs.map((r) => r.questionIndexEntryId)));
    setEditDraftTitle(v.config.title);
    setEditDraftClassId(v.config.classId ?? '');

    if (v.status === 'draft' && v.config.programId && v.config.importId) {
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

  async function handleDownloadPdf(v: VerificationItem) {
    if (v.status !== 'active') return;
    setPdfLoadingId(v.id);
    setPdfErrors((prev) => ({ ...prev, [v.id]: null }));
    try {
      const snapshot = v.teacherSnapshot;
      if (!snapshot) {
        setPdfErrors((prev) => ({
          ...prev,
          [v.id]: 'Snapshot della verifica non disponibile. Riattiva o ricrea la verifica.',
        }));
        return;
      }
      const result = await loadSelectedQuestions(snapshot.questionRefs, storage);
      if (!result.ok) {
        setPdfErrors((prev) => ({ ...prev, [v.id]: result.error }));
        return;
      }
      const classNameResolved =
        classes.find((c) => c.id === snapshot.classId)?.name ?? snapshot.className ?? null;
      await downloadStudentPdf(snapshot, result.questions, classNameResolved);
    } finally {
      setPdfLoadingId(null);
    }
  }

  function handleStartClose(id: string) {
    setCloseConfirmId(id);
    setCloseError(null);
    setDeleteConfirmId(null);
  }

  async function handleConfirmClose(id: string) {
    setClosing(true);
    setCloseError(null);
    try {
      await closeVerification(id, ownerUid, db);
      setCloseConfirmId(null);
      const updated = await listVerifications(ownerUid, db);
      setVerifications(updated);
      if (selectedVer?.id === id) {
        const refreshed = updated.find((v) => v.id === id);
        if (refreshed) setSelectedVer(refreshed);
      }
    } catch (err) {
      setCloseError(err instanceof Error ? err.message : 'Errore durante la chiusura.');
    } finally {
      setClosing(false);
    }
  }

  function handleStartDelete(id: string) {
    setDeleteConfirmId(id);
    setDeleteError(null);
    setCloseConfirmId(null);
  }

  async function handleConfirmDelete(id: string) {
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteClosedVerification(id, ownerUid, db);
      setVerifications((prev) => prev?.filter((v) => v.id !== id) ?? null);
      setDeleteConfirmId(null);
      if (selectedVer?.id === id) setSelectedVer(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Errore durante l'eliminazione.");
    } finally {
      setDeleting(false);
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
      {/* ── Verification table ── */}
      {verifications.length === 0 ? (
        <p className="state-empty">Nessuna verifica. Creane una.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Titolo</th>
                <th className={styles.th}>Classe</th>
                <th className={styles.th}>Corso</th>
                <th className={styles.th}>Stato</th>
                <th className={styles.th}>Domande</th>
                <th className={styles.th} aria-label="Azioni"></th>
              </tr>
            </thead>
            <tbody>
              {verifications.map((v) => {
                const programTitle =
                  programs.find((p) => p.id === v.config.programId)?.title ?? v.config.programId;
                const className = v.config.classId
                  ? (classes.find((c) => c.id === v.config.classId)?.name ?? v.config.classId)
                  : '—';
                const questionCount =
                  v.status === 'draft'
                    ? v.config.questionRefs.length
                    : (v.teacherSnapshot?.questionRefs.length ?? v.config.questionRefs.length);

                if (closeConfirmId === v.id) {
                  return (
                    <tr key={v.id} className={styles.confirmRowInline}>
                      <td colSpan={6} className={styles.td}>
                        <div
                          role="region"
                          aria-label="Conferma chiusura"
                          className={styles.confirmBox}
                        >
                          <p className={styles.confirmMsg}>
                            Chiudere <strong>{v.config.title}</strong>? Questa operazione non è
                            reversibile.
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
                              onClick={() => void handleConfirmClose(v.id)}
                            >
                              {closing ? 'Chiusura…' : 'Conferma chiusura'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setCloseConfirmId(null)}
                              disabled={closing}
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                if (deleteConfirmId === v.id) {
                  return (
                    <tr key={v.id} className={styles.confirmRowInline}>
                      <td colSpan={6} className={styles.td}>
                        <div
                          role="region"
                          aria-label="Conferma eliminazione"
                          className={`${styles.confirmBox} ${styles.confirmBoxDanger}`}
                        >
                          <p className={styles.confirmMsg}>
                            Eliminare definitivamente <strong>{v.config.title}</strong>?
                            L&apos;operazione è irreversibile e non può essere annullata.
                          </p>
                          {deleteError && (
                            <p role="alert" className="text-error">
                              {deleteError}
                            </p>
                          )}
                          <div className={styles.confirmRow}>
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => void handleConfirmDelete(v.id)}
                            >
                              {deleting ? 'Eliminazione…' : 'Elimina definitivamente'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteConfirmId(null)}
                              disabled={deleting}
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }

                return (
                  <Fragment key={v.id}>
                    <tr className={styles.row}>
                      <td className={styles.td}>
                        <button
                          type="button"
                          className={styles.verTitleBtn}
                          aria-pressed={selectedVer?.id === v.id}
                          aria-label={`Apri dettaglio verifica ${v.config.title}`}
                          onClick={() => void handleSelectVer(v)}
                        >
                          {v.config.title}
                        </button>
                      </td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{className}</td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{programTitle}</td>
                      <td className={styles.td}>
                        <StatusBadge status={v.status} />
                      </td>
                      <td className={`${styles.td} ${styles.metaCell}`}>{questionCount}</td>
                      <td className={styles.tdActions}>
                        {v.status === 'active' && (
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="Scarica PDF"
                            aria-label={`Scarica PDF — ${v.config.title}`}
                            disabled={pdfLoadingId === v.id}
                            onClick={() => void handleDownloadPdf(v)}
                          >
                            {pdfLoadingId === v.id ? '…' : '⬇️'}
                          </button>
                        )}
                        {v.status === 'active' && (
                          <button
                            type="button"
                            className={styles.iconBtn}
                            title="Chiudi verifica"
                            aria-label={`Chiudi verifica — ${v.config.title}`}
                            onClick={() => handleStartClose(v.id)}
                          >
                            🔒
                          </button>
                        )}
                        {v.status === 'closed' && (
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            title="Elimina verifica"
                            aria-label={`Elimina verifica — ${v.config.title}`}
                            onClick={() => handleStartDelete(v.id)}
                          >
                            🗑️
                          </button>
                        )}
                      </td>
                    </tr>
                    {pdfErrors[v.id] && (
                      <tr>
                        <td colSpan={6} className={styles.td}>
                          <p role="alert" className="text-error">
                            {pdfErrors[v.id]}
                          </p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

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

      {/* ── Detail panel — draft configuration only; active/closed show a compact summary ── */}
      {selectedVer && (
        <div className={styles.detail} aria-label="Dettaglio verifica">
          <div className={styles.detailHeader}>
            <h2 className={styles.detailTitle}>{selectedVer.config.title}</h2>
            <StatusBadge status={selectedVer.status} />
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

          {/* ── Active / closed: compact read-only summary — actions live in the table row ── */}
          {selectedVer.status !== 'draft' && (
            <p className={styles.detailMeta}>
              Programma: {programTitle(selectedVer, programs)}
              {selectedVer.config.classId &&
                ` · Classe: ${classes.find((c) => c.id === selectedVer.config.classId)?.name ?? selectedVer.config.classId}`}
              {' · Domande configurate: '}
              {(selectedVer.teacherSnapshot?.questionRefs.length ??
                selectedVer.config.questionRefs.length) ||
                0}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function programTitle(v: VerificationItem, programs: ProgramItem[]): string {
  return programs.find((p) => p.id === v.config.programId)?.title ?? v.config.programId;
}
