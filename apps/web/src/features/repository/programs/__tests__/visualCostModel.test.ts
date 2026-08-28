import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const raw = (path: string) => readFileSync(resolve(process.cwd(), 'src', path), 'utf8');

/**
 * I commenti vengono rimossi prima di cercare: questi moduli **documentano**
 * ciò che non fanno — «mai `marked.use()` globale», «`getDoc` e non
 * `onSnapshot`» — e cercare nel sorgente grezzo troverebbe la frase invece
 * della chiamata.
 */
const src = (path: string) =>
  raw(path)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

/**
 * VE-04A — il cost model, congelato staticamente.
 *
 * Le garanzie di costo di questa fase sono tutte **negative**: ciò che non
 * viene fatto. Un test funzionale può dimostrare che una lettura avviene; solo
 * un test sul sorgente può dimostrare che non ne esiste una seconda nascosta in
 * un ramo che i test non percorrono.
 */

describe('nessun costo passivo', () => {
  const visualSources = [
    'features/repository/programs/visualReadClients.ts',
    'features/repository/programs/useLessonVisual.ts',
    'features/repository/programs/visualReanchorClient.ts',
    'features/repository/programs/lessonVisualContract.ts',
    'components/lessonManualVisual.ts',
    'components/LessonVisualFigure.tsx',
    'components/LessonManualBody.tsx',
  ];

  /**
   * Un listener costerebbe una connessione aperta per osservare qualcosa che
   * non si muove: l'immagine di una lezione non cambia mentre la si legge.
   */
  it('nessun listener, polling o query', () => {
    for (const path of visualSources) {
      const code = src(path);
      for (const forbidden of ['onSnapshot', 'setInterval', 'getDocs', 'collection(', 'where(']) {
        expect(code, `${path} contiene ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  /** La lettura studente è puntuale per definizione: una `getDoc` e basta. */
  it('la lettura studente è una sola getDoc puntuale', () => {
    const code = src('features/repository/programs/visualReadClients.ts');
    expect(code.match(/getDoc\(/g)).toHaveLength(1);
    expect(code).toContain("doc(db, 'publicLessonVisuals', publicLessonId)");
  });

  /** Il docente riusa l'export binario: nessuna seconda operazione binaria. */
  it('la lettura docente riusa aiVisualExportBatch per una sola lezione', () => {
    const code = src('features/repository/programs/visualReadClients.ts');
    expect(code).toContain("'aiVisualExportBatch'");
    expect(code).toContain('lessonIds: [lessonId]');
    expect(code.match(/httpsCallable</g)).toHaveLength(1);

    const multi = src('features/repository/programs/multiVisualReadClients.ts');
    expect(multi).toContain('createVisualExportClient');
    expect(multi).toContain('lessonIds: [params.lessonId]');
    expect(multi).not.toContain('httpsCallable');
  });

  /**
   * Nessuna superficie di elenco legge byte: card, albero e liste hanno già il
   * manifest e non mostrano figure.
   */
  it('nessuna lettura visuale nelle superfici di elenco', () => {
    for (const path of [
      'features/repository/programs/studentLessonsService.ts',
      'features/repository/programs/programsService.ts',
    ]) {
      const code = src(path);
      expect(code).not.toContain('publicLessonVisuals');
      expect(code).not.toContain('aiVisualExportBatch');
    }
  });

  /**
   * Il discriminante è il manifest: senza, non parte nulla. È la garanzia che
   * rende la funzione gratuita per la stragrande maggioranza delle lezioni.
   */
  it('la lettura è condizionata all’esistenza del manifest', () => {
    const student = src('features/student/StudentDidatticaView.tsx');
    expect(student).toContain('lesson.visual\n    ? { assetId: lesson.visual.assetId');

    const teacher = src('features/teacher/CourseWorkspace.tsx');
    // Manifest **e** scheda Contenuto aperta: i byte servono per mostrarli.
    expect(teacher).toContain('manifest && contentOpen && importId');
  });

  it('il riancoraggio non tocca Storage né provider', () => {
    const code = src('features/repository/programs/visualReanchorClient.ts');
    for (const forbidden of ['storage', 'getBytes', 'uploadBytes', 'openai']) {
      expect(code.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe('il renderer non introduce costi', () => {
  it('non registra estensioni globali su marked', () => {
    const code = src('components/lessonManualVisual.ts');
    expect(code).not.toContain('marked.use(');
    // Usa l'istanza isolata già esistente, non ne costruisce una nuova.
    expect(code).toContain("from './lessonManualMarkdown.js'");
    expect(code).not.toContain('new Marked(');
  });

  it('non manipola l’HTML dopo la sanificazione', () => {
    const code = src('components/lessonManualVisual.ts');
    const afterSanitize = code.slice(code.indexOf('DOMPurify.sanitize'));
    // Nessuna concatenazione o sostituzione su ciò che esce da DOMPurify.
    expect(afterSanitize).not.toMatch(/sanitize\([^)]*\)\s*[+.]/);
  });
});
