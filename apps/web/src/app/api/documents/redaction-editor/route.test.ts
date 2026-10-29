import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as suggest } from '../redaction-suggestions/route';
import { POST as openEditor } from './route';

const { session, requireAccess, open, suggestions, EACH } = vi.hoisted(() => ({
  EACH: Symbol('each'),
  session: vi.fn(),
  requireAccess: vi.fn(),
  open: vi.fn(),
  suggestions: vi.fn(),
}));
const capability = vi.hoisted(() => ({ redactedDownload: 'available' }));
vi.mock('../../../../lib/capabilities', () => ({ getPlatformCapabilities: () => capability }));
vi.mock('../../../../lib/session', () => ({ withSession: session }));
vi.mock('../../../../lib/storage', () => ({ createStorage: () => ({}) }));
vi.mock('../../../../lib/step-up', () => ({ establishStepUpProof: vi.fn() }));
vi.mock('../../../../lib/providers', () => ({ createKeyManagementPort: () => undefined }));
vi.mock('@visastack/adapters', () => ({ createSafeCopyRenderer: () => ({}) }));
vi.mock('@visastack/services', () => ({
  EACH_GRANT: EACH,
  accountPrincipal: (accountId: string) => ({ kind: 'account', accountId }),
  requireAccess,
  openRedactionEditor: open,
  suggestRedactions: suggestions,
}));

const documentId = '00000000-0000-4000-8000-000000000001';
const versionId = '00000000-0000-4000-8000-000000000101';

function request(path: string, body: unknown) {
  const text = JSON.stringify(body);
  return new Request(`https://app.example/api/documents/${path}`, {
    method: 'POST',
    headers: {
      origin: 'https://app.example',
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
    },
    body: text,
  });
}

beforeEach(() => {
  capability.redactedDownload = 'available';
  for (const mock of [session, requireAccess, open, suggestions]) mock.mockReset();
  session.mockImplementation((fn) => fn({ db: {}, accountId: 'acct' }));
  requireAccess.mockResolvedValue({ ok: true, value: { proof: true } });
});

describe('safe copy editor routes', () => {
  it('opens the editor through a PREVIEW proof and returns only what the editor needs', async () => {
    open.mockResolvedValue({
      ok: true,
      value: {
        documentId,
        versionId,
        pageCount: 2,
        state: 'NOT_PREPARED',
        savedPages: null,
        maskRevision: null,
        preparedPages: [],
        canSave: true,
      },
    });
    const response = await openEditor(request('redaction-editor', { documentId }));
    expect(await response.json()).toEqual({
      versionId,
      pageCount: 2,
      state: 'NOT_PREPARED',
      savedPages: null,
      maskRevision: null,
      preparedPages: [],
      canSave: true,
    });
    expect(requireAccess.mock.calls[0]?.[2]).toBe('PREVIEW');
  });

  it('returns suggestions as page, box and reason only', async () => {
    suggestions.mockResolvedValue({
      ok: true,
      value: [{ page: 1, box: { x: 0, y: 0.8, w: 1, h: 0.2 }, reason: 'mrz', extra: 'secret' }],
    });
    const response = await suggest(request('redaction-suggestions', { documentId, versionId }));
    expect(await response.json()).toEqual({
      suggestions: [{ page: 1, box: { x: 0, y: 0.8, w: 1, h: 0.2 }, reason: 'mrz' }],
    });
    expect(requireAccess.mock.calls[0]?.[2]).toBe('PREVIEW');
    expect((await suggest(request('redaction-suggestions', { documentId }))).status).toBe(400);
  });

  it('answers a refused or too large document in plain words', async () => {
    open.mockResolvedValueOnce({
      ok: false,
      error: { code: 'invalid', message: 'x', refusal: 'too_large' },
    });
    const large = await openEditor(request('redaction-editor', { documentId }));
    expect(large.status).toBe(413);
    open.mockResolvedValueOnce({ ok: false, error: { code: 'forbidden', message: 'owner only' } });
    const refused = await openEditor(request('redaction-editor', { documentId }));
    expect(refused.status).toBe(403);
  });
});
