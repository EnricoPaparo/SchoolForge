import { useState } from 'react';
import { IconDownload } from '../../components/icons.js';
import { downloadKitZip, downloadTemplate, TEMPLATES } from './templateKit.js';
import styles from './TemplateKitView.module.css';

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  'programma-template.md': 'Metadati generali del corso e riferimenti alle UDA.',
  'uda-template.md': 'Descrizione, competenze e obiettivi di una UDA.',
  'lezione-template.md': 'Front matter e corpo Markdown di una lezione.',
  'pool-template.pool.md': 'Pool validato con domande e relative soluzioni.',
};

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
    <section aria-label="Template" className={styles.section}>
      <div className={styles.kitHero}>
        <div className={styles.kitCopy}>
          <h2>Kit completo</h2>
          <p>
            Un archivio di esempio già strutturato, da compilare manualmente o con uno strumento AI
            e importare in Didattica.
          </p>
        </div>
        <button
          type="button"
          className={`${styles.zipBtn} btn-primary`}
          onClick={() => void handleDownloadZip()}
          disabled={zipping}
        >
          <IconDownload size={17} />
          {zipping ? 'Generazione ZIP…' : 'Scarica kit completo (ZIP)'}
        </button>
        {zipError && (
          <p role="alert" className={styles.errorMsg}>
            {zipError}
          </p>
        )}
      </div>

      <div className={styles.contentSection}>
        <h2 className={styles.sectionTitle}>Template singoli</h2>
        <ul className={styles.templateList}>
          {TEMPLATES.map((template) => (
            <li key={template.filename} className={styles.templateItem}>
              <div className={styles.templateInfo}>
                <span className={styles.templateName}>{template.name}</span>
                <span className={styles.templateDescription}>
                  {TEMPLATE_DESCRIPTIONS[template.filename] ?? 'Template Markdown SchoolForge.'}
                </span>
              </div>
              <button
                type="button"
                className={styles.downloadBtn}
                aria-label={`Scarica template ${template.name}`}
                title={`Scarica template ${template.name}`}
                onClick={() => downloadTemplate(template.filename)}
              >
                <IconDownload size={17} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.guideBox}>
        <h2>Guida compatta</h2>
        <ol>
          <li>Scarica il kit completo oppure i singoli template.</li>
          <li>Compila i campi manualmente o con uno strumento AI, senza cambiare i nomi file.</li>
          <li>Comprimi la struttura e importala con “Importa ZIP” dalla sezione Didattica.</li>
        </ol>
      </div>

      <div className={styles.contentSection}>
        <h2 className={styles.sectionTitle}>Struttura ZIP di esempio</h2>
        <pre className={styles.zipTree} aria-label="Struttura ZIP di esempio">{`programma.md
uda-01-reti/
  uda.md
  01-modello-osi.md
  01-modello-osi.pool.md
  02-tcp-ip.md
  02-tcp-ip.pool.md
uda-02-sicurezza/
  uda.md
  01-crittografia.md
  01-crittografia.pool.md`}</pre>
      </div>
    </section>
  );
}
