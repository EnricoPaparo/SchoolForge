import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * STRUCTURE-IMPORT-02A — cablaggio nel workspace del corso.
 *
 * `CourseWorkspace` è un componente grande e con molte dipendenze Firebase:
 * queste verifiche sono statiche sul sorgente, perché ciò che deve restare vero
 * è *dove* vive il comando e *che cosa* non è cambiato intorno — non il
 * rendering, già coperto dai test del dialog.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const workspace = readFileSync(resolve(__dirname, '../CourseWorkspace.tsx'), 'utf8');

describe('voce di menu', () => {
  it('vive nel menu Azioni del corso, subito dopo «Importa UDA»', () => {
    const menu = workspace.slice(
      workspace.indexOf('ariaLabel="Azioni corso"'),
      workspace.indexOf('Elimina corso'),
    );
    expect(menu).toContain('Importa struttura UDA');
    expect(menu.indexOf('Importa UDA\n')).toBeLessThan(menu.indexOf('Importa struttura UDA'));
  });

  it('usa un’icona del set del progetto e apre il dialog dedicato', () => {
    const entry = workspace.slice(
      workspace.indexOf("openDialog({ kind: 'importUdaStructure' })"),
      workspace.indexOf('Importa struttura UDA'),
    );
    expect(entry).toContain('IconLayers');
    expect(workspace).toMatch(/IconLayers,\n/);
  });

  it('è disabilitata su un corso senza import attivo', () => {
    const entry = workspace.slice(
      workspace.indexOf("onClick={() => openDialog({ kind: 'importUdaStructure' })}") - 200,
      workspace.indexOf("onClick={() => openDialog({ kind: 'importUdaStructure' })}"),
    );
    expect(entry).toContain('disabled={!card.hasImport}');
  });

  it('non compare nel menu Azioni della UDA: l’import delle UDA vive sul corso', () => {
    const udaMenu = workspace.slice(workspace.indexOf('ariaLabel="Azioni UDA"'));
    expect(udaMenu).not.toContain('Importa struttura UDA');
    // «Importa lezioni» invece ci vive: è STRUCTURE-IMPORT-02B, e agisce sulla
    // sola UDA da cui il menu è stato aperto.
    expect(udaMenu).toContain('Importa lezioni');
  });
});

describe('handler', () => {
  it('usa l’orchestratore e le deps Firestore dedicate, non una logica propria', () => {
    expect(workspace).toContain(
      "import { importUdaStructure } from '../repository/structureImportRuntime/udaStructureImportRepository.js'",
    );
    expect(workspace).toContain('createFirestoreUdaStructureImportDeps(db)');
    // Nessuna duplicazione del planner nella UI.
    expect(workspace).not.toContain('planUdaMetadataAppend');
  });

  it('conserva il requestId fra i retry e lo azzera solo a dialog riaperto', () => {
    expect(workspace).toContain('udaStructureRequestIdRef');
    expect(workspace).toContain(
      "if (kind.kind === 'importUdaStructure') udaStructureRequestIdRef.current = null;",
    );
    const handler = workspace.slice(
      workspace.indexOf('async function handleImportUdaStructure'),
      workspace.indexOf('function handleImportUda(files'),
    );
    expect(handler).toContain('crypto.randomUUID()');
    // Azzerato solo dopo un commit riuscito.
    expect(handler.indexOf('udaStructureRequestIdRef.current = null')).toBeGreaterThan(
      handler.indexOf('added = result.udaCount'),
    );
  });

  it('aggiorna l’albero locale dal manifest, senza refetch del corso', () => {
    const handler = workspace.slice(
      workspace.indexOf('async function handleImportUdaStructure'),
      workspace.indexOf('function handleImportUda(files'),
    );
    expect(handler).toContain('result.manifest.udas.map');
    expect(handler).toContain('sortUdas(');
    expect(handler).toContain('patchCardCounts(next)');
    // Nessuna rilettura completa dopo il commit.
    expect(handler).not.toContain('listUdas(');
    expect(handler).not.toContain('listLessons(');
  });

  it('dopo il commit non trasforma mai un problema locale in un errore', () => {
    const handler = workspace.slice(
      workspace.indexOf('async function handleImportUdaStructure'),
      workspace.indexOf('function handleImportUda(files'),
    );
    // Il ramo di fallimento dell'aggiornamento locale produce un avviso, non un errore.
    expect(handler).toContain('refreshDeferred');
    expect(handler).toContain('verrà riallineata al prossimo caricamento');
  });
});

describe('regressione: i flussi esistenti non cambiano', () => {
  it('«Importa ZIP» e «Importa UDA» restano invariati', () => {
    expect(workspace).toContain("openDialog({ kind: 'importCourse' })");
    expect(workspace).toContain("openDialog({ kind: 'importUda' })");
    expect(workspace).toContain(
      "import { importUda } from '../repository/importUda/importUdaRepository.js'",
    );
    expect(workspace).toContain('createFirestoreUdaImportDeps(db)');
  });

  it('creazione, modifica ed eliminazione manuale della UDA restano al loro posto', () => {
    for (const entry of ["kind: 'newUda'", "kind: 'deleteCourse'", 'enterOrganize']) {
      expect(workspace).toContain(entry);
    }
  });

  it('nessuna lettura aggiuntiva all’apertura del corso', () => {
    // Il nuovo percorso parte solo da un gesto esplicito del docente: non è
    // richiamato da nessun effetto di montaggio o di caricamento del corso.
    for (const effect of workspace.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[/g)) {
      expect(effect[1]!).not.toContain('importUdaStructure(');
      expect(effect[1]!).not.toContain('createFirestoreUdaStructureImportDeps');
    }
    // E l'unico punto di ingresso è il gestore del dialog.
    expect(workspace.match(/importUdaStructure\(/g) ?? []).toHaveLength(1);
  });
});
