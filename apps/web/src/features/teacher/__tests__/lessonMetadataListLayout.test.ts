import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(__dirname, '../CourseWorkspace.module.css'), 'utf8');
const source = readFileSync(resolve(__dirname, '../CourseWorkspace.tsx'), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`regola CSS mancante: ${selector}`);
  return css.slice(start, css.indexOf('}', start) + 1);
}

describe('LESSON-METADATA-UI-01 — contratto responsive degli elenchi', () => {
  it('consente alla colonna dei valori di restringersi senza overflow', () => {
    expect(rule('.infoList')).toMatch(/grid-template-columns:\s*max-content minmax\(0, 1fr\)/);
    expect(rule('.infoList dd')).toMatch(/min-width:\s*0/);
  });

  it('manda a capo anche elementi lunghi o senza spazi', () => {
    expect(rule('.metaList')).toMatch(/min-width:\s*0/);
    expect(rule('.metaList li')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('non ricompone gli array nella scheda Informazioni', () => {
    const lessonInfo = source.slice(source.indexOf('function LessonInfo'));
    expect(lessonInfo).not.toContain("join(', ')");
    expect(lessonInfo).toContain('<MetadataList items={metadata.concettiChiave} />');
    expect(lessonInfo).toContain('<MetadataList items={metadata.obiettivi} />');
  });

  it('usa chiavi composte da indice e valore anche con voci duplicate', () => {
    const metadataList = source.slice(
      source.indexOf('function MetadataList'),
      source.indexOf('function UdaOverview'),
    );
    expect(metadataList).toContain('key={`${index}-${item}`}');
  });
});
