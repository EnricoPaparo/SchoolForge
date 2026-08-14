import type {
  DifferentiatedChoiceSnapshot,
  VerificationDifferentiationSnapshot,
} from '../../../types/firestore.js';

/**
 * VDIF-04 — parte **deterministica** dell'algoritmo di risoluzione congelato
 * (roadmap §5.D.4, passi 1–3): dato lo snapshot e l'etichetta di uno studente,
 * quali `order` comuni gli restano dopo sostituzioni e omissioni.
 *
 * ## Perché questa funzione esiste qui e non nella callable
 *
 * L'algoritmo completo ha cinque passi: (1–3) applicare le scelte
 * dell'etichetta alle domande comuni, (4) estrarre una alternativa per gruppo
 * VEX con l'RNG sicuro, (5) rifiutare insieme vuoto e duplicati. Il passo 4 usa
 * l'RNG e vive **solo** dove l'assegnazione viene realmente prodotta, cioè
 * nella callable (`functions/src/verificationVariantCore.ts`).
 *
 * I passi 1–3 servono invece **anche** al preflight dell'attivazione — per le
 * guardie G13 (duplicazioni), G15 (etichetta con zero domande) e G16 (punteggio
 * massimo per etichetta) e per il riepilogo di conferma — che girano nel client
 * docente, dove la callable non è raggiungibile.
 *
 * **Conflitto dichiarato, non aggirato.** La roadmap §5.D.4 chiede «una sola
 * versione autorevole e pura» di `resolveDifferentiatedOrders`. Il repository
 * non ha un package condiviso fra `apps/web` e `functions`
 * (`@schoolforge/lesson-contract` è dipendenza della sola web app), e
 * aggiungerne uno a `functions` significherebbe introdurre una dipendenza nuova
 * nel bundle deployato — vietato dal perimetro di questo pacchetto. È la stessa
 * frattura che VEX ha già oggi fra `assignVariant` (functions) e
 * `resolveAssignedQuestions` (web).
 *
 * La scelta fatta, che è verificabile invece che promessa: i passi 1–3 esistono
 * in due punti, e un **vettore di conformità condiviso**
 * (`__tests__/fixtures/differentiationConformance.json`) è eseguito da entrambe
 * le suite — quella web e quella Functions. Una divergenza fra le due
 * implementazioni fa fallire una delle due suite sullo stesso file di casi.
 */

export class DifferentiationResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DifferentiationResolutionError';
  }
}

function choiceFor(
  question: { choices: Record<string, DifferentiatedChoiceSnapshot> },
  labelId: string | null,
): DifferentiatedChoiceSnapshot | undefined {
  if (labelId === null) return undefined;
  return Object.prototype.hasOwnProperty.call(question.choices, labelId)
    ? question.choices[labelId]
    : undefined;
}

/**
 * Passi 1–3 dell'algoritmo congelato. Restituisce gli `order` **comuni** dopo
 * differenziazione, ordinati in modo crescente.
 *
 * `labelId === null` (studente senza etichetta) ⇒ nessuna modifica: riceve la
 * base, che è il default esplicito del principio 7.
 *
 * Fail-closed: una base che non è fra le comuni, un'alternativa che coincide con
 * un order già presente, o un duplicato prodotto da due sostituzioni diverse
 * lanciano. Nessuna potatura, nessuna normalizzazione silenziosa.
 */
export function resolveDifferentiatedCommonOrders(
  input: {
    commonQuestionOrders: readonly number[];
    differentiation: VerificationDifferentiationSnapshot;
  },
  labelId: string | null,
): number[] {
  const base = new Set<number>();
  for (const order of input.commonQuestionOrders) {
    if (!Number.isInteger(order)) {
      throw new DifferentiationResolutionError(`Order comune non intero: ${order}.`);
    }
    base.add(order);
  }

  for (const question of input.differentiation.questions) {
    if (!base.has(question.baseOrder)) {
      throw new DifferentiationResolutionError(
        `La domanda base ${question.baseOrder} non è fra le domande comuni.`,
      );
    }
    const choice = choiceFor(question, labelId);
    if (choice === undefined || choice.kind === 'base') continue;
    if (choice.kind === 'none') {
      base.delete(question.baseOrder);
      continue;
    }
    // `alternative`: la base esce e l'alternativa entra. Se l'order entrante è
    // già presente la verifica risolta avrebbe la stessa domanda due volte —
    // il caso che G13 blocca all'attivazione e che qui non può passare.
    base.delete(question.baseOrder);
    if (base.has(choice.order)) {
      throw new DifferentiationResolutionError(
        `L'alternativa ${choice.order} duplicherebbe una domanda già assegnata.`,
      );
    }
    base.add(choice.order);
  }

  return [...base].sort((a, b) => a - b);
}
