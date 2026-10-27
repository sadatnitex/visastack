import { randomBytes } from 'node:crypto';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { systemScopeForTest } from '../access/system-scope.test-support';
import { provisionAccount } from '../accounts';
import { createApplicant } from '../applicants';
import { setConsent } from '../consent';
import type { Db } from '../db';
import { createMission } from '../missions';
import type { KeyManagementPort } from '../ports';
import {
  EVENT_RETENTION_MS,
  MAX_EVENT_ATTEMPTS,
  REPLY_LIMIT_UNLINKED,
  WELCOME_GAP_MS,
  type WhatsAppChannelSettings,
  ingestWhatsAppWebhook,
  processWhatsAppInbox,
  retryDelayMs,
} from './whatsapp-inbox';
import { disconnectWhatsApp, getWhatsAppConnection, startWhatsAppLink } from './whatsapp-link';
import {
  WHATSAPP_ERROR,
  type WhatsAppOutgoing,
  type WhatsAppPort,
  WhatsAppSendError,
} from './whatsapp-port';
import { MENU_REPLY_IDS, TEXT } from './whatsapp-replies';

/*
 * Webhook bodies follow Meta's documented structure (research file sections 5 to 8); values
 * are made up. Every test runs the real inbox against a migrated database.
 */

const NUMBER_ID = '106540352242922';
const SETTINGS: WhatsAppChannelSettings = {
  phoneNumberId: NUMBER_ID,
  baseUrl: 'https://vs.example.test',
  supportEmail: 'help@vs.example.test',
};
const T0 = new Date('2026-10-27T09:00:00Z');

function fakeKeyPort(): KeyManagementPort {
  const masterKey = Buffer.alloc(32, 7);
  return {
    currentKeyVersion: () => 'test-v1',
    async generateDataKey() {
      return {
        keyVersion: 'test-v1',
        plaintextDataKey: randomBytes(32),
        wrappedDataKey: masterKey,
      };
    },
    async unwrapDataKey() {
      return masterKey;
    },
  };
}

class RecordingPort implements WhatsAppPort {
  readonly sent: { to: string; message: WhatsAppOutgoing }[] = [];
  failWith: WhatsAppSendError | null = null;
  async send(_phoneNumberId: string, message: WhatsAppOutgoing) {
    if (this.failWith) throw this.failWith;
    this.sent.push({ to: message.to.waId, message });
    return { providerMessageId: `wamid.out.${this.sent.length}` };
  }
  last(): WhatsAppOutgoing | undefined {
    return this.sent.at(-1)?.message;
  }
  bodies(): string[] {
    return this.sent.map((item) => ('body' in item.message ? item.message.body : ''));
  }
}

let counter = 0;
function inbound(
  sender: { userId: string; waId?: string | null },
  message: Record<string, unknown>,
  options: { numberId?: string; at?: Date; id?: string } = {},
) {
  counter += 1;
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '15550783881',
                phone_number_id: options.numberId ?? NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name: 'x' },
                  user_id: sender.userId,
                  ...(sender.waId === null ? {} : { wa_id: sender.waId ?? '8801700001234' }),
                },
              ],
              messages: [
                {
                  ...(sender.waId === null ? {} : { from: sender.waId ?? '8801700001234' }),
                  from_user_id: sender.userId,
                  id: options.id ?? `wamid.in.${counter}`,
                  // Each message a second after the last, as real messages are.
                  timestamp: String(
                    Math.floor(
                      (options.at ?? new Date(T0.getTime() + counter * 1000)).getTime() / 1000,
                    ),
                  ),
                  ...message,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

const text = (body: string) => ({ type: 'text', text: { body } });
const pressed = (id: string) => ({
  type: 'interactive',
  interactive: { type: 'list_reply', list_reply: { id, title: 'x' } },
});

const bytes = (payload: unknown) => new TextEncoder().encode(JSON.stringify(payload));

describe('WhatsApp inbox', () => {
  let db: Db;
  let keys: KeyManagementPort;
  let port: RecordingPort;
  let clock: Date;
  const scope = systemScopeForTest('process-whatsapp-inbox');

  async function deliver(payload: unknown) {
    expect(await ingestWhatsAppWebhook(db, keys, bytes(payload), clock)).toBe('stored');
    return processWhatsAppInbox(scope, db, {
      encryption: keys,
      whatsapp: port,
      settings: SETTINGS,
      now: () => clock,
    });
  }

  async function account(email: string) {
    const provisioned = await provisionAccount(db, { email });
    if (!isOk(provisioned)) throw new Error('provision');
    return provisioned.value.id;
  }

  async function traveller(ownerId: string, name: string) {
    await setConsent(db, {
      actorAccountId: ownerId,
      accountId: ownerId,
      type: 'CORE_PROCESSING',
      granted: true,
    });
    const applicant = await createApplicant(db, {
      actorAccountId: ownerId,
      ownerAccountId: ownerId,
      displayName: name,
    });
    if (!isOk(applicant)) throw new Error('applicant');
    return applicant.value.id;
  }

  async function connect(accountId: string, userId: string, waId = '8801700001234') {
    const started = await startWhatsAppLink(db, { accountId, optIn: true, now: clock });
    if (!isOk(started)) throw new Error('link');
    await deliver(inbound({ userId, waId }, text(started.value.message)));
    return started.value;
  }

  beforeEach(async () => {
    db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    keys = fakeKeyPort();
    port = new RecordingPort();
    clock = T0;
  });

  it('stores a delivery encrypted, and a repeat of the same delivery once', async () => {
    const payload = inbound({ userId: 'BD.1' }, text('What is my passport number A12345678?'));
    expect(await ingestWhatsAppWebhook(db, keys, bytes(payload), clock)).toBe('stored');
    expect(await ingestWhatsAppWebhook(db, keys, bytes(payload), clock)).toBe('duplicate');
    const rows = await db.select().from(schema.channelWebhookEvents);
    expect(rows).toHaveLength(1);
    expect(Buffer.from(rows[0]?.payloadCiphertext ?? []).toString('utf8')).not.toContain(
      'A12345678',
    );
  });

  it('greets an unknown sender with how to connect, never with any record, and not twice in a row', async () => {
    await deliver(inbound({ userId: 'BD.unknown' }, text('show my case')));
    expect(port.sent).toHaveLength(1);
    expect(port.last()).toMatchObject({
      kind: 'link',
      body: TEXT.welcome,
      url: 'https://vs.example.test/app/account/whatsapp',
    });
    await deliver(inbound({ userId: 'BD.unknown' }, text('hello?')));
    expect(port.sent).toHaveLength(1);
    clock = new Date(T0.getTime() + WELCOME_GAP_MS + 1);
    await deliver(inbound({ userId: 'BD.unknown' }, text('hello again')));
    expect(port.sent).toHaveLength(2);
  });

  it('connects only with a code made in the signed-in account, and shows it there', async () => {
    const owner = await account('owner@example.test');
    const started = await connect(owner, 'BD.owner');
    expect(started.code).toMatch(/^\d{5}-\d{5}$/);
    expect(port.bodies().at(-1)).toContain(TEXT.connected);
    const connection = await getWhatsAppConnection(db, owner, clock);
    expect(connection).toMatchObject({
      connected: true,
      maskedNumber: 'ends in 1234',
      messagesOff: false,
    });
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'WHATSAPP_CONNECTED'));
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorAccountId).toBe(owner);
    expect(JSON.stringify(audits[0]?.metadata)).not.toMatch(/\d{4}-\d{4}|BD\.owner|8801/);
  });

  it('refuses a wrong, expired, reused or brute-forced code', async () => {
    const owner = await account('owner@example.test');
    const started = await startWhatsAppLink(db, { accountId: owner, optIn: true, now: clock });
    if (!isOk(started)) throw new Error('link');
    await deliver(inbound({ userId: 'BD.x' }, text('LINK 00000-00000')));
    expect(port.last()).toMatchObject({ body: TEXT.codeRefused });

    // Expiry is judged by when the person sent it (Meta's signed time).
    clock = new Date(T0.getTime() + 11 * 60 * 1000);
    await deliver(inbound({ userId: 'BD.x' }, text(started.value.message), { at: clock }));
    expect(port.last()).toMatchObject({ body: TEXT.codeRefused });
    expect((await getWhatsAppConnection(db, owner, clock)).connected).toBe(false);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await deliver(inbound({ userId: 'BD.x' }, text(`LINK 11111-1111${attempt}`)));
    }
    expect(port.last()).toMatchObject({ body: TEXT.tooManyAttempts });
  });

  it('never lets one WhatsApp take over a connection to a different account', async () => {
    const first = await account('first@example.test');
    const second = await account('second@example.test');
    await connect(first, 'BD.shared');
    const other = await startWhatsAppLink(db, { accountId: second, optIn: true, now: clock });
    if (!isOk(other)) throw new Error('link');
    await deliver(inbound({ userId: 'BD.shared' }, text(other.value.message)));
    expect(port.last()).toMatchObject({ body: TEXT.alreadyLinkedElsewhere });
    expect((await getWhatsAppConnection(db, first, clock)).connected).toBe(true);
    expect((await getWhatsAppConnection(db, second, clock)).connected).toBe(false);
  });

  it('answers case status, what is missing and expiry from the account own records only', async () => {
    const owner = await account('owner@example.test');
    const applicantId = await traveller(owner, 'Synthetic Traveller');
    const mission = await createMission(db, {
      actorAccountId: owner,
      applicantId,
      title: 'Family Visit',
      destination: 'United Kingdom',
      purpose: 'Visit family',
      travelStartDate: new Date('2026-12-01T00:00:00Z'),
    });
    expect(isOk(mission)).toBe(true);
    const stranger = await account('stranger@example.test');
    await traveller(stranger, 'Someone Else');
    await connect(owner, 'BD.owner');

    await deliver(inbound({ userId: 'BD.owner' }, pressed(MENU_REPLY_IDS.status)));
    const status = port.last();
    expect(status).toMatchObject({
      kind: 'link',
      url: `https://vs.example.test/app/applicant/${applicantId}`,
    });
    expect(status && 'body' in status ? status.body : '').toContain(
      'Family Visit (United Kingdom)',
    );
    expect(status && 'body' in status ? status.body : '').not.toContain('Someone Else');

    await deliver(inbound({ userId: 'BD.owner' }, text('what is missing?')));
    expect(port.bodies().at(-1)).toMatch(/^Still needed/);
    await deliver(inbound({ userId: 'BD.owner' }, text('anything expiring')));
    expect(port.bodies().at(-1)).toMatch(/^Expiring soon/);

    const reads = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'WHATSAPP_SUMMARY_PREPARED'));
    expect(reads).toHaveLength(3);
    expect(reads.every((row) => row.actorAccountId === owner)).toBe(true);
  });

  it('shows the menu for anything it does not understand, and Talk to a Person gives real contacts', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    await deliver(inbound({ userId: 'BD.owner' }, text('blue elephant')));
    expect(port.last()).toMatchObject({ kind: 'list', body: TEXT.menuBody });
    await deliver(inbound({ userId: 'BD.owner' }, text('I want to talk to a person')));
    expect(port.bodies().at(-1)).toContain('help@vs.example.test');
  });

  it('declines a document sent in chat, keeps nothing of it, and points to the private upload', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    await deliver(
      inbound(
        { userId: 'BD.owner' },
        { type: 'image', image: { id: 'media-777', mime_type: 'image/jpeg' } },
      ),
    );
    expect(port.last()).toMatchObject({
      kind: 'link',
      body: TEXT.media,
      url: 'https://vs.example.test/app/applicants',
    });
    const events = await db.select().from(schema.channelWebhookEvents);
    expect(events.every((row) => row.payloadCiphertext === null)).toBe(true);
    const audit = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'WHATSAPP_DOCUMENT_DECLINED'));
    expect(JSON.stringify(audit)).not.toContain('media-777');
  });

  it('handles the same message delivered twice as one', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    const before = port.sent.length;
    const first = inbound({ userId: 'BD.owner' }, text('status'), { id: 'wamid.same' });
    await deliver(first);
    // Meta retries with the same message id inside a new delivery.
    const again = inbound({ userId: 'BD.owner' }, text('status'), {
      id: 'wamid.same',
      at: new Date(T0.getTime() + 1000),
    });
    await deliver(again);
    expect(port.sent.length - before).toBe(1);
  });

  it('honours STOP at once, stays silent, and START turns it back on', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    await deliver(inbound({ userId: 'BD.owner' }, text('STOP')));
    expect(port.last()).toMatchObject({ body: TEXT.stopped });
    expect((await getWhatsAppConnection(db, owner, clock)).messagesOff).toBe(true);
    const count = port.sent.length;
    await deliver(inbound({ userId: 'BD.owner' }, text('status')));
    expect(port.sent.length).toBe(count);
    await deliver(inbound({ userId: 'BD.owner' }, text('start')));
    expect(port.bodies().at(-1)).toContain(TEXT.started);
    expect((await getWhatsAppConnection(db, owner, clock)).messagesOff).toBe(false);
  });

  it('treats a block reported by Meta as messages off', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    port.failWith = new WhatsAppSendError('blocked', WHATSAPP_ERROR.BLOCKED, false);
    await deliver(inbound({ userId: 'BD.owner' }, text('status')));
    expect((await getWhatsAppConnection(db, owner, clock)).messagesOff).toBe(true);
  });

  it('records delivery states in order and never moves one back', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    const outId = 'wamid.out.1';
    const statuses = (state: string, at: number) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: NUMBER_ID },
                statuses: [
                  {
                    id: outId,
                    status: state,
                    timestamp: String(at),
                    pricing: { billable: true, category: 'service' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await deliver(statuses('read', 1761555000));
    await deliver(statuses('delivered', 1761554000));
    const row = (
      await db
        .select()
        .from(schema.channelMessages)
        .where(eq(schema.channelMessages.providerMessageId, outId))
    )[0];
    expect(row).toMatchObject({ state: 'READ', pricingCategory: 'service', billable: true });
  });

  it("ends the connection when Meta says the person's id changed", async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    await deliver(
      inbound(
        { userId: 'BD.owner' },
        { type: 'system', system: { type: 'user_changed_user_id', user_id: 'BD.new' } },
      ),
    );
    expect((await getWhatsAppConnection(db, owner, clock)).connected).toBe(false);
  });

  it('disconnects from the account page, and the WhatsApp then knows nothing', async () => {
    const owner = await account('owner@example.test');
    await traveller(owner, 'Synthetic Traveller');
    await connect(owner, 'BD.owner');
    const result = await disconnectWhatsApp(db, { accountId: owner, now: clock });
    expect(isOk(result) && result.value.disconnected).toBe(true);
    clock = new Date(T0.getTime() + WELCOME_GAP_MS + 1);
    await deliver(inbound({ userId: 'BD.owner' }, pressed(MENU_REPLY_IDS.status)));
    expect(port.last()).toMatchObject({ body: TEXT.welcome });
  });

  it('ignores messages to another business number', async () => {
    await deliver(inbound({ userId: 'BD.1' }, text('hi'), { numberId: '999999999999' }));
    expect(port.sent).toHaveLength(0);
    expect(await db.select().from(schema.channelIdentities)).toHaveLength(0);
  });

  it('cannot answer a person whose number Meta left out, but still records the message', async () => {
    await deliver(inbound({ userId: 'BD.username', waId: null }, text('hi')));
    expect(port.sent).toHaveLength(0);
    expect(await db.select().from(schema.channelMessages)).toHaveLength(1);
  });

  it('waits longer after each failure, gives up after a few tries, and lets others through', async () => {
    const broken = new TextEncoder().encode('{not json');
    expect(await ingestWhatsAppWebhook(db, keys, broken, clock)).toBe('stored');
    const pass = () =>
      processWhatsAppInbox(scope, db, {
        encryption: keys,
        whatsapp: port,
        settings: SETTINGS,
        now: () => clock,
      });
    // One try per pass, and a second pass straight away does not retry it yet.
    expect((await pass()).failed).toBe(1);
    expect((await pass()).failed).toBe(0);
    for (let run = 1; run < MAX_EVENT_ATTEMPTS + 2; run += 1) {
      clock = new Date(clock.getTime() + retryDelayMs(run));
      await pass();
    }
    const [row] = await db.select().from(schema.channelWebhookEvents);
    expect(row).toMatchObject({
      attempts: MAX_EVENT_ATTEMPTS,
      lastError: 'unreadable',
      processedAt: null,
    });
    await deliver(inbound({ userId: 'BD.next' }, text('hi')));
    expect(port.sent).toHaveLength(1);
  });

  it('removes handled deliveries and unknown senders after 7 days, on the daily pass only', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    await deliver(inbound({ userId: 'BD.idle' }, text('hi')));
    clock = new Date(T0.getTime() + 8 * 24 * 60 * 60 * 1000);
    const options = { encryption: keys, whatsapp: port, settings: SETTINGS, now: () => clock };
    expect((await processWhatsAppInbox(scope, db, options)).purged).toBe(0);
    const result = await processWhatsAppInbox(scope, db, { ...options, purge: true });
    expect(result.purged).toBeGreaterThan(0);
    expect(await db.select().from(schema.channelWebhookEvents)).toHaveLength(0);
    const left = await db.select().from(schema.channelIdentities);
    // The connected person stays; the sender who never connected is gone.
    expect(left.map((row) => row.externalUserId)).toEqual(['BD.owner']);
    expect(EVENT_RETENTION_MS).toBeLessThanOrEqual(8 * 24 * 60 * 60 * 1000);
  });

  it('never lets an older STOP or START that arrives late undo a newer choice', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    const startAt = new Date(T0.getTime() + 60_000);
    const stopAt = new Date(T0.getTime() + 120_000);
    await deliver(inbound({ userId: 'BD.owner' }, text('STOP'), { at: stopAt }));
    // Meta's retry of an earlier START, delivered after the STOP.
    await deliver(inbound({ userId: 'BD.owner' }, text('START'), { at: startAt }));
    expect((await getWhatsAppConnection(db, owner, clock)).messagesOff).toBe(true);
  });

  it('applies STOP even when Meta left the number out', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    await deliver(inbound({ userId: 'BD.owner', waId: null }, text('stop')));
    expect((await getWhatsAppConnection(db, owner, clock)).messagesOff).toBe(true);
  });

  it('does not answer a reaction', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    const before = port.sent.length;
    await deliver(
      inbound(
        { userId: 'BD.owner' },
        { type: 'reaction', reaction: { message_id: 'wamid.x', emoji: 'x' } },
      ),
    );
    expect(port.sent.length).toBe(before);
  });

  it('caps replies to a sender who never connected, and writes no audit rows for them', async () => {
    for (let index = 0; index < 10; index += 1) {
      await deliver(inbound({ userId: 'BD.script' }, text(index % 2 === 0 ? 'STOP' : 'START')));
    }
    expect(port.sent.length).toBeLessThanOrEqual(REPLY_LIMIT_UNLINKED.limit);
    const audits = await db.select().from(schema.auditEvents);
    expect(audits.filter((row) => row.eventType.startsWith('WHATSAPP_'))).toEqual([]);
  });

  it('retries a send Meta refused for a moment, and gives up only on lasting errors', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    const before = port.sent.length;
    let refusals = 1;
    const send = port.send.bind(port);
    port.send = async (numberId, message) => {
      if (refusals > 0) {
        refusals -= 1;
        throw new WhatsAppSendError('slow down', WHATSAPP_ERROR.PAIR_RATE_LIMIT, true);
      }
      return send(numberId, message);
    };
    expect(
      await ingestWhatsAppWebhook(
        db,
        keys,
        bytes(inbound({ userId: 'BD.owner' }, text('status'))),
        clock,
      ),
    ).toBe('stored');
    const result = await processWhatsAppInbox(scope, db, {
      encryption: keys,
      whatsapp: port,
      settings: SETTINGS,
      now: () => clock,
      sleep: async () => undefined,
    });
    expect(result.sent).toBe(1);
    expect(port.sent.length).toBe(before + 1);
  });

  it('keeps cost data when a later status has none', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    const status = (state: string, at: number, pricing?: Record<string, unknown>) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: NUMBER_ID },
                statuses: [
                  {
                    id: 'wamid.out.1',
                    status: state,
                    timestamp: String(at),
                    ...(pricing ? { pricing } : {}),
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    await deliver(status('delivered', 1761554000, { billable: true, category: 'utility' }));
    await deliver(status('read', 1761555000));
    const [row] = await db
      .select()
      .from(schema.channelMessages)
      .where(eq(schema.channelMessages.providerMessageId, 'wamid.out.1'));
    expect(row).toMatchObject({ state: 'READ', pricingCategory: 'utility', billable: true });
  });

  it('ends the connection when Meta says the number changed', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    await deliver(
      inbound(
        { userId: 'BD.owner' },
        {
          type: 'system',
          system: { type: 'user_changed_number', wa_id: '8801800005678', user_id: 'BD.newid' },
        },
      ),
    );
    expect((await getWhatsAppConnection(db, owner, clock)).connected).toBe(false);
  });

  it('tells the account owner by email and in the app when a WhatsApp is connected', async () => {
    const owner = await account('owner@example.test');
    await connect(owner, 'BD.owner');
    const rows = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.eventType, 'WHATSAPP_CONNECTED'));
    expect(rows.map((row) => row.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
    expect(rows.every((row) => row.recipientAccountId === owner)).toBe(true);
    expect(JSON.stringify(rows[0]?.payload)).toContain('ending in 1234');
  });
});
