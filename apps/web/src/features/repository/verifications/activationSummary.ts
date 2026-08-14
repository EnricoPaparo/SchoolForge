import type { DifferentiationSnapshotParts } from './differentiationSnapshot.js';

/**
 * VDIF-04 — riepilogo **derivato puro** mostrato prima della conferma di
 * attivazione. Owner-only e **mai persistito**: non esiste alcun documento, e
 * nessuno dei suoi numeri raggiunge una superficie leggibile dallo studente.
 *
 * Non esegue alcuna lettura: opera esclusivamente sulle parti già costruite dal
 * preflight. È la ragione per cui `prepareVerificationActivation` è separata dal
 * commit — mostrare un riepilogo ricalcolato da dati diversi da quelli che
 * verranno congelati sarebbe peggio che non mostrarlo affatto.
 */

export type ActivationSummaryRow = {
  /** `null` per la riga «Nessuna etichetta». */
  labelId: string | null;
  labelName: string;
  studentCount: number;
  questionCount: number;
  maxPoints: number;
  substitutions: number;
  omissions: number;
  blocker: string | null;
};

export type ActivationSummary = {
  /** Studenti che riceveranno la verifica base (senza etichetta assegnata). */
  baseStudents: number;
  /** Studenti che riceveranno un percorso differenziato. */
  differentiatedStudents: number;
  /** Studenti senza etichetta: è il momento in cui ci si accorge di averne dimenticato uno. */
  unlabelledStudents: number;
  labelCount: number;
  substitutions: number;
  omissions: number;
  /** Riga «Nessuna etichetta» **prima**, poi una riga per etichetta coinvolta. */
  rows: ActivationSummaryRow[];
  blockers: string[];
};

const NO_LABEL_ROW_NAME = 'Nessuna etichetta';

/**
 * Costruisce il riepilogo dalle parti del preflight e dagli studenti già
 * caricati. Nessuna lettura, nessuna scrittura, nessun nome inventato: le righe
 * portano i nomi che il docente ha scelto, congelati al momento
 * dell'attivazione.
 */
export function buildActivationSummary(
  parts: DifferentiationSnapshotParts,
  students: readonly { uid: string }[],
): ActivationSummary {
  const byStudentUid = parts.labelAssignments.byStudentUid;
  const involvedLabelIds = new Set(parts.perLabel.map((label) => label.labelId));

  let differentiatedStudents = 0;
  let unlabelledStudents = 0;
  const studentsByLabel = new Map<string, number>();
  for (const student of students) {
    const labelId = byStudentUid[student.uid];
    // Un'etichetta assegnata ma **non coinvolta** in questa configurazione non
    // differenzia nulla: quello studente riceve la base come chi non ne ha, e
    // il riepilogo lo dice invece di suggerire una differenziazione che non
    // avverrà.
    if (labelId === undefined || !involvedLabelIds.has(labelId)) {
      unlabelledStudents += 1;
      continue;
    }
    differentiatedStudents += 1;
    studentsByLabel.set(labelId, (studentsByLabel.get(labelId) ?? 0) + 1);
  }

  const rows: ActivationSummaryRow[] = [
    {
      labelId: null,
      labelName: NO_LABEL_ROW_NAME,
      studentCount: unlabelledStudents,
      questionCount: parts.base.questionCount,
      maxPoints: parts.base.maxPoints,
      substitutions: 0,
      omissions: 0,
      blocker: parts.base.blocker,
    },
    ...parts.perLabel.map((label) => ({
      labelId: label.labelId,
      labelName: label.labelName,
      studentCount: studentsByLabel.get(label.labelId) ?? 0,
      questionCount: label.questionCount,
      maxPoints: label.maxPoints,
      substitutions: label.substitutions,
      omissions: label.omissions,
      blocker: label.blocker,
    })),
  ];

  return {
    baseStudents: unlabelledStudents,
    differentiatedStudents,
    unlabelledStudents,
    labelCount: parts.perLabel.length,
    substitutions: parts.perLabel.reduce((total, label) => total + label.substitutions, 0),
    omissions: parts.perLabel.reduce((total, label) => total + label.omissions, 0),
    rows,
    blockers: rows
      .map((row) => row.blocker)
      .filter((blocker): blocker is string => blocker !== null),
  };
}
