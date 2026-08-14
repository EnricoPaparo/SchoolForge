import { describe, expect, it } from 'vitest';
import {
  activationBlockers,
  assertNoBlockers,
  buildDifferentiationSnapshotParts,
  DifferentiationSnapshotError,
  type BuildDifferentiationSnapshotInput,
  type DifferentiationIndexEntry,
} from '../differentiationSnapshot.js';
import { buildActivationSummary } from '../activationSummary.js';
import type { VerificationQuestionRef } from '../../../../types/firestore.js';

/**
 * VDIF-04 — guardie G03→G16b sul preflight, tutte pure.
 *
 * Il mondo di prova: quattro domande nell'indice (`q1`..`q4`), le prime due
 * selezionate nella verifica, `q3` alternativa della stessa lezione di `q1`,
 * `q4` di un'altra lezione. Due etichette, due studenti etichettati e uno no.
 */

const OWNER = 'owner-uid';

function entry(
  id: string,
  over: Partial<DifferentiationIndexEntry> = {},
): DifferentiationIndexEntry {
  return {
    id,
    udaDir: 'uda-1',
    lessonFilename: 'lezione-1.md',
    poolStorageRef: 'pool/uda-1/lezione-1.pool.md',
    questionLocalId: id.toUpperCase(),
    tipo: 'aperta',
    difficolta: 2,
    maxPoints: 2,
    ...over,
  };
}

function ref(id: string, over: Partial<VerificationQuestionRef> = {}): VerificationQuestionRef {
  const base = entry(id);
  return {
    questionIndexEntryId: base.id,
    questionLocalId: base.questionLocalId,
    udaDir: base.udaDir,
    lessonFilename: base.lessonFilename,
    poolStorageRef: base.poolStorageRef,
    tipo: base.tipo,
    difficolta: base.difficolta,
    maxPoints: base.maxPoints,
    ...over,
  };
}

const QUESTION_INDEX = [
  entry('q1'),
  entry('q2'),
  entry('q3'),
  entry('q4', { lessonFilename: 'lezione-2.md', questionLocalId: 'Q4' }),
];

function input(
  over: Partial<BuildDifferentiationSnapshotInput> = {},
): BuildDifferentiationSnapshotInput {
  return {
    config: {
      version: 1,
      questions: [
        {
          baseQuestionIndexEntryId: 'q1',
          choices: { L1: { kind: 'alternative', questionIndexEntryId: 'q3' } },
        },
      ],
    },
    questionRefs: [ref('q1'), ref('q2')],
    equivalentGroups: [],
    questionIndex: QUESTION_INDEX,
    labels: [
      { labelId: 'L1', name: 'Percorso A' },
      { labelId: 'L2', name: 'Percorso B' },
    ],
    assignments: [
      { studentUid: 's1', labelId: 'L1' },
      { studentUid: 's2', labelId: 'L2' },
    ],
    students: [
      { uid: 's1', ownerUid: OWNER },
      { uid: 's2', ownerUid: OWNER },
      { uid: 's3', ownerUid: OWNER },
    ],
    ownerUid: OWNER,
    ...over,
  };
}

function guardOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof DifferentiationSnapshotError) return error.guard;
    throw error;
  }
  throw new Error('Nessuna guardia ha bloccato: il caso non è coperto.');
}

describe('buildDifferentiationSnapshotParts — snapshot congelato', () => {
  it('converte gli entryId in order e appende le alternative in coda', () => {
    const parts = buildDifferentiationSnapshotParts(input());
    // q1 → 0, q2 → 1; l'alternativa q3 riceve l'order 2.
    expect(parts.snapshot.questions).toEqual([
      { baseOrder: 0, choices: { L1: { kind: 'alternative', order: 2 } } },
    ]);
    expect(parts.snapshot.differentiatedAlternativeOrders).toEqual([2]);
    expect(parts.alternativeRefs.map((item) => item.questionIndexEntryId)).toEqual(['q3']);
  });

  it('congela il nome dell’etichetta al momento dell’attivazione', () => {
    const parts = buildDifferentiationSnapshotParts(input());
    expect(parts.snapshot.labels).toEqual([{ labelId: 'L1', labelName: 'Percorso A' }]);
  });

  it('congela solo le etichette realmente referenziate', () => {
    const parts = buildDifferentiationSnapshotParts(input());
    expect(parts.snapshot.labels.map((label) => label.labelId)).not.toContain('L2');
  });

  it('la stessa alternativa usata da due etichette occupa un solo order', () => {
    const parts = buildDifferentiationSnapshotParts(
      input({
        config: {
          version: 1,
          questions: [
            {
              baseQuestionIndexEntryId: 'q1',
              choices: {
                L1: { kind: 'alternative', questionIndexEntryId: 'q3' },
                L2: { kind: 'alternative', questionIndexEntryId: 'q3' },
              },
            },
          ],
        },
      }),
    );
    expect(parts.alternativeRefs).toHaveLength(1);
    expect(parts.snapshot.questions[0]!.choices).toEqual({
      L1: { kind: 'alternative', order: 2 },
      L2: { kind: 'alternative', order: 2 },
    });
  });
});

describe('guardie G03→G16b', () => {
  it('G03 — versione non riconosciuta', () => {
    expect(
      guardOf(() =>
        buildDifferentiationSnapshotParts(
          input({ config: { version: 2, questions: [] } as never }),
        ),
      ),
    ).toBe('G03');
  });

  it('G04 — etichetta referenziata inesistente', () => {
    expect(guardOf(() => buildDifferentiationSnapshotParts(input({ labels: [] })))).toBe('G04');
  });

  it('G05 — etichetta di un altro owner: stesso messaggio di G04, nessuna conferma di esistenza', () => {
    // Le etichette arrivano già filtrate sull'owner: una di altro docente non
    // compare in lista, quindi è indistinguibile da una inesistente.
    let message = '';
    try {
      buildDifferentiationSnapshotParts(input({ labels: [{ labelId: 'L2', name: 'Percorso B' }] }));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/non esiste più/);
    expect(message).not.toMatch(/altro docente/);
  });

  it('G06 — assegnazione verso uno studente inesistente: ignorata, non bloccante', () => {
    const parts = buildDifferentiationSnapshotParts(
      input({ assignments: [{ studentUid: 'fantasma', labelId: 'L1' }] }),
    );
    expect(parts.ignoredAssignments).toEqual(['fantasma']);
    expect(parts.labelAssignments.byStudentUid).toEqual({});
  });

  it('G07 — assegnazione verso uno studente di un altro docente: blocca', () => {
    expect(
      guardOf(() =>
        buildDifferentiationSnapshotParts(
          input({ students: [{ uid: 's1', ownerUid: 'altro-owner' }] }),
        ),
      ),
    ).toBe('G07');
  });

  it('G08 — base non più selezionata nella verifica', () => {
    expect(
      guardOf(() => buildDifferentiationSnapshotParts(input({ questionRefs: [ref('q2')] }))),
    ).toBe('G08');
  });

  it('G09/G10 — alternativa assente dall’indice corrente (rimossa dal pool)', () => {
    expect(
      guardOf(() =>
        buildDifferentiationSnapshotParts(
          input({ questionIndex: QUESTION_INDEX.filter((item) => item.id !== 'q3') }),
        ),
      ),
    ).toBe('G09');
  });

  it('G09 — il messaggio nomina la domanda base e l’etichetta, mai un id nudo', () => {
    let message = '';
    try {
      buildDifferentiationSnapshotParts(
        input({ questionIndex: QUESTION_INDEX.filter((item) => item.id !== 'q3') }),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('Percorso A');
    expect(message).toContain('Q1');
  });

  it('G11 — alternativa di un’altra lezione', () => {
    expect(
      guardOf(() =>
        buildDifferentiationSnapshotParts(
          input({
            config: {
              version: 1,
              questions: [
                {
                  baseQuestionIndexEntryId: 'q1',
                  choices: { L1: { kind: 'alternative', questionIndexEntryId: 'q4' } },
                },
              ],
            },
          }),
        ),
      ),
    ).toBe('G11');
  });

  it('G12 — alternativa già selezionata come domanda della verifica', () => {
    expect(
      guardOf(() =>
        buildDifferentiationSnapshotParts(
          input({
            config: {
              version: 1,
              questions: [
                {
                  baseQuestionIndexEntryId: 'q1',
                  choices: { L1: { kind: 'alternative', questionIndexEntryId: 'q2' } },
                },
              ],
            },
          }),
        ),
      ),
    ).toBe('G12');
  });

  it('G14 — base differenziata dentro un gruppo VEX', () => {
    expect(
      guardOf(() =>
        buildDifferentiationSnapshotParts(
          input({ equivalentGroups: [{ id: 'g1', questionIndexEntryIds: ['q1', 'q2'] }] }),
        ),
      ),
    ).toBe('G14');
  });

  it('G14 — un’alternativa dentro un gruppo VEX è irraggiungibile: G12 la intercetta prima', () => {
    // Un membro di gruppo è per contratto una domanda **selezionata**, e una
    // domanda selezionata non può essere un'alternativa: la violazione più
    // esterna è G12, con il messaggio giusto. Il test lo fissa perché nessuno
    // vada a cercare un ramo G14 che non può esistere.
    expect(
      guardOf(() =>
        buildDifferentiationSnapshotParts(
          input({
            questionRefs: [ref('q1'), ref('q2'), ref('q3')],
            equivalentGroups: [{ id: 'g1', questionIndexEntryIds: ['q2', 'q3'] }],
          }),
        ),
      ),
    ).toBe('G12');
  });

  it('G14 — il messaggio parla di gruppi equivalenti solo quando il conflitto è davvero VEX', () => {
    let message = '';
    try {
      buildDifferentiationSnapshotParts(input({ questionRefs: [ref('q2')] }));
    } catch (error) {
      message = (error as Error).message;
    }
    // Base non più selezionata: il docente non deve leggere di gruppi VEX.
    expect(message).not.toMatch(/gruppo equivalente/i);
  });
});

describe('blocker per percorso: G13, G15, G16', () => {
  it('G13 — due sostituzioni verso la stessa alternativa duplicherebbero una domanda', () => {
    // Stato che il parser di bozza rifiuta già, ma che una scheda vecchia o una
    // manomissione possono aver persistito: qui deve **bloccare**, non passare.
    const parts = buildDifferentiationSnapshotParts(
      input({
        config: {
          version: 1,
          questions: [
            {
              baseQuestionIndexEntryId: 'q1',
              choices: { L1: { kind: 'alternative', questionIndexEntryId: 'q3' } },
            },
            {
              baseQuestionIndexEntryId: 'q2',
              choices: { L1: { kind: 'alternative', questionIndexEntryId: 'q3' } },
            },
          ],
        },
      }),
    );
    expect(parts.perLabel[0]!.blocker).toMatch(/due volte la stessa domanda/);
    expect(() => assertNoBlockers(parts)).toThrow(DifferentiationSnapshotError);
  });

  it('G15 — un’etichetta senza domande produce un blocker leggibile, non un’eccezione', () => {
    const parts = buildDifferentiationSnapshotParts(
      input({
        questionRefs: [ref('q1')],
        config: {
          version: 1,
          questions: [{ baseQuestionIndexEntryId: 'q1', choices: { L1: { kind: 'none' } } }],
        },
      }),
    );
    expect(parts.perLabel[0]!.blocker).toMatch(/Percorso A: non riceverebbe alcuna domanda/);
    expect(activationBlockers(parts)).toHaveLength(1);
    expect(() => assertNoBlockers(parts)).toThrow(DifferentiationSnapshotError);
  });

  it('G15 — il percorso base senza domande blocca come un’etichetta', () => {
    const parts = buildDifferentiationSnapshotParts(
      input({
        questionRefs: [ref('q1')],
        equivalentGroups: [],
        config: {
          version: 1,
          questions: [{ baseQuestionIndexEntryId: 'q1', choices: { L1: { kind: 'none' } } }],
        },
      }),
    );
    // La base conserva q1: è l'etichetta a restare vuota, non il percorso base.
    expect(parts.base.blocker).toBeNull();
    expect(parts.base.questionCount).toBe(1);
  });

  it('G16 — punteggio massimo per etichetta legittimamente diverso da quello base', () => {
    const parts = buildDifferentiationSnapshotParts(
      input({
        questionRefs: [ref('q1'), ref('q2')],
        config: {
          version: 1,
          questions: [{ baseQuestionIndexEntryId: 'q1', choices: { L1: { kind: 'none' } } }],
        },
      }),
    );
    expect(parts.base.maxPoints).toBe(4);
    expect(parts.perLabel[0]!.maxPoints).toBe(2);
    expect(parts.perLabel[0]!.blocker).toBeNull();
  });

  it('un’alternativa con punteggio diverso cambia il massimo dell’etichetta, e va bene', () => {
    const parts = buildDifferentiationSnapshotParts(
      input({
        questionIndex: [
          entry('q1'),
          entry('q2'),
          entry('q3', { difficolta: 5, maxPoints: 5 }),
          entry('q4', { lessonFilename: 'lezione-2.md' }),
        ],
      }),
    );
    expect(parts.base.maxPoints).toBe(4);
    expect(parts.perLabel[0]!.maxPoints).toBe(7);
  });
});

describe('VEX e differenziazione insieme', () => {
  const mixed = () =>
    buildDifferentiationSnapshotParts(
      input({
        // q1 comune differenziata, q2 + q5 gruppo VEX.
        questionRefs: [ref('q1'), ref('q2'), ref('q5')],
        questionIndex: [...QUESTION_INDEX, entry('q5')],
        equivalentGroups: [{ id: 'g1', questionIndexEntryIds: ['q2', 'q5'] }],
      }),
    );

  it('il gruppo contribuisce con una sola domanda a ogni percorso', () => {
    const parts = mixed();
    // Base: q1 + un membro del gruppo = 2.
    expect(parts.base.questionCount).toBe(2);
    // L1: alternativa di q1 + un membro del gruppo = 2.
    expect(parts.perLabel[0]!.questionCount).toBe(2);
  });

  it('i membri del gruppo non compaiono fra le comuni risolte', () => {
    const parts = mixed();
    // q2 → order 1, q5 → order 2: nessuno dei due è comune.
    expect(parts.base.commonOrders).toEqual([0]);
  });
});

describe('riepilogo derivato', () => {
  it('conta studenti base, differenziati e senza etichetta', () => {
    const parts = buildDifferentiationSnapshotParts(input());
    const summary = buildActivationSummary(parts, [{ uid: 's1' }, { uid: 's2' }, { uid: 's3' }]);
    // Solo L1 è coinvolta: s2 (L2) riceve la base come s3.
    expect(summary.differentiatedStudents).toBe(1);
    expect(summary.unlabelledStudents).toBe(2);
    expect(summary.baseStudents).toBe(2);
    expect(summary.labelCount).toBe(1);
    expect(summary.substitutions).toBe(1);
    expect(summary.omissions).toBe(0);
  });

  it('la prima riga è «Nessuna etichetta», poi una riga per etichetta', () => {
    const parts = buildDifferentiationSnapshotParts(input());
    const summary = buildActivationSummary(parts, [{ uid: 's1' }]);
    expect(summary.rows[0]!.labelId).toBeNull();
    expect(summary.rows[0]!.labelName).toBe('Nessuna etichetta');
    expect(summary.rows[1]!.labelName).toBe('Percorso A');
  });

  it('non inventa nomi: mostra solo quelli congelati', () => {
    const parts = buildDifferentiationSnapshotParts(input());
    const summary = buildActivationSummary(parts, [{ uid: 's1' }]);
    const names = summary.rows.map((row) => row.labelName);
    expect(names).toEqual(['Nessuna etichetta', 'Percorso A']);
  });
});
