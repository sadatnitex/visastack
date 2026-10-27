import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  MAX_TEXT_LENGTH,
  parseWhatsAppWebhook,
  verifySubscription,
  verifyWebhookSignature,
} from './whatsapp-webhook';

/*
 * Fixtures follow the structure in Meta's webhook reference as recorded in
 * docs/roadmap/pwa-whatsapp/WHATSAPP-POLICY-RESEARCH.md (sections 5 to 8). They are built, not
 * copied verbatim: replace them with Meta's own example payloads once the docs can be fetched.
 * All values are made up.
 */

const PHONE_NUMBER_ID = '106540352242922';
const USER_ID = 'BD.13491208655302741918';

function envelope(value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: '102290129340398',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550783881', phone_number_id: PHONE_NUMBER_ID },
              ...value,
            },
          },
        ],
      },
    ],
  };
}

const contact = { profile: { name: 'Test Person' }, wa_id: '8801700000000', user_id: USER_ID };

function message(fields: Record<string, unknown>) {
  return {
    from: '8801700000000',
    from_user_id: USER_ID,
    id: 'wamid.HBgLMTY1MDM4Nzk0MzkVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA=',
    timestamp: '1761540000',
    ...fields,
  };
}

describe('verifySubscription', () => {
  const params = (mode: string, token: string, challenge = '1158201444') =>
    new URLSearchParams({
      'hub.mode': mode,
      'hub.verify_token': token,
      'hub.challenge': challenge,
    });

  it('echoes the challenge only for subscribe with the right token', () => {
    expect(verifySubscription(params('subscribe', 'expected-token'), 'expected-token')).toBe(
      '1158201444',
    );
    expect(verifySubscription(params('subscribe', 'wrong'), 'expected-token')).toBeNull();
    expect(
      verifySubscription(params('unsubscribe', 'expected-token'), 'expected-token'),
    ).toBeNull();
    expect(
      verifySubscription(params('subscribe', 'expected-token', ''), 'expected-token'),
    ).toBeNull();
  });

  it('refuses everything while no token is configured', () => {
    expect(verifySubscription(params('subscribe', ''), undefined)).toBeNull();
    expect(verifySubscription(params('subscribe', ''), '')).toBeNull();
  });
});

describe('verifyWebhookSignature', () => {
  const body = new TextEncoder().encode(JSON.stringify(envelope({ messages: [] })));
  const sign = (secret: string, bytes: Uint8Array = body) =>
    `sha256=${createHmac('sha256', secret).update(bytes).digest('hex')}`;

  it('accepts the raw body signed with the app secret', () => {
    expect(verifyWebhookSignature(body, sign('app-secret'), ['app-secret'])).toBe(true);
  });

  it('accepts the previous secret during a rotation', () => {
    expect(verifyWebhookSignature(body, sign('old-secret'), ['new-secret', 'old-secret'])).toBe(
      true,
    );
  });

  it('refuses an altered body, a wrong secret, a missing or malformed header', () => {
    const altered = new TextEncoder().encode(`${new TextDecoder().decode(body)} `);
    expect(verifyWebhookSignature(altered, sign('app-secret'), ['app-secret'])).toBe(false);
    expect(verifyWebhookSignature(body, sign('other'), ['app-secret'])).toBe(false);
    expect(verifyWebhookSignature(body, null, ['app-secret'])).toBe(false);
    expect(verifyWebhookSignature(body, 'sha1=abc', ['app-secret'])).toBe(false);
    expect(verifyWebhookSignature(body, 'sha256=zz', ['app-secret'])).toBe(false);
  });

  it('refuses everything while no secret is configured', () => {
    expect(verifyWebhookSignature(body, sign(''), [''])).toBe(false);
    expect(verifyWebhookSignature(body, sign('x'), [])).toBe(false);
  });
});

describe('parseWhatsAppWebhook', () => {
  it('reads an inbound text message keyed on the business-scoped id', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [contact],
        messages: [message({ type: 'text', text: { body: '  What is missing?  ' } })],
      }),
    );
    expect(parsed.inbound).toEqual([
      {
        providerMessageId: expect.stringMatching(/^wamid\./),
        phoneNumberId: PHONE_NUMBER_ID,
        sender: { externalUserId: USER_ID, waId: '8801700000000' },
        sentAt: new Date(1761540000 * 1000),
        kind: 'text',
        text: 'What is missing?',
        replyId: null,
        mediaType: null,
      },
    ]);
  });

  it('works when the phone number is left out (a person who uses a username)', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [{ profile: { name: 'x', username: 'test.person' }, user_id: USER_ID }],
        messages: [message({ from: undefined, type: 'text', text: { body: 'hi' } })],
      }),
    );
    expect(parsed.inbound[0]?.sender).toEqual({ externalUserId: USER_ID, waId: null });
  });

  it('falls back to the phone id for a payload without a business-scoped id', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [{ profile: { name: 'x' }, wa_id: '8801700000000' }],
        messages: [message({ from_user_id: undefined, type: 'text', text: { body: 'hi' } })],
      }),
    );
    expect(parsed.inbound[0]?.sender.externalUserId).toBe('wa:8801700000000');
  });

  it('reads button and list replies as opaque ids', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [contact],
        messages: [
          message({
            id: 'wamid.button',
            type: 'interactive',
            interactive: {
              type: 'button_reply',
              button_reply: { id: 'menu:status', title: 'Case' },
            },
          }),
          message({
            id: 'wamid.list',
            type: 'interactive',
            interactive: { type: 'list_reply', list_reply: { id: 'menu:expiry', title: 'Expiry' } },
          }),
          message({
            id: 'wamid.template',
            type: 'button',
            button: { payload: 'stop', text: 'Stop' },
          }),
        ],
      }),
    );
    expect(parsed.inbound.map((item) => [item.kind, item.replyId])).toEqual([
      ['reply', 'menu:status'],
      ['reply', 'menu:expiry'],
      ['reply', 'stop'],
    ]);
  });

  it('records media by type only, never its link or id', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [contact],
        messages: [
          message({ type: 'image', image: { id: '1234', mime_type: 'image/jpeg', sha256: 'x' } }),
        ],
      }),
    );
    expect(parsed.inbound[0]).toMatchObject({ kind: 'media', mediaType: 'image', text: null });
    expect(JSON.stringify(parsed)).not.toContain('1234');
  });

  it('cuts very long text instead of rejecting it', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [contact],
        messages: [message({ type: 'text', text: { body: 'a'.repeat(MAX_TEXT_LENGTH + 50) } })],
      }),
    );
    expect(parsed.inbound[0]?.text).toHaveLength(MAX_TEXT_LENGTH);
  });

  it('reads delivery statuses with error codes and pricing', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        statuses: [
          {
            id: 'wamid.out1',
            status: 'failed',
            timestamp: '1761540100',
            recipient_id: '8801700000000',
            recipient_user_id: USER_ID,
            errors: [{ code: 130403, title: 'Blocked' }],
          },
          {
            id: 'wamid.out2',
            status: 'delivered',
            timestamp: '1761540101',
            pricing: { billable: true, pricing_model: 'PMP', category: 'utility' },
          },
          { id: 'wamid.out3', status: 'unknown-state', timestamp: '1761540102' },
        ],
      }),
    );
    expect(parsed.statuses).toEqual([
      expect.objectContaining({ state: 'failed', errorCodes: [130403], recipientUserId: USER_ID }),
      expect.objectContaining({ state: 'delivered', pricingCategory: 'utility', billable: true }),
    ]);
  });

  it("reads Meta's notice that a person changed number or id", () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [contact],
        messages: [
          message({
            id: 'wamid.system1',
            type: 'system',
            system: { type: 'user_changed_user_id', user_id: 'BD.99999' },
          }),
          message({
            id: 'wamid.system2',
            type: 'system',
            system: { type: 'user_changed_number', wa_id: '8801800000000' },
          }),
        ],
      }),
    );
    expect(parsed.inbound).toEqual([]);
    expect(parsed.identityChanges).toEqual([
      expect.objectContaining({
        kind: 'user_id_changed',
        externalUserId: USER_ID,
        newExternalUserId: 'BD.99999',
      }),
      expect.objectContaining({ kind: 'number_changed', newWaId: '8801800000000' }),
    ]);
  });

  it('ignores other products, other fields, and malformed entries without throwing', () => {
    expect(parseWhatsAppWebhook(null).inbound).toEqual([]);
    expect(parseWhatsAppWebhook({ object: 'page', entry: [] }).inbound).toEqual([]);
    const parsed = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        { changes: [{ field: 'account_update', value: { messaging_product: 'whatsapp' } }] },
        { changes: 'not-a-list' },
        envelope({ contacts: [contact], messages: [{ id: 'no-timestamp' }, 'junk', 42] }).entry[0],
        envelope({
          contacts: [contact],
          messages: [message({ type: 'text', text: { body: 'kept' } })],
        }).entry[0],
      ],
    });
    expect(parsed.inbound.map((item) => item.text)).toEqual(['kept']);
  });

  it('drops a message with no usable sender', () => {
    const parsed = parseWhatsAppWebhook(
      envelope({
        contacts: [],
        messages: [
          message({ from: 'not-digits', from_user_id: 'bad', type: 'text', text: { body: 'x' } }),
        ],
      }),
    );
    expect(parsed.inbound).toEqual([]);
  });
});
