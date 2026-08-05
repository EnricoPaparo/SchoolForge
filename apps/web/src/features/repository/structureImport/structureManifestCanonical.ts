/**
 * STRUCTURE-IMPORT-01 — canonical serialization of an append manifest.
 *
 * **This module produces a string, not an identity.** The authoritative
 * identity of an attempt is `SHA-256(manifestCanonical)`, and it is computed by
 * the STRUCTURE-IMPORT-02A/02B runtime adapter via Web Crypto
 * (`crypto.subtle.digest`), **before** acquiring the lease and before any
 * staging or write. It is not computed here for one reason only: `subtle.digest`
 * is asynchronous, and these planners must stay pure and synchronous.
 *
 * The FNV-1a fingerprint used by the older "Importa UDA" flow
 * (`importUda/manifestHash.ts`) is a 32-bit **diagnostic** value. It is
 * deliberately not reused here and must never decide equality, replay,
 * idempotency, lease ownership or the reuse of an attempt: 32 bits collide far
 * too easily for that. That flow is left exactly as it was.
 *
 * ## What "canonical" means here
 *
 * Two serializations are equal if and only if the two manifests are equal as
 * data. To get there:
 *
 * - object keys are sorted, so a manifest built by listing properties in a
 *   different order serializes identically — property order carries no meaning;
 * - array order **is** preserved, because it does carry meaning: the append
 *   order is the file order;
 * - `undefined` properties are omitted, so an absent key and an explicitly
 *   undefined one cannot differ;
 * - every value is written with `JSON.stringify`, which escapes strings
 *   unambiguously, and each key/value pair is length-prefixed, so no
 *   combination of separators inside the data can imitate a structural
 *   boundary.
 *
 * Pure module: no crypto, no async, no Firebase, no DOM.
 */

/**
 * The version tag of the serialization format. It is part of the serialized
 * output, so changing how manifests are serialized changes every identity
 * derived from it instead of silently making two incompatible attempts look
 * equal.
 */
export const MANIFEST_CANONICAL_VERSION = 'structure-import/manifest-canonical/v1';

type Serializable =
  | string
  | number
  | boolean
  | null
  | undefined
  | Serializable[]
  | { [key: string]: Serializable };

function serialize(value: Serializable): string {
  if (value === undefined) return 'u';
  if (value === null) return 'z';
  if (typeof value === 'string') return `s${JSON.stringify(value)}`;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      // A manifest can only ever carry integers (`order`, counters). Anything
      // else is a bug upstream, and silently serializing `NaN` would make two
      // different manifests look identical.
      throw new Error('Manifest non serializzabile: valore numerico non finito.');
    }
    return `n${JSON.stringify(value)}`;
  }
  if (typeof value === 'boolean') return value ? 'b1' : 'b0';
  if (Array.isArray(value)) {
    // Order preserved: it is semantic.
    const items = value.map((item) => serialize(item));
    return `a${items.length}[${items.join(',')}]`;
  }

  // Keys sorted: property order is not semantic.
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    // Length-prefixed keys: no key can imitate a separator.
    .map(([key, item]) => `${key.length}:${key}=${serialize(item)}`);
  return `o${entries.length}{${entries.join(',')}}`;
}

/**
 * Canonical, stable serialization of any manifest body.
 *
 * The value passed in must be the manifest **without** its own
 * `manifestCanonical` field: a serialization cannot contain itself.
 */
export function canonicalizeManifest(body: unknown): string {
  return canonicalizeWithVersion(MANIFEST_CANONICAL_VERSION, body);
}

/**
 * The same canonical serialization under an explicit version tag, for the other
 * closed structures the protocol needs to identify — today the **source** of an
 * import (see `structureSourceCanonical.ts`), whose hash must be computable
 * *before* the planner runs.
 *
 * The tag is part of the output: two structures serialized under different tags
 * can never collide, and changing how one of them is built changes every
 * identity derived from it instead of silently equating two incompatible
 * things.
 */
export function canonicalizeWithVersion(version: string, body: unknown): string {
  return `${version}\n${serialize(body as Serializable)}`;
}
