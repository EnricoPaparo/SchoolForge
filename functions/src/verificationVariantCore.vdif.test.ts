import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  isValidResolvedAssignment,
  parseResolvableSnapshot,
  resolveDifferentiatedOrders,
  sanitizeResolvedQuestions,
  VexAssignmentError,
  type ResolvableSnapshot,
  type VdifSnapshot,
} from './verificationVariantCore.js';

/**
 * VDIF-04 — l'unica implementazione autorevole dell'algoritmo di risoluzione.
 *
 * La prima suite legge lo **stesso fixture** della web app: i passi 1–3 esistono
 * in due runtime (nessun package condiviso fra `apps/web` e `functions`), e
 * questo file è ciò che impedisce alle due implementazioni di divergere in
 * silenzio.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(
  __dirname,
  '../../apps/web/src/features/repository/verifications/__tests__/fixtures/differentiationConformance.json',
);

type Case = {
  name: string;
  commonQuestionOrders: number[];
  differentiation: VdifSnapshot;
  labelId: string | null;
  expectedCommonOrders: number[];
};
type ErrorCase = Omit<Case, 'expectedCommonOrders'>;

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  cases: Case[];
  errorCases: ErrorCase[];
};

/** Snapshot minimo che isola i passi 1–3: nessun gruppo VEX, RNG mai chiamato. */
function deterministicSnapshot(entry: Case | ErrorCase): ResolvableSnapshot {
  return {
    questions: [],
    commonQuestionOrders: entry.commonQuestionOrders,
    equivalentGroups: [],
    differentiation: entry.differentiation,
    labelAssignments:
      entry.labelId === null
        ? { version: 1, byStudentUid: {} }
        : { version: 1, byStudentUid: { 'student-1': entry.labelId } },
  };
}

const NEVER_CALLED = () => {
  throw new Error('RNG chiamato in un caso senza gruppi equivalenti.');
};

describe('resolveDifferentiatedOrders — vettori di conformità condivisi con la web app', () => {
  it('il fixture non è vuoto (il test non è vacuo)', () => {
    expect(fixture.cases.length).toBeGreaterThan(5);
    expect(fixture.errorCases.length).toBeGreaterThan(0);
  });

  it.each(fixture.cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    if (entry.expectedCommonOrders.length === 0) {
      // Insieme vuoto: i passi 1–3 lo producono, ed è il passo 5 a rifiutarlo.
      expect(() =>
        resolveDifferentiatedOrders(deterministicSnapshot(entry), 'student-1', NEVER_CALLED),
      ).toThrow(VexAssignmentError);
      return;
    }
    expect(
      resolveDifferentiatedOrders(deterministicSnapshot(entry), 'student-1', NEVER_CALLED),
    ).toEqual(entry.expectedCommonOrders);
  });

  it.each(fixture.errorCases.map((entry) => [entry.name, entry] as const))(
    'fail-closed: %s',
    (_name, entry) => {
      expect(() =>
        resolveDifferentiatedOrders(deterministicSnapshot(entry), 'student-1', NEVER_CALLED),
      ).toThrow(VexAssignmentError);
    },
  );
});

// ── Snapshot realistici ────────────────────────────────────────────────────────

function question(order: number, over: Record<string, unknown> = {}) {
  return {
    order,
    tipo: 'aperta' as const,
    maxPoints: 2,
    difficolta: 2,
    testo: `Domanda ${order}`,
    ...over,
  };
}

/** Q0 comune, Q1 comune differenziata, Q2/Q3 gruppo VEX, Q4 alternativa di Q1. */
function mixedRaw(over: Record<string, unknown> = {}) {
  return {
    distributionMode: 'equivalent_variants',
    questions: [question(0), question(1), question(2), question(3), question(4)],
    commonQuestionOrders: [0, 1],
    equivalentGroups: [{ id: 'g1', alternativeOrders: [2, 3] }],
    differentiation: {
      version: 1,
      questions: [{ baseOrder: 1, choices: { L1: { kind: 'alternative', order: 4 } } }],
      labels: [{ labelId: 'L1', labelName: 'Percorso A' }],
      differentiatedAlternativeOrders: [4],
    },
    labelAssignments: { version: 1, byStudentUid: { 'stud-1': 'L1' } },
    ...over,
  };
}

/** Solo differenziazione: nessun gruppo, `same_questions`. */
function diffOnlyRaw(over: Record<string, unknown> = {}) {
  return {
    distributionMode: 'same_questions',
    questions: [question(0), question(1), question(2)],
    commonQuestionOrders: [0, 1],
    equivalentGroups: [],
    differentiation: {
      version: 1,
      questions: [{ baseOrder: 1, choices: { L1: { kind: 'alternative', order: 2 } } }],
      labels: [{ labelId: 'L1', labelName: 'Percorso A' }],
      differentiatedAlternativeOrders: [2],
    },
    labelAssignments: { version: 1, byStudentUid: { 'stud-1': 'L1' } },
    ...over,
  };
}

describe('parseResolvableSnapshot — i tre casi reali', () => {
  it('accetta VEX senza differenziazione', () => {
    const snapshot = parseResolvableSnapshot({
      distributionMode: 'equivalent_variants',
      questions: [question(0), question(1), question(2)],
      commonQuestionOrders: [0],
      equivalentGroups: [{ id: 'g1', alternativeOrders: [1, 2] }],
    });
    expect(snapshot.differentiation).toBeNull();
    expect(snapshot.labelAssignments).toBeNull();
  });

  it('accetta differenziazione senza VEX', () => {
    const snapshot = parseResolvableSnapshot(diffOnlyRaw());
    expect(snapshot.equivalentGroups).toEqual([]);
    expect(snapshot.differentiation?.labels).toEqual([{ labelId: 'L1', labelName: 'Percorso A' }]);
  });

  it('accetta VEX e differenziazione insieme', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    expect(snapshot.equivalentGroups).toHaveLength(1);
    expect(snapshot.differentiation).not.toBeNull();
  });

  it('rifiuta una verifica che non richiede assegnazione dal server', () => {
    expect(() =>
      parseResolvableSnapshot({
        distributionMode: 'same_questions',
        questions: [question(0)],
        commonQuestionOrders: [0],
      }),
    ).toThrow(/non richiede/);
  });

  it.each([
    ['versione diversa da 1', { version: 2 }],
    ['chiave extra', { colore: 'rosso' }],
    ['labels vuoto', { labels: [] }],
  ])('T40 — fail-closed sul blocco differenziato: %s', (_name, patch) => {
    const raw = diffOnlyRaw();
    raw.differentiation = { ...raw.differentiation, ...(patch as object) } as never;
    expect(() => parseResolvableSnapshot(raw)).toThrow(VexAssignmentError);
  });

  it('T40 — rifiuta una scelta che referenzia un’etichetta non dichiarata in labels[]', () => {
    const raw = diffOnlyRaw();
    raw.differentiation.questions[0]!.choices = {
      L9: { kind: 'alternative', order: 2 },
    } as never;
    expect(() => parseResolvableSnapshot(raw)).toThrow(/non dichiarata/);
  });

  it('rifiuta un’alternativa non dichiarata in differentiatedAlternativeOrders', () => {
    const raw = diffOnlyRaw();
    raw.differentiation.differentiatedAlternativeOrders = [] as never;
    expect(() => parseResolvableSnapshot(raw)).toThrow(VexAssignmentError);
  });

  it('rifiuta una base che non è fra le comuni', () => {
    const raw = diffOnlyRaw();
    raw.differentiation.questions[0]!.baseOrder = 2;
    expect(() => parseResolvableSnapshot(raw)).toThrow(VexAssignmentError);
  });

  it('rifiuta una copertura incompleta: una domanda né comune, né di gruppo, né alternativa', () => {
    const raw = diffOnlyRaw();
    raw.questions = [...raw.questions, question(9)];
    expect(() => parseResolvableSnapshot(raw)).toThrow(/Copertura/);
  });
});

describe('resolveDifferentiatedOrders — VEX e differenziazione su insiemi disgiunti', () => {
  it('studente etichettato: alternativa differenziata + un membro del gruppo', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    expect(resolveDifferentiatedOrders(snapshot, 'stud-1', () => 0)).toEqual([0, 2, 4]);
    expect(resolveDifferentiatedOrders(snapshot, 'stud-1', () => 1)).toEqual([0, 3, 4]);
  });

  it('studente senza etichetta: base + un membro del gruppo', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    expect(resolveDifferentiatedOrders(snapshot, 'stud-senza', () => 0)).toEqual([0, 1, 2]);
  });

  it('la differenziazione non tocca i gruppi e i gruppi non toccano le comuni', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    for (let index = 0; index < 2; index++) {
      const orders = resolveDifferentiatedOrders(snapshot, 'stud-1', () => index);
      // Esattamente una domanda del gruppo, sempre.
      expect(orders.filter((order) => order === 2 || order === 3)).toHaveLength(1);
      // La base sostituita non compare mai.
      expect(orders).not.toContain(1);
    }
  });

  it('VEX senza differenziazione resta identico a prima', () => {
    const snapshot = parseResolvableSnapshot({
      distributionMode: 'equivalent_variants',
      questions: [question(0), question(1), question(2)],
      commonQuestionOrders: [0],
      equivalentGroups: [{ id: 'g1', alternativeOrders: [1, 2] }],
    });
    expect(resolveDifferentiatedOrders(snapshot, 'chiunque', () => 1)).toEqual([0, 2]);
  });

  it('un percorso che resta senza domande è un errore, mai un insieme vuoto servito', () => {
    const raw = diffOnlyRaw();
    raw.commonQuestionOrders = [1];
    raw.questions = [question(1), question(2)];
    raw.differentiation.questions = [{ baseOrder: 1, choices: { L1: { kind: 'none' } } }] as never;
    raw.differentiation.differentiatedAlternativeOrders = [2] as never;
    const snapshot = parseResolvableSnapshot(raw);
    expect(() => resolveDifferentiatedOrders(snapshot, 'stud-1', () => 0)).toThrow(
      /non assegna alcuna domanda/,
    );
  });

  it('un RNG fuori range è un errore, non un ripiego sul primo elemento', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    expect(() => resolveDifferentiatedOrders(snapshot, 'stud-1', () => 5)).toThrow(/fuori range/);
  });
});

describe('isValidResolvedAssignment — replay e stato incoerente', () => {
  it('accetta un’assegnazione coerente con l’etichetta congelata', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    expect(isValidResolvedAssignment(snapshot, 'stud-1', [0, 2, 4])).toBe(true);
    expect(isValidResolvedAssignment(snapshot, 'stud-1', [0, 3, 4])).toBe(true);
  });

  it('rifiuta l’assegnazione di un’altra etichetta', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    // [0, 1, 2] è ciò che riceve chi non ha etichetta: per `stud-1` è incoerente.
    expect(isValidResolvedAssignment(snapshot, 'stud-1', [0, 1, 2])).toBe(false);
  });

  it('rifiuta due alternative dello stesso gruppo, un order estraneo e un duplicato', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    expect(isValidResolvedAssignment(snapshot, 'stud-1', [0, 2, 3, 4])).toBe(false);
    expect(isValidResolvedAssignment(snapshot, 'stud-1', [0, 2, 4, 99])).toBe(false);
    expect(isValidResolvedAssignment(snapshot, 'stud-1', [0, 2, 4, 4])).toBe(false);
  });

  it('rifiuta un’assegnazione che omette una comune non omessa dalla configurazione', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    expect(isValidResolvedAssignment(snapshot, 'stud-1', [2, 4])).toBe(false);
  });
});

describe('sanitizeResolvedQuestions — mai alternative non assegnate, mai soluzioni', () => {
  it('restituisce solo gli order assegnati, ordinati, senza soluzione', () => {
    const raw = mixedRaw();
    raw.questions = raw.questions.map((q) => ({ ...q, soluzione: 'segreto' })) as never;
    const snapshot = parseResolvableSnapshot(raw);
    const questions = sanitizeResolvedQuestions(snapshot, [0, 2, 4]);
    expect(questions.map((q) => q.order)).toEqual([0, 2, 4]);
    for (const q of questions) expect('soluzione' in q).toBe(false);
    expect(JSON.stringify(questions)).not.toContain('segreto');
  });

  it('non espone mai l’alternativa non assegnata di un altro percorso', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    const questions = sanitizeResolvedQuestions(snapshot, [0, 1, 2]);
    expect(questions.map((q) => q.order)).not.toContain(4);
  });

  it('la risposta non contiene alcun termine vietato dal perimetro privacy', () => {
    const snapshot = parseResolvableSnapshot(mixedRaw());
    const serialized = JSON.stringify(sanitizeResolvedQuestions(snapshot, [0, 2, 4]));
    for (const forbidden of [
      'labelId',
      'labelName',
      'labels',
      'differentiation',
      'differentiated',
      'Percorso A',
      'nameKey',
      'draftUsageCount',
      'assignedCount',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
