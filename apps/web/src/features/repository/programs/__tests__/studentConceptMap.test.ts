import { describe, expect, it } from 'vitest';
import { readPublicConceptMap } from '../conceptMapContract.js';
import { MAX_CONCEPT_MAP_BYTES } from '../conceptMapContract.js';

/**
 * CONCEPT-MAP-03 — ciò che il portale studente riceve.
 *
 * La vista non decide nulla sulla visibilità: legge un campo già normalizzato.
 * Questi test difendono la normalizzazione al confine, che è l'unico punto in
 * cui l'invariante può essere applicato una volta per tutte.
 *
 * Il mapping reale vive in `loadStudentLessons`, che qui non viene eseguito
 * (richiederebbe Firestore): si verifica la funzione che quel mapping applica,
 * sugli stessi documenti grezzi che arriverebbero da una query.
 */

const MAP = '## Ossatura della lezione\n\n- densità\n';

/** Documento grezzo come arriva da `publicLessons`. */
function projection(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ownerUid: 'owner-1',
    programId: 'p1',
    importId: 'i1',
    udaDir: 'uda-01',
    path: 'uda-01/lezione-001.md',
    filename: 'lezione-001.md',
    contentPath: 'repository/owner-1/imports/i1/uda-01/lezione-001.md',
    content: '# Lezione',
    ...over,
  };
}

describe('mappa nella proiezione studente', () => {
  it('è presente quando la lezione è svolta e la mappa è valida', () => {
    expect(readPublicConceptMap(projection({ completed: true, conceptMapMarkdown: MAP }))).toBe(
      MAP,
    );
  });

  it('è assente quando la lezione non è svolta, anche se il documento la contiene', () => {
    // Non dovrebbe esistere (Rules + transazione lo impediscono), ma se
    // esistesse la vista non deve mostrarlo: la sezione non compare affatto.
    expect(
      readPublicConceptMap(projection({ completed: false, conceptMapMarkdown: MAP })),
    ).toBeNull();
    expect(readPublicConceptMap(projection({ conceptMapMarkdown: MAP }))).toBeNull();
  });

  it('è assente su una proiezione senza mappa', () => {
    expect(readPublicConceptMap(projection({ completed: true }))).toBeNull();
  });

  it('ignora fail-closed una mappa corrotta', () => {
    for (const corrupted of ['', '   ', 42, null, { markdown: MAP }, ['- voce']]) {
      expect(
        readPublicConceptMap(projection({ completed: true, conceptMapMarkdown: corrupted })),
      ).toBeNull();
    }
    expect(
      readPublicConceptMap(
        projection({
          completed: true,
          conceptMapMarkdown: 'x'.repeat(MAX_CONCEPT_MAP_BYTES + 1),
        }),
      ),
    ).toBeNull();
  });

  it('una proiezione legacy priva del campo resta valida e legge null', () => {
    expect(readPublicConceptMap(projection({ completed: true }))).toBeNull();
  });
});
