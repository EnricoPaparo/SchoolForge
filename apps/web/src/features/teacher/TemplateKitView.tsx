import { useState } from 'react';
import { downloadKitZip, downloadTemplate, TEMPLATES } from './templateKit.js';

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
    <section aria-label="Kit template">
      <h3>Kit template</h3>
      <p>Scarica i file template per preparare il tuo repository didattico.</p>
      <ul>
        {TEMPLATES.map((t) => (
          <li key={t.filename}>
            <button type="button" onClick={() => downloadTemplate(t.filename)}>
              Scarica {t.name}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => void handleDownloadZip()} disabled={zipping}>
        {zipping ? 'Generazione ZIP…' : 'Scarica kit completo (ZIP)'}
      </button>
      {zipError && <p role="alert">{zipError}</p>}
    </section>
  );
}
