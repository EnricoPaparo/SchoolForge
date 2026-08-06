import { useEffect, useRef, useState } from 'react';
import {
  IconCircleCheck,
  IconCopy,
  IconDownload,
  IconTriangleAlert,
} from '../../components/icons.js';
import {
  LESSON_SIMPLE_TEMPLATE,
  UDA_SIMPLE_TEMPLATE,
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
    title: 'Struttura UDA',
    description: 'Metadati di più UDA da aggiungere in coda a un corso.',
    content: UDA_SIMPLE_TEMPLATE,
  },
  {
    id: 'lesson',
    title: 'Struttura lezioni',
    description: 'Metadati di più lezioni vuote da aggiungere a una UDA.',
    content: LESSON_SIMPLE_TEMPLATE,
  },
] as const;

/**
 * Esito della copia, sempre riferito a **una sola** card. L'esito vive nel
 * pulsante che il docente ha premuto: un messaggio in fondo alla pagina
 * costringeva a cercare altrove la conferma di un gesto fatto qui, e comparendo
 * spostava il contenuto sotto la griglia.
 */
type CopyOutcome = { id: string; status: 'copied' | 'error' };

/** Quanto resta visibile la conferma prima di tornare a «Copia». */
const COPY_FEEDBACK_MS = 2_000;

export function TemplateKitView() {
  const [zipping, setZipping] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [copyOutcome, setCopyOutcome] = useState<CopyOutcome | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // La clipboard è asincrona: senza questa guardia una risposta tardiva
  // aggiornerebbe lo stato di un componente già smontato.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    };
  }, []);

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

  async function handleCopy(id: string, title: string, content: string): Promise<void> {
    // Un secondo click riparte da capo: nessun esito residuo di un tentativo
    // precedente può sovrapporsi a quello nuovo.
    if (resetTimerRef.current !== null) clearTimeout(resetTimerRef.current);
    setCopyOutcome(null);
    setAnnouncement('');
    try {
      await navigator.clipboard.writeText(content);
      if (!mountedRef.current) return;
      setCopyOutcome({ id, status: 'copied' });
      setAnnouncement(`${title}: esempio copiato negli appunti.`);
      resetTimerRef.current = setTimeout(() => {
        if (!mountedRef.current) return;
        setCopyOutcome(null);
        setAnnouncement('');
      }, COPY_FEEDBACK_MS);
    } catch {
      // Un fallimento non dichiara mai successo, e resta finché il docente non
      // riprova: è lui a dover decidere cosa fare, non un timer.
      if (!mountedRef.current) return;
      setCopyOutcome({ id, status: 'error' });
      setAnnouncement(
        `${title}: impossibile copiare negli appunti. Seleziona il testo manualmente.`,
      );
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
          <li>Copia l’esempio, poi sostituisci i valori mantenendo le etichette.</li>
        </ol>
      </div>

      <div className={styles.contentSection}>
        <h2 className={styles.sectionTitle}>Esempi pronti all’uso</h2>
        {/* L'esito è annunciato qui e mostrato nel pulsante: questa regione non
            occupa spazio e non può spostare nulla. */}
        <span className={styles.srOnly} role="status" aria-live="polite">
          {announcement}
        </span>
        <div className={styles.examplesGrid}>
          {EXAMPLES.map((example) => (
            <article key={example.id} className={styles.exampleCard}>
              <header className={styles.exampleHeader}>
                <div className={styles.exampleInfo}>
                  <h3>{example.title}</h3>
                  <p>{example.description}</p>
                </div>
                <div className={styles.exampleActions}>
                  {(() => {
                    const outcome = copyOutcome?.id === example.id ? copyOutcome.status : undefined;
                    const label =
                      outcome === 'copied' ? 'Copiato' : outcome === 'error' ? 'Riprova' : 'Copia';
                    const accessible =
                      outcome === 'copied'
                        ? `${example.title}: copiato`
                        : outcome === 'error'
                          ? `Riprova a copiare ${example.title}`
                          : `Copia ${example.title}`;
                    return (
                      <button
                        type="button"
                        className={styles.exampleAction}
                        data-state={outcome ?? 'idle'}
                        onClick={() => void handleCopy(example.id, example.title, example.content)}
                        aria-label={accessible}
                        title={accessible}
                      >
                        {outcome === 'copied' ? (
                          <IconCircleCheck size={16} />
                        ) : outcome === 'error' ? (
                          <IconTriangleAlert size={16} />
                        ) : (
                          <IconCopy size={16} />
                        )}
                        {/* Larghezza riservata alla parola più lunga: i tre stati
                            non cambiano la dimensione del pulsante. */}
                        <span className={styles.exampleActionLabel}>{label}</span>
                      </button>
                    );
                  })()}
                </div>
              </header>
              <pre className={styles.exampleCode} aria-label={`Esempio ${example.title}`}>
                {example.content}
              </pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
