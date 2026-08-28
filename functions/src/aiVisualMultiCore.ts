/**
 * MULTI-VISUAL-01 — nucleo puro condiviso dal contratto multi-immagine.
 *
 * Non è una reimplementazione di VISUAL-ENRICHMENT: è il solo posto dove
 * questo pacchetto dichiara le proprie costanti (`documentazione/multi-visual-
 * roadmap.md` §5.6) e il proprio codice d'errore, per gli aspetti che il
 * contratto singolo non conosce ancora (il manifest ad array, il piano
 * coordinato, il selettore d'ancora indice+testo). Tutto ciò che VE-01/03 già
 * possiede — slug, hash, Timestamp, path Storage, testo editoriale — viene
 * importato da lì, mai duplicato: vedi `aiVisualMultiManifest.ts` e
 * `aiVisualMultiAnchor.ts`.
 *
 * **Review fix (blocker 1).** UUID v4 e SHA-256 esadecimale avevano una
 * ridefinizione locale in `aiVisualMultiManifest.ts` e in
 * `aiVisualMultiPlan.ts`. Questo modulo è ora la sola definizione raggiunta
 * da entrambi — nessun'altra regex privata equivalente nei due file.
 *
 * Puro: nessuna rete, nessun I/O, nessuna dipendenza Firebase.
 */

import { canonicalTuple, sha256Hex } from './aiVisualCore.js';

// ─── Costanti (roadmap §5.6, §9) ───────────────────────────────────────────────

export const MAX_VISUALS_PER_LESSON = 3;

/** Cap grezzo di un file caricato, PRIMA della decodifica. 2 MB decimali. */
export const MAX_VISUAL_UPLOAD_INPUT_BYTES = 2_000_000;

/** Formati di input accettati per l'upload. L'output normalizzato è sempre WebP. */
export const ACCEPTED_VISUAL_UPLOAD_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Tentativi di generazione coperti dalla prenotazione di un singolo slot. */
export const VISUAL_PLAN_MAX_ATTEMPTS_PER_SLOT = 2;

/** Versione del contratto del manifest ad array (privato e pubblico). */
export const LESSON_VISUALS_CONTRACT_VERSION = 'lesson-visuals/v1' as const;

/** Versione del contratto del piano coordinato. */
export const VISUAL_PLAN_CONTRACT_VERSION = 'visual-plan/v1' as const;

/** Versioni dei due record tecnici introdotti da MULTI-VISUAL-03B. */
export const VISUAL_PLAN_SLOT_RUN_CONTRACT_VERSION = 'visual-plan-slot-run/v1' as const;
export const VISUAL_PLAN_PROMOTION_CONTRACT_VERSION = 'visual-plan-promotion/v1' as const;
export const VISUAL_PLAN_PROMOTION_RECOVERY_CONTRACT_VERSION =
  'visual-plan-promotion-recovery/v1' as const;

/** `styleVersion` di un'immagine caricata dal docente — nessuna verifica di stile. */
export const UPLOADED_VISUAL_STYLE_VERSION = 'uploaded/v1' as const;

// ─── Identità: UUID v4 e SHA-256 — un'unica definizione (blocker 1) ────────────

export const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/** Minuscolo, forma canonica: nessuna coercizione di maiuscole in fase di lettura. */
export function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_RE.test(value);
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && SHA256_HEX_RE.test(value);
}

// ─── Identità del piano (roadmap §10.1) ────────────────────────────────────────

/**
 * `opaquePlanId`, derivato server-side dalla tupla canonica
 * `['visual-plan/v1', ownerUid, requestId]` (roadmap §10.1) — stesso schema
 * di `computeVisualRunId`/`computeVisualBudgetReservationKey` di VE
 * (`aiVisualCore.ts`), riusato e non reinventato. Determinismo: stessa
 * coppia ⇒ stesso id, così un `VisualPlanRun` persistito può essere
 * riconciliato con il percorso di staging che dichiara senza fidarsi del
 * solo valore scritto nel documento (blocker 3).
 */
export function computeOpaqueVisualPlanId(ownerUid: string, requestId: string): string {
  return sha256Hex(canonicalTuple([VISUAL_PLAN_CONTRACT_VERSION, ownerUid, requestId]));
}

/**
 * Identità stabile dell'esecuzione di uno slot. Non include il tentativo:
 * entrambi i tentativi autorizzati sono una sola macchina a stati persistita,
 * così un replay non può creare una seconda spesa sotto un altro documento.
 */
export function computeOpaqueVisualPlanSlotRunId(
  ownerUid: string,
  opaquePlanId: string,
  slotIndex: number,
): string {
  return sha256Hex(
    canonicalTuple(['visual-plan-slot/v1', ownerUid, opaquePlanId, String(slotIndex)]),
  );
}

/**
 * MULTI-VISUAL-03A — `planHash` (roadmap §10.1, corretto rispetto alla
 * revisione 3): fingerprint di integrità interna calcolato **una sola
 * volta**, alla creazione del piano, dai valori **iniziali** — mai
 * ricalcolato dopo, mai usato per giudicare se un replay è valido (quel
 * giudizio confronta i campi identità persistiti, §10.1). Include davvero
 * tutti i campi che §5.5 promette (`programId`/`importId`/`publicLessonId`
 * compresi, omessi dalla formula difettosa della revisione 3).
 *
 * Il tipo di `quantity` è dichiarato qui a forma strutturale (non importato
 * da `aiVisualMultiPlan.ts`) per evitare un ciclo di import: questo modulo è
 * la base che `aiVisualMultiPlan.ts` importa, mai il contrario.
 *
 * **Review fix (Codex, blocker P2).** `existingItemAssetIds` **non** viene
 * ordinato prima dell'hash: l'ordine dell'array è lo stesso, semantico,
 * ordine di `LessonDoc.visuals.items` (roadmap §5.5) — due piani che
 * differiscono solo per l'ordine di due asset esistenti sono due piani
 * diversi (per esempio dopo un riordino, §8.10), e devono produrre due
 * `planHash` diversi. Ordinare avrebbe reso il piano indifferente a uno
 * scambio di posizione, contraddicendo l'invariante che l'array è
 * l'informazione, non l'insieme che rappresenta.
 */
export function computeVisualPlanHash(params: {
  ownerUid: string;
  programId: string;
  importId: string;
  lessonId: string;
  publicLessonId: string;
  sourceBodyHash: string;
  existingItemAssetIds: readonly string[];
  replacementAssetId?: string | null;
  quantity: { mode: 'auto' | 'exact'; ceiling: 1 | 2 | 3 };
}): string {
  return sha256Hex(
    canonicalTuple([
      VISUAL_PLAN_CONTRACT_VERSION,
      params.ownerUid,
      params.programId,
      params.importId,
      params.lessonId,
      params.publicLessonId,
      params.sourceBodyHash,
      JSON.stringify(params.existingItemAssetIds),
      params.replacementAssetId ?? '',
      JSON.stringify(params.quantity),
    ]),
  );
}

// ─── Errore tipizzato ───────────────────────────────────────────────────────────

/**
 * Codici propri del contratto multi-immagine. Distinto da `AiContentError` e
 * da `AiVisualError` (VE) — non ne estende l'unione perché quei due tipi
 * restano quelli del flusso singolo congelato: introdurre qui nuovi codici
 * (`visual_legacy_conflict`, `visual_promotion_anchor_stale`, …) non deve
 * toccare un solo carattere di quei moduli.
 */
export type AiVisualMultiErrorCode =
  | 'invalid_input'
  | 'corrupted_state'
  | 'visuals_malformed'
  | 'visual_legacy_malformed'
  | 'visual_legacy_conflict'
  | 'provider_invalid_output'
  | 'visual_promotion_anchor_stale'
  // MULTI-VISUAL-03A — vocabolario proprio del piano coordinato (roadmap
  // §10.3, §8.3): un secondo tentativo di autorizzazione mentre un piano è
  // già attivo sulla stessa lezione; il corpo è cambiato fra l'autorizzazione
  // e la ripresa della proposta coordinata dopo una risposta persa.
  | 'visual_plan_already_active'
  | 'visual_plan_proposal_body_changed'
  | 'visual_plan_expired'
  | 'visual_plan_slot_not_generatable'
  | 'visual_plan_slot_attempts_exhausted'
  | 'visual_plan_external_mutation'
  | 'visual_slot_full'
  | 'visual_replace_target_missing'
  // MULTI-VISUAL-02 — vocabolario proprio della catena binaria dell'upload
  // (roadmap §9.2, §9.7): distinti dai codici di VE (`AiVisualErrorCode`),
  // che restano quelli del flusso di generazione, mai riusati qui per non
  // confondere «byte troppo grandi/formato non ammesso in un upload del
  // docente» con «byte prodotti da un provider IA».
  | 'visual_upload_too_large'
  | 'visual_upload_unsupported_format'
  | 'visual_upload_conflict';

export class AiVisualMultiError extends Error {
  readonly code: AiVisualMultiErrorCode;
  /**
   * MULTI-VISUAL-03A — dati non sensibili da propagare al chiamante insieme
   * al codice (roadmap §10.3: `visual_plan_already_active` porta
   * `opaquePlanId`/`requestId` del piano che detiene il lease, perché il
   * client possa riaprirlo invece di crearne un altro). `undefined` per ogni
   * altro codice: nessun altro punto del contratto ne ha bisogno.
   */
  readonly details?: Record<string, unknown>;

  constructor(code: AiVisualMultiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'AiVisualMultiError';
    this.code = code;
    this.details = details;
  }
}

// ─── Helper strutturali condivisi fra i validatori del pacchetto ──────────────

export function asRecord(
  value: unknown,
  message: string,
  code: AiVisualMultiErrorCode = 'invalid_input',
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiVisualMultiError(code, message);
  }
  return value as Record<string, unknown>;
}

/** Chiavi esatte: nessuna proprietà extra, nessuna proprietà mancante. */
export function assertExactKeys(
  root: Record<string, unknown>,
  keys: readonly string[],
  label: string,
  code: AiVisualMultiErrorCode = 'invalid_input',
): void {
  const actual = Object.keys(root).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new AiVisualMultiError(code, `${label}: chiavi non ammesse.`);
  }
}
