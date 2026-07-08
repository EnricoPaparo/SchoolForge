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
 * with obvious placeholder content — never real didactic material — that
 * exercises every structural feature a teacher's own ZIP can use: 2 UDA,
 * 2 lessons per UDA, a valid pool on one lesson per UDA (the other lesson
 * is left without a pool, poolStatus "absent"), all three question types
 * (aperta, chiusa_singola, chiusa_multipla), and filled-in programma/UDA
 * metadata (anno_scolastico, docente, materia, classe, descrizione,
 * competenze, obiettivi). Wrapped in a single "programma-esempio/" folder,
 * the same shape a teacher gets zipping their own program folder —
 * readZipFile strips that wrapper on import.
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
titolo: 'Titolo UDA 1'
competenze:
  - 'Competenza 1'
  - 'Competenza 2'
obiettivi:
  - 'Obiettivo 1'
---

# Titolo UDA 1

Descrizione UDA 1.
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-01-titolo-uda/lezione-001-titolo-lezione.md`,
    `# Titolo della lezione 1.1

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
    testo: 'Testo della domanda aperta'
    soluzione: 'Testo della soluzione'
  - id: q2
    tipo: chiusa_singola
    difficolta: 1
    peso: 1
    testo: 'Testo della domanda a scelta singola'
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

  zip.file(
    `${KIT_ROOT}/uda-01-titolo-uda/lezione-002-titolo-lezione.md`,
    `# Titolo della lezione 1.2

Testo della lezione. Questa lezione non ha un pool domande allegato.
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-02-titolo-uda/uda-02-titolo-uda.md`,
    `---
titolo: 'Titolo UDA 2'
competenze:
  - 'Competenza 3'
obiettivi:
  - 'Obiettivo 2'
  - 'Obiettivo 3'
---

# Titolo UDA 2

Descrizione UDA 2.
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-02-titolo-uda/lezione-001-titolo-lezione.md`,
    `# Titolo della lezione 2.1

Testo della lezione.
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-02-titolo-uda/lezione-001-titolo-lezione.pool.md`,
    `---
schema: schoolforge-pool/v1
questions:
  - id: q1
    tipo: chiusa_multipla
    difficolta: 2
    peso: 2
    testo: 'Testo della domanda a scelta multipla'
    opzioni:
      - id: a
        testo: 'Opzione A'
      - id: b
        testo: 'Opzione B'
      - id: c
        testo: 'Opzione C'
    soluzione:
      - a
      - c
---
`,
  );

  zip.file(
    `${KIT_ROOT}/uda-02-titolo-uda/lezione-002-titolo-lezione.md`,
    `# Titolo della lezione 2.2

Testo della lezione. Questa lezione non ha un pool domande allegato.
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
