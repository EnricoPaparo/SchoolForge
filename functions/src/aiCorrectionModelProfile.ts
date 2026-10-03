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
  OPENAI_RUNTIME_GPT6_LUNA_MODEL,
  OPENAI_RUNTIME_GPT6_SOL_MODEL,
  OPENAI_RUNTIME_GPT61_SOL_MODEL,
  OPENAI_RUNTIME_GPT61_SOL_PRICE_LIST_VERSION,
  OPENAI_RUNTIME_GPT6_LUNA_PRICE_LIST_VERSION,
  OPENAI_RUNTIME_SOL_MODEL,
  OPENAI_RUNTIME_SOL_CACHE_PRICE_LIST_VERSION,
  OPENAI_RUNTIME_LUNA_MODEL,
  OPENAI_RUNTIME_LUNA_CACHE_PRICE_LIST_VERSION,
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
/**
 * Coppie GPT-5.6 già validate, cache-aware e mantenute come baseline di rollback.
 */
export const GPT56_ROLLBACK_MODEL_PROFILE_RESOLUTIONS: Readonly<
  Record<ModelProfile, ModelProfileResolution>
> = {
  quality: {
    model: OPENAI_RUNTIME_SOL_MODEL,
    priceListVersion: OPENAI_RUNTIME_SOL_CACHE_PRICE_LIST_VERSION,
  },
  economy: {
    model: OPENAI_RUNTIME_LUNA_MODEL,
    priceListVersion: OPENAI_RUNTIME_LUNA_CACHE_PRICE_LIST_VERSION,
  },
};

/** Coppie GPT-6 della fase 1. Restano separate per consentire rollback atomico. */
export const GPT6_MODEL_PROFILE_RESOLUTIONS: Readonly<
  Record<ModelProfile, ModelProfileResolution>
> = {
  economy: {
    model: OPENAI_RUNTIME_GPT6_LUNA_MODEL,
    priceListVersion: OPENAI_RUNTIME_GPT6_LUNA_PRICE_LIST_VERSION,
  },
  quality: {
    model: OPENAI_RUNTIME_GPT61_SOL_MODEL,
    priceListVersion: OPENAI_RUNTIME_GPT61_SOL_PRICE_LIST_VERSION,
  },
};

/**
 * Unico selettore di rollout. Cambiarlo in `gpt56` ripristina in un solo punto
 * modelli/listini e, tramite il payload lesson, prompt e parametri precedenti.
 */
export const ACTIVE_AI_RUNTIME_POLICY: 'gpt6' | 'gpt56' = 'gpt6';
const MODEL_PROFILE_POLICIES = {
  gpt6: GPT6_MODEL_PROFILE_RESOLUTIONS,
  gpt56: GPT56_ROLLBACK_MODEL_PROFILE_RESOLUTIONS,
} as const;

/**
 * Mapping operativo della fase 1 GPT-6. Per effettuare il rollback atomico si
 * assegna qui `GPT56_ROLLBACK_MODEL_PROFILE_RESOLUTIONS`: il builder riconosce
 * quei modelli e ripristina insieme prompt precedente e assenza dei parametri
 * GPT-6, mantenendo modello e listino sempre accoppiati.
 */
export const MODEL_PROFILE_RESOLUTIONS = MODEL_PROFILE_POLICIES[ACTIVE_AI_RUNTIME_POLICY];

/** Application default for new operations, independent of runtime configuration. */
export const DEFAULT_MODEL_PROFILE: ModelProfile = 'economy';

/**
 * Esito **puro** della validazione del campo `modelProfile` inviato dal client.
 * `ok: true` con `profile: undefined` significa **campo assente** (il chiamante
 * applicherà il default applicativo Economy). `ok: false` è fail-closed
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
  // Rollback GPT-5.6 e precedente GPT-6 Sol restano riconosciuti per config e
  // run storici anche quando il mapping operativo punta ai modelli nuovi.
  if (model === OPENAI_RUNTIME_LUNA_MODEL) return 'economy';
  if (model === OPENAI_RUNTIME_SOL_MODEL) return 'quality';
  if (model === OPENAI_RUNTIME_GPT6_LUNA_MODEL) return 'economy';
  if (model === OPENAI_RUNTIME_GPT6_SOL_MODEL) return 'quality';
  if (model === OPENAI_RUNTIME_GPT61_SOL_MODEL) return 'quality';
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
