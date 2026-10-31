import { describe, expect, it } from 'vitest';
import { type UploadRequest, readAnswer, sendDocumentFile } from './document-upload-client';

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
});
