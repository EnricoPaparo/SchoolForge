import { describe, expect, it } from 'vitest';
import { planLessonMetadataAppend } from '../planLessonMetadataAppend.js';
import { parseLessonStructureInput } from '../structureInputAdapter.js';

const BUG_REPORT_INPUT = `LEZIONE: Aprire il prompt dei comandi ed eseguire i primi comandi
Sottotitolo: Riga di comando
Difficoltà: base
Concetti chiave:
- riga di comando
Obiettivi:
- Descrivere le differenze tra interfaccia a riga di comando e interfaccia grafica.
- Eseguire da riga di comando i comandi per verificare la cartella corrente ed elencarne il contenuto.
`;

const KEY_CONCEPTS = ['riga di comando'];
const OBJECTIVES = [
  'Descrivere le differenze tra interfaccia a riga di comando e interfaccia grafica.',
  'Eseguire da riga di comando i comandi per verificare la cartella corrente ed elencarne il contenuto.',
];

describe('LESSON-METADATA-UI-01 — conservazione end-to-end pura degli elenchi', () => {
  it('mantiene concetti e obiettivi separati dalla porta byte-first al piano canonico', () => {
    const parsed = parseLessonStructureInput(new TextEncoder().encode(BUG_REPORT_INPUT));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value).toHaveLength(1);
    expect(parsed.value[0]!.concettiChiave).toEqual(KEY_CONCEPTS);
    expect(parsed.value[0]!.obiettivi).toEqual(OBJECTIVES);
    expect(parsed.value[0]!.obiettivi.every((value) => !value.startsWith('-'))).toBe(true);
    expect(parsed.value[0]!.obiettivi.every((value) => !value.includes(','))).toBe(true);

    const planned = planLessonMetadataAppend({
      ownerUid: 'owner-1',
      programId: 'program-1',
      importId: 'import-1',
      udaId: 'uda-01-sistemi-operativi',
      udaDir: 'uda-01-sistemi-operativi',
      lessons: parsed.value,
      existingLessons: [],
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;

    const lesson = planned.value.lessons[0]!;
    expect(lesson.metadata.concettiChiave).toEqual(KEY_CONCEPTS);
    expect(lesson.metadata.obiettivi).toEqual(OBJECTIVES);
    expect(lesson.doc.concettiChiave).toEqual(KEY_CONCEPTS);
    expect(lesson.doc.obiettivi).toEqual(OBJECTIVES);
    expect(lesson.publicLesson.concettiChiave).toEqual(KEY_CONCEPTS);
    expect(lesson.publicLesson.obiettivi).toEqual(OBJECTIVES);
    expect(lesson.content).toContain('obiettivi:\n');
    expect(lesson.content).toMatch(/^ {2}- Descrivere le differenze/m);
    expect(lesson.content).toMatch(/^ {2}- Eseguire da riga di comando/m);
  });
});
