/**
 * Semantica canonica di un **id documento Firestore**, in un modulo neutro.
 *
 * Queste regole vivevano dentro `forceSubmitCore.ts`, cioè dentro un dominio
 * applicativo. Riusarle da lì avrebbe legato l'export visuale alla consegna
 * forzata di una verifica — due cose che non hanno niente a che vedere l'una con
 * l'altra — e riscriverle a mano avrebbe prodotto la solita seconda versione più
 * debole della prima. Stanno quindi qui: nessun import, nessun dominio, nessuna
 * dipendenza Firebase.
 *
 * Il modulo è **puro** e non lancia: decide soltanto se un valore è un id
 * valido. Chi chiama traduce l'esito nell'errore tipizzato del proprio contesto.
 */

/**
 * Dimensione **reale in byte UTF-8**. Il limite Firestore sugli id documento è
 * espresso in byte, non in caratteri: `'é'` occupa 2 byte e un'emoji ne occupa
 * 4, quindi contare i caratteri (o le UTF-16 code unit) sottostima il limite e
 * lascerebbe passare id che Firestore rifiuta.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const codePoint of value) {
    const cp = codePoint.codePointAt(0)!;
    if (cp < 0x80) bytes += 1;
    else if (cp < 0x800) bytes += 2;
    else if (cp < 0x10000) bytes += 3;
    else bytes += 4;
  }
  return bytes;
}

/** Limite Firestore per un id documento, in byte UTF-8. */
export const MAX_DOCUMENT_ID_BYTES = 1500;

/**
 * Un id documento Firestore valido: non vuoto, senza '/', diverso da '.'/'..',
 * non nella forma riservata `__…__`, senza caratteri di controllo, e — verificato
 * sui **byte UTF-8** — entro il limite di 1500 byte.
 *
 * Ognuna di queste condizioni corrisponde a un modo diverso in cui un id
 * apparentemente innocuo smette di essere un dato: `/` cambia il documento
 * indirizzato, `..` risale, `__…__` collide con lo spazio dei nomi riservato di
 * Firestore, un carattere di controllo rende illeggibile un log.
 */
export function isValidDocumentId(value: string): boolean {
  if (value.length === 0) return false;
  if (utf8ByteLength(value) > MAX_DOCUMENT_ID_BYTES) return false;
  if (value.includes('/')) return false;
  if (value === '.' || value === '..') return false;
  if (value.startsWith('__') && value.endsWith('__')) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return false;
  return true;
}

/**
 * Variante che accetta `unknown` e verifica anche il tipo e l'assenza di spazi
 * ai bordi.
 *
 * Il trim esterno non è vietato da Firestore, ma un id con spazi ai bordi è
 * quasi sempre il sintomo di un input incollato male: accettarlo creerebbe due
 * documenti indistinguibili a occhio nudo.
 */
export function isValidDocumentIdInput(value: unknown): value is string {
  return typeof value === 'string' && value === value.trim() && isValidDocumentId(value);
}
