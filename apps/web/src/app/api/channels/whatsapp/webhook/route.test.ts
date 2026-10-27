import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  run: vi.fn(),
  after: vi.fn(),
  keys: vi.fn(),
}));
vi.mock('@visastack/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@visastack/services')>()),
  ingestWhatsAppWebhook: mocks.ingest,
}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('../../../../../lib/public-db', () => ({
  withPublicDb: (fn: (db: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock('../../../../../lib/providers', () => ({ createKeyManagementPort: mocks.keys }));
vi.mock('../../../jobs/process-whatsapp-inbox/run', () => ({ runWhatsAppInbox: mocks.run }));

const { GET, POST } = await import('./route');

const URL_BASE = 'https://vs.example.test/api/channels/whatsapp/webhook';
const SECRET = 'synthetic-app-secret';

function enable() {
  vi.stubEnv('WHATSAPP_CHANNEL_ENABLED', 'on');
  vi.stubEnv('WHATSAPP_APP_SECRET', SECRET);
  vi.stubEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'synthetic-verify');
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'synthetic-access');
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', '106540352242922');
  vi.stubEnv('WHATSAPP_SUPPORT_EMAIL', 'help@vs.example.test');
}

function signed(body: string, secret = SECRET) {
  return new Request(URL_BASE, {
    method: 'POST',
    body,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
  });
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.keys.mockReturnValue({});
  mocks.ingest.mockResolvedValue('stored');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('WhatsApp webhook', () => {
  it('refuses the handshake while off, and answers deliveries 200 without storing them', async () => {
    expect((await GET(new Request(`${URL_BASE}?hub.mode=subscribe`))).status).toBe(404);
    // A 200 stops Meta retrying a delivery for seven days while the channel is switched off.
    expect((await POST(signed('{}'))).status).toBe(200);
    expect(mocks.ingest).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("answers Meta's handshake only with the configured token", async () => {
    enable();
    const ok = await GET(
      new Request(
        `${URL_BASE}?hub.mode=subscribe&hub.verify_token=synthetic-verify&hub.challenge=4242`,
      ),
    );
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe('4242');
    const wrong = await GET(
      new Request(`${URL_BASE}?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=4242`),
    );
    expect(wrong.status).toBe(403);
  });

  it('refuses an unsigned or wrongly signed delivery and stores nothing', async () => {
    enable();
    expect((await POST(new Request(URL_BASE, { method: 'POST', body: '{}' }))).status).toBe(401);
    expect((await POST(signed('{}', 'other-secret'))).status).toBe(401);
    expect(mocks.ingest).not.toHaveBeenCalled();
  });

  it('refuses an oversized delivery before reading it', async () => {
    enable();
    const request = new Request(URL_BASE, {
      method: 'POST',
      body: 'x',
      headers: { 'content-length': String(2 * 1024 * 1024) },
    });
    expect((await POST(request)).status).toBe(413);
  });

  it('stores a signed delivery with its exact bytes, answers at once, and handles it afterwards', async () => {
    enable();
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    const response = await POST(signed(body));
    expect(response.status).toBe(200);
    const stored = mocks.ingest.mock.calls[0]?.[2] as Uint8Array;
    expect(new TextDecoder().decode(stored)).toBe(body);
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it('accepts the previous secret during a rotation', async () => {
    enable();
    vi.stubEnv('WHATSAPP_APP_SECRET', 'new-secret');
    vi.stubEnv('WHATSAPP_APP_SECRET_PREVIOUS', SECRET);
    expect((await POST(signed('{}'))).status).toBe(200);
  });

  it('asks Meta to retry when it cannot store, and does not re-handle a repeat', async () => {
    enable();
    mocks.keys.mockReturnValue(undefined);
    expect((await POST(signed('{}'))).status).toBe(503);
    mocks.keys.mockReturnValue({});
    mocks.ingest.mockResolvedValue('unavailable');
    expect((await POST(signed('{}'))).status).toBe(503);
    mocks.ingest.mockRejectedValue(new Error('database down'));
    expect((await POST(signed('{}'))).status).toBe(503);
    mocks.ingest.mockResolvedValue('duplicate');
    expect((await POST(signed('{}'))).status).toBe(200);
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
