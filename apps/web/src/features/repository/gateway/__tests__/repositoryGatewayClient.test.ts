import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetIdToken = vi.fn();
vi.mock('../../../../lib/firebase.js', () => ({
  auth: {
    get currentUser() {
      return mockCurrentUser;
    },
  },
}));

let mockCurrentUser: { getIdToken: () => Promise<string> } | null;

import {
  GatewayError,
  deleteFile,
  deleteImportPrefix,
  isFileNotFound,
  readText,
  readTexts,
  writeText,
  writeTexts,
} from '../repositoryGatewayClient.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentUser = { getIdToken: mockGetIdToken };
  mockGetIdToken.mockResolvedValue('id-token-123');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function fetchOk(body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

describe('repositoryGatewayClient adapter', () => {
  it('readText: sends the token + path and returns the content on 200', async () => {
    const fetchSpy = fetchOk({ content: '# Corpo' });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(readText('repository/uid/imports/imp/x.md')).resolves.toBe('# Corpo');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('/api/repository/read');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer id-token-123');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ path: 'repository/uid/imports/imp/x.md' });
  });

  it('readTexts deduplicates paths, preserves order and skips the network for empty input', async () => {
    const a = 'repository/uid/imports/imp/a.md';
    const b = 'repository/uid/imports/imp/b.md';
    const fetchSpy = fetchOk({
      files: [
        { path: a, content: 'A' },
        { path: b, error: { code: 'file_not_found', message: 'File non trovato.' } },
      ],
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(readTexts([])).resolves.toEqual([]);
    await expect(readTexts([a, a, b])).resolves.toEqual([
      { ok: true, path: a, content: 'A' },
      { ok: false, path: b, error: { code: 'file_not_found', message: 'File non trovato.' } },
    ]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/repository/batch-read');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ paths: [a, b] });
  });

  it('readTexts chunks more than 300 distinct paths without changing order', async () => {
    const paths = Array.from({ length: 301 }, (_, i) => `repository/uid/imports/imp/file-${i}.md`);
    const fetchSpy = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const requested = (JSON.parse(init.body as string) as { paths: string[] }).paths;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: requested.map((path) => ({ path, content: path })),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await readTexts(paths);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(result.map((entry) => entry.path)).toEqual(paths);
  });

  it('readTexts splits a chunk when the gateway reports total_too_large', async () => {
    const paths = ['repository/uid/imports/imp/a.md', 'repository/uid/imports/imp/b.md'];
    let call = 0;
    const fetchSpy = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      call += 1;
      const requested = (JSON.parse(init.body as string) as { paths: string[] }).paths;
      if (call === 1) {
        return {
          ok: false,
          status: 413,
          json: async () => ({
            error: { code: 'total_too_large', message: 'Troppo grande.' },
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ files: [{ path: requested[0], content: requested[0] }] }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await readTexts(paths);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(result.map((entry) => entry.path)).toEqual(paths);
  });

  it('writeText, deleteFile and deleteImportPrefix hit their endpoints', async () => {
    const fetchSpy = fetchOk({ ok: true });
    vi.stubGlobal('fetch', fetchSpy);
    await expect(writeText('repository/uid/imports/imp/x.md', 'body')).resolves.toBeUndefined();
    await expect(deleteFile('repository/uid/imports/imp/x.md')).resolves.toBeUndefined();
    await expect(deleteImportPrefix('repository/uid/imports/imp')).resolves.toBeUndefined();
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/repository/write');
    expect(fetchSpy.mock.calls[1][0]).toBe('/api/repository/delete');
    expect(fetchSpy.mock.calls[2][0]).toBe('/api/repository/delete-prefix');
  });

  it('writeTexts sends an ordered batch and skips the network for empty input', async () => {
    const a = { path: 'repository/uid/imports/imp/a.md', content: 'A' };
    const b = { path: 'repository/uid/imports/imp/b.md', content: 'Bè' };
    const fetchSpy = fetchOk({
      files: [
        { path: a.path, bytes: 1 },
        { path: b.path, bytes: 3 },
      ],
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(writeTexts([])).resolves.toBeUndefined();
    await expect(writeTexts([a, b])).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/repository/batch-write');
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({ files: [a, b] });
  });

  it('writeTexts rejects duplicate paths before authentication or network I/O', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const file = { path: 'repository/uid/imports/imp/a.md', content: 'A' };

    await expect(writeTexts([file, { ...file, content: 'B' }])).rejects.toMatchObject({
      code: 'duplicate_path',
    });
    expect(mockGetIdToken).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('writeTexts chunks more than 300 files without changing order', async () => {
    const files = Array.from({ length: 301 }, (_, index) => ({
      path: `repository/uid/imports/imp/file-${index}.md`,
      content: `body-${index}`,
    }));
    const requestedPaths: string[] = [];
    const fetchSpy = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      const requested = (JSON.parse(init.body as string) as { files: typeof files }).files;
      requestedPaths.push(...requested.map((file) => file.path));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: requested.map((file) => ({
            path: file.path,
            bytes: new TextEncoder().encode(file.content).byteLength,
          })),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(writeTexts(files)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(requestedPaths).toEqual(files.map((file) => file.path));
  });

  it('writeTexts halves an oversized chunk and never retries a single file forever', async () => {
    const files = [
      { path: 'repository/uid/imports/imp/a.md', content: 'A' },
      { path: 'repository/uid/imports/imp/b.md', content: 'B' },
    ];
    let calls = 0;
    const fetchSpy = vi.fn().mockImplementation(async (_url, init: RequestInit) => {
      calls += 1;
      const requested = (JSON.parse(init.body as string) as { files: typeof files }).files;
      if (calls === 1) {
        return {
          ok: false,
          status: 413,
          json: async () => ({ error: { code: 'total_too_large', message: 'Troppo grande.' } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          files: requested.map((file) => ({ path: file.path, bytes: 1 })),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchSpy);

    await expect(writeTexts(files)).resolves.toBeUndefined();
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: async () => ({ error: { code: 'total_too_large', message: 'Troppo grande.' } }),
      }),
    );
    await expect(writeTexts([files[0]])).rejects.toMatchObject({ code: 'total_too_large' });
  });

  it('writeTexts rejects a malformed or reordered gateway response', async () => {
    const a = { path: 'repository/uid/imports/imp/a.md', content: 'A' };
    const b = { path: 'repository/uid/imports/imp/b.md', content: 'B' };
    vi.stubGlobal(
      'fetch',
      fetchOk({
        files: [
          { path: b.path, bytes: 1 },
          { path: a.path, bytes: 1 },
        ],
      }),
    );

    await expect(writeTexts([a, b])).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('translates a structured gateway error into a GatewayError (code + status)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: { code: 'file_not_found', message: 'File non trovato.' } }),
      }),
    );
    const err = await readText('repository/uid/imports/imp/x.md').catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe('file_not_found');
    expect(err.status).toBe(404);
    expect(isFileNotFound(err)).toBe(true);
  });

  it('maps an aborted request (timeout) to a GatewayError timeout, no infinite retry', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((_url, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          (init.signal as AbortSignal).addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }),
    );
    vi.useFakeTimers();
    const promise = writeText('repository/uid/imports/imp/x.md', 'body').catch((e) => e);
    await vi.advanceTimersByTimeAsync(31_000);
    const err = await promise;
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe('timeout');
  });

  it('fails fast when there is no authenticated user', async () => {
    mockCurrentUser = null;
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(readText('repository/uid/imports/imp/x.md')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
