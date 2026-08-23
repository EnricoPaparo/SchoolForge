/**
 * VISUAL-ENRICHMENT-03C — contratti puri dell'export binario.
 *
 * L'export ZIP di SchoolForge è sempre stato testuale: il gateway legge `.md` e
 * `.pool.md`, e fino a qui l'immagine di una lezione era documentata ma non
 * trasportata (roadmap §12, limite dichiarato). Questa fase la trasporta, e lo
 * fa con l'unica operazione binaria che serve — nessuna in più.
 *
 * **Il client non nomina mai un percorso.** L'input chiuso porta
 * `programId`, `importId` e `lessonIds`: tutto il resto — `ownerUid`, `udaDir`,
 * `assetId`, `storageRef`, `sha256`, dimensioni, MIME — è derivato dal server
 * leggendo il `LessonDoc`. Un'operazione binaria che accettasse un path sarebbe
 * una lettura arbitraria dello Storage con un nome diverso.
 *
 * **Fail-closed su un visual dichiarato.** Se una lezione dice di avere
 * un'immagine e quell'immagine non è recuperabile e verificabile, l'export si
 * ferma. Un archivio a cui manca in silenzio la figura di una lezione è peggio
 * di un export fallito, perché sembra completo. Una lezione **senza** campo
 * `visual` è invece il caso normale e non produce nulla.
 *
 * Modulo puro: nessun Firebase, nessun I/O.
 */

import { MAX_VISUAL_BYTES } from './aiContentVisualProposal.js';
import { AiVisualError } from './aiVisualCore.js';
import type { LessonVisualPrivateManifest } from './aiVisualManifest.js';

// ─── Limiti del trasporto ─────────────────────────────────────────────────────

/**
 * **Da dove vengono questi numeri.**
 *
 * Una callable Firebase risponde in JSON, quindi i byte binari viaggiano in
 * base64: +33% circa, più il manifest testuale che li accompagna. Il tetto
 * pratico della risposta di una callable di 2ª generazione è dell'ordine delle
 * decine di MB, ma avvicinarcisi significa costruire risposte lente e fragili
 * per risparmiare qualche round-trip su un'operazione che il docente lancia a
 * mano una volta ogni tanto.
 *
 * Il tetto binario è quindi fissato **basso e per intero**: 8 MB di byte
 * effettivi per risposta, cioè ~10,7 MB di base64. Il numero di lezioni per
 * richiesta discende da lì e dal solo limite già congelato in VE-02 — 204.800
 * byte per immagine:
 *
 *     32 lezioni × 204.800 byte = 6.553.600 byte ≤ 8.000.000
 *
 * Trentadue è il più grande multiplo comodo che sta nel caso peggiore lasciando
 * spazio ai manifest. Non è un numero scelto a caso ed è verificato da un test
 * che ricalcola la disuguaglianza: se qualcuno alzasse il numero di lezioni
 * senza alzare il tetto, il test fallirebbe invece di lasciar passare una
 * risposta che in produzione verrebbe troncata.
 */
export const MAX_VISUAL_EXPORT_LESSONS_PER_BATCH = 32;

/** Byte binari (non base64) ammessi in una singola risposta. */
export const MAX_VISUAL_EXPORT_TOTAL_BYTES = 8_000_000;

/** Richieste binarie in volo contemporaneamente, lato client. */
export const MAX_VISUAL_EXPORT_CONCURRENCY = 2;

// ─── Input ────────────────────────────────────────────────────────────────────

export interface VisualExportInput {
  programId: string;
  importId: string;
  lessonIds: string[];
}

const EXPORT_KEYS = ['programId', 'importId', 'lessonIds'] as const;

function invalidInput(message: string): never {
  throw new AiVisualError('invalid_input', message);
}

function assertSegment(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim() ||
    value.includes('/') ||
    value === '.' ||
    value === '..' ||
    Buffer.byteLength(value, 'utf8') > 1_500
  ) {
    invalidInput(`${label} non valido.`);
  }
  return value;
}

export function validateVisualExportInput(value: unknown): VisualExportInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalidInput('Payload mancante o non valido.');
  }
  const root = value as Record<string, unknown>;
  const keys = Object.keys(root).sort();
  const expected = [...EXPORT_KEYS].sort();
  if (keys.length !== expected.length || keys.some((k, i) => k !== expected[i])) {
    invalidInput('Il payload contiene proprietà non ammesse.');
  }

  const rawIds = root.lessonIds;
  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    invalidInput('lessonIds deve contenere almeno una lezione.');
  }
  if (rawIds.length > MAX_VISUAL_EXPORT_LESSONS_PER_BATCH) {
    invalidInput(
      `Sono ammesse al massimo ${MAX_VISUAL_EXPORT_LESSONS_PER_BATCH} lezioni per richiesta.`,
    );
  }
  const lessonIds = rawIds.map((id, index) => assertSegment(id, `lessonIds[${index}]`));
  // Un duplicato non è un dettaglio estetico: farebbe leggere e fatturare due
  // volte lo stesso oggetto, e renderebbe ambigua la corrispondenza fra
  // richiesta e risposta — che è esattamente ciò su cui il client si basa per
  // accorgersi di un risultato mancante.
  if (new Set(lessonIds).size !== lessonIds.length) {
    invalidInput('lessonIds contiene duplicati.');
  }

  return {
    programId: assertSegment(root.programId, 'programId'),
    importId: assertSegment(root.importId, 'importId'),
    lessonIds,
  };
}

// ─── Risultato ────────────────────────────────────────────────────────────────

/**
 * Esito per una singola lezione. `absent` è un esito legittimo e frequente —
 * la maggioranza delle lezioni non ha immagine — e va distinto nettamente da
 * un errore: confonderli produrrebbe o un export che fallisce sempre, o un
 * export che perde le figure in silenzio.
 */
export type VisualExportItem =
  | { lessonId: string; status: 'absent' }
  | {
      lessonId: string;
      status: 'present';
      assetId: string;
      /** Manifest privato validato, serializzato in JSON deterministico. */
      manifestJson: string;
      /** WebP canonico in base64, byte per byte l'oggetto dello Storage. */
      base64: string;
      byteLength: number;
    };

export interface VisualExportResult {
  items: VisualExportItem[];
}

// ─── Serializzazione deterministica del manifest ──────────────────────────────

/**
 * Ordine delle chiavi nel sidecar JSON. È **congelato** qui e non ricavato da
 * `Object.keys`: l'ordine di enumerazione di un oggetto letto da Firestore
 * dipende da come è stato scritto, e due export della stessa lezione
 * produrrebbero due file diversi a parità di contenuto.
 */
const EXPORT_MANIFEST_KEY_ORDER = [
  'assetId',
  'storageRef',
  'anchor',
  'caption',
  'altText',
  'width',
  'height',
  'byteLength',
  'sha256',
  'mimeType',
  'styleVersion',
  'sourceBodyHash',
  'approvedAt',
] as const;

const EXPORT_ANCHOR_KEY_ORDER = ['headingSlug', 'headingText', 'placement'] as const;

/**
 * Serializza il manifest privato **già validato** in JSON deterministico.
 *
 * `approvedAt` diventa un ISO 8601 UTC: un `Timestamp` non è serializzabile in
 * JSON in modo stabile, e la sua forma interna (`_seconds`/`_nanoseconds`) è un
 * dettaglio dell'SDK che non ha ragione di finire in un archivio destinato a
 * sopravvivere alle versioni.
 *
 * Che cosa **non** contiene, e non per omissione ma perché il manifest non le
 * ha mai avute: URL pubbliche, download token, dati o identificativi del
 * provider, prompt, subject, costi, API key, dati studente.
 */
export function serializeVisualManifestForExport(manifest: LessonVisualPrivateManifest): string {
  const approvedAtMs = manifest.approvedAt.toMillis();
  const ordered: Record<string, unknown> = {};
  for (const key of EXPORT_MANIFEST_KEY_ORDER) {
    if (key === 'approvedAt') {
      ordered.approvedAt = new Date(approvedAtMs).toISOString();
      continue;
    }
    if (key === 'anchor') {
      const anchor: Record<string, unknown> = {};
      for (const anchorKey of EXPORT_ANCHOR_KEY_ORDER)
        anchor[anchorKey] = manifest.anchor[anchorKey];
      ordered.anchor = anchor;
      continue;
    }
    ordered[key] = manifest[key];
  }
  // Indentazione a 2 spazi e newline finale: un sidecar che un essere umano
  // può aprire e un diff può confrontare riga per riga.
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

// ─── Percorsi nello ZIP ───────────────────────────────────────────────────────

/**
 * Prefisso dei sidecar visuali dentro l'archivio.
 *
 * È di primo livello e piatto: gli `assetId` sono UUID, quindi non collidono, e
 * tenerli fuori dalle directory delle UDA garantisce che un file visuale non
 * possa **mai** occupare il nome di una lezione, di un pool o del manifest di
 * UDA. Il prezzo è che l'importer deve saperlo ignorare esplicitamente — e lo
 * fa, vedi `readZipFile.ts`.
 */
export const VISUAL_EXPORT_ZIP_PREFIX = 'visuals/';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * I due percorsi ZIP di un asset. L'`assetId` è già un UUID validato quando
 * arriva qui, ma viene ricontrollato **al momento di comporre un path**: è il
 * punto in cui un valore inatteso smetterebbe di essere un dato e diventerebbe
 * una posizione nel filesystem di chi apre l'archivio.
 */
export function visualExportZipPaths(assetId: string): { json: string; webp: string } {
  if (typeof assetId !== 'string' || !UUID_V4_RE.test(assetId)) {
    invalidInput('assetId non valido per l’export.');
  }
  return {
    json: `${VISUAL_EXPORT_ZIP_PREFIX}${assetId}.json`,
    webp: `${VISUAL_EXPORT_ZIP_PREFIX}${assetId}.webp`,
  };
}

/**
 * Nessun percorso dell'archivio può essere scritto due volte, e nessun percorso
 * visuale può collidere con un file didattico.
 *
 * `JSZip.file()` sovrascrive in silenzio: senza questo controllo due lezioni che
 * dichiarassero lo stesso `assetId` — per un bug, una copia manuale di un
 * documento o un restore parziale — produrrebbero un archivio in cui una delle
 * due figure è sparita senza che nulla lo segnali.
 */
export function assertNoZipPathCollisions(paths: readonly string[]): void {
  const seen = new Set<string>();
  for (const path of paths) {
    if (
      path.length === 0 ||
      path.startsWith('/') ||
      path.includes('//') ||
      path.includes('\\') ||
      path.split('/').some((segment) => segment === '.' || segment === '..')
    ) {
      throw new AiVisualError('corrupted_state', `Percorso non valido nell’archivio: ${path}`);
    }
    if (seen.has(path)) {
      throw new AiVisualError(
        'corrupted_state',
        `Due file dell’archivio userebbero lo stesso percorso: ${path}`,
      );
    }
    seen.add(path);
  }
}

// ─── Riconciliazione dei batch ────────────────────────────────────────────────

/**
 * Verifica che la risposta di un batch corrisponda **esattamente** alla
 * richiesta: stessi id, stesso numero, stesso ordine, nessun duplicato.
 *
 * È il controllo che rende sicuro dividere l'export in più chiamate. Senza,
 * un risultato mancante diventerebbe una lezione senza figura e un duplicato
 * diventerebbe una figura sbagliata attribuita alla lezione vicina — in
 * entrambi i casi dentro un archivio che sembra completo.
 */
export function reconcileVisualExportBatch(params: {
  requested: readonly string[];
  items: readonly VisualExportItem[];
}): void {
  const { requested, items } = params;
  if (items.length !== requested.length) {
    throw new AiVisualError(
      'corrupted_state',
      'La risposta dell’export non copre tutte le lezioni richieste.',
    );
  }
  const seen = new Set<string>();
  for (let i = 0; i < requested.length; i += 1) {
    const item = items[i];
    if (!item || item.lessonId !== requested[i]) {
      throw new AiVisualError(
        'corrupted_state',
        'L’ordine della risposta dell’export non è quello richiesto.',
      );
    }
    if (seen.has(item.lessonId)) {
      throw new AiVisualError('corrupted_state', 'La risposta dell’export contiene un duplicato.');
    }
    seen.add(item.lessonId);
  }
}

/** Il caso peggiore di un batch pieno deve stare nel tetto dichiarato. */
export const VISUAL_EXPORT_WORST_CASE_BYTES =
  MAX_VISUAL_EXPORT_LESSONS_PER_BATCH * MAX_VISUAL_BYTES;

/**
 * Divide le lezioni in batch di dimensione ammessa, conservando l'ordine
 * canonico. La suddivisione è per **numero** e non per byte previsti: i byte
 * non sono noti prima di leggere, e il tetto per immagine garantisce già che un
 * batch pieno stia sotto il tetto totale.
 */
export function planVisualExportBatches(lessonIds: readonly string[]): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < lessonIds.length; i += MAX_VISUAL_EXPORT_LESSONS_PER_BATCH) {
    batches.push(lessonIds.slice(i, i + MAX_VISUAL_EXPORT_LESSONS_PER_BATCH));
  }
  return batches;
}
