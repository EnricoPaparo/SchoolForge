import { useState } from 'react';
import { IconCopy, IconDownload } from '../../components/icons.js';
import {
  LESSON_METADATA_TEMPLATE,
  UDA_METADATA_TEMPLATE,
} from '../repository/structureImport/index.js';
import { downloadKitZip, downloadTemplate, TEMPLATES } from './templateKit.js';
import styles from './TemplateKitView.module.css';

const TEMPLATE_DESCRIPTIONS: Record<string, string> = {
  'programma-template.md': 'Metadati generali del corso e riferimenti alle UDA.',
  'uda-template.md': 'Descrizione, competenze e obiettivi di una UDA.',
  'lezione-template.md': 'Front matter e corpo Markdown di una lezione.',
  'pool-template.pool.md': 'Pool validato con domande e relative soluzioni.',
};

const ZIP_STRUCTURE = `programma.md
uda-01-reti/
  uda.md
  01-modello-osi.md
  01-modello-osi.pool.md
  02-tcp-ip.md
  02-tcp-ip.pool.md
uda-02-sicurezza/
  uda.md
  01-crittografia.md
  01-crittografia.pool.md`;

const EXAMPLES = [
  {
    id: 'zip',
    title: 'Struttura ZIP',
    description: 'Organizzazione completa di corso, UDA, lezioni e pool.',
    content: ZIP_STRUCTURE,
  },
  {
    id: 'uda',
    title: 'Struttura UDA — YAML',
    description: 'Metadati di più UDA da aggiungere in coda a un corso.',
    content: UDA_METADATA_TEMPLATE,
  },
  {
    id: 'lesson',
    title: 'Struttura lezioni — YAML',
    description: 'Metadati di più lezioni vuote da aggiungere a una UDA.',
    content: LESSON_METADATA_TEMPLATE,
  },
] as const;

export function TemplateKitView() {
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState(false);

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

  async function handleCopy(id: string, content: string): Promise<void> {
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
    } catch {
      setCopiedId(null);
      setCopyError(true);
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
          <li>Usa il kit ZIP per importare un programma completo di contenuti e pool.</li>
          <li>Usa il modello UDA per aggiungere in blocco i metadati delle UDA a un corso.</li>
          <li>Usa il modello lezioni dentro l’UDA a cui vuoi aggiungere le lezioni vuote.</li>
          <li>Copia l’esempio, poi compilalo senza cambiare lo schema.</li>
        </ol>
      </div>

      <div className={styles.contentSection}>
        <h2 className={styles.sectionTitle}>Esempi pronti all’uso</h2>
        <div className={styles.examplesGrid}>
          {EXAMPLES.map((example) => (
            <article key={example.id} className={styles.exampleCard}>
              <header className={styles.exampleHeader}>
                <div className={styles.exampleInfo}>
                  <h3>{example.title}</h3>
                  <p>{example.description}</p>
                </div>
                <div className={styles.exampleActions}>
                  <button
                    type="button"
                    className={styles.exampleAction}
                    onClick={() => void handleCopy(example.id, example.content)}
                    aria-label={`Copia ${example.title}`}
                    title={`Copia ${example.title}`}
                  >
                    <IconCopy size={16} />
                    <span>{copiedId === example.id ? 'Copiato' : 'Copia'}</span>
                  </button>
                </div>
              </header>
              <pre className={styles.exampleCode} aria-label={`Esempio ${example.title}`}>
                {example.content}
              </pre>
            </article>
          ))}
        </div>
        <p className={styles.copyStatus} role="status" aria-live="polite">
          {copyError
            ? 'Impossibile copiare negli appunti. Seleziona il testo manualmente.'
            : copiedId
              ? 'Esempio copiato negli appunti.'
              : ''}
        </p>
      </div>
    </section>
  );
}
