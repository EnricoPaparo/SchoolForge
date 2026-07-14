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
  writeText,
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
