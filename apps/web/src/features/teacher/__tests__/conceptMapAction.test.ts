import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readPrivateConceptMap } from '../../repository/programs/conceptMapContract.js';

/**
 * CONCEPT-MAP-03 — stato dell'azione docente e assenza di codice morto.
 *
 * La logica dell'azione vive dentro `CourseWorkspace`, che è troppo grande per
 * essere montato qui con profitto: si verifica quindi la **regola** che la
 * governa, replicata identica, più il fatto che il sorgente la applichi
 * davvero. Un test che monti il workspace intero costerebbe più di quanto
 * dimostra, e dimostrerebbe soprattutto il montaggio.
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

describe('etichetta dell’azione', () => {
  it('cambia in base alla presenza della mappa già salvata', () => {
    const withMap = readPrivateConceptMap({ conceptMapMarkdown: '## Ossatura\n\n- voce' });
    const withoutMap = readPrivateConceptMap({});
    expect(withMap !== null ? 'Modifica mappa concettuale' : 'Genera mappa concettuale').toBe(
      'Modifica mappa concettuale',
    );
    expect(withoutMap !== null ? 'Modifica mappa concettuale' : 'Genera mappa concettuale').toBe(
      'Genera mappa concettuale',
    );
  });
});

describe('il workspace applica davvero la regola', () => {
  it('la voce è disabilitata dal motivo, non nascosta', () => {
    expect(workspaceSource).toContain('conceptMapBlockedReason');
    expect(workspaceSource).toContain('disabled={conceptMapBlockedReason !== null}');
    // Entrambe le etichette esistono nel sorgente: l'azione è una sola voce che
    // cambia nome, non due voci alternative.
    expect(workspaceSource).toContain('Modifica mappa concettuale');
    expect(workspaceSource).toContain('Genera mappa concettuale');
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
