/**
 * TWU-02 — profili modello **chiusi** della correzione IA. Il client sceglie un
 * profilo astratto (`economy` | `quality`) e **mai** un model ID o un listino:
 * il mapping profilo → modello tecnico + versione listino è **esclusivamente**
 * server-side e fail-closed, così un client non può iniettare un modello
 * arbitrario né disaccoppiare modello e prezzo.
 *
 * Modulo **puro e indipendente**: nessuna dipendenza Firestore/rete e **nessun
 * import da `aiCorrectionGatewayCore`** (nessun ciclo). La validazione del campo
 * client è esposta come funzione pura che ritorna un `result` (mai un throw di
 * `AiGatewayError`): è `aiCorrectionGatewayCore` a tradurre un input non valido
 * in `AiGatewayError('invalid_input', …)`, ed è `aiCorrectionEngine` a tradurre
 * un'impossibilità server-side in `provider_config_invalid`. Riusa le costanti
 * autoritative di `aiCorrectionCost.ts` — nessun nuovo modello o listino qui.
 */

import {
  DEFAULT_PRICE_LIST_VERSION,
  OPENAI_PRODUCTION_MODEL,
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
} from './aiCorrectionCost.js';

/** Profili chiusi: gli unici valori che il client può inviare in `modelProfile`. */
export type ModelProfile = 'economy' | 'quality';

/** Insieme canonico dei profili ammessi (fonte di verità server-side). */
export const MODEL_PROFILES: readonly ModelProfile[] = ['economy', 'quality'];

/** Coppia autoritativa modello tecnico + listino di un profilo. */
export interface ModelProfileResolution {
  model: string;
  priceListVersion: string;
}

/**
 * Mapping **chiuso** profilo → (modello tecnico, listino). È l'unica sorgente
 * che traduce la scelta astratta del docente in un modello reale e nel suo
 * listino accoppiato. Coerente con l'allowlist runtime (`RUNTIME_MODEL_PRICE_LISTS`).
 */
export const MODEL_PROFILE_RESOLUTIONS: Readonly<Record<ModelProfile, ModelProfileResolution>> = {
  economy: { model: OPENAI_PRODUCTION_MODEL, priceListVersion: DEFAULT_PRICE_LIST_VERSION },
  quality: {
    model: OPENAI_RUNTIME_LUNA_MODEL,
    priceListVersion: OPENAI_RUNTIME_LUNA_PRICE_LIST_VERSION,
  },
};

/**
 * Default applicativo quando non è deducibile dalla config runtime (es. modalità
 * mock, dove non esiste un modello reale). Su DEV la config runtime punta a Luna
 * ⇒ profilo effettivo `quality`; questo default lo rispecchia.
 */
export const DEFAULT_MODEL_PROFILE: ModelProfile = 'quality';

/**
 * Esito **puro** della validazione del campo `modelProfile` inviato dal client.
 * `ok: true` con `profile: undefined` significa **campo assente** (il chiamante
 * applicherà il default legacy dal modello runtime). `ok: false` è fail-closed
 * (nessun fallback silenzioso): sta al chiamante tradurlo in `invalid_input`.
 */
export type ModelProfileFieldResult =
  | { ok: true; profile: ModelProfile | undefined }
  | { ok: false };

/**
 * Valida il campo `modelProfile` **inviato dal client** senza mai lanciare:
 * **assente** (`undefined`) ⇒ `{ ok: true, profile: undefined }`; `economy`/
 * `quality` ⇒ `{ ok: true, profile }`; `null`, stringa sconosciuta o tipo
 * non-stringa ⇒ `{ ok: false }`.
 */
export function parseModelProfileField(value: unknown): ModelProfileFieldResult {
  if (value === undefined) return { ok: true, profile: undefined };
  if (typeof value === 'string' && (MODEL_PROFILES as readonly string[]).includes(value)) {
    return { ok: true, profile: value as ModelProfile };
  }
  return { ok: false };
}

/**
 * Reverse lookup: il profilo il cui **modello** coincide con quello dato, o
 * `null` se il modello non appartiene ad alcun profilo chiuso. Serve a derivare
 * il profilo di default **legacy** dal modello della config runtime (senza mai
 * fare fallback silenzioso tra modelli diversi).
 */
export function profileForModel(model: string): ModelProfile | null {
  for (const profile of MODEL_PROFILES) {
    if (MODEL_PROFILE_RESOLUTIONS[profile].model === model) return profile;
  }
  return null;
}

/**
 * Risolve la coppia (modello, listino) autoritativa per un profilo. Funzione
 * pura: il tipo `ModelProfile` (unione chiusa) garantisce sempre una risoluzione,
 * quindi non lancia. L'eventuale impossibilità server-side (es. modello runtime
 * non mappato) è gestita a monte dall'engine come `provider_config_invalid`.
 */
export function resolveModelProfile(profile: ModelProfile): ModelProfileResolution {
  return MODEL_PROFILE_RESOLUTIONS[profile];
}
