import type { EquivalentGroupConfig, VerificationQuestionRef } from '../../../types/firestore.js';

/**
 * Sottoinsieme **strutturale** dei campi realmente usati dalla logica pura: così
 * accettiamo sia i `VerificationQuestionRef` congelati sia il tipo UI-only del
 * builder (`VexBuilderQuestion`, che aggiunge solo `questionPreview`). Nessuna
 * dipendenza dalla preview qui.
 */
export type VexQuestionRefLike = Pick<
  VerificationQuestionRef,
  'questionIndexEntryId' | 'questionLocalId' | 'udaDir' | 'tipo' | 'difficolta' | 'maxPoints'
>;

/**
 * VEX-01A — logica **pura** dei gruppi equivalenti: riconciliazione con la
 * selezione, validazioni bloccanti/warning e riepilogo derivato. Nessuna
 * lettura/scrittura, nessuna query, nessun accesso a pool/Storage.
 *
 * Criteri di equivalenza (vex-contract.md §2.4/§3): stessa `udaDir`, stesso
 * `tipo`, stessa `difficolta` intera ⇒ stesso `maxPoints` (perché
 * `maxPoints === difficolta`). `maxCharacters` **non** è confrontato.
 */

/** Prodotto delle varianti, con cap sicuro (nessun NaN/Infinity). */
export interface VariantsCount {
  value: number;
  /** `true` se il numero reale supera il cap ed è mostrato in forma cappata. */
  capped: boolean;
}

export interface VexSummary {
  commonCount: number;
  groupsCount: number;
  questionsPerStudent: number;
  variantsPossible: VariantsCount;
  maxPoints: number;
}

export interface VexWarning {
  code:
    | 'single_alternative'
    | 'single_variant'
    | 'fewer_variants_than_students'
    | 'variant_repetition_possible';
  message: string;
  /** id del gruppo, per i warning per-gruppo. */
  groupId?: string;
}

export interface VexValidation {
  blocking: string[];
  warnings: VexWarning[];
}

/** Oltre questo prodotto la conta è mostrata cappata (evita overflow/`Infinity`). */
export const VARIANTS_CAP = 1_000_000;

const WARN_SINGLE_ALTERNATIVE =
  'Una alternativa possibile — questa domanda sarà assegnata a tutti gli studenti.';
const WARN_SINGLE_VARIANT =
  'Una sola variante possibile. La verifica funzionerà normalmente, ma tutti gli studenti riceveranno le stesse domande in ordine casuale.';

function refMap(refs: readonly VexQuestionRefLike[]): Map<string, VexQuestionRefLike> {
  return new Map(refs.map((r) => [r.questionIndexEntryId, r]));
}

/**
 * Rimuove dai gruppi gli `entryId` non più selezionati e scarta i gruppi che
 * restano **vuoti** (eliminazione automatica). Deterministico e immutabile: non
 * muta l'input. Deduplica gli entryId dentro lo stesso gruppo.
 */
export function reconcileEquivalentGroups(
  groups: readonly EquivalentGroupConfig[],
  selectedEntryIds: ReadonlySet<string>,
): EquivalentGroupConfig[] {
  const result: EquivalentGroupConfig[] = [];
  for (const group of groups) {
    const kept: string[] = [];
    const seen = new Set<string>();
    for (const id of group.questionIndexEntryIds) {
      if (selectedEntryIds.has(id) && !seen.has(id)) {
        seen.add(id);
        kept.push(id);
      }
    }
    if (kept.length > 0) {
      result.push({ id: group.id, questionIndexEntryIds: kept });
    }
  }
  return result;
}

/** entryId selezionati che non appartengono ad alcun gruppo → domande comuni. */
export function commonEntryIds(
  selectedEntryIds: readonly string[],
  groups: readonly EquivalentGroupConfig[],
): string[] {
  const grouped = new Set<string>();
  for (const g of groups) for (const id of g.questionIndexEntryIds) grouped.add(id);
  return selectedEntryIds.filter((id) => !grouped.has(id));
}

/** Prodotto sicuro del numero di alternative per gruppo (cap, mai `Infinity`/`NaN`). */
export function computeVariantsPossible(groups: readonly EquivalentGroupConfig[]): VariantsCount {
  let value = 1;
  let capped = false;
  for (const g of groups) {
    const n = g.questionIndexEntryIds.length;
    if (n <= 0) continue;
    value *= n;
    if (value > VARIANTS_CAP) {
      capped = true;
      value = VARIANTS_CAP;
    }
  }
  return { value, capped };
}

/**
 * Riepilogo derivato **puro**. `common` = selezionati non nei gruppi;
 * `questionsPerStudent` = common + numero gruppi; `variantsPossible` = prodotto
 * (cappato); `maxPoints` = somma punti comuni + un punto per gruppo (le
 * alternative equivalenti hanno lo stesso `maxPoints`, si usa la prima).
 */
export function deriveVexSummary(
  refs: readonly VexQuestionRefLike[],
  groups: readonly EquivalentGroupConfig[],
): VexSummary {
  const byId = refMap(refs);
  const selectedIds = refs.map((r) => r.questionIndexEntryId);
  const common = commonEntryIds(selectedIds, groups);
  const commonPoints = common.reduce((sum, id) => sum + (byId.get(id)?.maxPoints ?? 0), 0);
  const groupPoints = groups.reduce((sum, g) => {
    const firstId = g.questionIndexEntryIds[0];
    return sum + (firstId ? (byId.get(firstId)?.maxPoints ?? 0) : 0);
  }, 0);
  return {
    commonCount: common.length,
    groupsCount: groups.length,
    questionsPerStudent: common.length + groups.length,
    variantsPossible: computeVariantsPossible(groups),
    maxPoints: commonPoints + groupPoints,
  };
}

/**
 * Validazione pura dei gruppi. `studentCount` opzionale: se non disponibile nel
 * contesto (VEX-01A **non** introduce letture studenti per calcolarlo) i warning
 * che vi dipendono sono omessi.
 */
export function validateEquivalentGroups(
  refs: readonly VexQuestionRefLike[],
  groups: readonly EquivalentGroupConfig[],
  studentCount?: number,
): VexValidation {
  const blocking: string[] = [];
  const warnings: VexWarning[] = [];
  const byId = refMap(refs);

  // Gli id dei gruppi devono essere univoci (fail-closed: due gruppi con lo
  // stesso id renderebbero ambiguo lo snapshot entryId→order).
  const seenGroupIds = new Set<string>();
  for (const g of groups) {
    if (seenGroupIds.has(g.id)) {
      blocking.push(`Due gruppi hanno lo stesso identificativo (${g.id}).`);
    } else {
      seenGroupIds.add(g.id);
    }
  }

  // Una stessa domanda non può stare in più gruppi.
  const seenInGroup = new Map<string, string>();
  for (const g of groups) {
    for (const id of g.questionIndexEntryIds) {
      // Riferimento presente tra le domande selezionate.
      const ref = byId.get(id);
      if (!ref) {
        blocking.push(`Un gruppo referenzia una domanda non più selezionata (${id}).`);
        continue;
      }
      if (seenInGroup.has(id)) {
        blocking.push(`La domanda ${ref.questionLocalId ?? id} è presente in più di un gruppo.`);
      } else {
        seenInGroup.set(id, g.id);
      }
    }
    // Compatibilità delle alternative dello stesso gruppo.
    const present = g.questionIndexEntryIds
      .map((id) => byId.get(id))
      .filter((r): r is VexQuestionRefLike => r !== undefined);
    if (present.length >= 2) {
      const first = present[0]!;
      const incompatible = present.some(
        (r) =>
          r.udaDir !== first.udaDir || r.tipo !== first.tipo || r.difficolta !== first.difficolta,
      );
      if (incompatible) {
        blocking.push(
          'Le alternative di un gruppo devono avere stessa UDA, stesso tipo e stessa difficoltà.',
        );
      }
    }
    // Warning: gruppo con una sola alternativa (non bloccante).
    if (present.length === 1) {
      warnings.push({
        code: 'single_alternative',
        message: WARN_SINGLE_ALTERNATIVE,
        groupId: g.id,
      });
    }
  }

  // Nessuna domanda complessiva (0 comuni e 0 gruppi con alternative).
  const selectedIds = refs.map((r) => r.questionIndexEntryId);
  const common = commonEntryIds(selectedIds, groups);
  const nonEmptyGroups = groups.filter((g) => g.questionIndexEntryIds.length > 0);
  if (common.length === 0 && nonEmptyGroups.length === 0) {
    blocking.push('Nessuna domanda selezionata per la verifica.');
  }

  // Warning globali sulle combinazioni. «Una sola variante» va mostrato ogni
  // volta che c'è almeno una domanda selezionata ma esiste una sola
  // combinazione possibile: sia con gruppi a singola alternativa, sia — caso
  // corretto in VEX-01A-FIX — quando non esistono gruppi e tutte le domande
  // sono comuni (variantsPossible == 1). Lo stato completamente vuoto (nessuna
  // domanda) resta gestito dall'errore bloccante sopra e non mostra il warning.
  const variants = computeVariantsPossible(groups);
  if (selectedIds.length > 0 && !variants.capped && variants.value === 1) {
    warnings.push({ code: 'single_variant', message: WARN_SINGLE_VARIANT });
  }
  if (
    typeof studentCount === 'number' &&
    Number.isFinite(studentCount) &&
    studentCount > 1 &&
    !variants.capped &&
    variants.value < studentCount
  ) {
    warnings.push({
      code: 'fewer_variants_than_students',
      message: `Le combinazioni possibili (${variants.value}) sono meno degli studenti (${studentCount}): alcune varianti si ripeteranno.`,
    });
    warnings.push({
      code: 'variant_repetition_possible',
      message: 'Studenti diversi potrebbero ricevere la stessa variante.',
    });
  }

  return { blocking, warnings };
}
