/**
 * SGW-01 — logica pura del Repository Storage Gateway, senza dipendenze
 * `firebase-admin`/`firebase-functions`: routing, autorizzazione, validazione
 * path/contenuto, handler core e storage port su un bucket duck-typed. Testabile
 * in isolamento; il wiring runtime (Admin SDK, `onRequest`) è in
 * `repositoryGateway.ts`.
 */

/** Limite dimensione per file (coerente con `MAX_LESSON_CONTENT_BYTES`). */
export const MAX_FILE_BYTES = 700_000;
export const MAX_BATCH_READ_FILES = 300;
export const MAX_BATCH_READ_TOTAL_BYTES = 20_000_000;
const BATCH_READ_CONCURRENCY = 8;
export const MAX_BATCH_WRITE_FILES = 300;
// The request body is JSON: control characters can expand up to six bytes when
// escaped. Keeping the raw UTF-8 payload at 4 MB leaves a safe margin below the
// HTTP request limit even for the worst valid string representation.
export const MAX_BATCH_WRITE_TOTAL_BYTES = 4_000_000;
const BATCH_WRITE_CONCURRENCY = 8;

/** Errore applicativo del gateway: `code` + `status` HTTP. */
export class GatewayError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'GatewayError';
    this.code = code;
    this.status = status;
  }
}

export type Route = 'read' | 'write' | 'delete' | 'delete-prefix' | 'batch-read' | 'batch-write';

/**
 * Routing rigoroso: accetta **solo**
 * `/api/repository/{read|write|delete|delete-prefix|batch-read|batch-write}`
 * (con un eventuale singolo slash finale tollerato). Qualsiasi prefisso,
 * suffisso o segmento aggiuntivo → `null` (l'handler risponde 404 senza toccare
 * Storage). Rifiuta `/repository/read`, `/evil/repository/read`,
 * `/api/repository/read/extra`, alias non documentati.
 */
export function parseRoute(requestPath: string): Route | null {
  if (typeof requestPath !== 'string') return null;
  const normalized = requestPath.endsWith('/') ? requestPath.slice(0, -1) : requestPath;
  const match =
    /^\/api\/repository\/(read|write|delete|delete-prefix|batch-read|batch-write)$/.exec(
      normalized,
    );
  return match ? (match[1] as Route) : null;
}

/**
 * Content-Type rigoroso: il media type deve essere **esattamente**
 * `application/json` (case-insensitive, spazi normalizzati), con eventuali
 * parametri (es. `; charset=utf-8`). Rifiuta `text/application/json`,
 * `application/json-malicious`, `text/plain`.
 */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';', 1)[0]!.trim().toLowerCase();
  return mediaType === 'application/json';
}

// Allowlist dei segmenti del path. `uid`/`importId` sono identificatori tecnici
// (niente punti); i segmenti file/cartella ammettono il punto per le estensioni.
const OWNER_ID_RE = /^[A-Za-z0-9_-]+$/;
const FILE_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Validazione esplicita (allowlist) del path, compatibile con i percorsi
 * realmente prodotti da SchoolForge: `repository/{ownerUid}/imports/{importId}/…`
 * con `programma.md` alla root dell'import o file dentro le cartelle UDA.
 * Rifiuta spazi, `:`, query/fragment, emoji/Unicode arbitrario, `.`/`..`,
 * slash doppio, backslash, percent-encoding, controllo e URL. Solo `.md`/`.pool.md`.
 */
export function validateRepositoryPath(rawPath: unknown, uid: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new GatewayError('invalid_path', 'Path mancante o non valido.', 400);
  }
  const path = rawPath;

  // Difesa in profondità su forme pericolose (ridondante con l'allowlist, ma
  // dà messaggi mirati e chiude subito i casi ovvi).
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new GatewayError('invalid_path', 'Path con caratteri di controllo.', 400);
  }
  if (/%[0-9a-fA-F]{2}/.test(path)) {
    throw new GatewayError('invalid_path', 'Path con percent-encoding non ammesso.', 400);
  }

  const segments = path.split('/');
  // Slash doppio, iniziale o finale → segmento vuoto.
  if (segments.some((s) => s.length === 0)) {
    throw new GatewayError('invalid_path', 'Path con slash ambigue o vuote.', 400);
  }
  // repository / {ownerUid} / imports / {importId} / …almeno un segmento.
  if (segments.length < 5) {
    throw new GatewayError(
      'invalid_path',
      'Il path deve essere sotto repository/{uid}/imports/{importId}/…',
      400,
    );
  }
  if (segments[0] !== 'repository' || segments[2] !== 'imports') {
    throw new GatewayError(
      'invalid_path',
      'Il path deve essere sotto repository/{uid}/imports/{importId}/…',
      400,
    );
  }
  if (!OWNER_ID_RE.test(segments[1]!)) {
    throw new GatewayError('invalid_path', 'ownerUid del path non valido.', 400);
  }
  if (segments[1] !== uid) {
    throw new GatewayError('not_owner', 'Il path non appartiene all’utente autenticato.', 403);
  }
  if (!OWNER_ID_RE.test(segments[3]!)) {
    throw new GatewayError('invalid_path', 'importId del path non valido.', 400);
  }
  for (const segment of segments.slice(4)) {
    if (segment === '.' || segment === '..' || segment.includes('..')) {
      throw new GatewayError('invalid_path', 'Path con segmenti relativi non ammessi.', 400);
    }
    if (!FILE_SEGMENT_RE.test(segment)) {
      throw new GatewayError('invalid_path', 'Path con caratteri non ammessi.', 400);
    }
  }
  if (!path.endsWith('.pool.md') && !path.endsWith('.md')) {
    throw new GatewayError('unsupported_extension', 'Sono ammessi solo file .md o .pool.md.', 415);
  }
  return path;
}

/**
 * Valida il solo prefisso eliminabile in blocco: la root esatta di un import.
 * Non accetta file, sottocartelle o prefissi più ampi, così una chiamata non
 * può cancellare altri import o l'intero repository del docente.
 */
export function validateImportPrefix(rawPath: unknown, uid: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new GatewayError('invalid_path', 'Prefisso mancante o non valido.', 400);
  }
  const segments = rawPath.split('/');
  if (
    segments.length !== 4 ||
    segments[0] !== 'repository' ||
    segments[2] !== 'imports' ||
    !OWNER_ID_RE.test(segments[1] ?? '') ||
    !OWNER_ID_RE.test(segments[3] ?? '')
  ) {
    throw new GatewayError(
      'invalid_path',
      'Il prefisso deve essere repository/{uid}/imports/{importId}.',
      400,
    );
  }
  if (segments[1] !== uid) {
    throw new GatewayError('not_owner', 'Il prefisso non appartiene all’utente autenticato.', 403);
  }
  return rawPath;
}

/** Valida una richiesta batch-read, preservando ordine e unicità dei path. */
export function validateBatchReadPaths(rawPaths: unknown, uid: string): string[] {
  if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
    throw new GatewayError('invalid_paths', 'La lista dei path è mancante o vuota.', 400);
  }
  if (rawPaths.length > MAX_BATCH_READ_FILES) {
    throw new GatewayError(
      'too_many_files',
      `Sono ammessi al massimo ${MAX_BATCH_READ_FILES} file per richiesta.`,
      400,
    );
  }
  const paths = rawPaths.map((path) => validateRepositoryPath(path, uid));
  if (new Set(paths).size !== paths.length) {
    throw new GatewayError('duplicate_path', 'La lista contiene path duplicati.', 400);
  }
  return paths;
}

export type ValidatedBatchWriteFile = { path: string; buf: Buffer };

/**
 * Valida l'intero batch prima di qualunque I/O: forma chiusa, path owner-only,
 * contenuto UTF-8, limite per file, unicità e tetto complessivo. In questo modo
 * un input invalido non può produrre un upload parziale.
 */
export function validateBatchWriteFiles(rawFiles: unknown, uid: string): ValidatedBatchWriteFile[] {
  if (!Array.isArray(rawFiles) || rawFiles.length === 0) {
    throw new GatewayError('invalid_files', 'La lista dei file è mancante o vuota.', 400);
  }
  if (rawFiles.length > MAX_BATCH_WRITE_FILES) {
    throw new GatewayError(
      'too_many_files',
      `Sono ammessi al massimo ${MAX_BATCH_WRITE_FILES} file per richiesta.`,
      400,
    );
  }

  let totalBytes = 0;
  const files = rawFiles.map((rawFile) => {
    if (typeof rawFile !== 'object' || rawFile === null || Array.isArray(rawFile)) {
      throw new GatewayError('invalid_file', 'Elemento file non valido.', 400);
    }
    const record = rawFile as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== 'content' || keys[1] !== 'path') {
      throw new GatewayError(
        'invalid_file',
        'Ogni file deve contenere soltanto path e content.',
        400,
      );
    }
    const path = validateRepositoryPath(record.path, uid);
    const buf = validateContent(record.content);
    totalBytes += buf.byteLength;
    if (totalBytes > MAX_BATCH_WRITE_TOTAL_BYTES) {
      throw new GatewayError(
        'total_too_large',
        `La richiesta supera il limite di ${MAX_BATCH_WRITE_TOTAL_BYTES} byte.`,
        413,
      );
    }
    return { path, buf };
  });

  if (new Set(files.map((file) => file.path)).size !== files.length) {
    throw new GatewayError('duplicate_path', 'La lista contiene path duplicati.', 400);
  }
  return files;
}

/** True se la stringa contiene surrogati UTF-16 isolati (UTF-8 non codificabile). */
export function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Valida il contenuto: stringa UTF-8 codificabile, entro `MAX_FILE_BYTES`. */
export function validateContent(content: unknown): Buffer {
  if (typeof content !== 'string') {
    throw new GatewayError('invalid_content', 'Contenuto mancante o non stringa.', 400);
  }
  if (hasLoneSurrogate(content)) {
    throw new GatewayError('invalid_utf8', 'Contenuto con surrogati UTF-16 isolati.', 400);
  }
  const buf = Buffer.from(content, 'utf-8');
  if (buf.byteLength > MAX_FILE_BYTES) {
    throw new GatewayError(
      'file_too_large',
      `Il file supera il limite di ${MAX_FILE_BYTES} byte.`,
      413,
    );
  }
  return buf;
}

export type AuthDeps = {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  getOwnerUid: () => Promise<string | null>;
};

/**
 * Autorizza **solo** il docente proprietario: verifica l'ID token e confronta
 * l'uid con `settings/owner.ownerUid` (fonte autoritativa; **non**
 * `settings/ownerPublic`). Studenti e qualsiasi altro account autenticato sono
 * negati. Il solo `uid` nel path non basta mai.
 */
export async function authorizeOwner(
  authHeader: string | undefined,
  deps: AuthDeps,
): Promise<string> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new GatewayError('unauthenticated', 'Token di autenticazione mancante.', 401);
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    throw new GatewayError('unauthenticated', 'Token di autenticazione mancante.', 401);
  }
  let uid: string;
  try {
    const decoded = await deps.verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    throw new GatewayError('unauthenticated', 'Token non valido o scaduto.', 401);
  }
  const ownerUid = await deps.getOwnerUid();
  if (!ownerUid || ownerUid !== uid) {
    throw new GatewayError('not_owner', 'Accesso riservato al docente proprietario.', 403);
  }
  return uid;
}

/** Astrazione minima sul bucket, così l'handler è testabile senza Storage. */
export type StoragePort = {
  read: (path: string) => Promise<{ exists: boolean; content?: string }>;
  write: (path: string, buf: Buffer) => Promise<void>;
  /** Ritorna `true` se il file esisteva (per la risposta idempotente). */
  delete: (path: string) => Promise<boolean>;
  /** Elimina tutti gli oggetti sotto la root esatta di un import. */
  deletePrefix: (path: string) => Promise<void>;
};

/** Riconosce un errore Google Cloud Storage "oggetto non trovato" (HTTP 404). */
export function isStorageNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 404;
}

/**
 * File/bucket duck-typed: solo ciò che serve al gateway, così è mockabile e
 * compatibile con il `Bucket`/`File` reale dell'Admin SDK. Metodi in forma
 * shorthand (parametri bivarianti) per accettare le firme più larghe del SDK.
 */
export interface FileLike {
  download(): Promise<[Uint8Array]>;
  save(data: Uint8Array, options?: unknown): Promise<unknown>;
  delete(): Promise<unknown>;
}
export interface BucketLike {
  file(path: string): FileLike;
  deleteFiles(options: { prefix: string }): Promise<unknown>;
}

/**
 * Storage port su un bucket: **una sola** operazione per read/delete (nessun
 * `exists()` seguito da `download()`/`delete()` → niente doppie operazioni
 * fatturabili né race "esiste, poi scompare"). Il 404 è gestito in modo mirato;
 * la lettura decodifica in UTF-8 con `fatal: true`, così un oggetto non UTF-8
 * valido produce un errore strutturato invece di testo corrotto.
 */
export function createStoragePort(bucket: BucketLike): StoragePort {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    read: async (path) => {
      try {
        const [bytes] = await bucket.file(path).download();
        let content: string;
        try {
          content = decoder.decode(bytes);
        } catch {
          throw new GatewayError(
            'invalid_stored_utf8',
            'Il contenuto del file non è UTF-8 valido.',
            422,
          );
        }
        return { exists: true, content };
      } catch (err) {
        if (err instanceof GatewayError) throw err;
        if (isStorageNotFound(err)) return { exists: false };
        throw err;
      }
    },
    write: async (path, buf) => {
      await bucket.file(path).save(buf, {
        contentType: 'text/markdown; charset=utf-8',
        resumable: false,
      });
    },
    delete: async (path) => {
      try {
        await bucket.file(path).delete();
        return true;
      } catch (err) {
        if (isStorageNotFound(err)) return false;
        throw err;
      }
    },
    deletePrefix: async (path) => {
      await bucket.deleteFiles({ prefix: `${path}/` });
    },
  };
}

export type GatewayInput = {
  method: string;
  route: Route | null;
  contentType: string | undefined;
  authHeader: string | undefined;
  body: { path?: unknown; paths?: unknown; files?: unknown; content?: unknown } | undefined;
};

export type GatewayResult = { status: number; body: unknown };

function errorResult(status: number, code: string, message: string): GatewayResult {
  return { status, body: { error: { code, message } } };
}

/**
 * Core dell'handler, puro rispetto a I/O (dipendenze iniettate). Ordine:
 * metodo → rotta (404 endpoint sconosciuto, senza toccare Storage) →
 * Content-Type → autorizzazione → validazione path → dispatch. Ritorna status +
 * body JSON; non logga mai token, contenuti, pool o soluzioni.
 */
export async function handleGateway(
  input: GatewayInput,
  deps: AuthDeps & { storage: StoragePort },
): Promise<GatewayResult> {
  try {
    if (input.method !== 'POST') {
      return errorResult(405, 'method_not_allowed', 'Metodo non consentito.');
    }
    if (input.route === null) {
      return errorResult(404, 'not_found', 'Endpoint non trovato.');
    }
    if (!isJsonContentType(input.contentType)) {
      return errorResult(
        415,
        'unsupported_media_type',
        'Content-Type deve essere application/json.',
      );
    }
    const uid = await authorizeOwner(input.authHeader, deps);
    if (input.route === 'batch-read') {
      const paths = validateBatchReadPaths(input.body?.paths, uid);
      const files: Array<
        | { path: string; content: string; encoding: 'utf-8' }
        | { path: string; error: { code: 'file_not_found'; message: string } }
      > = [];
      let totalBytes = 0;

      for (let i = 0; i < paths.length; i += BATCH_READ_CONCURRENCY) {
        const chunk = paths.slice(i, i + BATCH_READ_CONCURRENCY);
        const results = await Promise.all(
          chunk.map(async (path) => ({ path, result: await deps.storage.read(path) })),
        );
        for (const { path, result } of results) {
          if (!result.exists) {
            files.push({
              path,
              error: { code: 'file_not_found', message: 'File non trovato.' },
            });
            continue;
          }
          const content = result.content ?? '';
          totalBytes += Buffer.byteLength(content, 'utf-8');
          if (totalBytes > MAX_BATCH_READ_TOTAL_BYTES) {
            throw new GatewayError(
              'total_too_large',
              `La risposta supera il limite di ${MAX_BATCH_READ_TOTAL_BYTES} byte.`,
              413,
            );
          }
          files.push({ path, content, encoding: 'utf-8' });
        }
      }
      return { status: 200, body: { files } };
    }

    if (input.route === 'batch-write') {
      const files = validateBatchWriteFiles(input.body?.files, uid);
      const written: Array<{ path: string; bytes: number }> = [];
      for (let i = 0; i < files.length; i += BATCH_WRITE_CONCURRENCY) {
        const chunk = files.slice(i, i + BATCH_WRITE_CONCURRENCY);
        await Promise.all(chunk.map((file) => deps.storage.write(file.path, file.buf)));
        written.push(...chunk.map((file) => ({ path: file.path, bytes: file.buf.byteLength })));
      }
      return { status: 200, body: { files: written } };
    }

    const path =
      input.route === 'delete-prefix'
        ? validateImportPrefix(input.body?.path, uid)
        : validateRepositoryPath(input.body?.path, uid);

    if (input.route === 'read') {
      const result = await deps.storage.read(path);
      if (!result.exists) return errorResult(404, 'file_not_found', 'File non trovato.');
      return { status: 200, body: { path, content: result.content ?? '', encoding: 'utf-8' } };
    }
    if (input.route === 'write') {
      const buf = validateContent(input.body?.content);
      await deps.storage.write(path, buf);
      return { status: 200, body: { path, bytes: buf.byteLength } };
    }
    if (input.route === 'delete-prefix') {
      await deps.storage.deletePrefix(path);
      return { status: 200, body: { path, deleted: true } };
    }
    // input.route === 'delete'
    const existed = await deps.storage.delete(path);
    return { status: 200, body: { path, deleted: existed } };
  } catch (err) {
    if (err instanceof GatewayError) {
      return errorResult(err.status, err.code, err.message);
    }
    return errorResult(500, 'internal_error', 'Errore interno del gateway.');
  }
}
