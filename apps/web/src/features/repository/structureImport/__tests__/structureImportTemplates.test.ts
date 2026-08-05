import { describe, expect, it } from 'vitest';
import {
  LESSON_METADATA_TEMPLATE,
  LESSON_TEMPLATE_FILENAME,
  STRUCTURE_IMPORT_TEMPLATES,
  UDA_METADATA_TEMPLATE,
  UDA_TEMPLATE_FILENAME,
} from '../structureImportTemplates.js';
import { validateUdaMetadataFile } from '../validateUdaMetadataFile.js';
import { validateLessonMetadataFile } from '../validateLessonMetadataFile.js';
import { planUdaMetadataAppend } from '../planUdaMetadataAppend.js';
import { planLessonMetadataAppend } from '../planLessonMetadataAppend.js';
import { utf8ByteLength, STRUCTURE_IMPORT_LIMITS } from '../limits.js';

/** I modelli sono testi costanti: il percorso reale li riceverà come byte. */
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

/**
 * STRUCTURE-IMPORT-01 — i due modelli canonici. Il round-trip è il punto: un
 * modello che il validatore rifiuterebbe insegnerebbe un formato sbagliato al
 * docente, e nessuno se ne accorgerebbe finché non prova a importarlo.
 */

describe('round-trip: i modelli sono accettati dai parser reali', () => {
  it('il modello UDA è valido e normalizza come atteso', () => {
    const result = validateUdaMetadataFile(utf8(UDA_METADATA_TEMPLATE), {
      filename: UDA_TEMPLATE_FILENAME,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.titolo).toBe('Introduzione alle reti');
    expect(result.value[0]!.descrizione).toBe('Fondamenti della comunicazione tra dispositivi.');
    expect(result.value[0]!.competenze).toHaveLength(2);
    expect(result.value[1]!.titolo).toBe('Il livello di trasporto');
  });

  it('il modello lezioni è valido e normalizza come atteso', () => {
    const result = validateLessonMetadataFile(utf8(LESSON_METADATA_TEMPLATE), {
      filename: LESSON_TEMPLATE_FILENAME,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    expect(result.value[0]!.titolo).toBe("Che cos'è una rete");
    expect(result.value[0]!.difficolta).toBe('introduttiva');
    expect(result.value[1]!.concettiChiave).toEqual([
      'indirizzo IP',
      'pacchetto',
      'router',
      'instradamento',
    ]);
  });

  it('ogni modello attraversa anche il planner senza errori', () => {
    const udas = validateUdaMetadataFile(utf8(UDA_METADATA_TEMPLATE));
    expect(udas.ok).toBe(true);
    if (!udas.ok) return;
    const udaPlan = planUdaMetadataAppend({
      ownerUid: 'owner-1',
      programId: 'prog-1',
      importId: 'imp-1',
      udas: udas.value,
      existingUdas: [],
    });
    expect(udaPlan.ok).toBe(true);
    if (udaPlan.ok) {
      expect(udaPlan.value.udas.map((u) => u.dir)).toEqual([
        'uda-01-introduzione-alle-reti',
        'uda-02-il-livello-di-trasporto',
      ]);
    }

    const lessons = validateLessonMetadataFile(utf8(LESSON_METADATA_TEMPLATE));
    expect(lessons.ok).toBe(true);
    if (!lessons.ok) return;
    const lessonPlan = planLessonMetadataAppend({
      ownerUid: 'owner-1',
      programId: 'prog-1',
      importId: 'imp-1',
      udaId: 'uda-01-reti',
      udaDir: 'uda-01-reti',
      lessons: lessons.value,
      existingLessons: [],
    });
    expect(lessonPlan.ok).toBe(true);
    if (lessonPlan.ok) {
      expect(lessonPlan.value.lessons.every((l) => l.doc.poolStatus === 'absent')).toBe(true);
    }
  });

  it('il modello UDA non è accettato come file lezioni, e viceversa', () => {
    expect(validateLessonMetadataFile(utf8(UDA_METADATA_TEMPLATE)).ok).toBe(false);
    expect(validateUdaMetadataFile(utf8(LESSON_METADATA_TEMPLATE)).ok).toBe(false);
  });
});

describe('forma dei modelli', () => {
  it('usano gli schemi definitivi', () => {
    expect(UDA_METADATA_TEMPLATE).toContain('schema: schoolforge-uda-metadata/v1');
    expect(LESSON_METADATA_TEMPLATE).toContain('schema: schoolforge-lesson-metadata/v1');
  });

  it('non contengono id tecnici, corpo o pool', () => {
    for (const template of [UDA_METADATA_TEMPLATE, LESSON_METADATA_TEMPLATE]) {
      for (const forbidden of [
        'body:',
        'content:',
        'id:',
        'path:',
        'filename:',
        'order:',
        'pool',
        'storageRef',
      ]) {
        expect(template).not.toContain(forbidden);
      }
    }
  });

  it('terminano in modo deterministico con un solo a capo finale', () => {
    for (const template of [UDA_METADATA_TEMPLATE, LESSON_METADATA_TEMPLATE]) {
      expect(template.endsWith('\n')).toBe(true);
      expect(template.endsWith('\n\n')).toBe(false);
    }
  });

  it('restano ampiamente entro il limite di dimensione', () => {
    for (const { content } of STRUCTURE_IMPORT_TEMPLATES) {
      expect(utf8ByteLength(content)).toBeLessThan(STRUCTURE_IMPORT_LIMITS.MAX_FILE_BYTES / 10);
    }
  });

  it('sono esposti con i nomi file canonici', () => {
    expect(STRUCTURE_IMPORT_TEMPLATES.map((t) => t.filename)).toEqual([
      'schoolforge-udas.yaml',
      'schoolforge-lezioni.yaml',
    ]);
  });
});
