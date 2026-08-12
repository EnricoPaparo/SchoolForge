/**
 * VDIF-01 — identità deterministica della prenotazione di un nome di etichetta.
 *
 * `reservationId = hex(SHA-256(UTF8(ownerUid + U+0000 + nameKey)))`, minuscolo,
 * 64 caratteri. È questo id a rendere l'unicità **autorevole**: due tentativi
 * concorrenti sullo stesso `(ownerUid, nameKey)` puntano allo stesso documento,
 * quindi la loro `create` è mutuamente esclusiva dentro una transazione.
 *
 * **Perché un hash e non il nome in chiaro nel path.** Un path Firestore finisce
 * in log, messaggi di errore, tracce di rete ed export della console. Se il
 * docente scrivesse un nome improprio, quel nome vivrebbe in chiaro dentro un
 * identificatore. L'hash lo impedisce per costruzione senza indebolire nulla:
 * la funzione resta deterministica.
 *
 * Stessa tecnica e stessa disciplina fail-closed di `computeManifestHash`
 * (STRUCTURE-IMPORT-02A): Web Crypto, mai un digest più debole come ripiego,
 * mai una dipendenza nuova.
 */

import { buildLabelReservationInput } from './labelName.js';

export class LabelReservationIdUnavailableError extends Error {
  constructor() {
    super(
      'Impossibile calcolare l’identità del nome in questo browser. Aggiorna il browser o usa una connessione sicura (https) e riprova.',
    );
    this.name = 'LabelReservationIdUnavailableError';
  }
}

function subtleCrypto(): SubtleCrypto {
  const provider = globalThis.crypto;
  if (!provider?.subtle?.digest) throw new LabelReservationIdUnavailableError();
  return provider.subtle;
}

function toHex(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Calcola l'id della prenotazione per la coppia `(ownerUid, nameKey)`.
 *
 * Fail-closed: se Web Crypto non è disponibile (contesto non sicuro, ambiente
 * ridotto) **lancia**. Il chiamante deve interrompere prima di qualsiasi
 * scrittura: senza questo id non esiste garanzia di unicità, e procedere
 * comunque significherebbe creare due etichette con lo stesso nome.
 */
export async function computeLabelReservationId(
  ownerUid: string,
  nameKey: string,
): Promise<string> {
  const subtle = subtleCrypto();
  const input = buildLabelReservationInput(ownerUid, nameKey);
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
  } catch {
    throw new LabelReservationIdUnavailableError();
  }
  return toHex(digest);
}
