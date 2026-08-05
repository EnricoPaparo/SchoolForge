import { canonicalizeWithVersion } from '../structureImport/index.js';
import type { NormalizedLessonMetadata, NormalizedUdaMetadata } from '../structureImport/index.js';

/**
 * STRUCTURE-IMPORT — identità della **sorgente** di un tentativo.
 *
 * Perché esiste, oltre al `manifestHash`. Il manifest nasce dal planner, e il
 * planner ha bisogno di leggere la destinazione: dopo un commit riuscito la cui
 * risposta si è persa, i documenti importati sono già lì, il planner li vede
 * come duplicati e il tentativo fallisce *prima* di poter essere riconosciuto
 * come replay. L'idempotenza promessa si romperebbe proprio nel caso per cui
 * esiste.
 *
 * Il `sourceHash` risolve il problema perché è calcolabile **prima** del
 * planner: dipende solo da ciò che il docente ha scelto — il tipo di import,
 * l'owner autorevole, la destinazione e i metadati normalizzati del file — e
 * non da come quei metadati verranno materializzati. Due esecuzioni della
 * stessa richiesta sullo stesso bersaglio hanno lo stesso `sourceHash` anche
 * quando la prima ha già scritto tutto.
 *
 * I due livelli restano distinti e servono a cose diverse:
 *
 * - `sourceHash` risponde a «è la stessa richiesta sullo stesso bersaglio?» e
 *   governa il riconoscimento del replay;
 * - `manifestHash` risponde a «è lo stesso identico piano, con questi id,
 *   questo `order` e questi path?» e governa lease, resume e commit.
 *
 * Modulo puro: nessun Firebase, nessun DOM, nessun timer.
 */

export const SOURCE_CANONICAL_VERSION = 'structure-import/source-canonical/v1';

export interface UdaSourceIdentity {
  kind: 'uda';
  /** Owner **autorevole**, letto dal documento programma. */
  ownerUid: string;
  programId: string;
  importId: string;
  udas: readonly NormalizedUdaMetadata[];
}

export interface LessonSourceIdentity {
  kind: 'lesson';
  ownerUid: string;
  programId: string;
  importId: string;
  /** UDA di destinazione: la stessa sorgente su un'altra UDA è un'altra cosa. */
  udaId: string;
  lessons: readonly NormalizedLessonMetadata[];
}

export type StructureSourceIdentity = UdaSourceIdentity | LessonSourceIdentity;

/**
 * Serializzazione canonica e chiusa della sorgente. L'ordine delle voci è
 * semantico (è l'ordine di append) e viene conservato; l'ordine delle proprietà
 * non lo è e viene normalizzato dal serializzatore condiviso.
 */
export function canonicalizeSource(identity: StructureSourceIdentity): string {
  const body =
    identity.kind === 'uda'
      ? {
          kind: 'uda',
          ownerUid: identity.ownerUid,
          programId: identity.programId,
          importId: identity.importId,
          udaId: null,
          entries: identity.udas.map((uda) => ({
            titolo: uda.titolo,
            descrizione: uda.descrizione,
            competenze: uda.competenze,
            obiettivi: uda.obiettivi,
          })),
        }
      : {
          kind: 'lesson',
          ownerUid: identity.ownerUid,
          programId: identity.programId,
          importId: identity.importId,
          udaId: identity.udaId,
          entries: identity.lessons.map((lesson) => ({
            titolo: lesson.titolo,
            sottotitolo: lesson.sottotitolo,
            difficolta: lesson.difficolta,
            concettiChiave: lesson.concettiChiave,
            obiettivi: lesson.obiettivi,
          })),
        };
  return canonicalizeWithVersion(SOURCE_CANONICAL_VERSION, body);
}
