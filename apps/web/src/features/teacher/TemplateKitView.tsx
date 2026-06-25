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
      <h3>Kit template</h3>
      <p className={styles.intro}>
        Scarica i file template per preparare il tuo repository didattico.
      </p>

      <ul className={styles.templateList}>
        {TEMPLATES.map((t) => (
          <li key={t.filename} className={styles.templateItem}>
            <span className={styles.templateName}>{t.name}</span>
            <button
              type="button"
              className={styles.downloadBtn}
              onClick={() => downloadTemplate(t.filename)}
            >
              Scarica {t.name}
            </button>
          </li>
        ))}
      </ul>

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
    </section>
  );
}
