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

export async function downloadKitZip(): Promise<void> {
  const zip = new JSZip();
  await Promise.all(
    TEMPLATES.map(async (t) => {
      const res = await fetch(t.url);
      const text = await res.text();
      zip.file(t.filename, text);
    }),
  );
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'schoolforge-kit.zip';
  a.click();
  URL.revokeObjectURL(url);
}
