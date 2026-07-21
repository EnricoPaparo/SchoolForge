import { useMemo, useState } from 'react';
import type { QuestionIndexEntry } from '../repository/verifications/questionIndexService.js';
import styles from './QuestionPicker.module.css';

type Props = {
  entries: QuestionIndexEntry[];
  selectedIds: Set<string>;
  onChange: (next: Set<string>) => void;
};

const TIPO_LABELS: Record<QuestionIndexEntry['tipo'], string> = {
  aperta: 'aperta',
  chiusa_singola: 'chiusa singola',
  chiusa_multipla: 'chiusa multipla',
};

function uniqueSorted<T>(values: T[]): T[] {
  return Array.from(new Set(values)).sort();
}

/**
 * Compact, filterable picker for questionIndex entries. Only metadata already
 * present in QuestionIndexEntry is shown/searched — question text, answers
 * and solutions are never fetched or exposed here.
 */
export function QuestionPicker({ entries, selectedIds, onChange }: Props) {
  const [search, setSearch] = useState('');
  const [udaFilter, setUdaFilter] = useState('');
  const [lessonFilter, setLessonFilter] = useState('');
  const [tipoFilter, setTipoFilter] = useState<QuestionIndexEntry['tipo'] | ''>('');
  const [difficoltaFilter, setDifficoltaFilter] = useState('');

  const udaOptions = useMemo(() => uniqueSorted(entries.map((e) => e.udaDir)), [entries]);
  const lessonOptions = useMemo(() => {
    const scope = udaFilter ? entries.filter((e) => e.udaDir === udaFilter) : entries;
    return uniqueSorted(scope.map((e) => e.lessonFilename));
  }, [entries, udaFilter]);
  const tipoOptions = useMemo(
    () => uniqueSorted(entries.map((e) => e.tipo)),
    [entries],
  ) as QuestionIndexEntry['tipo'][];
  const difficoltaOptions = useMemo(
    () => uniqueSorted(entries.map((e) => e.difficolta)),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (udaFilter && e.udaDir !== udaFilter) return false;
      if (lessonFilter && e.lessonFilename !== lessonFilter) return false;
      if (tipoFilter && e.tipo !== tipoFilter) return false;
      if (difficoltaFilter && String(e.difficolta) !== difficoltaFilter) return false;
      if (q) {
        const haystack =
          `${e.questionPreview} ${e.udaDir} ${e.lessonFilename} ${e.questionLocalId}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, udaFilter, lessonFilter, tipoFilter, difficoltaFilter]);

  const filteredIds = useMemo(() => filtered.map((e) => e.id), [filtered]);
  const allFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.has(id));
  const noneFilteredSelected = filteredIds.every((id) => !selectedIds.has(id));

  const selectedEntries = useMemo(
    () => entries.filter((e) => selectedIds.has(e.id)),
    [entries, selectedIds],
  );
  const totalPoints = selectedEntries.reduce((sum, e) => sum + e.maxPoints, 0);

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  function selectAllFiltered() {
    const next = new Set(selectedIds);
    filteredIds.forEach((id) => next.add(id));
    onChange(next);
  }

  function deselectAllFiltered() {
    const next = new Set(selectedIds);
    filteredIds.forEach((id) => next.delete(id));
    onChange(next);
  }

  function removeFromSummary(id: string) {
    const next = new Set(selectedIds);
    next.delete(id);
    onChange(next);
  }

  return (
    <div className={styles.container}>
      <div className={styles.filterBar}>
        <div className={styles.filterRowPrimary}>
          <div className={`${styles.filterField} ${styles.filterFieldSearch}`}>
            <label className={styles.filterLabel} htmlFor="qp-search">
              Cerca
            </label>
            <input
              id="qp-search"
              type="text"
              className={styles.filterInput}
              placeholder="Cerca nel testo domanda, UDA o lezione"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Cerca domande"
            />
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="qp-difficolta">
              Difficoltà
            </label>
            <select
              id="qp-difficolta"
              className={styles.filterInput}
              value={difficoltaFilter}
              onChange={(e) => setDifficoltaFilter(e.target.value)}
              aria-label="Filtra per difficoltà"
            >
              <option value="">Tutte</option>
              {difficoltaOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="qp-tipo">
              Tipo
            </label>
            <select
              id="qp-tipo"
              className={styles.filterInput}
              value={tipoFilter}
              onChange={(e) => setTipoFilter(e.target.value as QuestionIndexEntry['tipo'] | '')}
              aria-label="Filtra per tipo"
            >
              <option value="">Tutti</option>
              {tipoOptions.map((tipo) => (
                <option key={tipo} value={tipo}>
                  {TIPO_LABELS[tipo]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={styles.filterRowScope}>
          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="qp-uda">
              UDA
            </label>
            <select
              id="qp-uda"
              className={styles.filterInput}
              value={udaFilter}
              onChange={(e) => {
                setUdaFilter(e.target.value);
                setLessonFilter('');
              }}
              aria-label="Filtra per UDA"
            >
              <option value="">Tutte</option>
              {udaOptions.map((uda) => (
                <option key={uda} value={uda}>
                  {uda}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.filterField}>
            <label className={styles.filterLabel} htmlFor="qp-lesson">
              Lezione
            </label>
            <select
              id="qp-lesson"
              className={styles.filterInput}
              value={lessonFilter}
              onChange={(e) => setLessonFilter(e.target.value)}
              aria-label="Filtra per lezione"
            >
              <option value="">Tutte</option>
              {lessonOptions.map((lesson) => (
                <option key={lesson} value={lesson}>
                  {lesson}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className={styles.toolbarRow}>
        <button
          type="button"
          className={styles.bulkBtn}
          disabled={filteredIds.length === 0 || allFilteredSelected}
          onClick={selectAllFiltered}
          aria-label="Seleziona tutte le domande filtrate"
        >
          Seleziona tutte filtrate
        </button>
        <button
          type="button"
          className={styles.bulkBtn}
          disabled={filteredIds.length === 0 || noneFilteredSelected}
          onClick={deselectAllFiltered}
          aria-label="Deseleziona tutte le domande filtrate"
        >
          Deseleziona tutte filtrate
        </button>
        <span className={styles.counters} aria-live="polite">
          <span>{filtered.length} domande trovate</span> ·{' '}
          <span aria-label="Domande selezionate (contatore)">
            <span className={styles.countsStrong}>{selectedIds.size}</span> selezionate
          </span>{' '}
          ·{' '}
          <span aria-label="Punti totali selezionati">
            <span className={styles.countsStrong}>{totalPoints}</span> punti totali
          </span>
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="state-empty">Nessuna domanda corrisponde ai filtri.</p>
      ) : (
        <ul className={styles.list} aria-label="Elenco domande filtrate">
          {filtered.map((entry) => (
            <li key={entry.id} className={styles.row}>
              <input
                type="checkbox"
                id={`qp-check-${entry.id}`}
                checked={selectedIds.has(entry.id)}
                onChange={() => toggle(entry.id)}
                aria-label={`Seleziona domanda ${entry.questionLocalId}`}
              />
              <label htmlFor={`qp-check-${entry.id}`} className={styles.rowContent}>
                <span className={styles.rowPreviewLine}>
                  <span className={styles.rowLocalId}>#{entry.questionLocalId}</span>
                  {entry.questionPreview.trim() ? (
                    <span className={styles.rowPreview} title={entry.questionPreview}>
                      {entry.questionPreview}
                    </span>
                  ) : (
                    <span className={styles.rowPreview}>
                      <span className={styles.rowPreviewMissing}>Anteprima non disponibile</span>
                    </span>
                  )}
                </span>
                <span className={styles.rowMeta}>
                  {entry.udaDir} / {entry.lessonFilename} · {TIPO_LABELS[entry.tipo]} · diff{' '}
                  {entry.difficolta} · {entry.maxPoints}pt
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <div className={styles.summary} aria-label="Domande selezionate" role="region">
        <p className={styles.summaryTitle}>
          Domande selezionate ({selectedEntries.length} · {totalPoints} punti)
        </p>
        {selectedEntries.length === 0 ? (
          <p className="state-empty">Nessuna domanda selezionata.</p>
        ) : (
          <ul className={styles.summaryList}>
            {selectedEntries.map((entry) => (
              <li key={entry.id} className={styles.summaryRow}>
                <span className={styles.summaryMeta}>
                  {entry.udaDir} / {entry.lessonFilename} · {TIPO_LABELS[entry.tipo]}
                </span>
                <span className={styles.summaryPoints}>{entry.maxPoints}pt</span>
                <button
                  type="button"
                  className={styles.removeBtn}
                  onClick={() => removeFromSummary(entry.id)}
                  aria-label={`Rimuovi domanda ${entry.questionLocalId} dal riepilogo`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
