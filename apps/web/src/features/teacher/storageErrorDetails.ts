/**
 * MOB-01B — non-sensitive diagnostics for a failed Firebase Storage read.
 *
 * When a lesson's Markdown fails to load (observed only on Brave mobile so
 * far, while Safari mobile loads it fine), the teacher needs actionable
 * detail without us ever surfacing anything sensitive. This module turns an
 * unknown thrown value — ideally the *original* Firebase `StorageError`, not a
 * re-wrapped generic `Error` — into a small, whitelisted set of fields.
 *
 * Whitelisted (shown): Firebase Storage code, error name, HTTP status (when
 * present), a synthetic browser label, online/offline, storage bucket.
 * Never read/shown: auth token, Authorization headers, `serverResponse`,
 * signed URLs, or any personal data. We only ever pull the specific fields
 * below — we never spread the error or stringify `customData`.
 */

export type StorageErrorDetails = {
  /** Firebase Storage error code, e.g. `storage/unauthorized`, or `unknown`. */
  code: string;
  /** Human category for the code (incl. network/timeout), for the reader. */
  category: string;
  /** Error constructor/name, e.g. `FirebaseError`, or the primitive type. */
  name: string;
  /** HTTP status when the SDK exposed one (0 for a blocked/failed request). */
  httpStatus: number | null;
  /** Wall-clock time from request start to failure, when measured. */
  elapsedMs: number | null;
  /**
   * True when the failure most likely came *after* Firebase Storage's own
   * automatic retries were exhausted (a `storage/retry-limit-exceeded` code,
   * or an elapsed time near the default `maxOperationRetryTime` of 120s). We
   * do NOT change that timeout or add retries — this only records the fact so
   * we can decide with real data later.
   */
  afterAutoRetries: boolean;
  /** True when `navigator.onLine` is true (or unknown → true). */
  online: boolean;
  /** Coarse browser label (e.g. `Brave`, `Safari`, `Chrome`) + `mobile`. */
  browser: string;
  /** Configured Storage bucket (public config, never a signed URL). */
  bucket: string | null;
};

/**
 * Elapsed threshold (ms) above which a failure is treated as having gone
 * through Firebase's automatic retry window. Kept below the SDK default
 * `maxOperationRetryTime` (120s) so a genuine long hang → timeout is caught.
 */
export const AFTER_AUTO_RETRIES_MS = 90_000;

/** Maps a Storage code (and network/timeout signals) to a readable category. */
export function classifyStorageCode(code: string, httpStatus: number | null): string {
  switch (code) {
    case 'storage/unauthorized':
      return 'Permesso negato (403)';
    case 'storage/object-not-found':
      return 'File non trovato (404)';
    case 'storage/retry-limit-exceeded':
      return 'Timeout dopo i retry automatici di Firebase';
    case 'storage/canceled':
      return 'Richiesta annullata';
    case 'storage/unknown':
      return httpStatus === 0
        ? 'Errore sconosciuto — richiesta mai arrivata al server (rete/blocco browser)'
        : 'Errore sconosciuto';
    default:
      break;
  }
  if (code === 'unknown') {
    return httpStatus === 0 ? 'Errore di rete o timeout' : 'Errore non classificato';
  }
  if (/network|timeout|abort/i.test(code)) return 'Errore di rete / timeout';
  return code;
}

function readString(obj: unknown, key: string): string | null {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function readNumber(obj: unknown, key: string): number | null {
  if (obj && typeof obj === 'object' && key in obj) {
    const value = (obj as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * A short, non-fingerprinting browser label. Brave is called out explicitly
 * because it exposes `navigator.brave` and is the browser where the failure
 * reproduces — that single bit is the most useful diagnostic here.
 */
export function syntheticBrowser(nav: Navigator | undefined = globalThisNavigator()): string {
  if (!nav) return 'unknown';
  const ua = nav.userAgent ?? '';
  const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  let brand = 'sconosciuto';
  if ('brave' in nav && (nav as { brave?: unknown }).brave) brand = 'Brave';
  else if (/Edg\//.test(ua)) brand = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) brand = 'Opera';
  else if (/Firefox\//.test(ua)) brand = 'Firefox';
  else if (/Chrome\//.test(ua)) brand = 'Chrome';
  else if (/Safari\//.test(ua)) brand = 'Safari';
  return isMobile ? `${brand} (mobile)` : brand;
}

function globalThisNavigator(): Navigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator;
}

/**
 * Extracts the whitelisted, non-sensitive fields from a thrown Storage error.
 * Robust to any input shape: a plain `Error`, a Firebase `StorageError`, or a
 * non-object. Only the named fields are ever touched.
 */
export function describeStorageError(
  err: unknown,
  options: { bucket?: string | null; navigator?: Navigator; elapsedMs?: number | null } = {},
): StorageErrorDetails {
  const code = readString(err, 'code') ?? 'unknown';
  const name = readString(err, 'name') ?? (err instanceof Error ? 'Error' : typeof err);
  // Firebase StorageError exposes an HTTP `status` (0 when the request never
  // reached the server, e.g. blocked by the browser). Fall back to `status_`
  // used by some SDK builds. `serverResponse` is deliberately never read.
  const httpStatus = readNumber(err, 'status') ?? readNumber(err, 'status_');
  const online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  const elapsedMs =
    typeof options.elapsedMs === 'number' && Number.isFinite(options.elapsedMs)
      ? Math.round(options.elapsedMs)
      : null;
  const afterAutoRetries =
    code === 'storage/retry-limit-exceeded' ||
    (elapsedMs !== null && elapsedMs >= AFTER_AUTO_RETRIES_MS);

  return {
    code,
    category: classifyStorageCode(code, httpStatus),
    name,
    httpStatus,
    elapsedMs,
    afterAutoRetries,
    online,
    browser: syntheticBrowser(options.navigator),
    bucket: options.bucket ?? null,
  };
}

/** Human-readable label/value lines for the "Dettagli tecnici" panel. */
export function storageErrorDetailLines(
  details: StorageErrorDetails,
): { label: string; value: string }[] {
  return [
    { label: 'Codice', value: details.code },
    { label: 'Categoria', value: details.category },
    { label: 'Errore', value: details.name },
    {
      label: 'Stato HTTP',
      value: details.httpStatus === null ? 'n/d' : String(details.httpStatus),
    },
    {
      label: 'Durata',
      value: details.elapsedMs === null ? 'n/d' : `${details.elapsedMs} ms`,
    },
    { label: 'Dopo retry automatici', value: details.afterAutoRetries ? 'sì' : 'no' },
    { label: 'Connessione', value: details.online ? 'online' : 'offline' },
    { label: 'Browser', value: details.browser },
    { label: 'Bucket', value: details.bucket ?? 'n/d' },
  ];
}
