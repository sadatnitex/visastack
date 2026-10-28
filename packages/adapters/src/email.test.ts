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
    await expect(port.send({ to: 'a@example.com', subject: 'hi', body: 'hello' })).rejects.toThrow(
      'Email provider not configured',
    );
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
    expect(body).not.toHaveProperty('html');
  });

  it('sends the designed HTML beside the plain text when there is one', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'msg_html' }));
    const port = new ResendEmailPort({
      apiKey: 're_test_key',
      from: 'VisaStack <n@example.com>',
      fetchImpl,
    });
    await port.send({
      to: 'a@example.com',
      subject: 's',
      body: 'plain words',
      html: '<p>designed</p>',
    });
    const [, requestInit] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string);
    expect(body.text).toBe('plain words');
    expect(body.html).toBe('<p>designed</p>');
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

  it('rejects an acknowledgement without a provider id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const port = new ResendEmailPort({ apiKey: 'k', from: 'a@example.com', fetchImpl });
    await expect(port.send({ to: 'a@example.com', subject: 's', body: 'b' })).rejects.toThrow(
      'Email provider did not confirm acceptance',
    );
  });

  it('rejects a non-JSON success response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not json', { status: 200 }));
    const port = new ResendEmailPort({ apiKey: 'k', from: 'a@example.com', fetchImpl });
    await expect(port.send({ to: 'a@example.com', subject: 's', body: 'b' })).rejects.toThrow(
      'Email provider did not confirm acceptance',
    );
  });

  it('throws on a non-2xx response, retaining only the provider status -- never the recipient or subject', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          '{"message":"invalid API key; applicant@example.com; Evidence requested; private body"}',
          { status: 401 },
        ),
      );
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
    expect(message).not.toContain('invalid API key');
    expect(message).not.toContain('private body');
    expect(message).not.toContain('applicant@example.com');
    expect(message).not.toContain('Evidence requested');
  });

  it('sanitizes a network-level fetch rejection', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('DNS failure; private request body'));
    const port = new ResendEmailPort({ apiKey: 'k', from: 'a@example.com', fetchImpl });
    await expect(port.send({ to: 'a@example.com', subject: 's', body: 'b' })).rejects.toThrow(
      'Email provider unavailable or request timed out',
    );
  });
});

describe('email acceptance and retry boundaries', () => {
  it('reuses an opaque key across provider retries', async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementation(async () => jsonResponse(200, { id: 'same-message' }));
    const port = new ResendEmailPort({ apiKey: 'test', from: 'noreply@example.com', fetchImpl });
    const input = {
      to: 'synthetic@example.com',
      subject: 'synthetic',
      body: 'synthetic',
      idempotencyKey: 'notification-opaque-id',
    };
    await port.send(input);
    await port.send(input);
    for (const call of fetchImpl.mock.calls) {
      expect(new Headers(call[1].headers).get('Idempotency-Key')).toBe(input.idempotencyKey);
      expect(call[1].signal).toBeInstanceOf(AbortSignal);
    }
  });
  it('rejects a key containing an address without making a request', async () => {
    const fetchImpl = vi.fn();
    const port = new ResendEmailPort({ apiKey: 'test', from: 'noreply@example.com', fetchImpl });
    await expect(
      port.send({
        to: 'synthetic@example.com',
        subject: 'synthetic',
        body: 'synthetic',
        idempotencyKey: 'private@example.com',
      }),
    ).rejects.toThrow('Invalid email idempotency key');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('times out a stalled provider request', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, options: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          options.signal?.addEventListener(
            'abort',
            () => reject(new Error('private transport details')),
            { once: true },
          );
        }),
    );
    const port = new ResendEmailPort({ apiKey: 'test', from: 'noreply@example.com', fetchImpl });
    await expect(
      port.send({ to: 'synthetic@example.com', subject: 'synthetic', body: 'synthetic' }),
    ).rejects.toThrow('Email provider unavailable or request timed out');
  }, 15_000);
});
