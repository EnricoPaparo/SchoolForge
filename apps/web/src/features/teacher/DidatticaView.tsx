import { useEffect, useMemo, useRef, useState } from 'react';
import { db, storage } from '../../lib/firebase.js';
import { loadCourseLibrary, type CourseCard } from '../repository/programs/courseLibrary.js';
import {
  createInitializedProgram,
  createProgram,
  deleteProgram,
  updateProgramTitle,
} from '../repository/programs/programsService.js';
import { importRepository } from '../repository/import/importRepository.js';
import { readZipFile } from '../repository/import/readZipFile.js';
import {
  backfillPublicLessonsContent,
  isPublicLessonsMigrationComplete,
  type BackfillSummary,
} from '../repository/programs/publicLessonsBackfillService.js';
import { describeImportValidationError } from './importValidationMessage.js';
import { CourseWorkspace } from './CourseWorkspace.js';
import { TitleDialog, NewCourseDialog, ImportDialog, ConfirmDialog } from './workspaceDialogs.js';
import { IconPlus, IconSearch, IconUpload } from '../../components/icons.js';
import styles from './DidatticaView.module.css';

const YEAR_ALL = '__all__';
const YEAR_NONE = '__none__';

type DidatticaViewProps = {
  ownerUid: string;
};

type Dialog =
  | { kind: 'none' }
  | { kind: 'new' }
  | { kind: 'import' }
  | { kind: 'rename'; programId: string; current: string }
  | { kind: 'delete'; programId: string; title: string };

export function DidatticaView({ ownerUid }: DidatticaViewProps) {
  const [cards, setCards] = useState<CourseCard[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Didattica ha due livelli (DUX-02): libreria (openProgramId === null) e
  // workspace del corso selezionato. La libreria resta montata sotto al
  // workspace, così filtri e ricerca sono conservati al ritorno.
  const [openProgramId, setOpenProgramId] = useState<string | null>(null);

  const [yearFilter, setYearFilter] = useState<string>(YEAR_ALL);
  const yearInitialized = useRef(false);
  const [classFilter, setClassFilter] = useState<string>(YEAR_ALL);
  const [search, setSearch] = useState('');

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  // Legacy publicLessons.content backfill (M3F-08), moved here from LessonsView
  // in DUX-04D. Owner-only, discreet: visibility is a single cheap read of the
  // settings marker on mount — never a per-document scan. Once the marker is
  // set the notice stays hidden for good (every write path keeps `content` in
  // sync from here on). The migration itself runs only on explicit confirmation.
  const [migrationComplete, setMigrationComplete] = useState<boolean | null>(null);
  const [backfillRunning, setBackfillRunning] = useState(false);
  const [backfillSummary, setBackfillSummary] = useState<BackfillSummary | null>(null);
  const [backfillError, setBackfillError] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerUid) return;
    let cancelled = false;
    isPublicLessonsMigrationComplete(db)
      .then((done) => {
        if (!cancelled) setMigrationComplete(done);
      })
      .catch(() => {
        if (!cancelled) setMigrationComplete(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ownerUid]);

  async function handleRunBackfill() {
    setBackfillRunning(true);
    setBackfillError(null);
    setBackfillSummary(null);
    try {
      const summary = await backfillPublicLessonsContent(ownerUid, db, storage);
      setBackfillSummary(summary);
      if (summary.failed.length === 0) setMigrationComplete(true);
    } catch {
      setBackfillError('Impossibile eseguire il backfill delle proiezioni.');
    } finally {
      setBackfillRunning(false);
    }
  }

  // ── Load ──────────────────────────────────────────────────────────────
  async function load() {
    setLoadError(null);
    try {
      const next = await loadCourseLibrary(ownerUid, db);
      setCards(next);
      // Default = anno scolastico più recente disponibile (item 5), fissato
      // solo al primo caricamento così una scelta successiva del docente non
      // viene sovrascritta a ogni refresh.
      if (!yearInitialized.current) {
        yearInitialized.current = true;
        const years = distinctYears(next);
        if (years.length > 0) setYearFilter(years[0]!);
      }
    } catch {
      setLoadError('Impossibile caricare i corsi.');
    }
  }

  useEffect(() => {
    if (!ownerUid) return;
    void load();
  }, [ownerUid]);

  useEffect(() => {
    if (!menuOpenId) return;
    function onDocClick() {
      setMenuOpenId(null);
    }
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [menuOpenId]);

  // ── Derived: filter options + filtered cards ────────────────────────────
  const years = useMemo(() => (cards ? distinctYears(cards) : []), [cards]);
  const classOptions = useMemo(() => {
    if (!cards) return [];
    const set = new Set<string>();
    for (const c of cards) for (const name of c.classNames) set.add(name);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [cards]);
  const hasNoYear = useMemo(() => (cards ? cards.some((c) => !c.annoScolastico) : false), [cards]);

  const filtered = useMemo(() => {
    if (!cards) return [];
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (yearFilter === YEAR_NONE && c.annoScolastico) return false;
      if (yearFilter !== YEAR_ALL && yearFilter !== YEAR_NONE && c.annoScolastico !== yearFilter)
        return false;
      if (classFilter !== YEAR_ALL && !c.classNames.includes(classFilter)) return false;
      if (q && !c.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cards, yearFilter, classFilter, search]);

  function resetFilters() {
    setYearFilter(YEAR_ALL);
    setClassFilter(YEAR_ALL);
    setSearch('');
  }

  // ── Mutations (riuso esclusivo dei service esistenti) ──────────────────
  async function handleCreate(title: string, annoScolastico: string) {
    setBusy(true);
    setDialogError(null);
    try {
      const created = await createInitializedProgram(title, annoScolastico, ownerUid, db);
      const card: CourseCard = {
        programId: created.programId,
        title: title.trim(),
        annoScolastico: created.annoScolastico,
        classIds: [],
        classNames: [],
        udaCount: 0,
        lessonsTotal: 0,
        lessonsDone: 0,
        questionsTotal: 0,
        hasImport: true,
        activeImportId: created.importId,
      };
      setCards((prev) => (prev ? [...prev, card] : [card]));
      setYearFilter(created.annoScolastico);
      setClassFilter(YEAR_ALL);
      setSearch('');
      setDialog({ kind: 'none' });
      setOpenProgramId(created.programId);
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Impossibile creare il corso.');
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(title: string, file: File) {
    setBusy(true);
    setDialogError(null);
    try {
      // "Importa un nuovo corso da ZIP" = crea il programma e poi importa il
      // contenuto al suo interno, componendo i service esistenti
      // (createProgram + importRepository) senza duplicarne la logica.
      const programId = await createProgram(title, ownerUid, db);
      const files = await readZipFile(file);
      const result = await importRepository(
        { ownerUid, programmaTitle: title, programId, files },
        { db, storage },
      );
      if (result.status === 'validation_failed') {
        setDialogError(describeImportValidationError(result.validationIssues));
        // Il programma è stato creato ma resta vuoto: aggiorno comunque la
        // libreria così compare e il docente può ritentare o eliminarlo.
        await load();
        return;
      }
      setDialog({ kind: 'none' });
      await load();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Errore durante l'importazione.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(programId: string, title: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await updateProgramTitle(programId, title, ownerUid, db);
      setDialog({ kind: 'none' });
      await load();
    } catch {
      setDialogError('Impossibile rinominare il corso.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(programId: string) {
    setBusy(true);
    setDialogError(null);
    try {
      await deleteProgram(programId, ownerUid, db);
      setDialog({ kind: 'none' });
      await load();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : 'Impossibile eliminare il corso.');
    } finally {
      setBusy(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  if (loadError) {
    return (
      <section aria-label="Didattica" className={styles.container}>
        <p role="alert" className="text-error">
          {loadError}
        </p>
      </section>
    );
  }

  if (cards === null) {
    return (
      <section aria-label="Didattica" className={styles.container}>
        <p aria-busy="true" className="state-loading">
          Caricamento…
        </p>
      </section>
    );
  }

  const openCard = openProgramId ? cards.find((c) => c.programId === openProgramId) : undefined;
  if (openCard) {
    return (
      <section aria-label="Didattica" className={styles.container}>
        <CourseWorkspace
          card={openCard}
          ownerUid={ownerUid}
          onBack={() => setOpenProgramId(null)}
          onProgramQuestionsChange={(programId, questionsTotal) =>
            setCards(
              (prev) =>
                prev?.map((c) => (c.programId === programId ? { ...c, questionsTotal } : c)) ??
                prev,
            )
          }
          onCardPatch={(programId, patch) =>
            setCards(
              (prev) =>
                prev?.map((c) => (c.programId === programId ? { ...c, ...patch } : c)) ?? prev,
            )
          }
          onCourseDeleted={(programId) => {
            setCards((prev) => prev?.filter((c) => c.programId !== programId) ?? prev);
            setOpenProgramId(null);
          }}
        />
      </section>
    );
  }

  return (
    <section aria-label="Didattica" className={styles.container}>
      {migrationComplete === false && (
        <div role="status" className={styles.migrationNotice}>
          <p>Proiezioni lezione legacy da sincronizzare (manutenzione una tantum).</p>
          <button type="button" disabled={backfillRunning} onClick={() => void handleRunBackfill()}>
            {backfillRunning ? 'Sincronizzazione in corso…' : 'Sincronizza proiezioni legacy'}
          </button>
          {backfillError && (
            <p role="alert" className="text-error">
              {backfillError}
            </p>
          )}
        </div>
      )}
      {backfillSummary && (
        <p role="status" className={styles.migrationSummary}>
          Analizzate: {backfillSummary.analyzed} · Migrate: {backfillSummary.migrated} · Già
          sincronizzate: {backfillSummary.skipped} · Fallite: {backfillSummary.failed.length}
        </p>
      )}
      <div className={styles.toolbar} aria-label="Filtri e azioni corsi">
        <div className={styles.filters}>
          <select
            aria-label="Filtro anno scolastico"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
          >
            <option value={YEAR_ALL}>Tutti gli anni</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
            {hasNoYear && <option value={YEAR_NONE}>Senza anno</option>}
          </select>
          <select
            aria-label="Filtro classe"
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
          >
            <option value={YEAR_ALL}>Tutte le classi</option>
            {classOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <label className={styles.searchWrap}>
            <span className={styles.searchIcon} aria-hidden="true">
              <IconSearch size={16} />
            </span>
            <span className={styles.visuallyHidden}>Cerca corso</span>
            <input
              className={styles.search}
              type="search"
              placeholder="Cerca…"
              aria-label="Cerca corso"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            onClick={() => {
              setDialogError(null);
              setDialog({ kind: 'import' });
            }}
          >
            <IconUpload size={16} />
            Importa ZIP
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              setDialogError(null);
              setDialog({ kind: 'new' });
            }}
          >
            <IconPlus size={16} />
            Nuovo corso
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className={styles.emptyState}>
          {cards.length === 0 ? (
            <>
              <p className={styles.emptyTitle}>Nessun corso</p>
              <p className={styles.emptyDesc}>
                Crea il tuo primo corso o importane uno da uno ZIP didattico.
              </p>
            </>
          ) : (
            <>
              <p className={styles.emptyTitle}>Nessun corso corrisponde ai filtri</p>
              <p className={styles.emptyDesc}>
                Prova a cambiare anno scolastico, classe o testo di ricerca.
              </p>
              <button type="button" onClick={resetFilters}>
                Azzera filtri
              </button>
            </>
          )}
        </div>
      ) : (
        <ul className={styles.grid}>
          {filtered.map((card) => (
            <CourseCardView
              key={card.programId}
              card={card}
              menuOpen={menuOpenId === card.programId}
              onToggleMenu={() =>
                setMenuOpenId((cur) => (cur === card.programId ? null : card.programId))
              }
              onOpen={() => setOpenProgramId(card.programId)}
              onRename={() => {
                setMenuOpenId(null);
                setDialogError(null);
                setDialog({ kind: 'rename', programId: card.programId, current: card.title });
              }}
              onDelete={() => {
                setMenuOpenId(null);
                setDialogError(null);
                setDialog({ kind: 'delete', programId: card.programId, title: card.title });
              }}
            />
          ))}
        </ul>
      )}

      {dialog.kind === 'new' && (
        <NewCourseDialog
          initialYear={defaultNewCourseYear(yearFilter, years)}
          busy={busy}
          error={dialogError}
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={(title, year) => void handleCreate(title, year)}
        />
      )}

      {dialog.kind === 'rename' && (
        <TitleDialog
          title="Rinomina corso"
          label="Titolo del corso"
          confirmLabel="Salva"
          initial={dialog.current}
          busy={busy}
          error={dialogError}
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={(t) => void handleRename(dialog.programId, t)}
        />
      )}

      {dialog.kind === 'import' && (
        <ImportDialog
          busy={busy}
          error={dialogError}
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={(t, f) => void handleImport(t, f)}
        />
      )}

      {dialog.kind === 'delete' && (
        <ConfirmDialog
          title="Elimina corso"
          message={`Eliminare definitivamente "${dialog.title}"? Verranno rimossi import, UDA, lezioni, pool e file caricati. L'operazione non è reversibile.`}
          confirmLabel="Elimina"
          danger
          busy={busy}
          error={dialogError}
          onCancel={() => setDialog({ kind: 'none' })}
          onConfirm={() => void handleDelete(dialog.programId)}
        />
      )}
    </section>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

type CourseCardViewProps = {
  card: CourseCard;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onOpen: () => void;
  onRename: () => void;
  onDelete: () => void;
};

function CourseCardView({
  card,
  menuOpen,
  onToggleMenu,
  onOpen,
  onRename,
  onDelete,
}: CourseCardViewProps) {
  const pct = card.lessonsTotal > 0 ? Math.round((card.lessonsDone / card.lessonsTotal) * 100) : 0;
  const yearLabel = card.annoScolastico ?? 'Senza anno';

  return (
    <li className={styles.cardWrap}>
      {/* Card non interattiva (article): l'apertura passa da un vero <button>
          e il menu ⋯ è un bottone fratello — nessun controllo annidato. */}
      <article className={styles.card}>
        <button
          type="button"
          className={styles.cardOpen}
          aria-label={`Apri il corso ${card.title}`}
          onClick={onOpen}
        />
        <div className={styles.cardHead}>
          <h3 className={styles.cardTitle} title={card.title}>
            {card.title}
          </h3>
          <div className={styles.menuWrap} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={styles.menuBtn}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              aria-label={`Azioni corso — ${card.title}`}
              onClick={onToggleMenu}
            >
              ⋯
            </button>
            {menuOpen && (
              <div className={styles.menu} role="menu">
                <button type="button" role="menuitem" onClick={onOpen}>
                  Apri corso
                </button>
                <button type="button" role="menuitem" onClick={onRename}>
                  Rinomina
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuDanger}
                  onClick={onDelete}
                >
                  Elimina corso
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={styles.cardMeta}>
          <span className={styles.pill}>{yearLabel}</span>
          {card.classNames.length > 0 ? (
            card.classNames.map((name) => (
              <span key={name} className={styles.pill}>
                {name}
              </span>
            ))
          ) : (
            <span className={styles.pill}>Nessuna classe</span>
          )}
        </div>

        <div className={styles.cardStats}>
          <div>
            <strong>{card.udaCount}</strong>UDA
          </div>
          <div>
            <strong>
              {card.lessonsDone}/{card.lessonsTotal}
            </strong>
            lezioni
          </div>
          <div>
            <strong>{card.questionsTotal}</strong>domande
          </div>
        </div>

        <div className={styles.progressTrack} role="img" aria-label={`Avanzamento lezioni ${pct}%`}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
      </article>
    </li>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────

function distinctYears(cards: CourseCard[]): string[] {
  const set = new Set<string>();
  for (const c of cards) if (c.annoScolastico) set.add(c.annoScolastico);
  return [...set].sort((a, b) => b.localeCompare(a)); // più recente prima
}

export function currentSchoolYear(now = new Date()): string {
  const calendarYear = now.getFullYear();
  const startYear = now.getMonth() >= 8 ? calendarYear : calendarYear - 1;
  return `${startYear}/${startYear + 1}`;
}

export function defaultNewCourseYear(yearFilter: string, years: string[]): string {
  if (yearFilter !== YEAR_ALL && yearFilter !== YEAR_NONE) return yearFilter;
  return years[0] ?? currentSchoolYear();
}
