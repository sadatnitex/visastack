import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UploadRequest } from '../../lib/document-upload-client';
import { ImportQueue } from '../../lib/import/import-queue';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';

/**
 * The guest upload route, the guest sender driving the P2 queue, and the verified desk with files
 * (UMPE P9). Every service and outside port is a stand-in; synthetic values only.
 */

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  uploads: vi.fn(),
  desk: vi.fn(),
  cookie: undefined as string | undefined,
}));

vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  addGuestFile: mocks.add,
  readGuestUploadDesk: mocks.uploads,
  readGuestDesk: mocks.desk,
  checkRateLimits: async () => ({ allowed: true }),
}));
vi.mock('../../lib/public-db', () => ({
  withPublicDb: async (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../lib/providers', () => ({
  createKeyManagementPort: () => ({}),
  createMalwareScanner: () => ({ name: 'basic-structural-scanner', version: '1', scan: vi.fn() }),
  createContentLimitsChecker: () => ({ name: 'limits', version: '1', check: vi.fn() }),
}));
vi.mock('../../lib/upload-preflight', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/upload-preflight')>()),
  validateUploadBytes: () => true,
  pdfUploadsAccepted: () => true,
}));
vi.mock('../../lib/send-now', () => ({ sendEmailNow: async () => 'sent' }));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '203.0.113.9' }),
  cookies: async () => ({
    get: (name: string) =>
      name === 'vs_collect' && mocks.cookie !== undefined ? { value: mocks.cookie } : undefined,
    set: () => undefined,
  }),
}));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ refresh: () => undefined }),
}));

const { POST } = await import('./upload/route');
const { default: CollectPage } = await import('./page');
const { sendGuestFile } = await import('./guest-upload-client');

const SESSION = 'S'.repeat(43);
const UPLOAD_ID = '11111111-2222-4333-8444-555555555555';
const ORIGIN = 'https://vs.example.test';
const FILE = {
  id: 'f1',
  name: 'passport.pdf',
  sizeBytes: 1200,
  status: 'ready',
  virusScanned: false,
  itemId: 'i1',
  mapping: 'proposed',
  sent: false,
};

function upload(headers: Record<string, string> = {}, body = '%PDF-1.4 synthetic') {
  return new Request(`${ORIGIN}/collect/upload`, {
    method: 'POST',
    body,
    headers: {
      origin: ORIGIN,
      'content-type': 'application/pdf',
      'content-length': String(body.length),
      'x-upload-id': UPLOAD_ID,
      'x-file-name': encodeURIComponent('passport.pdf'),
      ...headers,
    },
  });
}

describe('guest upload route (UMPE P9)', () => {
  beforeEach(() => {
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'true');
    mocks.cookie = SESSION;
    mocks.add.mockReset();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('refuses another site, a missing session and a missing upload id, before any service', async () => {
    expect((await POST(upload({ origin: 'https://evil.example.test' }))).status).toBe(403);
    mocks.cookie = undefined;
    expect((await POST(upload())).status).toBe(403);
    mocks.cookie = SESSION;
    expect((await POST(upload({ 'x-upload-id': 'not-an-id' }))).status).toBe(400);
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('answers like the vault route: kept, refused, not now', async () => {
    mocks.add.mockResolvedValueOnce({
      ok: true,
      value: { kind: 'stored', file: FILE, replay: false },
    });
    const kept = await POST(upload());
    expect(kept.status).toBe(201);
    expect(kept.headers.get('cache-control')).toBe('no-store');
    const call = mocks.add.mock.calls[0];
    expect(call?.[3]).toMatchObject({ uploadId: UPLOAD_ID, originalName: 'passport.pdf' });
    // The structural check is never called a virus scan.
    expect(call?.[3].checks.virusScanner).toBe(false);

    mocks.add.mockResolvedValueOnce({
      ok: true,
      value: { kind: 'refused', file: { ...FILE, status: 'refused' }, message: 'Not kept.' },
    });
    expect((await POST(upload())).status).toBe(422);

    mocks.add.mockResolvedValueOnce({
      ok: false,
      error: { code: 'in_progress', message: 'Still adding.', retryAfterSeconds: 7 },
    });
    const busy = await POST(upload());
    expect(busy.status).toBe(503);
    expect(busy.headers.get('retry-after')).toBe('7');

    mocks.add.mockResolvedValueOnce({ ok: false, error: { code: 'rate_limited', message: 'x' } });
    expect((await POST(upload())).status).toBe(429);

    mocks.add.mockResolvedValueOnce({ ok: false, error: { code: 'not_found', message: 'x' } });
    expect((await POST(upload())).status).toBe(403);
  });
});

/** A stand-in browser request that answers from a script, once per send. */
function fakeRequest(answer: () => { status: number; body: string; retryAfter?: string }) {
  return (): UploadRequest => {
    const request: UploadRequest & { headers: Record<string, string> } = {
      headers: {},
      timeout: 0,
      status: 0,
      responseText: '',
      upload: { onprogress: null },
      onload: null,
      onerror: null,
      ontimeout: null,
      onabort: null,
      open: () => undefined,
      setRequestHeader(name, value) {
        request.headers[name] = value;
      },
      getResponseHeader: (name) => (name === 'Retry-After' ? (current.retryAfter ?? null) : null),
      send() {
        current = answer();
        (request as { status: number }).status = current.status;
        (request as { responseText: string }).responseText = current.body;
        queueMicrotask(() => request.onload?.());
      },
    };
    let current: { status: number; body: string; retryAfter?: string } = { status: 0, body: '' };
    return request;
  };
}

describe('guest sender on the P2 queue (UMPE P9)', () => {
  it('85 files each settle as added, through busy answers, with no applicant id sent', async () => {
    const seen = new Set<string>();
    let sends = 0;
    const answer = () => {
      sends++;
      // Every seventh send is turned away for a moment, as a busy server does.
      if (sends % 7 === 0) return { status: 503, body: '{"message":"Busy"}', retryAfter: '0' };
      return { status: 201, body: '{"message":"Added and checked."}' };
    };
    const create = fakeRequest(answer);
    const queue = new ImportQueue({
      applicantId: '',
      rules: { limitBytes: 4 * 1024 * 1024, limitLabel: '4 MB', pdfAccepted: true },
      send: (request) => {
        seen.add(request.uploadId);
        return sendGuestFile(request, create);
      },
      wait: async () => undefined,
      retryUnknown: true,
    });
    const files = Array.from({ length: 85 }, (_, i) => ({
      file: new File([`%PDF-1.4 file ${i}`], `file-${i}.pdf`, {
        type: 'application/pdf',
        lastModified: 1_700_000_000_000 + i,
      }),
      path: '',
    }));
    await queue.add(files);
    await queue.whenIdle();
    const items = queue.list();
    expect(items).toHaveLength(85);
    expect(items.every((item) => item.state === 'added')).toBe(true);
    expect(seen.size).toBe(85);
  });

  it('sends only to the desk route, with the upload id and the file name', async () => {
    let headers: Record<string, string> = {};
    let url = '';
    const create = () => {
      const make = fakeRequest(() => ({ status: 201, body: '{"message":"ok"}' }))();
      const open = make.open;
      make.open = (method, target) => {
        url = target;
        open(method, target);
      };
      headers = (make as unknown as { headers: Record<string, string> }).headers;
      return make;
    };
    const outcome = await sendGuestFile(
      {
        applicantId: '',
        file: new Blob(['x']),
        contentType: 'application/pdf',
        uploadId: UPLOAD_ID,
        fileName: 'my passport.pdf',
        onProgress: () => undefined,
      },
      create,
    );
    expect(outcome.kind).toBe('added');
    expect(url).toBe('/collect/upload');
    expect(headers['X-Upload-Id']).toBe(UPLOAD_ID);
    expect(headers['X-File-Name']).toBe('my%20passport.pdf');
  });
});

describe('verified desk with files (UMPE P9)', () => {
  beforeEach(() => {
    vi.stubEnv('AGENCY_COLLECTION_REQUESTS', 'true');
    mocks.cookie = SESSION;
    mocks.desk.mockResolvedValue({
      stage: 'verified',
      agency: { name: 'Synthetic Agency One', accentColor: null, hasLogo: false },
      revisionNo: 1,
      intact: true,
      retentionDays: 30,
      items: [
        {
          id: 'i1',
          label: 'Passport',
          kind: 'DOCUMENT',
          necessity: 'MANDATORY',
          provenance: 'AGENCY_ADDED',
          groupKey: null,
          note: null,
          order: 1,
        },
        {
          id: 'i2',
          label: 'Bank Statement',
          kind: 'DOCUMENT',
          necessity: 'MANDATORY',
          provenance: 'AGENCY_ADDED',
          groupKey: null,
          note: null,
          order: 2,
        },
      ],
    });
    mocks.uploads.mockResolvedValue({
      files: [FILE],
      stillMissing: ['i2'],
      submissions: [
        {
          id: 's1',
          submissionNo: 1,
          revisionNo: 1,
          submittedAt: new Date('2026-11-02T10:00:00Z'),
          retentionDays: 30,
          decision: 'NEEDS_CORRECTION',
          decisionNote: null,
          lines: [
            {
              itemId: 'i1',
              label: 'Passport',
              files: ['old-passport.pdf'],
              missing: false,
              note: 'The photo page is cut off.',
            },
          ],
        },
      ],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('shows the files, what is still missing, what was sent and the agency note', async () => {
    const html = await renderServer(await CollectPage({ searchParams: Promise.resolve({}) }));
    const text = textOf(html);
    expect(text).toContain('Add Your Files');
    expect(text).toContain('passport.pdf');
    expect(text).toContain('Suggested from its name');
    expect(text).toContain('Not scanned for viruses');
    expect(text).toContain('Still Missing');
    expect(text).toContain('Bank Statement');
    expect(text).toContain('What You Sent');
    expect(text).toContain('Needs Correction');
    expect(text).toContain('Agency note: The photo page is cut off.');
    expect(text).toContain('Submit Documents Again');
    expect(text).not.toContain('Reviewed');
  });
});
