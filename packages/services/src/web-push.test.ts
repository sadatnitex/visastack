import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { executeAccountDeletion, requestAccountDeletion } from './deletion';
import { enqueueNotification, runNotificationWorker } from './notifications';
import type { EmailPort, KeyManagementPort, SendEmailResult } from './ports';
import {
  type PushPort,
  WEB_PUSH_BODY,
  WEB_PUSH_FALLBACK_PATH,
  WEB_PUSH_MAX_DEVICES,
  WEB_PUSH_TITLE,
  type WebPushSendOutcome,
  type WebPushSubscriptionValue,
  composeWebPushMessage,
  countWebPushSubscriptions,
  endpointHash,
  removeWebPushSubscription,
  removeWebPushSubscriptionsForSession,
  safePushPath,
  saveWebPushSubscription,
  sendWebPushToAccount,
  webPushTableReady,
} from './web-push';

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

function keyPort(): KeyManagementPort {
  const key = Buffer.alloc(32, 9);
  return {
    currentKeyVersion: () => 'test-v1',
    async generateDataKey() {
      return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: key };
    },
    async unwrapDataKey() {
      return key;
    },
  };
}

const noEmail: EmailPort = {
  async send(): Promise<SendEmailResult> {
    throw new Error('no email in this test');
  },
};

function sub(n: number): WebPushSubscriptionValue {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
  };
}

/** Records every send and answers with the queued outcomes, then "sent". */
class FakePush implements PushPort {
  readonly calls: { endpoint: string; message: string; topic: string; ttl: number }[] = [];
  readonly outcomes: (WebPushSendOutcome | Error)[] = [];
  async send(
    subscription: WebPushSubscriptionValue,
    message: Uint8Array,
    options: { ttlSeconds: number; topic: string },
  ): Promise<WebPushSendOutcome> {
    this.calls.push({
      endpoint: subscription.endpoint,
      message: new TextDecoder().decode(message),
      topic: options.topic,
      ttl: options.ttlSeconds,
    });
    const next = this.outcomes.shift();
    if (next instanceof Error) throw next;
    return next ?? { kind: 'sent' };
  }
}

async function account(db: Db, email: string): Promise<string> {
  const result = await provisionAccount(db, { email });
  if (!result.ok) throw new Error('provision failed');
  return result.value.id;
}

describe('web push message', () => {
  it('keeps only plain VisaStack paths', () => {
    expect(safePushPath('/app/cases/abc?tab=1#x')).toBe('/app/cases/abc?tab=1#x');
    for (const bad of [
      'https://evil.example/x',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      'app/cases',
      '/app/\nx',
      '',
      null,
      undefined,
      `/${'a'.repeat(600)}`,
    ]) {
      expect(safePushPath(bad)).toBe(WEB_PUSH_FALLBACK_PATH);
    }
  });

  it('is always the same title and line, with nothing from the notice but its path', () => {
    expect(composeWebPushMessage('/app/cases/1')).toEqual({
      title: WEB_PUSH_TITLE,
      body: WEB_PUSH_BODY,
      url: '/app/cases/1',
    });
    expect(WEB_PUSH_BODY).toBe('Something in VisaStack needs you');
  });
});

describe('web push subscriptions', () => {
  let db: Db;
  let port: KeyManagementPort;
  let alice: string;
  let bob: string;
  beforeEach(async () => {
    db = await freshDb();
    port = keyPort();
    alice = await account(db, 'alice@example.com');
    bob = await account(db, 'bob@example.com');
  });

  it('seals the address and keys; only a hash is in the clear', async () => {
    expect(
      await saveWebPushSubscription(db, port, {
        accountId: alice,
        subscription: sub(1),
        sessionRef: 's1',
      }),
    ).toBe('saved');
    const [row] = await db.select().from(schema.webPushSubscriptions);
    expect(row?.endpointHash).toBe(endpointHash(sub(1).endpoint));
    const stored = Buffer.concat([
      Buffer.from(row?.endpointCiphertext ?? []),
      Buffer.from(row?.keysCiphertext ?? []),
    ]).toString('latin1');
    expect(stored).not.toContain('fcm.googleapis.com');
    expect(stored).not.toContain('p256dh-1');
    expect(stored).not.toContain('auth-1');
    const audits = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.eventType, 'WEB_PUSH_TURNED_ON'));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain('device-1');
    expect(JSON.stringify(audits[0])).not.toContain('s1');
  });

  it('lets only the owner remove or reach a subscription', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: 's1',
    });
    expect(await removeWebPushSubscription(db, { accountId: bob, endpoint: sub(1).endpoint })).toBe(
      0,
    );
    expect(
      await removeWebPushSubscriptionsForSession(db, { accountId: bob, sessionRef: 's1' }),
    ).toBe(0);
    expect(await countWebPushSubscriptions(db, bob)).toBe(0);
    expect(await countWebPushSubscriptions(db, alice)).toBe(1);
    const push = new FakePush();
    expect(
      await sendWebPushToAccount(db, push, port, { accountId: bob, deepLinkPath: '/app' }),
    ).toEqual({
      sent: 0,
      removed: 0,
      failed: 0,
    });
    expect(push.calls).toHaveLength(0);
    expect(
      await removeWebPushSubscription(db, { accountId: alice, endpoint: sub(1).endpoint }),
    ).toBe(1);
    expect(await countWebPushSubscriptions(db, alice)).toBe(0);
  });

  it('gives one browser to one account at a time', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: 's1',
    });
    await saveWebPushSubscription(db, port, {
      accountId: bob,
      subscription: sub(1),
      sessionRef: 's2',
    });
    expect(await countWebPushSubscriptions(db, alice)).toBe(0);
    expect(await countWebPushSubscriptions(db, bob)).toBe(1);
  });

  it('keeps at most five browsers, forgetting the oldest', async () => {
    for (let n = 1; n <= WEB_PUSH_MAX_DEVICES + 2; n += 1) {
      await saveWebPushSubscription(db, port, {
        accountId: alice,
        subscription: sub(n),
        sessionRef: null,
      });
    }
    expect(await countWebPushSubscriptions(db, alice)).toBe(WEB_PUSH_MAX_DEVICES);
    const push = new FakePush();
    await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' });
    expect(push.calls.map((c) => c.endpoint).sort()).toEqual(
      [3, 4, 5, 6, 7].map((n) => sub(n).endpoint).sort(),
    );
  });

  it('forgets only the browsers of the sign-in that ends', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: 'phone',
    });
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(2),
      sessionRef: 'laptop',
    });
    expect(
      await removeWebPushSubscriptionsForSession(db, { accountId: alice, sessionRef: 'phone' }),
    ).toBe(1);
    const push = new FakePush();
    await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' });
    expect(push.calls.map((c) => c.endpoint)).toEqual([sub(2).endpoint]);
  });

  it('sends the fixed message, opened from the sealed values', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    const push = new FakePush();
    const summary = await sendWebPushToAccount(db, push, port, {
      accountId: alice,
      deepLinkPath: '/app/cases/123',
    });
    expect(summary).toEqual({ sent: 1, removed: 0, failed: 0 });
    expect(push.calls[0]?.endpoint).toBe(sub(1).endpoint);
    expect(JSON.parse(push.calls[0]?.message ?? '')).toEqual({
      title: 'VisaStack',
      body: 'Something in VisaStack needs you',
      url: '/app/cases/123',
    });
    const [row] = await db.select().from(schema.webPushSubscriptions);
    expect(row?.lastSuccessAt).not.toBeNull();
  });

  it('removes a browser the push service calls gone (404 or 410)', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    const push = new FakePush();
    push.outcomes.push({ kind: 'gone' });
    expect(
      await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' }),
    ).toEqual({
      sent: 0,
      removed: 1,
      failed: 0,
    });
    expect(await countWebPushSubscriptions(db, alice)).toBe(0);
  });

  it('counts other failures and forgets a browser after three in a row', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    const push = new FakePush();
    push.outcomes.push({ kind: 'failed', status: 500 }, new Error('boom'));
    await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' });
    await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' });
    let [row] = await db.select().from(schema.webPushSubscriptions);
    expect(row?.failureCount).toBe(2);
    push.outcomes.push({ kind: 'failed', status: 503 });
    expect(
      await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' }),
    ).toEqual({
      sent: 0,
      removed: 1,
      failed: 0,
    });
    [row] = await db.select().from(schema.webPushSubscriptions);
    expect(row).toBeUndefined();
  });

  it('a success clears earlier failures', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    const push = new FakePush();
    push.outcomes.push({ kind: 'failed', status: 500 });
    await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' });
    await sendWebPushToAccount(db, push, port, { accountId: alice, deepLinkPath: '/app' });
    const [row] = await db.select().from(schema.webPushSubscriptions);
    expect(row?.failureCount).toBe(0);
  });

  it('goes with the account when the account is deleted', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    const requested = await requestAccountDeletion(db, {
      actorAccountId: alice,
      accountId: alice,
      gracePeriodMs: 0,
    });
    expect(requested.ok).toBe(true);
    const executed = await executeAccountDeletion(db, {
      accountId: alice,
      now: new Date(Date.now() + 1000),
    });
    expect(executed.ok).toBe(true);
    const left = await db.select().from(schema.webPushSubscriptions);
    expect(left).toHaveLength(0);
  });
});

describe('the notification worker', () => {
  let db: Db;
  let port: KeyManagementPort;
  let alice: string;
  beforeEach(async () => {
    db = await freshDb();
    port = keyPort();
    alice = await account(db, 'alice@example.com');
  });

  async function enqueueInApp(resourceId: string) {
    await db.transaction(async (tx) => {
      await enqueueNotification(tx, {
        eventType: 'PLATFORM_ROLE_GRANTED',
        channel: 'IN_APP',
        resourceId,
        recipientAccountId: alice,
        payload: {
          subject: 'Alice Example was given a role for Bangladesh passport',
          summary: 'Alice Example, passport BX1234567, Germany',
          deepLinkPath: '/app/notifications',
        },
      });
    });
  }

  async function inAppStatus(): Promise<string | undefined> {
    const [row] = await db.select().from(schema.notifications);
    return row?.status;
  }

  it('alerts the recipient after the notice is sent, with no personal data', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    await enqueueInApp('11111111-1111-4111-8111-111111111111');
    const push = new FakePush();
    const result = await runNotificationWorker(db, noEmail, 'https://app.example.com', {
      encryption: port,
      push,
    });
    expect(result.sent).toBe(1);
    expect(await inAppStatus()).toBe('SENT');
    expect(push.calls).toHaveLength(1);
    const message = push.calls[0]?.message ?? '';
    expect(JSON.parse(message)).toEqual({
      title: 'VisaStack',
      body: 'Something in VisaStack needs you',
      url: '/app/notifications',
    });
    for (const secret of ['Alice', 'alice', 'BX1234567', 'Germany', 'Bangladesh', 'passport']) {
      expect(message).not.toContain(secret);
    }
  });

  it('sends nothing without the push option (switch off)', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    await enqueueInApp('11111111-1111-4111-8111-111111111112');
    const result = await runNotificationWorker(db, noEmail, 'https://app.example.com', {
      encryption: port,
    });
    expect(result.sent).toBe(1);
    expect(await inAppStatus()).toBe('SENT');
  });

  it('a push that throws never changes or fails the notice', async () => {
    await saveWebPushSubscription(db, port, {
      accountId: alice,
      subscription: sub(1),
      sessionRef: null,
    });
    await enqueueInApp('11111111-1111-4111-8111-111111111113');
    const throwing: PushPort = {
      async send() {
        throw new Error('push service down');
      },
    };
    const result = await runNotificationWorker(db, noEmail, 'https://app.example.com', {
      encryption: port,
      push: throwing,
    });
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(await inAppStatus()).toBe('SENT');
  });

  it('works unchanged when the table is missing', async () => {
    await db.execute(sql`drop table web_push_subscriptions`);
    expect(await webPushTableReady(db)).toBe(false);
    expect(
      await saveWebPushSubscription(db, port, {
        accountId: alice,
        subscription: sub(1),
        sessionRef: null,
      }),
    ).toBe('unavailable');
    expect(await countWebPushSubscriptions(db, alice)).toBe(0);
    expect(
      await removeWebPushSubscription(db, { accountId: alice, endpoint: sub(1).endpoint }),
    ).toBe(0);
    await enqueueInApp('11111111-1111-4111-8111-111111111114');
    const push = new FakePush();
    const result = await runNotificationWorker(db, noEmail, 'https://app.example.com', {
      encryption: port,
      push,
    });
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 0 });
    expect(await inAppStatus()).toBe('SENT');
    expect(push.calls).toHaveLength(0);
  });
});
