/**
 * TWU-02 — profili modello **chiusi** della correzione IA. Il client sceglie un
 * profilo astratto (`economy` | `quality`) e **mai** un model ID o un listino:
 * il mapping profilo → modello tecnico + versione listino è **esclusivamente**
 * server-side e fail-closed, così un client non può iniettare un modello
 * arbitrario né disaccoppiare modello e prezzo.
 *
 * Modulo **puro**: nessuna dipendenza Firestore/rete. Riusa le costanti
 * autoritative di `aiCorrectionCost.ts` — nessun nuovo modello o listino è
 * introdotto qui.
 */

import { AiGatewayError } from './aiCorrectionGatewayCore.js';
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
 * Normalizza il campo `modelProfile` **inviato dal client**. **Assente**
 * (`undefined`) ⇒ `undefined` (il chiamante applicherà il default legacy dal
 * modello runtime). Ogni altro caso è fail-closed: `null`, stringa sconosciuta,
 * o tipo non-stringa ⇒ `invalid_input`. Nessun fallback silenzioso.
 */
export function normalizeModelProfileField(value: unknown): ModelProfile | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' && (MODEL_PROFILES as readonly string[]).includes(value)) {
    return value as ModelProfile;
  }
  throw new AiGatewayError('invalid_input', 'Profilo modello non valido.');
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
 * Risolve la coppia (modello, listino) autoritativa per un profilo. Fail-closed:
 * un profilo fuori mappa ⇒ `provider_config_invalid` (mai un modello arbitrario).
 */
export function resolveModelProfile(profile: ModelProfile): ModelProfileResolution {
  const resolution = MODEL_PROFILE_RESOLUTIONS[profile];
  if (!resolution) {
    throw new AiGatewayError('provider_config_invalid', 'Profilo modello non risolvibile.');
  }
  return resolution;
}
