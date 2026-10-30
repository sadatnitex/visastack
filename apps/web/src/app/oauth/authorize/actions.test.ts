import { beforeEach, describe, expect, it, vi } from 'vitest';

/** The consent answer and the ticked files it keeps across a fresh sign-in check (S20). */
const mocks = vi.hoisted(() => ({
  requireAccess: vi.fn(),
  createAiConnection: vi.fn(),
  establishStepUpProof: vi.fn(),
  redirect: vi.fn(),
  check: vi.fn(),
}));
vi.mock('@visastack/services', async (original) => ({
  ...(await original<typeof import('@visastack/services')>()),
  requireAccess: mocks.requireAccess,
  createAiConnection: mocks.createAiConnection,
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('../../../lib/step-up', () => ({
  STEP_UP_NOT_CONFIGURED_MESSAGE: 'Confirmation unavailable.',
  establishStepUpProof: mocks.establishStepUpProof,
}));
vi.mock('../../../lib/oauth-authorize', () => ({
  checkAuthorizeRequest: mocks.check,
  authorizationResponseUrl: (uri: string, params: Record<string, string>) =>
    `${uri}?${new URLSearchParams(params).toString()}`,
}));
vi.mock('../../../lib/public-db', () => ({
  withPublicDb: (fn: (db: unknown) => unknown) => fn({}),
}));
vi.mock('../../../lib/base-url', () => ({ resolveBaseUrl: () => 'https://vs.example.test' }));
vi.mock('../../../lib/session', () => ({
  withSession: async (fn: (ctx: unknown) => Promise<unknown>) =>
    fn({
      db: { transaction: (work: (tx: unknown) => Promise<unknown>) => work('tx') },
      accountId: 'owner',
    }),
}));
const jar = new Map<string, { value: string; options: { path?: string } }>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)?.value } : undefined),
    set: (name: string, value: string, options: { path?: string }) => {
      jar.set(name, { value, options });
    },
    delete: (options: { name: string; path?: string }) => {
      expect(options.path).toBe('/oauth/authorize');
      jar.delete(options.name);
    },
  }),
}));
const { answerAiConsentAction } = await import('./actions');
const { consentRequestKey, decodeAiFilePicks } = await import('../../../lib/ai-file-picks-retry');

const RECORD = '11111111-1111-4111-8111-111111111111';
const DOC = '44444444-4444-4444-8444-444444444444';
const REQUEST = {
  client: {
    clientId: 'https://claude.ai/meta',
    clientName: 'Claude',
    host: 'claude.ai',
    loopback: false,
  },
  redirectUri: 'https://claude.ai/api/mcp/auth_callback',
  codeChallenge: 'c'.repeat(43),
  resource: 'https://vs.example.test/mcp',
  state: 'state-1',
};
const NONE = { ok: true, message: '' };
const binding = (request = REQUEST) => ({
  accountId: 'owner',
  applicantId: RECORD,
  target: 'consent',
  request: consentRequestKey({
    clientId: request.client.clientId,
    codeChallenge: request.codeChallenge,
    state: request.state,
  }),
});

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  data.set('record', RECORD);
  data.set('decision', 'allow');
  for (const [name, value] of Object.entries(fields)) {
    data.delete(name);
    for (const item of Array.isArray(value) ? value : [value]) data.append(name, item);
  }
  return data;
}
const base = { layer: 'identity', cases: 'all', duration: '30d', document_list: 'on' };

beforeEach(() => {
  vi.resetAllMocks();
  jar.clear();
  vi.stubEnv('AI_CONNECTOR_ENABLED', 'true');
  vi.stubEnv('NEON_AUTH_COOKIE_SECRET', 'x'.repeat(64));
  mocks.check.mockResolvedValue({ kind: 'ok', request: REQUEST });
  mocks.requireAccess.mockResolvedValue({
    ok: true,
    value: { actor: { kind: 'applicant_owner' } },
  });
  mocks.establishStepUpProof.mockResolvedValue({ kind: 'reauth_required', reauthUrl: '/reauth' });
  mocks.redirect.mockImplementation((url: string) => {
    throw new Error(`redirected:${url}`);
  });
});

describe('the consent answer keeps the ticked files for this request only', () => {
  it('saves the latest choice, an empty one included, so unticked files never come back', async () => {
    const original = {
      ...base,
      files_present: '1',
      file: DOC,
      [`file_variant_${DOC}`]: 'ORIGINAL',
    };
    await expect(answerAiConsentAction(NONE, form(original))).rejects.toThrow('redirected:/reauth');
    expect(decodeAiFilePicks(jar.get('vs_ai_file_picks')?.value, binding())).toEqual([
      { documentId: DOC, variant: 'ORIGINAL' },
    ]);
    // Unticked everything, then the check again (full numbers): the saved choice is now empty.
    await expect(
      answerAiConsentAction(NONE, form({ ...base, reveal_identifiers: 'on', files_present: '1' })),
    ).rejects.toThrow('redirected:/reauth');
    expect(decodeAiFilePicks(jar.get('vs_ai_file_picks')?.value, binding())).toEqual([]);
    // No file choices on the form at all: any older saved choice is cleared.
    await expect(
      answerAiConsentAction(NONE, form({ ...base, reveal_identifiers: 'on' })),
    ).rejects.toThrow('redirected:/reauth');
    expect(jar.has('vs_ai_file_picks')).toBe(false);
  });

  it('never fills another app’s, or another request’s, consent screen', async () => {
    const original = {
      ...base,
      files_present: '1',
      file: DOC,
      [`file_variant_${DOC}`]: 'ORIGINAL',
    };
    await expect(answerAiConsentAction(NONE, form(original))).rejects.toThrow('redirected:/reauth');
    const saved = jar.get('vs_ai_file_picks')?.value;
    expect(decodeAiFilePicks(saved, binding())).not.toBeNull();
    const otherApp = {
      ...REQUEST,
      client: { ...REQUEST.client, clientId: 'https://chatgpt.com/meta' },
    };
    expect(decodeAiFilePicks(saved, binding(otherApp))).toBeNull();
    expect(decodeAiFilePicks(saved, binding({ ...REQUEST, state: 'state-2' }))).toBeNull();
    expect(
      decodeAiFilePicks(saved, binding({ ...REQUEST, codeChallenge: 'd'.repeat(43) })),
    ).toBeNull();
  });

  it('clears the saved choice on Do Not Allow and on Allow', async () => {
    jar.set('vs_ai_file_picks', { value: 'kept', options: {} });
    await expect(answerAiConsentAction(NONE, form({ ...base, decision: 'deny' }))).rejects.toThrow(
      /redirected:.*access_denied/,
    );
    expect(jar.has('vs_ai_file_picks')).toBe(false);
    jar.set('vs_ai_file_picks', { value: 'kept', options: {} });
    mocks.createAiConnection.mockResolvedValue({ ok: true, value: { code: 'code-1' } });
    await expect(answerAiConsentAction(NONE, form(base))).rejects.toThrow(/redirected:.*code-1/);
    expect(jar.has('vs_ai_file_picks')).toBe(false);
  });
});
