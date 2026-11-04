import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type UploadRequest,
  readAnswer,
  retryAfterSeconds,
  sendDocumentFile,
} from './document-upload-client';

function fakeRequest() {
  const request = {
    opened: [] as string[],
    headers: {} as Record<string, string>,
    body: null as Blob | null,
    timeout: 0,
    status: 0,
    responseText: '',
    upload: { onprogress: null as ((event: ProgressEvent) => void) | null },
    onload: null as (() => void) | null,
    onerror: null as (() => void) | null,
    ontimeout: null as (() => void) | null,
    onabort: null as (() => void) | null,
    open(method: string, url: string) {
      this.opened.push(method, url);
    },
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    send(body: Blob) {
      this.body = body;
    },
  };
  return request;
}

describe('sending one file', () => {
  it('posts the raw file with its type, kind and Other name, and reports progress', async () => {
    const request = fakeRequest();
    const progress: number[] = [];
    const file = new Blob(['hello'], { type: '' });
    const sent = sendDocumentFile({
      applicantId: 'a 1',
      file,
      contentType: 'image/heic',
      docType: 'OTHER',
      subject: 'Acte de Mariage',
      onProgress: (fraction) => progress.push(fraction),
      createRequest: () => request as unknown as UploadRequest,
    });
    expect(request.opened).toEqual(['POST', '/api/documents/upload?applicantId=a%201']);
    expect(request.headers).toEqual({
      'Content-Type': 'image/heic',
      'X-Document-Kind': 'OTHER',
      'X-Document-Name': 'Acte%20de%20Mariage',
    });
    expect(request.body).toBe(file);
    expect(request.timeout).toBeGreaterThan(60_000);
    request.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 4 } as ProgressEvent);
    request.upload.onprogress?.({ lengthComputable: false, loaded: 2, total: 0 } as ProgressEvent);
    expect(progress).toEqual([0.25]);
    request.status = 201;
    request.responseText = JSON.stringify({ message: 'Added.', title: 'Passport, Nazmus' });
    request.onload?.();
    expect(await sent).toEqual({ kind: 'added', message: 'Added.', title: 'Passport, Nazmus' });
  });

  it('sends no kind headers when none was chosen, and treats a lost request as unknown', async () => {
    for (const lose of ['onerror', 'ontimeout', 'onabort'] as const) {
      const request = fakeRequest();
      const sent = sendDocumentFile({
        applicantId: 'a1',
        file: new Blob(['x']),
        contentType: 'image/png',
        docType: '',
        subject: '',
        onProgress: () => undefined,
        createRequest: () => request as unknown as UploadRequest,
      });
      expect(Object.keys(request.headers)).toEqual(['Content-Type']);
      request[lose]?.();
      expect(await sent).toEqual({ kind: 'unknown' });
    }
  });
});

describe('reading the answer', () => {
  it('takes only the route’s own answer as a result', () => {
    expect(readAnswer(201, JSON.stringify({ message: 'Added.' }))).toEqual({
      kind: 'added',
      message: 'Added.',
      title: null,
    });
    expect(readAnswer(400, JSON.stringify({ message: 'Too big.' }))).toEqual({
      kind: 'refused',
      message: 'Too big.',
    });
    expect(
      readAnswer(413, JSON.stringify({ message: 'Choose a file smaller than 4 MB.' })),
    ).toEqual({ kind: 'refused', message: 'Choose a file smaller than 4 MB.' });
    // A server error, a sign-in page or any other body says nothing certain.
    expect(readAnswer(500, JSON.stringify({ message: 'Oops' }))).toEqual({ kind: 'unknown' });
    expect(readAnswer(200, '<html>Sign in</html>')).toEqual({ kind: 'unknown' });
    expect(readAnswer(201, JSON.stringify({ other: true }))).toEqual({ kind: 'unknown' });
    expect(readAnswer(201, 'null')).toEqual({ kind: 'unknown' });
  });

  it('keeps an exact copy to remove only when it is a document id (LC-C)', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(readAnswer(201, JSON.stringify({ message: 'Added.', removableCopyId: id }))).toEqual({
      kind: 'added',
      message: 'Added.',
      title: null,
      removableCopyId: id,
    });
    expect(
      readAnswer(201, JSON.stringify({ message: 'Added.', removableCopyId: 'Passport, Nazmus' })),
    ).toEqual({ kind: 'added', message: 'Added.', title: null });
  });

  it('carries the upgrade line with a refusal, and only a line it knows (ADR 0025)', () => {
    expect(readAnswer(400, JSON.stringify({ message: 'Full.', upgrade: 'storage' }))).toEqual({
      kind: 'refused',
      message: 'Full.',
      upgrade: 'storage',
    });
    expect(readAnswer(400, JSON.stringify({ message: 'Full.', upgrade: 'pop-up' }))).toEqual({
      kind: 'refused',
      message: 'Full.',
    });
    expect(readAnswer(201, JSON.stringify({ message: 'Added.', upgrade: 'storage' }))).toEqual({
      kind: 'added',
      message: 'Added.',
      title: null,
    });
  });

  it('reads 429 and 503 as a definite busy answer with the wait the server asked for', () => {
    expect(
      readAnswer(429, JSON.stringify({ message: 'Too many uploads. Try again later.' }), '120'),
    ).toEqual({
      kind: 'busy',
      message: 'Too many uploads. Try again later.',
      retryAfterSeconds: 120,
    });
    // A host page with no JSON and no Retry-After is still busy, never unknown.
    expect(readAnswer(503, '<html>Unavailable</html>')).toEqual({
      kind: 'busy',
      message: null,
      retryAfterSeconds: null,
    });
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(retryAfterSeconds('Mon, 02 Nov 2026 10:00:30 GMT', now)).toBe(30);
    expect(retryAfterSeconds('soon', now)).toBeNull();
    expect(retryAfterSeconds(null, now)).toBeNull();
  });

  it('passes the Retry-After header of a busy answer through', async () => {
    const request = {
      ...fakeRequest(),
      getResponseHeader: (name: string) => (name === 'Retry-After' ? '42' : null),
    };
    const sent = sendDocumentFile({
      applicantId: 'a1',
      file: new Blob(['x']),
      contentType: 'image/png',
      docType: '',
      subject: '',
      onProgress: () => undefined,
      createRequest: () => request as unknown as UploadRequest,
    });
    request.status = 429;
    request.responseText = JSON.stringify({ message: 'Too many uploads.' });
    request.onload?.();
    expect(await sent).toEqual({
      kind: 'busy',
      message: 'Too many uploads.',
      retryAfterSeconds: 42,
    });
  });
});

describe('the upload id and the file name (UMPE P3)', () => {
  it('sends the upload id as given and the file name percent-encoded', async () => {
    const request = fakeRequest();
    const sending = sendDocumentFile({
      applicantId: 'a-1',
      file: new Blob(['x']),
      contentType: 'image/jpeg',
      docType: '',
      subject: '',
      uploadId: '0b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f',
      fileName: 'ব্যাংক statement.jpg',
      onProgress: () => undefined,
      createRequest: () => request as unknown as UploadRequest,
    });
    request.status = 201;
    request.responseText = JSON.stringify({ message: 'Added.' });
    request.onload?.();
    await sending;
    expect(request.headers['X-Upload-Id']).toBe('0b9f8c1e-2d3a-4c5b-8e7f-6a5b4c3d2e1f');
    expect(decodeURIComponent(request.headers['X-File-Name'] ?? '')).toBe('ব্যাংক statement.jpg');
    expect(request.headers['X-File-Name']).not.toMatch(/[^\x20-\x7e]/);
  });

  it('treats the busy answer for an upload still being stored as busy, never as refused', () => {
    expect(readAnswer(503, JSON.stringify({ message: 'Still being added.' }), '5')).toEqual({
      kind: 'busy',
      message: 'Still being added.',
      retryAfterSeconds: 5,
    });
  });
});

describe('telling the server when a file ends with no usable answer', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const send = (request: ReturnType<typeof fakeRequest>, route?: 'hold') =>
    sendDocumentFile({
      applicantId: 'a1',
      file: new Blob(['x']),
      contentType: 'image/png',
      docType: '',
      subject: '',
      onProgress: () => undefined,
      ...(route ? { route } : {}),
      createRequest: () => request as unknown as UploadRequest,
    });

  it('reports each kind of lost request once, with only fixed fields', async () => {
    const calls = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', calls);
    for (const [lose, reason] of [
      ['onerror', 'network'],
      ['ontimeout', 'timeout'],
      ['onabort', 'abort'],
    ] as const) {
      calls.mockClear();
      const request = fakeRequest();
      const sent = send(request);
      request[lose]?.();
      expect(await sent).toEqual({ kind: 'unknown' });
      expect(calls).toHaveBeenCalledTimes(1);
      const [url, init] = calls.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe('/api/documents/upload-report');
      expect(JSON.parse(String(init.body))).toEqual({
        route: 'upload',
        reason,
        status: 0,
        redirected: false,
        ms: expect.any(Number),
      });
    }
  });

  it('reports a server error and a page that is not ours, with the status and any redirect', async () => {
    const calls = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', calls);
    const broken = fakeRequest();
    const first = send(broken, 'hold');
    broken.status = 502;
    broken.responseText = '<html>Bad gateway</html>';
    broken.onload?.();
    expect(await first).toEqual({ kind: 'unknown' });
    expect(
      JSON.parse(String((calls.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
    ).toMatchObject({
      route: 'hold',
      reason: 'server_error',
      status: 502,
    });

    calls.mockClear();
    const signIn = Object.assign(fakeRequest(), {
      responseURL: 'https://x.test/auth/sign-in?next=%2Fapp',
    });
    const second = send(signIn);
    signIn.status = 200;
    signIn.responseText = '<html>Sign in</html>';
    signIn.onload?.();
    expect(await second).toEqual({ kind: 'unknown' });
    expect(
      JSON.parse(String((calls.mock.calls[0] as unknown as [string, RequestInit])[1].body)),
    ).toMatchObject({
      reason: 'not_json',
      status: 200,
      redirected: true,
    });
  });

  it('reports nothing for an answer the server gave, and never breaks the file when reporting fails', async () => {
    const calls = vi.fn(async () => {
      throw new Error('offline');
    });
    vi.stubGlobal('fetch', calls);
    const added = fakeRequest();
    const first = send(added);
    added.status = 201;
    added.responseText = JSON.stringify({ message: 'Added.' });
    added.onload?.();
    expect((await first).kind).toBe('added');
    const refused = fakeRequest();
    const second = send(refused);
    refused.status = 400;
    refused.responseText = JSON.stringify({ message: 'No.' });
    refused.onload?.();
    expect((await second).kind).toBe('refused');
    expect(calls).not.toHaveBeenCalled();

    const lost = fakeRequest();
    const third = send(lost);
    lost.onerror?.();
    expect(await third).toEqual({ kind: 'unknown' });
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
