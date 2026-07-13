import { describe, expect, it } from 'vitest';
import {
  describeStorageError,
  storageErrorDetailLines,
  syntheticBrowser,
} from '../storageErrorDetails.js';

// A realistic Firebase StorageError carries sensitive-looking extras
// (serverResponse with a signed URL, an Authorization header). These must
// NEVER leak into the whitelisted diagnostics.
function fakeStorageError() {
  const err = new Error('Firebase Storage: User does not have permission.') as Error & {
    code: string;
    status: number;
    customData: { serverResponse: string };
    authorization: string;
  };
  err.name = 'FirebaseError';
  err.code = 'storage/unauthorized';
  err.status = 403;
  err.customData = {
    serverResponse:
      '{"error":{"message":"Permission denied","url":"https://firebasestorage.googleapis.com/v0/b/app/o/lesson.md?alt=media&token=SECRET-TOKEN-123"}}',
  };
  err.authorization = 'Bearer SUPER-SECRET-JWT';
  return err;
}

describe('describeStorageError — safe classification', () => {
  it('extracts code, name and HTTP status from a Firebase StorageError', () => {
    const details = describeStorageError(fakeStorageError(), { bucket: 'app.appspot.com' });
    expect(details.code).toBe('storage/unauthorized');
    expect(details.name).toBe('FirebaseError');
    expect(details.httpStatus).toBe(403);
    expect(details.bucket).toBe('app.appspot.com');
  });

  it('falls back to safe defaults for a non-Firebase / non-object throw', () => {
    expect(describeStorageError('boom').code).toBe('unknown');
    expect(describeStorageError(undefined).code).toBe('unknown');
    const plain = describeStorageError(new Error('x'));
    expect(plain.code).toBe('unknown');
    expect(plain.name).toBe('Error');
    expect(plain.httpStatus).toBeNull();
  });

  it('reads status_ when the SDK build uses it instead of status', () => {
    const err = Object.assign(new Error('e'), { code: 'storage/unknown', status_: 0 });
    expect(describeStorageError(err).httpStatus).toBe(0);
  });

  it('never surfaces token, Authorization header, serverResponse or signed URLs', () => {
    const details = describeStorageError(fakeStorageError(), { bucket: 'app.appspot.com' });
    const serialized = JSON.stringify(details) + JSON.stringify(storageErrorDetailLines(details));
    expect(serialized).not.toContain('SECRET-TOKEN-123');
    expect(serialized).not.toContain('SUPER-SECRET-JWT');
    expect(serialized.toLowerCase()).not.toContain('authorization');
    expect(serialized).not.toContain('serverResponse');
    expect(serialized).not.toContain('token=');
    expect(serialized).not.toContain('alt=media');
    // The detail rows only carry the whitelisted labels.
    expect(storageErrorDetailLines(details).map((r) => r.label)).toEqual([
      'Codice',
      'Categoria',
      'Errore',
      'Stato HTTP',
      'Durata',
      'Dopo retry automatici',
      'Sorgente',
      'Connessione',
      'Browser',
      'Bucket',
    ]);
  });
});

describe('describeStorageError — code classification (MOB-01B)', () => {
  const cases: [string, number | null, string][] = [
    ['storage/unauthorized', 403, 'Permesso negato (403)'],
    ['storage/object-not-found', 404, 'File non trovato (404)'],
    ['storage/retry-limit-exceeded', 0, 'Timeout dopo i retry automatici di Firebase'],
    [
      'storage/unknown',
      0,
      'Errore sconosciuto — richiesta mai arrivata al server (rete/blocco browser)',
    ],
  ];
  it.each(cases)('classifies %s → %s', (code, status, expected) => {
    const err = Object.assign(new Error('e'), { code, status });
    expect(describeStorageError(err).category).toBe(expected);
  });

  it('classifies a network/timeout error without a Firebase code', () => {
    const err = Object.assign(new Error('network timeout'), { code: 'network-timeout' });
    expect(describeStorageError(err).category).toBe('Errore di rete / timeout');
  });
});

describe('describeStorageError — elapsed + after-auto-retries (MOB-01B)', () => {
  it('records elapsedMs and flags a long hang as after Firebase auto-retries', () => {
    const err = Object.assign(new Error('slow'), { code: 'storage/unknown', status: 0 });
    const details = describeStorageError(err, { elapsedMs: 118_000 });
    expect(details.elapsedMs).toBe(118000);
    expect(details.afterAutoRetries).toBe(true);
  });

  it('does not flag after-auto-retries for a fast failure', () => {
    const err = Object.assign(new Error('fast'), { code: 'storage/unauthorized', status: 403 });
    const details = describeStorageError(err, { elapsedMs: 120 });
    expect(details.elapsedMs).toBe(120);
    expect(details.afterAutoRetries).toBe(false);
  });

  it('always flags storage/retry-limit-exceeded regardless of elapsed', () => {
    const err = Object.assign(new Error('rl'), { code: 'storage/retry-limit-exceeded' });
    expect(describeStorageError(err, { elapsedMs: 10 }).afterAutoRetries).toBe(true);
  });

  it('leaves elapsedMs null when not measured', () => {
    expect(describeStorageError(new Error('x')).elapsedMs).toBeNull();
  });
});

describe('syntheticBrowser', () => {
  it('flags Brave explicitly (the browser where the failure reproduces)', () => {
    const nav = {
      userAgent: 'Mozilla/5.0 (Linux; Android 13) Chrome/120 Mobile Safari/537.36',
      brave: {},
    } as unknown as Navigator;
    expect(syntheticBrowser(nav)).toBe('Brave (mobile)');
  });

  it('labels Safari on iPhone without exposing the raw UA string', () => {
    const nav = {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile/15E148 Safari/604.1',
    } as unknown as Navigator;
    const label = syntheticBrowser(nav);
    expect(label).toBe('Safari (mobile)');
    expect(label).not.toContain('Mozilla');
  });
});
