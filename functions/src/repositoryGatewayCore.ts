/**
 * SGW-01 — logica pura del Repository Storage Gateway, senza dipendenze
 * `firebase-admin`/`firebase-functions`: autorizzazione, validazione path e
 * contenuto, routing e handler core con I/O iniettato. Testabile in isolamento;
 * il wiring runtime (Admin SDK, `onRequest`) è in `repositoryGateway.ts`.
 */

/** Limite dimensione per file (coerente con `MAX_LESSON_CONTENT_BYTES`). */
export const MAX_FILE_BYTES = 700_000;

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

const REPOSITORY_PATH_RE = /^repository\/([^/]+)\/imports\/([^/]+)\/.+$/;

/**
 * Valida e normalizza un path repository. Ammette **solo**
 * `repository/{uid}/imports/{importId}/…` con `uid` == utente autenticato,
 * estensione `.md`/`.pool.md`, e rifiuta ogni forma ambigua/pericolosa.
 */
export function validateRepositoryPath(rawPath: unknown, uid: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new GatewayError('invalid_path', 'Path mancante o non valido.', 400);
  }
  const path = rawPath;
  // Caratteri di controllo / NUL.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) {
    throw new GatewayError('invalid_path', 'Path con caratteri di controllo.', 400);
  }
  // Traversal, slash ambigue, backslash, path assoluto.
  if (path.includes('..') || path.includes('//') || path.includes('\\') || path.startsWith('/')) {
    throw new GatewayError('invalid_path', 'Path con sequenze non ammesse.', 400);
  }
  // Percent-encoding.
  if (/%[0-9a-fA-F]{2}/.test(path)) {
    throw new GatewayError('invalid_path', 'Path con percent-encoding non ammesso.', 400);
  }
  // URL / schema (http://, gs://, ecc.).
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new GatewayError('invalid_path', 'Path con URL non ammesso.', 400);
  }
  const match = REPOSITORY_PATH_RE.exec(path);
  if (!match) {
    throw new GatewayError(
      'invalid_path',
      'Il path deve essere sotto repository/{uid}/imports/{importId}/…',
      400,
    );
  }
  if (match[1] !== uid) {
    throw new GatewayError('not_owner', 'Il path non appartiene all’utente autenticato.', 403);
  }
  if (!path.endsWith('.pool.md') && !path.endsWith('.md')) {
    throw new GatewayError('unsupported_extension', 'Sono ammessi solo file .md o .pool.md.', 415);
  }
  return path;
}

/** Valida il contenuto: stringa UTF-8, entro `MAX_FILE_BYTES`. */
export function validateContent(content: unknown): Buffer {
  if (typeof content !== 'string') {
    throw new GatewayError('invalid_content', 'Contenuto mancante o non stringa.', 400);
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

/** Estrae la sotto-rotta (`read`/`write`/`delete`) dal path della richiesta. */
export function extractSubpath(requestPath: string): string {
  const segments = requestPath.split('/').filter(Boolean);
  const idx = segments.lastIndexOf('repository');
  if (idx >= 0 && idx + 1 < segments.length) return segments[idx + 1]!;
  return segments[segments.length - 1] ?? '';
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
};

export type GatewayInput = {
  method: string;
  subpath: string;
  contentType: string | undefined;
  authHeader: string | undefined;
  body: { path?: unknown; content?: unknown } | undefined;
};

export type GatewayResult = { status: number; body: unknown };

function errorResult(status: number, code: string, message: string): GatewayResult {
  return { status, body: { error: { code, message } } };
}

/**
 * Core dell'handler, puro rispetto a I/O (dipendenze iniettate). Ritorna
 * status + body JSON; non logga mai token, contenuti, pool o soluzioni.
 */
export async function handleGateway(
  input: GatewayInput,
  deps: AuthDeps & { storage: StoragePort },
): Promise<GatewayResult> {
  try {
    if (input.method !== 'POST') {
      return errorResult(405, 'method_not_allowed', 'Metodo non consentito.');
    }
    if (!input.contentType || !input.contentType.includes('application/json')) {
      return errorResult(
        415,
        'unsupported_media_type',
        'Content-Type deve essere application/json.',
      );
    }
    const uid = await authorizeOwner(input.authHeader, deps);
    const path = validateRepositoryPath(input.body?.path, uid);

    if (input.subpath === 'read') {
      const result = await deps.storage.read(path);
      if (!result.exists) return errorResult(404, 'file_not_found', 'File non trovato.');
      return { status: 200, body: { path, content: result.content ?? '', encoding: 'utf-8' } };
    }
    if (input.subpath === 'write') {
      const buf = validateContent(input.body?.content);
      await deps.storage.write(path, buf);
      return { status: 200, body: { path, bytes: buf.byteLength } };
    }
    if (input.subpath === 'delete') {
      const existed = await deps.storage.delete(path);
      return { status: 200, body: { path, deleted: existed } };
    }
    return errorResult(404, 'not_found', 'Endpoint non trovato.');
  } catch (err) {
    if (err instanceof GatewayError) {
      return errorResult(err.status, err.code, err.message);
    }
    return errorResult(500, 'internal_error', 'Errore interno del gateway.');
  }
}
