import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * STRUCTURE-IMPORT-03 — prova strutturale del vincolo «zero nuove letture».
 *
 * Il contesto generale dell'UDA deve arrivare dall'albero **già caricato** in
 * `CourseWorkspace`. Un vincolo del genere non si difende con un mock: basta
 * una `getDoc` aggiunta più avanti perché il costo passivo cambi senza che
 * nessun test funzionale se ne accorga. Qui si legge il sorgente e si verifica
 * che la superficie di accesso ai dati resti quella dichiarata.
 */

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('zero nuove letture per il contesto generale dell’UDA', () => {
  it('il costruttore del contesto è puro: nessun import Firebase, nessun timer', () => {
    const source = read('../lessonUdaContext.ts');
    // I commenti *nominano* le API vietate proprio per spiegare che non si
    // usano: qui interessa il codice.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const forbidden of [
      'firebase',
      'getDoc',
      'getDocs',
      'onSnapshot',
      'query(',
      'setInterval',
      'setTimeout',
      'fetch(',
    ]) {
      expect(code).not.toContain(forbidden);
    }
    // L'unico import è il tipo del payload.
    const imports = [...code.matchAll(/^import .*$/gm)].map((m) => m[0]);
    expect(imports).toEqual(["import type { LessonUdaContext } from './aiContentClient.js';"]);
  });

  it('il workspace passa l’UDA dell’albero in memoria, non una lettura nuova', () => {
    const source = read('../../../teacher/CourseWorkspace.tsx');
    const call = source.slice(
      source.indexOf('udaContext: buildLessonUdaContext({'),
      source.indexOf('}),', source.indexOf('udaContext: buildLessonUdaContext({')),
    );
    expect(call).toContain('lessons: tree?.lessons ?? []');
    expect(call).toContain('uda: tree?.udas.find((u) => u.dir === selectedLesson.udaDir) ?? null');
    // Un solo punto di costruzione: nessun secondo oggetto parallelo.
    expect(source.split('buildLessonUdaContext(').length - 1).toBe(1);
  });

  it('esiste un solo confine di mapping verso il payload', () => {
    // I nomi canonici italiani (`descrizione`, `competenze`, `obiettivi`)
    // diventano payload soltanto dentro `buildLessonUdaContext`: altrove il
    // contesto viene trasportato, mai ricostruito.
    const client = read('../aiContentClient.ts');
    expect(client).toContain('descrizione: uda.descrizione');
    expect(client).toContain('competenze: uda.competenze');
    expect(client).toContain('obiettivi: uda.obiettivi');
    // Nessuna normalizzazione duplicata nel trasporto.
    expect(client).not.toContain('uda.descrizione?.trim()');
  });
});
