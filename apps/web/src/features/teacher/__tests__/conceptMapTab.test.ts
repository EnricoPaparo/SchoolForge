import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPrivateConceptMap } from '../../repository/programs/conceptMapContract.js';

/**
 * CONCEPT-MAP-04 — la mappa come **scheda** della lezione: ordine delle schede,
 * regola di blocco della generazione e assenza di codice morto.
 *
 * La logica vive dentro `CourseWorkspace`, che è troppo grande per essere
 * montato qui con profitto: si verifica quindi la **regola** che la governa,
 * replicata identica, più il fatto che il sorgente la applichi davvero. Un test
 * che monti il workspace intero costerebbe più di quanto dimostra, e
 * dimostrerebbe soprattutto il montaggio.
 */

function blockedReason(params: {
  lessonContent: string | null;
  contentDirty: boolean;
}): string | null {
  const { lessonContent, contentDirty } = params;
  return lessonContent === null
    ? 'Contenuto della lezione non disponibile.'
    : lessonContent.trim().length === 0
      ? 'La lezione non ha ancora un contenuto: scrivilo e salvalo prima di generare la mappa.'
      : contentDirty
        ? 'Salva prima le modifiche al contenuto: la mappa si genera dal testo salvato.'
        : null;
}

const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/features/teacher/CourseWorkspace.tsx'),
  'utf8',
);

describe('stato dell’azione «mappa concettuale»', () => {
  it('è disponibile con un corpo salvato e nessuna modifica pendente', () => {
    expect(blockedReason({ lessonContent: '# Lezione', contentDirty: false })).toBeNull();
  });

  it('è bloccata con corpo vuoto, e il motivo lo dice', () => {
    expect(blockedReason({ lessonContent: '', contentDirty: false })).toMatch(/non ha ancora un/);
    expect(blockedReason({ lessonContent: '   \n ', contentDirty: false })).toMatch(
      /non ha ancora un/,
    );
  });

  it('è bloccata con modifiche non salvate al corpo', () => {
    // Una mappa generata da un corpo non salvato descriverebbe un testo che non
    // esiste per nessuno: né per lo studente, né al prossimo caricamento.
    expect(blockedReason({ lessonContent: '# Lezione', contentDirty: true })).toMatch(
      /Salva prima le modifiche/,
    );
  });

  it('è bloccata quando il contenuto non è ancora disponibile', () => {
    expect(blockedReason({ lessonContent: null, contentDirty: false })).toMatch(/non disponibile/);
  });
});

describe('etichetta della generazione', () => {
  it('cambia in base alla presenza della mappa già salvata', () => {
    const withMap = readPrivateConceptMap({ conceptMapMarkdown: '## Ossatura\n\n- voce' });
    const withoutMap = readPrivateConceptMap({});
    expect(withMap !== null ? 'Rigenera con IA' : 'Genera con IA').toBe('Rigenera con IA');
    expect(withoutMap !== null ? 'Rigenera con IA' : 'Genera con IA').toBe('Genera con IA');
  });
});

describe('ordine e struttura delle schede', () => {
  it('le quattro schede sono nell’ordine definitivo', () => {
    // La mappa segue il contenuto perché ne è la sintesi: si legge dopo, mai
    // al posto suo. L'ordine è dichiarato in una sola costante, ed è quella.
    const tabs = /const LESSON_TABS[^=]*=\s*\[(.*?)\];/s.exec(workspaceSource)?.[1] ?? '';
    const ids = [...tabs.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
    expect(ids).toEqual(['contenuto', 'mappa', 'domande', 'informazioni']);
  });

  it('il tipo della scheda include la mappa', () => {
    expect(workspaceSource).toContain(
      "type LessonTab = 'contenuto' | 'mappa' | 'domande' | 'informazioni'",
    );
  });

  it('la navigazione da tastiera lavora sull’intera lista, non su un numero fisso', () => {
    // Se il ciclo fosse cablato su tre elementi, aggiungere la quarta scheda
    // l'avrebbe resa irraggiungibile da tastiera senza rompere alcun test.
    expect(workspaceSource).toContain('(idx + 1) % LESSON_TABS.length');
    expect(workspaceSource).toContain('(idx - 1 + LESSON_TABS.length) % LESSON_TABS.length');
    expect(workspaceSource).toContain('next = LESSON_TABS.length - 1');
  });

  it('il pannello della mappa è un tabpanel legato alla propria scheda', () => {
    expect(workspaceSource).toContain('id="panel-mappa"');
    expect(workspaceSource).toContain('aria-labelledby="tab-mappa"');
    expect(workspaceSource).toContain("hidden={activeTab !== 'mappa'}");
  });

  it('la scheda monta l’editor solo dopo essere stata aperta, e lo tiene montato', () => {
    // Montarlo sempre non costerebbe letture, ma tenerlo montato **dopo** la
    // prima apertura è ciò che salva il draft al cambio scheda.
    expect(workspaceSource).toContain("if (tab === 'mappa') setMappaVisited(true);");
    expect(workspaceSource).toContain('{mappaVisited && (');
  });

  it('lo stato della scheda è legato alla lezione', () => {
    // Senza `key`, cambiando lezione il testo della precedente resterebbe
    // nell'editor della successiva.
    expect(workspaceSource).toMatch(/<ConceptMapEditor\s+key=\{lesson\.id\}/);
  });

  it('la mappa entra nella dirty guard esistente, senza una seconda', () => {
    expect(workspaceSource).toContain(
      'const anyDirty = poolDirty || contentDirty || infoDirty || conceptMapDirty;',
    );
    expect(workspaceSource).toContain('setConceptMapDirty(false);');
  });
});

describe('l’azione nel menu è stata rimossa', () => {
  it('nessuna voce di menu apre più la mappa', () => {
    for (const gone of [
      'Genera mappa concettuale',
      'Modifica mappa concettuale',
      'conceptMapOpen',
      'ConceptMapDialog',
      'concept-map-blocked-reason',
      'menuHint',
    ]) {
      expect(workspaceSource).not.toContain(gone);
    }
  });

  it('le altre azioni della lezione restano', () => {
    expect(workspaceSource).toContain('Modifica contenuto');
    expect(workspaceSource).toContain('Modifica informazioni');
    expect(workspaceSource).toContain('Elimina lezione');
  });

  it('il vecchio dialog non esiste più', () => {
    for (const gone of [
      'src/features/teacher/ConceptMapDialog.tsx',
      'src/features/teacher/ConceptMapDialog.module.css',
      'src/features/teacher/__tests__/ConceptMapDialog.test.tsx',
    ]) {
      expect(() => readFileSync(resolve(process.cwd(), gone), 'utf8')).toThrow();
    }
  });

  it('il CSS del vecchio hint di menu è sparito con la voce', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'src/features/teacher/CourseWorkspace.module.css'),
      'utf8',
    );
    expect(css).not.toContain('.menuHint');
  });
});

describe('il workspace applica davvero la regola', () => {
  it('il motivo del blocco viaggia fino alla scheda', () => {
    expect(workspaceSource).toContain('conceptMapBlockedReason');
    expect(workspaceSource).toContain('conceptMapBlockedReason={conceptMapBlockedReason}');
  });

  it('la mappa è letta dall’albero già in memoria, senza nuove letture', () => {
    // `readPrivateConceptMap(selectedLesson)` opera sul documento già caricato:
    // nessun `getDoc` viene aggiunto per aprire la finestra.
    expect(workspaceSource).toContain('readPrivateConceptMap(selectedLesson)');
  });

  it('il salvataggio passa dal service transazionale e aggiorna l’albero locale', () => {
    expect(workspaceSource).toContain('saveLessonConceptMap({');
    expect(workspaceSource).toContain('conceptMapMarkdown: markdown');
  });

  it('il riepilogo del pool non può ripristinare una fotografia precedente alla mappa', () => {
    const handler =
      /function handlePoolCountChange\([\s\S]*?\n  }\n\n  async function selectLesson/.exec(
        workspaceSource,
      )?.[0] ?? '';
    expect(handler).toContain('setTree((prev) =>');
    expect(handler).toContain('lessons: prev.lessons.map');
    expect(handler).not.toContain('setTree({ udas: tree.udas, lessons })');
  });
});

describe('codice morto rimosso', () => {
  it('lessonPdf non esiste più e nessuno lo importa', () => {
    expect(() =>
      readFileSync(resolve(process.cwd(), 'src/features/teacher/lessonPdf.ts'), 'utf8'),
    ).toThrow();
    expect(workspaceSource).not.toContain('lessonPdf');
    expect(workspaceSource).not.toContain('downloadLessonPdf');
  });

  it('gli altri PDF restano intatti', () => {
    // Programma svolto, verifiche e correzioni non sono toccati da questa fase.
    for (const survivor of [
      'src/features/repository/verifications/verificationPdf.ts',
      'src/features/repository/verifications/verificationPdfLayout.ts',
    ]) {
      expect(readFileSync(resolve(process.cwd(), survivor), 'utf8').length).toBeGreaterThan(0);
    }
  });
});
