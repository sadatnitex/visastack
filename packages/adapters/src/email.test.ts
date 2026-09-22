import { afterEach, describe, expect, it, vi } from 'vitest';
import { NullEmailPort, ResendEmailPort } from './email';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A variable-keyed env access (matches packages/adapters/src/email.ts's own
// `readEnv` helper) satisfies both TS's noPropertyAccessFromIndexSignature
// (wants bracket access) and Biome's useLiteralKeys (wants dot access for a
// literal key) -- a variable key trips neither.
const DEPLOYMENT_MODE_KEY = 'DEPLOYMENT_MODE';

describe('NullEmailPort', () => {
  const originalDeploymentMode = process.env[DEPLOYMENT_MODE_KEY];

  afterEach(() => {
    if (originalDeploymentMode === undefined) {
      delete process.env[DEPLOYMENT_MODE_KEY];
    } else {
      process.env[DEPLOYMENT_MODE_KEY] = originalDeploymentMode;
    }
    vi.restoreAllMocks();
  });

  it('constructs fine and never sends outside commercial mode', async () => {
    delete process.env[DEPLOYMENT_MODE_KEY];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const port = new NullEmailPort();
    const result = await port.send({ to: 'a@example.com', subject: 'hi', body: 'hello' });
    expect(result).toEqual({});
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // Never logs the recipient or subject (SEC-02/PRV).
    const [message] = warnSpy.mock.calls[0] as [string];
    expect(message).not.toContain('a@example.com');
    expect(message).not.toContain('hi');
  });

  it('refuses to construct when explicitly told deployment mode is commercial', () => {
    expect(() => new NullEmailPort({ deploymentMode: 'commercial' })).toThrow(/commercial mode/);
  });

  it('refuses to construct when DEPLOYMENT_MODE=commercial in the ambient environment', () => {
    process.env[DEPLOYMENT_MODE_KEY] = 'commercial';
    expect(() => new NullEmailPort()).toThrow(/commercial mode/);
  });

  it('does not throw for a non-commercial ambient DEPLOYMENT_MODE', () => {
    process.env[DEPLOYMENT_MODE_KEY] = 'controlled_pilot';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => new NullEmailPort()).not.toThrow();
  });
});

describe('ResendEmailPort', () => {
  it('posts to the Resend API with the expected headers and body, returning the provider id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'msg_abc123' }));
    const port = new ResendEmailPort({
      apiKey: 're_test_key',
      from: 'VisaStack <notifications@example.com>',
      fetchImpl,
    });

    const result = await port.send({
      to: 'applicant@example.com',
      subject: 'Evidence requested',
      body: 'Please review your evidence request.',
    });

    expect(result).toEqual({ providerMessageId: 'msg_abc123' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(requestInit.method).toBe('POST');
    const headers = requestInit.headers as Record<string, string>;
    // biome-ignore lint/complexity/useLiteralKeys: Record<string, ...> requires bracket access under noPropertyAccessFromIndexSignature.
    expect(headers['Authorization']).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(requestInit.body as string);
    expect(body.from).toBe('VisaStack <notifications@example.com>');
    expect(body.to).toEqual(['applicant@example.com']);
    expect(body.subject).toBe('Evidence requested');
    expect(body.text).toBe('Please review your evidence request.');
  });

  it('uses a custom apiBaseUrl when supplied', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'msg_1' }));
    const port = new ResendEmailPort({
      apiKey: 're_test_key',
      from: 'noreply@example.com',
      apiBaseUrl: 'https://staging.example.com/resend',
      fetchImpl,
    });
    await port.send({ to: 'a@example.com', subject: 's', body: 'b' });
    const [url] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://staging.example.com/resend/emails');
  });

  it('returns no providerMessageId when the response omits an id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const port = new ResendEmailPort({ apiKey: 'k', from: 'a@example.com', fetchImpl });
    const result = await port.send({ to: 'a@example.com', subject: 's', body: 'b' });
    expect(result).toEqual({});
  });

  it('tolerates a non-JSON 2xx body rather than throwing', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    const port = new ResendEmailPort({ apiKey: 'k', from: 'a@example.com', fetchImpl });
    const result = await port.send({ to: 'a@example.com', subject: 's', body: 'b' });
    expect(result).toEqual({});
  });

  it('throws on a non-2xx response, naming only the provider status/body -- never the recipient or subject', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"message":"invalid API key"}', { status: 401 }));
    const port = new ResendEmailPort({ apiKey: 'bad-key', from: 'a@example.com', fetchImpl });

    let caught: Error | undefined;
    try {
      await port.send({
        to: 'applicant@example.com',
        subject: 'Evidence requested',
        body: 'body text',
      });
    } catch (error) {
      caught = error as Error;
    }

    expect(caught).toBeDefined();
    const message = caught?.message ?? '';
    expect(message).toContain('401');
    expect(message).toContain('invalid API key');
    expect(message).not.toContain('applicant@example.com');
    expect(message).not.toContain('Evidence requested');
  });

  it('propagates a network-level fetch rejection', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure'));
    const port = new ResendEmailPort({ apiKey: 'k', from: 'a@example.com', fetchImpl });
    await expect(port.send({ to: 'a@example.com', subject: 's', body: 'b' })).rejects.toThrow(
      'DNS failure',
    );
  });
});
