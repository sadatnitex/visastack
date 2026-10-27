import { WhatsAppSendError } from '@visastack/services';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppCloudPort, toGraphMessage } from './whatsapp-cloud';

const to = { waId: '8801700000000' };
const PHONE_NUMBER_ID = '106540352242922';

function port(response: Response | Error) {
  const fetchImpl = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return {
    fetchImpl,
    port: new WhatsAppCloudPort({
      accessToken: 'test-token',
      apiVersion: 'v26.0',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }),
  };
}

const ok = () =>
  new Response(JSON.stringify({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.out' }] }), {
    status: 200,
  });

describe('WhatsAppCloudPort', () => {
  it('posts to the business number with the bearer token and returns the message id', async () => {
    const { port: cloud, fetchImpl } = port(ok());
    const result = await cloud.send(PHONE_NUMBER_ID, { kind: 'text', to, body: 'Hello' });
    expect(result).toEqual({ providerMessageId: 'wamid.out' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://graph.facebook.com/v26.0/${PHONE_NUMBER_ID}/messages`);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-token');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '8801700000000',
      type: 'text',
      text: { body: 'Hello', preview_url: false },
    });
  });

  it('marks a block as permanent and throttling as retryable', async () => {
    const blocked = port(
      new Response(JSON.stringify({ error: { code: 130403 } }), { status: 400 }),
    );
    await expect(
      blocked.port.send(PHONE_NUMBER_ID, { kind: 'text', to, body: 'x' }),
    ).rejects.toMatchObject({
      code: 130403,
      retryable: false,
    });
    const throttled = port(
      new Response(JSON.stringify({ error: { code: 131056 } }), { status: 400 }),
    );
    await expect(
      throttled.port.send(PHONE_NUMBER_ID, { kind: 'text', to, body: 'x' }),
    ).rejects.toMatchObject({ code: 131056, retryable: true });
  });

  it('treats a network failure and a server error as retryable', async () => {
    const offline = port(new TypeError('fetch failed'));
    await expect(
      offline.port.send(PHONE_NUMBER_ID, { kind: 'text', to, body: 'x' }),
    ).rejects.toBeInstanceOf(WhatsAppSendError);
    const down = port(new Response('busy', { status: 503 }));
    await expect(
      down.port.send(PHONE_NUMBER_ID, { kind: 'text', to, body: 'x' }),
    ).rejects.toMatchObject({
      retryable: true,
    });
  });

  it('never sends a message that breaks a limit', async () => {
    const { port: cloud, fetchImpl } = port(ok());
    await expect(
      cloud.send(PHONE_NUMBER_ID, {
        kind: 'buttons',
        to,
        body: 'Choose',
        buttons: [{ id: 'a', title: 'A title that is far too long for a button' }],
      }),
    ).rejects.toThrow(/button title/);
    await expect(
      cloud.send(PHONE_NUMBER_ID, {
        kind: 'link',
        to,
        body: 'Open',
        label: 'Open',
        url: 'http://x',
      }),
    ).rejects.toThrow(/https/);
    await expect(cloud.send('not-an-id', { kind: 'text', to, body: 'x' })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses to start without a token or with an odd version', () => {
    expect(() => new WhatsAppCloudPort({ accessToken: '', apiVersion: 'v26.0' })).toThrow();
    expect(() => new WhatsAppCloudPort({ accessToken: 't', apiVersion: '26' })).toThrow();
  });
});

describe('toGraphMessage', () => {
  it('builds reply buttons, a list and a link button', () => {
    expect(
      toGraphMessage({
        kind: 'buttons',
        to,
        body: 'Pick',
        buttons: [{ id: 'menu:status', title: 'Case' }],
      }),
    ).toMatchObject({
      type: 'interactive',
      interactive: {
        type: 'button',
        action: { buttons: [{ type: 'reply', reply: { id: 'menu:status' } }] },
      },
    });
    expect(
      toGraphMessage({
        kind: 'list',
        to,
        body: 'Pick',
        buttonLabel: 'Menu',
        rows: [{ id: 'r', title: 'Row' }],
      }),
    ).toMatchObject({
      interactive: {
        type: 'list',
        action: { button: 'Menu', sections: [{ rows: [{ id: 'r' }] }] },
      },
    });
    expect(
      toGraphMessage({
        kind: 'link',
        to,
        body: 'Open',
        label: 'Open',
        url: 'https://vs.example/app',
      }),
    ).toMatchObject({
      interactive: {
        type: 'cta_url',
        action: { parameters: { display_text: 'Open', url: 'https://vs.example/app' } },
      },
    });
  });
});
