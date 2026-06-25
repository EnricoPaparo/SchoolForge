import { type FormEvent, useEffect, useState } from 'react';
import {
  createProgram,
  listLessons,
  listPrograms,
  listUdas,
  setLessonCompleted,
  updateProgramTitle,
  type LessonItem,
  type ProgramItem,
  type UdaItem,
} from '../repository/programs/programsService.js';
import { db, storage } from '../../lib/firebase.js';
import { useAuth } from '../../lib/auth.js';
import { MarkdownRenderer } from './MarkdownRenderer.js';
import { fetchLessonContent } from './lessonContent.js';
import { exportZip } from './exportZip.js';
import { downloadMarkdown, downloadPdf, generateMarkdown } from './programmaSvolto.js';

export function ProgramsView() {
  const { user } = useAuth();
  const ownerUid = user?.uid ?? '';

  const [programs, setPrograms] = useState<ProgramItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedProgram, setSelectedProgram] = useState<ProgramItem | null>(null);
  const [udas, setUdas] = useState<UdaItem[] | null>(null);

  const [selectedUdaDir, setSelectedUdaDir] = useState<string | null>(null);
  const [lessons, setLessons] = useState<LessonItem[] | null>(null);

  const [selectedLesson, setSelectedLesson] = useState<LessonItem | null>(null);
  const [lessonContent, setLessonContent] = useState<string | null>(null);
  const [lessonContentError, setLessonContentError] = useState<string | null>(null);
  const [lessonContentLoading, setLessonContentLoading] = useState(false);

  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);

  const [editTitle, setEditTitle] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [exportingZip, setExportingZip] = useState(false);
  const [exportZipError, setExportZipError] = useState<string | null>(null);

  const [pdfDownloading, setPdfDownloading] = useState(false);

  useEffect(() => {
    void loadPrograms();
  }, []);

  async function loadPrograms() {
    setLoadError(null);
    try {
      const list = await listPrograms(db);
      setPrograms(list);
    } catch {
      setLoadError('Impossibile caricare i programmi.');
    }
  }

  async function handleSelectProgram(p: ProgramItem) {
    setSelectedProgram(p);
    setSelectedUdaDir(null);
    setLessons(null);
    setUdas(null);
    setEditTitle(null);
    setSelectedLesson(null);
    setLessonContent(null);
    setLessonContentError(null);
    setExportZipError(null);
    if (!p.activeImportId) return;
    try {
      const list = await listUdas(p.id, p.activeImportId, db);
      setUdas(list);
    } catch {
      setUdas([]);
    }
  }

  async function handleSelectUda(udaDir: string) {
    if (!selectedProgram?.activeImportId) return;
    setSelectedUdaDir(udaDir);
    setLessons(null);
    setSelectedLesson(null);
    setLessonContent(null);
    setLessonContentError(null);
    try {
      const all = await listLessons(selectedProgram.id, selectedProgram.activeImportId, db);
      setLessons(all.filter((l) => l.udaDir === udaDir));
    } catch {
      setLessons([]);
    }
  }

  async function handleSelectLesson(lesson: LessonItem) {
    setSelectedLesson(lesson);
    setLessonContent(null);
    setLessonContentError(null);
    setLessonContentLoading(true);
    try {
      const content = await fetchLessonContent(lesson.storageRef, storage);
      setLessonContent(content);
    } catch {
      setLessonContentError('Impossibile caricare il contenuto della lezione.');
    } finally {
      setLessonContentLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    const t = newTitle.trim();
    if (!t) return;
    setCreating(true);
    try {
      await createProgram(t, ownerUid, db);
      setNewTitle('');
      await loadPrograms();
    } finally {
      setCreating(false);
    }
  }

  async function handleSaveTitle(e: FormEvent) {
    e.preventDefault();
    if (!selectedProgram || editTitle === null) return;
    const t = editTitle.trim();
    if (!t) return;
    setSaving(true);
    try {
      await updateProgramTitle(selectedProgram.id, t, ownerUid, db);
      const updated = { ...selectedProgram, title: t };
      setSelectedProgram(updated);
      setPrograms((prev) => prev?.map((p) => (p.id === updated.id ? updated : p)) ?? null);
      setEditTitle(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleLesson(lesson: LessonItem) {
    if (!selectedProgram?.activeImportId) return;
    const completed = !(lesson.completed ?? false);
    await setLessonCompleted(
      selectedProgram.id,
      selectedProgram.activeImportId,
      lesson.id,
      completed,
      ownerUid,
      db,
    );
    setLessons((prev) => prev?.map((l) => (l.id === lesson.id ? { ...l, completed } : l)) ?? null);
  }

  async function handleExportZip() {
    if (!selectedProgram) return;
    setExportingZip(true);
    setExportZipError(null);
    try {
      await exportZip(selectedProgram, storage, db);
    } catch {
      setExportZipError('Impossibile esportare il ZIP.');
    } finally {
      setExportingZip(false);
    }
  }

  async function handleDownloadProgrammaSvoltoMd() {
    if (!selectedProgram || !udas || !lessons) return;
    const allLessons = await listLessons(
      selectedProgram.id,
      selectedProgram.activeImportId ?? '',
      db,
    );
    const content = generateMarkdown(selectedProgram, udas, allLessons);
    downloadMarkdown(content, `programma-svolto-${selectedProgram.title.replace(/\s+/g, '_')}.md`);
  }

  async function handleDownloadProgrammaSvoltoPdf() {
    if (!selectedProgram || !udas) return;
    setPdfDownloading(true);
    try {
      const allLessons = await listLessons(
        selectedProgram.id,
        selectedProgram.activeImportId ?? '',
        db,
      );
      const content = generateMarkdown(selectedProgram, udas, allLessons);
      await downloadPdf(content, `programma-svolto-${selectedProgram.title.replace(/\s+/g, '_')}`);
    } finally {
      setPdfDownloading(false);
    }
  }

  if (loadError) return <p role="alert">{loadError}</p>;
  if (programs === null) return <p aria-busy="true">Caricamento…</p>;

  return (
    <section aria-label="Programmi">
      <div>
        <h2>Programmi</h2>
        {programs.length === 0 && <p>Nessun programma. Creane uno.</p>}
        {programs.length > 0 && (
          <ul>
            {programs.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={selectedProgram?.id === p.id}
                  onClick={() => void handleSelectProgram(p)}
                >
                  {p.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={(e) => void handleCreate(e)}>
          <label>
            Titolo nuovo programma
            <input type="text" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
          </label>
          <button type="submit" disabled={creating || !newTitle.trim()}>
            {creating ? 'Creazione…' : 'Crea programma'}
          </button>
        </form>
      </div>

      {selectedProgram && (
        <div>
          {editTitle !== null ? (
            <form onSubmit={(e) => void handleSaveTitle(e)}>
              <label>
                Modifica titolo
                <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
              </label>
              <button type="submit" disabled={saving || !editTitle.trim()}>
                Salva
              </button>
              <button type="button" onClick={() => setEditTitle(null)}>
                Annulla
              </button>
            </form>
          ) : (
            <h2>
              {selectedProgram.title}
              <button type="button" onClick={() => setEditTitle(selectedProgram.title)}>
                Modifica titolo
              </button>
            </h2>
          )}

          {selectedProgram.activeImportId && (
            <div>
              <button type="button" onClick={() => void handleExportZip()} disabled={exportingZip}>
                {exportingZip ? 'Esportazione…' : 'Esporta ZIP'}
              </button>
              {exportZipError && <p role="alert">{exportZipError}</p>}

              <button
                type="button"
                onClick={() => void handleDownloadProgrammaSvoltoMd()}
                disabled={!udas}
              >
                Programma svolto (MD)
              </button>

              <button
                type="button"
                onClick={() => void handleDownloadProgrammaSvoltoPdf()}
                disabled={!udas || pdfDownloading}
              >
                {pdfDownloading ? 'Generazione PDF…' : 'Programma svolto (PDF)'}
              </button>
            </div>
          )}

          {!selectedProgram.activeImportId ? (
            <p>Nessun import attivo per questo programma.</p>
          ) : udas === null ? (
            <p aria-busy="true">Caricamento UDA…</p>
          ) : (
            <div>
              <h3>UDA</h3>
              {udas.length === 0 ? (
                <p>Nessuna UDA.</p>
              ) : (
                <ul>
                  {udas.map((u) => (
                    <li key={u.id}>
                      <button
                        type="button"
                        aria-pressed={selectedUdaDir === u.dir}
                        onClick={() => void handleSelectUda(u.dir)}
                      >
                        {u.dir}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {selectedUdaDir && (
                <div>
                  <h4>Lezioni — {selectedUdaDir}</h4>
                  {lessons === null ? (
                    <p aria-busy="true">Caricamento lezioni…</p>
                  ) : lessons.length === 0 ? (
                    <p>Nessuna lezione.</p>
                  ) : (
                    <ul>
                      {lessons.map((l) => (
                        <li key={l.id}>
                          <label>
                            <input
                              type="checkbox"
                              checked={l.completed ?? false}
                              onChange={() => void handleToggleLesson(l)}
                            />
                            <button
                              type="button"
                              onClick={() => void handleSelectLesson(l)}
                              aria-pressed={selectedLesson?.id === l.id}
                            >
                              {l.filename}
                            </button>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}

                  {selectedLesson && (
                    <div>
                      <h5>{selectedLesson.filename}</h5>
                      {lessonContentLoading && <p aria-busy="true">Caricamento contenuto…</p>}
                      {lessonContentError && <p role="alert">{lessonContentError}</p>}
                      {lessonContent !== null && !lessonContentLoading && (
                        <MarkdownRenderer markdown={lessonContent} />
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
