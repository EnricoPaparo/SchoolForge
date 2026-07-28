/**
 * UI-VERIFICHE-06B — data didattica della verifica.
 *
 * Contratto canonico: stringa **esatta** `YYYY-MM-DD`, giorno di calendario
 * reale. Deliberatamente **non** un `Timestamp`: la data di una verifica è un
 * fatto didattico (il giorno in cui si svolge), non un istante — convertirla in
 * un istante introdurrebbe un fuso orario e la farebbe scivolare di un giorno a
 * seconda di dove viene letta.
 *
 * Nessuna normalizzazione silenziosa: `2026-2-3`, `03/02/2026`, spazi ai bordi o
 * un `Date` sono **rifiutati**, non corretti. Nessun limite arbitrario a passato
 * o futuro: una verifica può essere registrata a posteriori o programmata.
 *
 * Compatibilità: il campo è opzionale sui documenti esistenti. Una verifica
 * legacy senza data resta pienamente leggibile e la data viene semplicemente
 * omessa in UI — nessuna migrazione, nessun valore inventato.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `true` solo per una stringa `YYYY-MM-DD` che denota un giorno realmente
 * esistente. Rifiuta `2026-02-30`, `2026-13-01`, `2026-00-10` e qualunque
 * forma diversa (inclusi valori non stringa).
 */
export function isValidVerificationDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  // `Date.UTC` è usato solo come calendario (giorni per mese, anni bisestili),
  // mai come istante: nulla di questo valore viene persistito o confrontato.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Errore parlante e fail-closed per i percorsi di scrittura. */
export function assertValidVerificationDate(value: unknown): string {
  if (!isValidVerificationDate(value)) {
    throw new Error('La data della verifica deve essere un giorno valido nel formato AAAA-MM-GG.');
  }
  return value;
}

/**
 * `2026-02-02` → `02/02/2026`. Restituisce `null` per qualunque valore assente o
 * non conforme: una data malformata non viene mai mostrata a metà né corretta.
 */
export function formatVerificationDateIt(value: unknown): string | null {
  if (!isValidVerificationDate(value)) return null;
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}

/** «1 Domanda» / «0 Domande» / «6 Domande» — D maiuscola, singolare solo per 1. */
export function formatQuestionCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'Domanda' : 'Domande'}`;
}

/**
 * Testata condivisa da card docente e card studente:
 * `02/02/2026 · Titolo verifica · 6 Domande`.
 *
 * La data è omessa (senza separatore residuo) sulle verifiche legacy che non ne
 * hanno una: mai un trattino o un placeholder inventato. Restituisce le parti
 * separate perché la card renda il titolo con il proprio stile.
 */
export function buildVerificationHeadline(params: {
  verificationDate?: string | null;
  questionCount: number;
}): { datePrefix: string | null; questionLabel: string } {
  return {
    datePrefix: formatVerificationDateIt(params.verificationDate),
    questionLabel: formatQuestionCountLabel(params.questionCount),
  };
}
