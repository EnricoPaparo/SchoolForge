import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * STRUCTURE-IMPORT-02B — cablaggio nel workspace e mutua esclusione.
 *
 * Verifiche statiche sul sorgente: ciò che deve restare vero è *dove* vive il
 * comando — nel menu della UDA, mai in quello del corso o della lezione — e che
 * le mutazioni manuali di una UDA rispettino il lease di un import in volo.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(resolve(__dirname, '../CourseWorkspace.tsx'), 'utf8');
const editor = readFileSync(
  resolve(__dirname, '../../repository/editor/repositoryEditorService.ts'),
  'utf8',
);

const udaMenu = workspace.slice(
  workspace.indexOf('ariaLabel="Azioni UDA"'),
  workspace.indexOf('</ActionsMenu>', workspace.indexOf('ariaLabel="Azioni UDA"')),
);
const courseMenu = workspace.slice(
  workspace.indexOf('ariaLabel="Azioni corso"'),
  workspace.indexOf('</ActionsMenu>', workspace.indexOf('ariaLabel="Azioni corso"')),
);

describe('voce di menu', () => {
  it('vive nel menu Azioni della UDA', () => {
    expect(udaMenu).toContain('Importa lezioni');
    expect(udaMenu).toContain(
      "openDialog({ kind: 'importLessonStructure', udaId: selectedUda.id })",
    );
  });

  it('non compare nel menu del corso', () => {
    expect(courseMenu).not.toContain('Importa lezioni');
  });

  it('agisce sulla UDA da cui il menu è stato aperto', () => {
    // L'id viaggia nel dialog, e il dialog lo restituisce all'handler: non si
    // usa mai una selezione implicita che potrebbe essere cambiata nel mentre.
    expect(workspace).toContain("kind: 'importLessonStructure'; udaId: string");
    expect(workspace).toContain('handleImportLessonStructure(wsDialog.udaId, bytes, filename)');
  });

  it('mostra al docente la UDA di destinazione', () => {
    expect(workspace).toContain('udaTitle={resolveUdaTitle(selectedUda.dir, selectedUda.titolo)}');
  });
});

describe('handler', () => {
  const handler = workspace.slice(
    workspace.indexOf('async function handleImportLessonStructure'),
    workspace.indexOf('STRUCTURE-IMPORT-02A — metadata-only append'),
  );

  it('usa l’orchestratore condiviso, non una logica propria', () => {
    expect(workspace).toContain(
      "import { importLessonStructure } from '../repository/structureImportRuntime/lessonStructureImportRepository.js'",
    );
    expect(workspace).toContain('createFirestoreLessonStructureImportDeps(db)');
    expect(workspace).not.toContain('planLessonMetadataAppend');
  });

  it('conserva il requestId fra i retry e lo azzera a dialog riaperto', () => {
    expect(workspace).toContain(
      "if (kind.kind === 'importLessonStructure') lessonStructureRequestIdRef.current = null;",
    );
    expect(handler.indexOf('lessonStructureRequestIdRef.current = null')).toBeGreaterThan(
      handler.indexOf('added = result.lessonCount'),
    );
  });

  it('aggiorna l’albero locale dal manifest, senza refetch', () => {
    expect(handler).toContain('result.manifest.lessons.map');
    expect(handler).toContain('sortLessons(');
    expect(handler).toContain('patchCardCounts(next)');
    expect(handler).toContain('lessonCount: (u.lessonCount ?? 0) + appended.length');
    expect(handler).not.toContain('listLessons(');
    expect(handler).not.toContain('listUdas(');
  });

  it('non seleziona automaticamente una lezione vuota', () => {
    expect(handler).not.toContain('selectLesson(');
    expect(handler).not.toContain("setSelection({ kind: 'lesson'");
  });

  it('un problema locale post-commit resta un successo con avviso', () => {
    expect(handler).toContain('refreshDeferred');
    expect(handler).toContain('verrà riallineata al prossimo caricamento');
  });
});

describe('mutua esclusione per UDA', () => {
  it('creazione, riordino ed eliminazione di lezioni rispettano il lease della UDA', () => {
    expect(editor).toContain(
      "import { assertNoActiveLessonAppendLease } from '../structureImportRuntime/lessonAppendLease.js'",
    );
    // Quattro punti: createLesson, reorderLesson, deleteLesson, deleteUda.
    expect(editor.match(/assertNoActiveLessonAppendLease\(/g) ?? []).toHaveLength(4);
  });

  it('anche l’eliminazione della UDA di destinazione è bloccata', () => {
    const deleteUda = editor.slice(editor.indexOf('export async function deleteUda'));
    expect(deleteUda.slice(0, 1500)).toContain('assertNoActiveLessonAppendLease');
  });

  it('il lease vive sulla UDA, non sull’import: altre UDA restano libere', () => {
    const lease = readFileSync(
      resolve(__dirname, '../../repository/structureImportRuntime/lessonAppendLease.ts'),
      'utf8',
    );
    expect(lease).toContain("export const LESSON_APPEND_LEASE_FIELD = 'lessonAppendLease'");
    expect(lease).toContain('/udas/${udaId}');
    // Un lease scaduto non blocca il docente a tempo indeterminato.
    expect(lease).toContain('lease.expiresAt > Date.now()');
  });
});

describe('regressione: i flussi esistenti non cambiano', () => {
  it('import ZIP, Importa UDA e Importa struttura UDA restano al loro posto', () => {
    expect(courseMenu).toContain('Importa ZIP');
    expect(courseMenu).toContain('Importa UDA');
    expect(courseMenu).toContain('Importa struttura UDA');
  });

  it('creazione, modifica ed eliminazione manuale della lezione restano nel menu UDA', () => {
    expect(udaMenu).toContain('Nuova lezione');
    expect(udaMenu).toContain('Modifica metadata');
    expect(udaMenu).toContain('Elimina UDA');
  });

  it('nessuna lettura aggiuntiva all’apertura del corso o della UDA', () => {
    for (const effect of workspace.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)) {
      expect(effect[1]!).not.toContain('importLessonStructure(');
      expect(effect[1]!).not.toContain('createFirestoreLessonStructureImportDeps');
    }
    expect(workspace.match(/importLessonStructure\(/g) ?? []).toHaveLength(1);
  });
});
