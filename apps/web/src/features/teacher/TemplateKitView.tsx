import { useState } from 'react';
import { downloadKitZip, downloadTemplate, TEMPLATES } from './templateKit.js';
import styles from './TemplateKitView.module.css';

export function TemplateKitView() {
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);

  async function handleDownloadZip() {
    setZipping(true);
    setZipError(null);
    try {
      await downloadKitZip();
    } catch {
      setZipError('Impossibile generare il file ZIP.');
    } finally {
      setZipping(false);
    }
  }

  return (
    <section aria-label="Kit template" className={styles.section}>
      <ul className={styles.templateList}>
        {TEMPLATES.map((t) => (
          <li key={t.filename} className={styles.templateItem}>
            <span className={styles.templateName}>{t.name}</span>
            <button
              type="button"
              className={styles.downloadBtn}
              aria-label={`Scarica template ${t.name}`}
              onClick={() => downloadTemplate(t.filename)}
            >
              Scarica
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.zipRow}>
        <button
          type="button"
          className={styles.zipBtn}
          onClick={() => void handleDownloadZip()}
          disabled={zipping}
        >
          {zipping ? 'Generazione ZIP…' : 'Scarica kit completo (ZIP)'}
        </button>
        {zipError && (
          <p role="alert" className={styles.errorMsg}>
            {zipError}
          </p>
        )}
      </div>
    </section>
  );
}
