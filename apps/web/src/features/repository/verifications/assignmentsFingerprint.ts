/**
 * VDIF-04 — impronta deterministica delle assegnazioni studente → etichetta,
 * usata dalla guardia **G20**.
 *
 * ## Perché serve un'impronta e non una rilettura
 *
 * La transazione di attivazione non può rileggere `studentLabelAssignments`:
 * una `getDocs` non è ammessa dentro una transazione Firestore client, e le
 * assegnazioni sono decine di documenti fuori dal perimetro della transazione.
 * Il preflight calcola quindi questa impronta sulle assegnazioni che ha
 * congelato e la ricalcola **immediatamente prima** di aprire la transazione:
 * se le due differiscono, lo snapshot che si stava per congelare è già stantio
 * e l'attivazione si ferma.
 *
 * ## Limite dichiarato, senza ipocrisia
 *
 * È una finestra **stretta**, non nulla. In un sistema single-owner l'unico
 * principal che può cambiare le assegnazioni è il docente stesso: la finestra
 * reale è quella di due schede aperte dello stesso browser. Ciò che questa
 * impronta garantisce è che uno snapshot palesemente stantio non venga
 * congelato in silenzio; ciò che **non** garantisce è la serializzabilità
 * completa, che richiederebbe una Cloud Function di attivazione — costo
 * sproporzionato rispetto al rischio in questo modello.
 *
 * Stessa tecnica di `computeLabelReservationId` e di `manifestCanonical`
 * (STRUCTURE-IMPORT-01): Web Crypto, mai un digest più debole come ripiego,
 * mai una dipendenza nuova.
 */

export class AssignmentsFingerprintUnavailableError extends Error {
  constructor() {
    super(
      'Impossibile verificare le etichette degli studenti in questo browser. Aggiorna il browser o usa una connessione sicura (https) e riprova.',
    );
    this.name = 'AssignmentsFingerprintUnavailableError';
  }
}

function subtleCrypto(): SubtleCrypto {
  const provider = globalThis.crypto;
  if (!provider?.subtle?.digest) throw new AssignmentsFingerprintUnavailableError();
  return provider.subtle;
}

function toHex(buffer: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(buffer)) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Serializzazione **canonica** delle coppie `studentUid:labelId`: ordinate per
 * `studentUid`, separate da `U+0000` dentro la coppia e da `U+001E` fra le
 * coppie. Due separatori che non possono comparire in un uid o in un id di
 * documento Firestore, quindi nessuna coppia di input diversi può produrre la
 * stessa stringa.
 *
 * Esposta perché il test possa asserire sulla forma esatta invece che sul solo
 * digest, che non direbbe nulla su cosa è stato serializzato.
 */
export function canonicalAssignmentsInput(byStudentUid: Record<string, string>): string {
  return Object.entries(byStudentUid)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([studentUid, labelId]) => `${studentUid}\u0000${labelId}`)
    .join('\u001E');
}

/**
 * `hex(SHA-256(UTF8(canonical)))`, minuscolo, 64 caratteri.
 *
 * Fail-closed: senza Web Crypto **lancia**. Il chiamante deve fermarsi prima di
 * qualunque scrittura — senza impronta la guardia G20 non esiste, e attivare
 * comunque significherebbe congelare assegnazioni che nessuno ha verificato.
 */
export async function computeAssignmentsFingerprint(
  byStudentUid: Record<string, string>,
): Promise<string> {
  const subtle = subtleCrypto();
  let digest: ArrayBuffer;
  try {
    digest = await subtle.digest(
      'SHA-256',
      new TextEncoder().encode(canonicalAssignmentsInput(byStudentUid)),
    );
  } catch {
    throw new AssignmentsFingerprintUnavailableError();
  }
  return toHex(digest);
}
