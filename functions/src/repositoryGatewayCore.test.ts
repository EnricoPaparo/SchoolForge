import { describe, expect, it, vi } from 'vitest';
import {
  authorizeOwner,
  createStoragePort,
  handleGateway,
  hasLoneSurrogate,
  isJsonContentType,
  isStorageNotFound,
  parseRoute,
  validateContent,
  validateBatchReadPaths,
  validateImportPrefix,
  validateRepositoryPath,
  GatewayError,
  MAX_BATCH_READ_FILES,
  MAX_BATCH_READ_TOTAL_BYTES,
  MAX_FILE_BYTES,
  type BucketLike,
  type Route,
  type StoragePort,
} from './repositoryGatewayCore.js';

const UID = 'owner-uid';
const OK_PATH = `repository/${UID}/imports/imp-1/uda-01/lezione-001-x.md`;

function memoryStorage(
  initial: Record<string, string> = {},
): StoragePort & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    read: async (path) =>
      files.has(path) ? { exists: true, content: files.get(path)! } : { exists: false },
    write: async (path, buf) => {
      files.set(path, Buffer.from(buf).toString('utf-8'));
    },
    delete: async (path) => {
      const existed = files.has(path);
      files.delete(path);
      return existed;
    },
    deletePrefix: async (path) => {
      for (const key of [...files.keys()]) {
        if (key.startsWith(`${path}/`)) files.delete(key);
      }
    },
  };
}

function deps(overrides: Partial<Parameters<typeof handleGateway>[1]> = {}) {
  return {
    verifyIdToken: async (t: string) => {
      if (t === 'valid') return { uid: UID };
      if (t === 'student') return { uid: 'student-uid' };
      throw new Error('invalid token');
    },
    getOwnerUid: async () => UID,
    storage: memoryStorage({ [OK_PATH]: 'Corpo esistente.' }),
    ...overrides,
  };
}

function req(over: Partial<Parameters<typeof handleGateway>[0]> = {}) {
  return {
    method: 'POST',
    route: 'read' as Route | null,
    contentType: 'application/json',
    authHeader: 'Bearer valid',
    body: { path: OK_PATH },
    ...over,
  };
}

describe('parseRoute (routing rigoroso)', () => {
  it('accepts exactly the five documented repository routes', () => {
    expect(parseRoute('/api/repository/read')).toBe('read');
    expect(parseRoute('/api/repository/write')).toBe('write');
    expect(parseRoute('/api/repository/delete')).toBe('delete');
    expect(parseRoute('/api/repository/delete-prefix')).toBe('delete-prefix');
    expect(parseRoute('/api/repository/batch-read')).toBe('batch-read');
    expect(parseRoute('/api/repository/read/')).toBe('read'); // single trailing slash tolerated
  });

  it('rejects prefixes, suffixes, extra segments and undocumented aliases', () => {
    for (const p of [
      '/evil/repository/read',
      '/api/repository/read/extra',
      '/repository/read',
      '/api/repository/unknown',
      '/api/repository/',
      '/api/repository/read/write',
      '/read',
    ]) {
      expect(parseRoute(p)).toBeNull();
    }
  });
});

describe('validateBatchReadPaths', () => {
  const secondPath = `repository/${UID}/imports/imp-1/uda-01/lezione-002-y.md`;

  it('preserves a valid ordered list', () => {
    expect(validateBatchReadPaths([OK_PATH, secondPath], UID)).toEqual([OK_PATH, secondPath]);
  });

  it('rejects empty, oversized and duplicate lists', () => {
    expect(() => validateBatchReadPaths([], UID)).toThrowError(
      expect.objectContaining({ code: 'invalid_paths' }),
    );
    expect(() =>
      validateBatchReadPaths(Array(MAX_BATCH_READ_FILES + 1).fill(OK_PATH), UID),
    ).toThrowError(expect.objectContaining({ code: 'too_many_files' }));
    expect(() => validateBatchReadPaths([OK_PATH, OK_PATH], UID)).toThrowError(
      expect.objectContaining({ code: 'duplicate_path' }),
    );
  });

  it('applies the same owner/path allowlist to every element', () => {
    expect(() =>
      validateBatchReadPaths([OK_PATH, 'repository/other/imports/imp-1/x.md'], UID),
    ).toThrowError(expect.objectContaining({ code: 'not_owner' }));
  });
});

describe('validateImportPrefix (root import rigorosa)', () => {
  const valid = `repository/${UID}/imports/imp-1`;

  it('accepts only the exact authenticated import root', () => {
    expect(validateImportPrefix(valid, UID)).toBe(valid);
  });

  it.each([
    `repository/${UID}/imports`,
    `repository/${UID}/imports/imp-1/uda-01`,
    `repository/${UID}/imports/imp-1/`,
    `repository/${UID}/imports/../imp-1`,
    `repository/${UID}/other/imp-1`,
  ])('rejects an unsafe or non-exact prefix: %s', (path) => {
    expect(() => validateImportPrefix(path, UID)).toThrow(GatewayError);
  });

  it('rejects another owner with not_owner', () => {
    expect(() => validateImportPrefix('repository/other/imports/imp-1', UID)).toThrowError(
      expect.objectContaining({ code: 'not_owner' }),
    );
  });
});

describe('isJsonContentType (Content-Type rigoroso)', () => {
  it('accepts application/json with optional valid params', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonContentType('APPLICATION/JSON')).toBe(true);
  });
  it('rejects look-alike media types', () => {
    for (const ct of [
      'text/application/json',
      'application/json-malicious',
      'text/plain',
      undefined,
      '',
    ]) {
      expect(isJsonContentType(ct)).toBe(false);
    }
  });
});

describe('validateRepositoryPath (allowlist)', () => {
  it.each([
    ['programma.md at import root', `repository/${UID}/imports/imp-1/programma.md`],
    ['UDA file', `repository/${UID}/imports/imp-1/uda-01-reti/uda-01-reti.md`],
    ['lesson file', `repository/${UID}/imports/imp-1/uda-01-reti/lezione-001-http.md`],
    ['pool file', `repository/${UID}/imports/imp-1/uda-01-reti/lezione-001-http.pool.md`],
  ])('accepts a valid %s', (_label, path) => {
    expect(validateRepositoryPath(path, UID)).toBe(path);
  });

  it('rejects another owner’s path with not_owner', () => {
    try {
      validateRepositoryPath('repository/intruder/imports/imp-1/uda-01/l.md', UID);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as GatewayError).code).toBe('not_owner');
    }
  });

  it('rejects a forbidden extension with unsupported_extension', () => {
    try {
      validateRepositoryPath(`repository/${UID}/imports/imp-1/uda-01/x.txt`, UID);
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as GatewayError).code).toBe('unsupported_extension');
    }
  });

  it('rejects a path outside repository/{uid}/imports/…', () => {
    expect(() => validateRepositoryPath(`repository/${UID}/other/x.md`, UID)).toThrow(
      /repository\/\{uid\}\/imports/,
    );
  });

  // Forbidden characters/segments generated at runtime (no literal control bytes
  // in the source): space, colon, emoji, unicode, traversal, double/back slash,
  // percent-encoding, NUL, absolute path.
  it.each([
    ['space', `repository/${UID}/imports/imp-1/uda 01/x.md`],
    ['colon', `repository/${UID}/imports/imp-1/uda:01/x.md`],
    ['emoji', `repository/${UID}/imports/imp-1/uda-01/x\u{1F600}.md`],
    ['query string', `repository/${UID}/imports/imp-1/uda-01/x.md?y=1`],
    ['fragment', `repository/${UID}/imports/imp-1/uda-01/x.md#frag`],
    ['traversal', `repository/${UID}/imports/imp-1/../secret.md`],
    ['double slash', `repository/${UID}/imports/imp-1//x.md`],
    ['backslash', `repository/${UID}/imports/imp-1/uda-01/x\\y.md`],
    ['percent-encoding', `repository/${UID}/imports/imp-1/uda-01/x%2e.md`],
    ['NUL', `repository/${UID}/imports/imp-1/uda-01/x\u0000.md`],
    ['absolute', `/repository/${UID}/imports/imp-1/uda-01/x.md`],
    ['gs url', `gs://bucket/repository/${UID}/imports/imp-1/x.md`],
  ])('rejects a path with %s', (_label, path) => {
    expect(() => validateRepositoryPath(path, UID)).toThrow(GatewayError);
  });
});

describe('validateContent + hasLoneSurrogate (UTF-8 rigoroso)', () => {
  it('accepts a well-formed UTF-8 string including a surrogate pair (emoji)', () => {
    expect(validateContent('ciao àèì 😀').byteLength).toBeGreaterThan(0);
    expect(hasLoneSurrogate('😀')).toBe(false);
  });
  it('rejects a lone high/low surrogate with invalid_utf8', () => {
    expect(hasLoneSurrogate('\uD800')).toBe(true);
    expect(hasLoneSurrogate('\uDC00')).toBe(true);
    try {
      validateContent('bad \uD800 tail');
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as GatewayError).code).toBe('invalid_utf8');
    }
  });
  it('rejects a non-string and oversize content', () => {
    expect(() => validateContent(42)).toThrow(GatewayError);
    try {
      validateContent('a'.repeat(MAX_FILE_BYTES + 1));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as GatewayError).code).toBe('file_too_large');
    }
  });
});

describe('createStoragePort (una sola operazione, 404 mirato)', () => {
  function mockBucket(files: Record<string, Uint8Array>) {
    const downloads: string[] = [];
    const deletes: string[] = [];
    const notFound = () => Object.assign(new Error('Not Found'), { code: 404 });
    const bucket: BucketLike = {
      deleteFiles: async ({ prefix }) => {
        deletes.push(prefix);
        return undefined;
      },
      file: (path: string) => ({
        download: async () => {
          downloads.push(path);
          if (!(path in files)) throw notFound();
          return [files[path]!] as [Uint8Array];
        },
        save: async () => undefined,
        delete: async () => {
          deletes.push(path);
          if (!(path in files)) throw notFound();
          return undefined;
        },
      }),
    };
    return { bucket, downloads, deletes };
  }

  it('read: a single download; decodes UTF-8', async () => {
    const { bucket, downloads } = mockBucket({ [OK_PATH]: new TextEncoder().encode('Corpo.') });
    const port = createStoragePort(bucket);
    await expect(port.read(OK_PATH)).resolves.toEqual({ exists: true, content: 'Corpo.' });
    expect(downloads).toHaveLength(1);
  });

  it('read: a 404 yields exists:false without a second call', async () => {
    const { bucket, downloads } = mockBucket({});
    const port = createStoragePort(bucket);
    await expect(port.read(OK_PATH)).resolves.toEqual({ exists: false });
    expect(downloads).toHaveLength(1);
  });

  it('read: non-UTF-8 stored bytes produce a structured error', async () => {
    const { bucket } = mockBucket({ [OK_PATH]: new Uint8Array([0xff, 0xfe, 0xff]) });
    const port = createStoragePort(bucket);
    const err = await port.read(OK_PATH).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe('invalid_stored_utf8');
  });

  it('delete: a single delete; a 404 is idempotent (false)', async () => {
    const { bucket, deletes } = mockBucket({ [OK_PATH]: new Uint8Array() });
    const port = createStoragePort(bucket);
    await expect(port.delete(OK_PATH)).resolves.toBe(true);
    expect(deletes).toHaveLength(1);
    await expect(port.delete('repository/owner-uid/imports/imp-1/uda-01/absent.md')).resolves.toBe(
      false,
    );
  });

  it('deletePrefix: delegates once with a trailing slash', async () => {
    const { bucket, deletes } = mockBucket({});
    const port = createStoragePort(bucket);
    await port.deletePrefix(`repository/${UID}/imports/imp-1`);
    expect(deletes).toEqual([`repository/${UID}/imports/imp-1/`]);
  });

  it('isStorageNotFound only matches code 404', () => {
    expect(isStorageNotFound({ code: 404 })).toBe(true);
    expect(isStorageNotFound({ code: 500 })).toBe(false);
    expect(isStorageNotFound(new Error('x'))).toBe(false);
  });
});

describe('authorizeOwner', () => {
  it('rejects a missing/malformed header and an invalid token', async () => {
    await expect(authorizeOwner(undefined, deps())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(authorizeOwner('Basic xyz', deps())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    await expect(authorizeOwner('Bearer nope', deps())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
  it('rejects an authenticated non-owner (e.g. a student)', async () => {
    await expect(authorizeOwner('Bearer student', deps())).rejects.toMatchObject({
      code: 'not_owner',
    });
  });
  it('authorizes the real owner from settings/owner', async () => {
    await expect(authorizeOwner('Bearer valid', deps())).resolves.toBe(UID);
  });
});

describe('handleGateway', () => {
  it('read/write/delete/delete-prefix happy paths', async () => {
    const d = deps();
    const read = await handleGateway(req(), d);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({ path: OK_PATH, content: 'Corpo esistente.' });

    const path = `repository/${UID}/imports/imp-1/uda-01/nuova.md`;
    const write = await handleGateway(
      req({ route: 'write', body: { path, content: 'Nuovo.' } }),
      d,
    );
    expect(write.status).toBe(200);
    expect((d.storage as ReturnType<typeof memoryStorage>).files.get(path)).toBe('Nuovo.');

    const del = await handleGateway(req({ route: 'delete', body: { path: OK_PATH } }), d);
    expect(del.body).toMatchObject({ deleted: true });
    const del2 = await handleGateway(req({ route: 'delete', body: { path: OK_PATH } }), d);
    expect(del2.body).toMatchObject({ deleted: false });

    const importRoot = `repository/${UID}/imports/imp-1`;
    const prefixDelete = await handleGateway(
      req({ route: 'delete-prefix', body: { path: importRoot } }),
      d,
    );
    expect(prefixDelete).toMatchObject({ status: 200, body: { path: importRoot, deleted: true } });
    expect((d.storage as ReturnType<typeof memoryStorage>).files.size).toBe(0);
  });

  it('batch-read preserves order and reports a missing file per entry', async () => {
    const secondPath = `repository/${UID}/imports/imp-1/uda-01/lezione-002-y.md`;
    const missingPath = `repository/${UID}/imports/imp-1/uda-01/missing.md`;
    const storage = memoryStorage({ [OK_PATH]: 'Uno', [secondPath]: 'Due' });
    const result = await handleGateway(
      req({
        route: 'batch-read',
        body: { paths: [secondPath, missingPath, OK_PATH] },
      }),
      deps({ storage }),
    );
    expect(result).toEqual({
      status: 200,
      body: {
        files: [
          { path: secondPath, content: 'Due', encoding: 'utf-8' },
          {
            path: missingPath,
            error: { code: 'file_not_found', message: 'File non trovato.' },
          },
          { path: OK_PATH, content: 'Uno', encoding: 'utf-8' },
        ],
      },
    });
  });

  it('batch-read rejects a response above the total byte limit', async () => {
    const storage = memoryStorage({ [OK_PATH]: 'x'.repeat(MAX_BATCH_READ_TOTAL_BYTES + 1) });
    const result = await handleGateway(
      req({ route: 'batch-read', body: { paths: [OK_PATH] } }),
      deps({ storage }),
    );
    expect(result).toMatchObject({ status: 413, body: { error: { code: 'total_too_large' } } });
  });

  it('read: 404 file_not_found for an absent file', async () => {
    const res = await handleGateway(
      req({ body: { path: `repository/${UID}/imports/imp-1/uda-01/assente.md` } }),
      deps(),
    );
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'file_not_found' } });
  });

  it('unknown route → 404 without touching Storage', async () => {
    const storage = memoryStorage({ [OK_PATH]: 'x' });
    const readSpy = vi.spyOn(storage, 'read');
    const res = await handleGateway(req({ route: null }), deps({ storage }));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: { code: 'not_found' } });
    expect(readSpy).not.toHaveBeenCalled();
  });

  it('accepts application/json with a charset param, rejects a wrong one', async () => {
    expect(
      (await handleGateway(req({ contentType: 'application/json; charset=utf-8' }), deps())).status,
    ).toBe(200);
    expect((await handleGateway(req({ contentType: 'text/plain' }), deps())).status).toBe(415);
    expect(
      (await handleGateway(req({ contentType: 'application/json-malicious' }), deps())).status,
    ).toBe(415);
  });

  it('propagates method/auth/path/size errors as structured bodies', async () => {
    expect((await handleGateway(req({ method: 'GET' }), deps())).status).toBe(405);
    expect((await handleGateway(req({ authHeader: undefined }), deps())).status).toBe(401);
    expect((await handleGateway(req({ authHeader: 'Bearer student' }), deps())).status).toBe(403);
    expect(
      (
        await handleGateway(
          req({ body: { path: `repository/${UID}/imports/imp-1/../x.md` } }),
          deps(),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleGateway(
          req({ route: 'write', body: { path: OK_PATH, content: 'a'.repeat(MAX_FILE_BYTES + 1) } }),
          deps(),
        )
      ).status,
    ).toBe(413);
  });

  it('never touches Storage when authorization fails', async () => {
    const storage = memoryStorage({ [OK_PATH]: 'x' });
    const readSpy = vi.spyOn(storage, 'read');
    await handleGateway(req({ authHeader: 'Bearer student' }), deps({ storage }));
    expect(readSpy).not.toHaveBeenCalled();
  });
});
