import { useMemo, useState } from 'react';
import type { LessonVisualItem } from '../../types/firestore.js';
import type { MultiVisualIdentity } from '../repository/programs/multiVisualClient.js';
import styles from './LessonMultiVisualGallery.module.css';

export function LessonMultiVisualGallery({
  identity,
  manifest,
  onRemove,
  onGenerate,
  bytes = {},
}: {
  identity: MultiVisualIdentity;
  manifest: LessonVisualItem[];
  onRemove: (assetId: string) => Promise<void>;
  onGenerate?: () => void;
  bytes?: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const items = manifest;
  const ids = useMemo(() => items.map((item) => item.assetId), [items]);
  async function remove(assetId: string) {
    if (busy) return;
    if (!window.confirm('Rimuovere definitivamente questa immagine dalla lezione?')) return;
    setBusy(true);
    setError(null);
    try {
      await onRemove(assetId);
    } catch {
      setError('Impossibile rimuovere l’immagine. Riprova.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className={styles.gallery}
      aria-label="Gestisci immagini della lezione"
      data-testid="multi-visual-gallery"
    >
      <div className={styles.header}>
        <div>
          <h4>Immagini della lezione</h4>
          <p>{items.length} di 3 immagini</p>
        </div>
        {onGenerate && (
          <button
            type="button"
            className="btn-primary"
            onClick={onGenerate}
            disabled={busy || items.length >= 3}
          >
            Aggiungi immagine
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.grid}>
        {items.map((item, index) => (
          <article className={styles.card} key={item.assetId}>
            <div className={styles.meta}>
              <strong>Immagine {index + 1}</strong>
              <span>{item.anchor.headingText}</span>
            </div>
            <div className={styles.frame} style={{ aspectRatio: `${item.width} / ${item.height}` }}>
              {bytes[item.assetId] ? (
                <img
                  className={styles.image}
                  src={bytes[item.assetId]}
                  alt={item.altText}
                  width={item.width}
                  height={item.height}
                  loading="lazy"
                />
              ) : (
                <div
                  className={styles.placeholder}
                  aria-label="Anteprima disponibile dopo la lettura dei byte"
                >
                  Anteprima immagine
                </div>
              )}
            </div>
            <p className={styles.caption}>{item.caption}</p>
            <div className={styles.actions}>
              <button
                type="button"
                className="btn-danger"
                onClick={() => void remove(item.assetId)}
                disabled={busy}
              >
                Rimuovi
              </button>
            </div>
          </article>
        ))}
      </div>
      {items.length === 0 && <p className="state-empty">Nessuna immagine approvata.</p>}
      <span className={styles.srOnly}>
        {identity.lessonId} · {ids.join(',')}
      </span>
    </section>
  );
}
