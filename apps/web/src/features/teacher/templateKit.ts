import JSZip from 'jszip';

export type TemplateEntry = {
  name: string;
  filename: string;
  url: string;
};

export const TEMPLATES: TemplateEntry[] = [
  {
    name: 'Programma',
    filename: 'programma-template.md',
    url: '/templates/programma-template.md',
  },
  {
    name: 'UDA',
    filename: 'uda-template.md',
    url: '/templates/uda-template.md',
  },
  {
    name: 'Lezione',
    filename: 'lezione-template.md',
    url: '/templates/lezione-template.md',
  },
  {
    name: 'Pool domande',
    filename: 'pool-template.pool.md',
    url: '/templates/pool-template.pool.md',
  },
];

export function downloadTemplate(filename: string): void {
  const entry = TEMPLATES.find((t) => t.filename === filename);
  if (!entry) return;
  const a = document.createElement('a');
  a.href = entry.url;
  a.download = filename;
  a.click();
}

const KIT_ROOT = 'programma-esempio';

/**
 * Builds the example program kit: a small but fully importable repository
 * (programma.md + one UDA with one lesson and a pool) with obvious
 * placeholder content — never real didactic material. Wrapped in a single
 * "programma-esempio/" folder, the same shape a teacher gets zipping their
 * own program folder — readZipFile strips that wrapper on import.
 */
export function buildKitZip(): JSZip {
  const zip = new JSZip();

  zip.file(
    `${KIT_ROOT}/programma.md`,
    `---
titolo: 'Titolo del programma'
anno_scolastico: 'Anno scolastico'
classe: 'Classe'
materia: 'Materia'
docente: 'Nome Cognome docente'
---

# Titolo del programma

Descrizione del programma.
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-01-titolo-uda/uda-01-titolo-uda.md`,
    `---
titolo: 'Titolo UDA'
competenze:
  - 'Competenza 1'
obiettivi:
  - 'Obiettivo 1'
---

# Titolo UDA

Descrizione UDA.
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-01-titolo-uda/lezione-001-titolo-lezione.md`,
    `# Titolo della lezione

Testo della lezione.
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-01-titolo-uda/lezione-001-titolo-lezione.pool.md`,
    `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: aperta
    difficolta: 1
    peso: 1
    testo: 'Testo della domanda'
    soluzione: 'Testo della soluzione'
  - id: q2
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: 'Testo della domanda'
    opzioni:
      - id: a
        testo: 'Opzione A'
      - id: b
        testo: 'Opzione B'
    soluzione:
      - a
---
`,
  );

  return zip;
}

export async function downloadKitZip(): Promise<void> {
  const zip = buildKitZip();
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'programma-esempio.zip';
  a.click();
  URL.revokeObjectURL(url);
}
