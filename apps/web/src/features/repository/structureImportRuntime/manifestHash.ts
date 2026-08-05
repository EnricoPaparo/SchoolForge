/**
 * STRUCTURE-IMPORT-02A — authoritative identity of an import attempt.
 *
 * The pure layer (STRUCTURE-IMPORT-01) produces `manifestCanonical`, a stable
 * serialization of the whole manifest. The identity of the attempt is its
 * **SHA-256**, computed here with Web Crypto, and it is what the lease, the
 * attempt document and the replay check are keyed on together with the
 * `requestId`.
 *
 * Why this lives outside the pure package: `crypto.subtle.digest` is
 * asynchronous and is a platform capability, so it cannot sit inside modules
 * that must stay pure and synchronous.
 *
 * Deliberately **not** FNV-1a: 32 bits collide far too easily to decide
 * equality, replay or lease ownership. The old "Importa UDA" flow keeps its own
 * FNV fingerprint as a diagnostic value; nothing here reads it.
 *
 * Fail-closed: when Web Crypto is unavailable (an insecure context, a stripped
 * environment), this **throws** — it never falls back to a weaker digest. The
 * caller must abort before the lease, before staging and before any write.
 */

export class ManifestHashUnavailableError extends Error {
  constructor() {
    super(
      "Impossibile calcolare l'impronta dell'importazione in questo browser. Aggiorna il browser o usa una connessione sicura (https) e riprova.",
    );
    this.name = 'ManifestHashUnavailableError';
  }
}

function subtleCrypto(): SubtleCrypto {
  const provider = globalThis.crypto;
  if (!provider?.subtle?.digest) throw new ManifestHashUnavailableError();
  return provider.subtle;
}

function toHex(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * `hex(SHA-256(UTF8(manifestCanonical)))`, lowercase, 64 characters.
 *
 * The input is the canonical serialization and nothing else: no salt, no
 * timestamp, no `requestId`. Two attempts that would create exactly the same
 * documents and files therefore share a hash — which is precisely what makes a
 * retry recognizable as a replay rather than as a second import.
 */
export async function computeManifestHash(manifestCanonical: string): Promise<string> {
  const subtle = subtleCrypto();
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest('SHA-256', new TextEncoder().encode(manifestCanonical));
  } catch {
    throw new ManifestHashUnavailableError();
  }
  return toHex(digest);
}
