import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it, vi } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { enqueueNotification, runNotificationWorker } from './notifications';
import type { EmailPort, KeyManagementPort, SendEmailResult } from './ports';
import type { PushPort } from './web-push';

/**
 * WP-PIC18: whatever happens while sending alerts, the in-app notice it follows stays sent. The
 * alert sender is made to throw outright here, past all of its own guards, so the worker's own
 * catch is what keeps the notice: removing that catch turns this test red.
 */
vi.mock('./web-push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./web-push')>()),
  sendWebPushToAccount: vi.fn(async () => {
    throw new Error('alert sender failed');
  }),
}));

const key = Buffer.alloc(32, 9);
const port: KeyManagementPort = {
  currentKeyVersion: () => 'test-v1',
  async generateDataKey() {
    return { keyVersion: 'test-v1', plaintextDataKey: key, wrappedDataKey: key };
  },
  async unwrapDataKey() {
    return key;
  },
};
const noEmail: EmailPort = {
  async send(): Promise<SendEmailResult> {
    throw new Error('no email in this test');
  },
};
const push: PushPort = {
  async send() {
    return { kind: 'sent' };
  },
};

describe('the notification worker with a failing alert sender', () => {
  it('keeps the notice sent and the pass counts it as sent', async () => {
    const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const made = await provisionAccount(db, { email: 'alice@example.com' });
    if (!made.ok) throw new Error('provision failed');
    await db.transaction(async (tx) => {
      await enqueueNotification(tx, {
        eventType: 'PLATFORM_ROLE_GRANTED',
        channel: 'IN_APP',
        resourceId: '11111111-1111-4111-8111-111111111113',
        recipientAccountId: made.value.id,
        payload: { subject: 'x', summary: 'y', deepLinkPath: '/app/notifications' },
      });
    });
    const { sendWebPushToAccount } = await import('./web-push');
    const result = await runNotificationWorker(db, noEmail, 'https://app.example.com', {
      encryption: port,
      push,
    });
    expect(sendWebPushToAccount).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ sent: 1, retrying: 0, failed: 0 });
    const [row] = await db.select().from(schema.notifications);
    expect(row?.status).toBe('SENT');
  });
});
