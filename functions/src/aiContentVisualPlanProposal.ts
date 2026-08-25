/**
 * MULTI-VISUAL-02 — contratto puro della **proposta coordinata**
 * (`kind: 'visual_plan_proposal'`, roadmap §8.3): la fase testuale che
 * decide, per un tetto `ceiling` di 1..3 slot, quali immagini una lezione
 * beneficerebbe davvero — un array di 0..ceiling esiti, mai un piano
 * persistito.
 *
 * Questo modulo **non** scrive `VisualPlanRun`, non prenota budget, non
 * gestisce lease: quella persistenza/lifecycle resta MULTI-VISUAL-03. Qui si
 * valida soltanto l'output del provider (o del mock) per questo kind, con la
 * stessa disciplina fail-closed di `aiContentVisualProposal.ts` (VE-01), di
 * cui riusa interamente i validatori di campo — nessuna seconda definizione
 * dei limiti di `subject`/`rationale`/`caption`/`altText`.
 *
 * L'identità di ancoraggio è quella di MULTI-VISUAL-01
 * (`VisualAnchorSelector`, indice+testo — roadmap §7.1), non il solo testo
 * esatto della proposta singola: più immagini nello stesso array possono
 * dover disambiguare heading omonimi, cosa che il solo testo non permette.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

import { AiContentError } from './aiContentCore.js';
import {
  MAX_VISUAL_ALT_TEXT_CHARS,
  MAX_VISUAL_CAPTION_CHARS,
  MAX_VISUAL_RATIONALE_CHARS,
  MAX_VISUAL_REASON_CHARS,
  assertProposalField,
  assertValidVisualSubject,
} from './aiContentVisualProposal.js';
import {
  resolveVisualAnchorForWrite,
  validateVisualAnchorSelector,
  type VisualAnchorSelector,
} from './aiVisualMultiAnchor.js';
import { AiVisualMultiError, MAX_VISUALS_PER_LESSON } from './aiVisualMultiCore.js';
import { checkVisualDecisionDiversity } from './aiVisualMultiPlan.js';

// ─── Esito di un elemento dell'array ───────────────────────────────────────────

/** Il modello ha concluso che nessuna illustrazione aiuterebbe per questo slot. */
export interface VisualPlanProposalNone {
  decision: 'none';
  reason: string;
}

/** Il modello propone un'illustrazione per questo slot, ancora da approvare. */
export interface VisualPlanProposalImage {
  decision: 'image';
  subject: string;
  rationale: string;
  anchor: VisualAnchorSelector;
  caption: string;
  altText: string;
}

export type VisualPlanProposalDecision = VisualPlanProposalNone | VisualPlanProposalImage;

const NONE_KEYS = ['decision', 'reason'] as const;
const IMAGE_KEYS = ['decision', 'subject', 'rationale', 'anchor', 'caption', 'altText'] as const;

function invalidOutput(message: string): never {
  throw new AiContentError('provider_invalid_output', message);
}

function asObject(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidOutput(message);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(root: Record<string, unknown>, allowed: readonly string[]): void {
  for (const key of Object.keys(root)) {
    if (!allowed.includes(key)) {
      // Il messaggio non nomina la chiave: potrebbe essere testo del modello.
      invalidOutput('La proposta coordinata contiene campi non ammessi.');
    }
  }
}

/**
 * Valida un singolo elemento dell'array, fail-closed e senza coercizioni.
 * Stessa disciplina di `validateVisualProposalOutput` (VE-01): i due rami
 * sono chiusi in entrambe le direzioni — un `decision: 'none'` con `subject`
 * è rifiutato quanto un `decision: 'image'` privo di didascalia.
 */
export function validateVisualPlanProposalDecision(value: unknown): VisualPlanProposalDecision {
  const root = asObject(value, 'Struttura di un elemento della proposta non valida.');
  const decision = root.decision;

  if (decision === 'none') {
    assertExactKeys(root, NONE_KEYS);
    return {
      decision: 'none',
      reason: assertProposalField(root.reason, 'Motivazione', MAX_VISUAL_REASON_CHARS),
    };
  }

  if (decision === 'image') {
    assertExactKeys(root, IMAGE_KEYS);
    let anchor: VisualAnchorSelector;
    try {
      anchor = validateVisualAnchorSelector(root.anchor);
    } catch {
      // La forma dell'errore di MULTI-VISUAL-01 (`invalid_input`) non è
      // quella di questo strato (`provider_invalid_output`, output del
      // provider mai persistito): tradotta qui, una volta sola.
      invalidOutput("Ancora dell'immagine non valida.");
    }
    return {
      decision: 'image',
      subject: assertValidVisualSubject(root.subject),
      rationale: assertProposalField(
        root.rationale,
        'Utilità didattica',
        MAX_VISUAL_RATIONALE_CHARS,
      ),
      anchor,
      caption: assertProposalField(root.caption, 'Didascalia', MAX_VISUAL_CAPTION_CHARS),
      altText: assertProposalField(root.altText, 'Testo alternativo', MAX_VISUAL_ALT_TEXT_CHARS),
    };
  }

  invalidOutput('Decisione non riconosciuta.');
}

/** Chiave dell'envelope richiesto dallo Structured Output strict. */
export const VISUAL_PLAN_PROPOSAL_ENVELOPE_KEY = 'decisions' as const;

/**
 * Valida la risposta **grezza del provider** ed estrae l'array canonico.
 *
 * Stessa ragione dell'envelope singolo (VE-01, §299 del commento gemello):
 * lo Structured Output strict impone una radice `object`, mai un array alla
 * radice. `ceiling` delimita la cardinalità massima **qui**, non solo nello
 * schema trasmesso: uno schema mal costruito o un provider che lo ignora non
 * deve poter produrre un array più lungo del tetto autorizzato.
 */
export function validateVisualPlanProposalEnvelope(
  output: unknown,
  ceiling: 1 | 2 | 3,
): VisualPlanProposalDecision[] {
  const root = asObject(output, 'Struttura della proposta coordinata non valida.');
  const keys = Object.keys(root);
  if (keys.length !== 1 || keys[0] !== VISUAL_PLAN_PROPOSAL_ENVELOPE_KEY) {
    invalidOutput('La proposta coordinata non rispetta la forma attesa.');
  }
  const raw = root[VISUAL_PLAN_PROPOSAL_ENVELOPE_KEY];
  if (!Array.isArray(raw)) {
    invalidOutput('decisions non è un array.');
  }
  if (raw.length > ceiling) {
    invalidOutput('La proposta coordinata eccede il tetto di quantità autorizzato.');
  }
  if (raw.length > MAX_VISUALS_PER_LESSON) {
    invalidOutput('La proposta coordinata eccede il tetto assoluto di tre immagini.');
  }
  return raw.map((item: unknown) => validateVisualPlanProposalDecision(item));
}

/**
 * Controllo **relazionale**, fra la risposta del provider e la richiesta —
 * separato dalla validazione strutturale, come in VE-01
 * (`assertVisualProposalMatchesRequest`). Applica, in quest'ordine:
 *
 * 1. per ciascun elemento `decision: 'image'`, la risoluzione dell'ancora
 *    indice+testo contro il corpo **della richiesta corrente**
 *    (`resolveVisualAnchorForWrite`, MULTI-VISUAL-01, roadmap §7.2.1) — qui
 *    non c'è ancora nulla di persistito, quindi un'ancora che non risolve è
 *    `provider_invalid_output` (mai `visual_promotion_anchor_stale`, un
 *    codice che appartiene solo alla scrittura su un piano già esistente,
 *    fuori scope di questo modulo);
 * 2. il vincolo di diversità didattica **fra tutti** gli slot immagine
 *    (roadmap §7.4), riusando il nucleo condiviso di MULTI-VISUAL-01
 *    (`checkVisualDecisionDiversity`) — nessuna seconda definizione della
 *    normalizzazione o del confronto.
 *
 * **Confine dichiarato**, identico a VE-01: vive prima della prima
 * persistenza, non nel replay — il replay valida la sola struttura perché la
 * richiesta originale non è più disponibile.
 */
export function assertVisualPlanProposalMatchesRequest(
  decisions: readonly VisualPlanProposalDecision[],
  lessonBody: string,
): VisualPlanProposalDecision[] {
  for (const decision of decisions) {
    if (decision.decision !== 'image') continue;
    try {
      resolveVisualAnchorForWrite(decision.anchor, lessonBody);
    } catch (error) {
      if (error instanceof AiVisualMultiError && error.code === 'visual_promotion_anchor_stale') {
        invalidOutput("L'ancora scelta non esiste nel corpo della lezione.");
      }
      throw error;
    }
  }
  try {
    checkVisualDecisionDiversity(
      decisions.map((decision) =>
        decision.decision === 'image'
          ? { decision: 'image' as const, subject: decision.subject, rationale: decision.rationale }
          : { decision: 'none' as const, subject: null, rationale: null },
      ),
    );
  } catch (error) {
    if (error instanceof AiVisualMultiError) {
      invalidOutput(error.message);
    }
    throw error;
  }
  return [...decisions];
}

/**
 * Forma dell'`output` di un run `visual_plan_proposal` completato.
 *
 * **Diverge da VE-01 per un motivo strutturale, non di scelta.** Il run
 * completato di VE-01 persiste l'esito senza l'envelope del trasporto
 * perché un singolo `{decision, ...}` è già un oggetto. Qui l'esito è un
 * **array** di decisioni, e il parser generico del documento run
 * (`aiContentRunDoc.ts`, `isCoherentCompletedOutput`) rifiuta *ogni* `output`
 * che sia un array alla radice, per qualunque kind — è una guardia comune a
 * tutti i kind, non specifica di questo. `output` resta quindi
 * `{ decisions: [...] }` anche nel documento persistito: non è l'envelope
 * del provider (quello aveva anche solo quella chiave, ma la validazione qui
 * è indipendente e non si fida della forma già vista in fase `running`).
 */
export function validateStoredVisualPlanProposalOutput(
  output: unknown,
): VisualPlanProposalDecision[] {
  const root = asObject(output, 'Struttura della proposta coordinata non valida.');
  const raw = root.decisions;
  if (!Array.isArray(raw)) {
    invalidOutput('decisions non è un array.');
  }
  if (raw.length > MAX_VISUALS_PER_LESSON) {
    invalidOutput('La proposta coordinata eccede il tetto assoluto di tre immagini.');
  }
  if (Object.keys(root).length !== 1) {
    invalidOutput('La proposta coordinata persistita contiene campi non ammessi.');
  }
  return raw.map((item: unknown) => validateVisualPlanProposalDecision(item));
}

/** Predicato senza eccezioni, per i parser fail-closed che restituiscono `null`. */
export function isValidStoredVisualPlanProposalOutput(output: unknown): boolean {
  try {
    validateStoredVisualPlanProposalOutput(output);
    return true;
  } catch {
    return false;
  }
}
