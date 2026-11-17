import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, schema } from './db';
import { isMissingRelationError } from './missing-relation';
import type { KeyManagementPort } from './ports';
import { protectValue, revealValue } from './protected-fields';

/**
 * Web Push (WP-PIC18): a signed-in person may choose to get a phone or desktop alert when one of
 * the in-app notices they already receive is sent. Nothing here invents an event: the
 * notification worker calls `sendWebPushToAccount` right after it has marked an in-app notice as
 * sent.
 *
 * - The alert never carries personal data: always the same title and line, plus a same-origin
 *   path inside VisaStack. The page shows the details after sign-in.
 * - A subscription's push address and keys are sealed with the protected-field envelope, bound
 *   to the account and the row. Only a hash of the address is kept in the clear, so a row can be
 *   found again (Turn Off, a push service saying "gone") without opening it.
 * - Every read and write is for one account only; there is no way to name another account's row.
 * - The table may not exist yet (its migration runs only on the owner's word): every function
 *   treats that as "nothing stored" and never throws because of it.
 * - Audit rows carry counts only, never an address, a key or a session reference.
 */

/** The fixed words every alert shows. No name, no document, no country, no case detail. */
export const WEB_PUSH_TITLE = 'VisaStack';
export const WEB_PUSH_BODY = 'Something in VisaStack needs you';
/** Where an alert opens when the notice's own page is not a plain VisaStack path. */
export const WEB_PUSH_FALLBACK_PATH = '/app/notifications';
/** Browsers kept per account; adding one more forgets the oldest. */
export const WEB_PUSH_MAX_DEVICES = 5;
/** Consecutive failed sends after which a browser is forgotten. */
export const WEB_PUSH_MAX_FAILURES = 3;
/** How long a push service keeps an alert for a phone that is off. */
export const WEB_PUSH_TTL_SECONDS = 24 * 60 * 60;
/** Alerts still waiting at the push service replace each other instead of piling up. */
export const WEB_PUSH_TOPIC = 'visastack-notice';

/** The browser's subscription, already checked for shape by the caller. */
export interface WebPushSubscriptionValue {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
}

export type WebPushSendOutcome =
  | { readonly kind: 'sent' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'failed'; readonly status: number | null };

/** Sends one already-composed message to one browser (the adapter does the encryption). */
export interface PushPort {
  send(
    subscription: WebPushSubscriptionValue,
    message: Uint8Array,
    options: { readonly ttlSeconds: number; readonly topic: string },
  ): Promise<WebPushSendOutcome>;
}

/** What a browser receives, as JSON. Exactly these three keys. */
export interface WebPushMessage {
  readonly title: string;
  readonly body: string;
  readonly url: string;
}

export function endpointHash(endpoint: string): string {
  return createHash('sha256').update(`visastack:web-push-endpoint:v1:${endpoint}`).digest('hex');
}

function endpointAad(accountId: string, id: string): string {
  return `visastack:web_push_subscription:endpoint:v1:${accountId}:${id}`;
}

function keysAad(accountId: string, id: string): string {
  return `visastack:web_push_subscription:keys:v1:${accountId}:${id}`;
}

/**
 * A path inside VisaStack, or the notices page. Only a plain absolute path is kept: no scheme,
 * no host, no "//", no backslash, no control character.
 */
export function safePushPath(path: string | null | undefined): string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 512) {
    return WEB_PUSH_FALLBACK_PATH;
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return WEB_PUSH_FALLBACK_PATH;
  }
  for (let i = 0; i < path.length; i += 1) {
    const code = path.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return WEB_PUSH_FALLBACK_PATH;
  }
  try {
    const parsed = new URL(path, 'https://visastack.invalid');
    if (parsed.origin !== 'https://visastack.invalid') return WEB_PUSH_FALLBACK_PATH;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return WEB_PUSH_FALLBACK_PATH;
  }
}

/** The one message shape every alert uses. Nothing from the notice is read except its path. */
export function composeWebPushMessage(deepLinkPath: string | null | undefined): WebPushMessage {
  return { title: WEB_PUSH_TITLE, body: WEB_PUSH_BODY, url: safePushPath(deepLinkPath) };
}

/** Whether the subscriptions table exists. A missing table reads as false, anything else throws. */
export async function webPushTableReady(db: Db): Promise<boolean> {
  try {
    await db.execute(sql`select 1 from ${schema.webPushSubscriptions} limit 1`);
    return true;
  } catch (error) {
    if (isMissingRelationError(error)) return false;
    throw error;
  }
}

export type SaveWebPushResult = 'saved' | 'unavailable';

/**
 * Stores this browser for this account. The same browser saved again (or saved earlier by
 * another account signed in on it) is replaced, so one browser belongs to one account at a time.
 * Past the device limit the oldest browser is forgotten.
 */
export async function saveWebPushSubscription(
  db: Db,
  port: KeyManagementPort,
  input: {
    readonly accountId: string;
    readonly subscription: WebPushSubscriptionValue;
    readonly sessionRef: string | null;
  },
): Promise<SaveWebPushResult> {
  if (!(await webPushTableReady(db))) return 'unavailable';
  const { accountId, subscription } = input;
  const hash = endpointHash(subscription.endpoint);
  const id = randomUUID();
  let endpointSealed: Awaited<ReturnType<typeof protectValue>>;
  let keysSealed: Awaited<ReturnType<typeof protectValue>>;
  try {
    endpointSealed = await protectValue(
      db,
      port,
      subscription.endpoint,
      endpointAad(accountId, id),
    );
    keysSealed = await protectValue(
      db,
      port,
      JSON.stringify({ p256dh: subscription.keys.p256dh, auth: subscription.keys.auth }),
      keysAad(accountId, id),
    );
  } catch {
    return 'unavailable';
  }
  if (endpointSealed.keyVersion !== keysSealed.keyVersion) return 'unavailable';

  await db.transaction(async (tx) => {
    // Serialize saves for this account so the device limit holds under parallel requests.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`web_push:${accountId}`}))`);
    await tx
      .delete(schema.webPushSubscriptions)
      .where(eq(schema.webPushSubscriptions.endpointHash, hash));
    const existing = await tx
      .select({ id: schema.webPushSubscriptions.id })
      .from(schema.webPushSubscriptions)
      .where(eq(schema.webPushSubscriptions.accountId, accountId))
      .orderBy(asc(schema.webPushSubscriptions.createdAt), asc(schema.webPushSubscriptions.id));
    const over = existing.length - (WEB_PUSH_MAX_DEVICES - 1);
    if (over > 0) {
      await tx.delete(schema.webPushSubscriptions).where(
        and(
          eq(schema.webPushSubscriptions.accountId, accountId),
          inArray(
            schema.webPushSubscriptions.id,
            existing.slice(0, over).map((row) => row.id),
          ),
        ),
      );
    }
    await tx.insert(schema.webPushSubscriptions).values({
      id,
      accountId,
      endpointHash: hash,
      endpointCiphertext: endpointSealed.ciphertext,
      endpointNonce: endpointSealed.nonce,
      keysCiphertext: keysSealed.ciphertext,
      keysNonce: keysSealed.nonce,
      keyVersion: endpointSealed.keyVersion,
      sessionRef: input.sessionRef,
    });
    await appendAuditEvent(tx, {
      eventType: 'WEB_PUSH_TURNED_ON',
      actorAccountId: accountId,
      method: 'MANUAL',
      resourceType: 'web_push_subscription',
      metadata: { devices: Math.min(existing.length, WEB_PUSH_MAX_DEVICES - 1) + 1 },
    });
  });
  return 'saved';
}

async function deleteWhere(
  db: Db,
  accountId: string,
  condition: ReturnType<typeof eq>,
): Promise<number> {
  if (!(await webPushTableReady(db))) return 0;
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(schema.webPushSubscriptions)
      .where(and(eq(schema.webPushSubscriptions.accountId, accountId), condition))
      .returning({ id: schema.webPushSubscriptions.id });
    if (removed.length > 0) {
      await appendAuditEvent(tx, {
        eventType: 'WEB_PUSH_TURNED_OFF',
        actorAccountId: accountId,
        method: 'MANUAL',
        resourceType: 'web_push_subscription',
        metadata: { devices: removed.length },
      });
    }
    return removed.length;
  });
}

/** Turn Off on one browser: forgets that browser, only if it belongs to this account. */
export async function removeWebPushSubscription(
  db: Db,
  input: { readonly accountId: string; readonly endpoint: string },
): Promise<number> {
  return deleteWhere(
    db,
    input.accountId,
    eq(schema.webPushSubscriptions.endpointHash, endpointHash(input.endpoint)),
  );
}

/** Sign-out: forgets the browsers this sign-in turned alerts on for. */
export async function removeWebPushSubscriptionsForSession(
  db: Db,
  input: { readonly accountId: string; readonly sessionRef: string },
): Promise<number> {
  return deleteWhere(
    db,
    input.accountId,
    eq(schema.webPushSubscriptions.sessionRef, input.sessionRef),
  );
}

/** How many browsers this account has alerts on (for its own Account page only). */
export async function countWebPushSubscriptions(db: Db, accountId: string): Promise<number> {
  if (!(await webPushTableReady(db))) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.webPushSubscriptions)
    .where(eq(schema.webPushSubscriptions.accountId, accountId));
  return rows[0]?.n ?? 0;
}

export interface WebPushSendSummary {
  readonly sent: number;
  readonly removed: number;
  readonly failed: number;
}

const NOTHING: WebPushSendSummary = { sent: 0, removed: 0, failed: 0 };

/**
 * Sends the fixed alert to every browser this account turned alerts on for. Never throws: any
 * problem is counted, never logged with an address. A push service that says the browser is gone
 * (404, 410) removes it at once; a browser that fails three times in a row is removed too.
 */
export async function sendWebPushToAccount(
  db: Db,
  push: PushPort,
  encryption: KeyManagementPort,
  input: { readonly accountId: string; readonly deepLinkPath: string | null | undefined },
  now: Date = new Date(),
): Promise<WebPushSendSummary> {
  let rows: (typeof schema.webPushSubscriptions.$inferSelect)[];
  try {
    rows = await db
      .select()
      .from(schema.webPushSubscriptions)
      .where(eq(schema.webPushSubscriptions.accountId, input.accountId))
      .limit(WEB_PUSH_MAX_DEVICES);
  } catch {
    return NOTHING;
  }
  if (rows.length === 0) return NOTHING;
  const message = new TextEncoder().encode(
    JSON.stringify(composeWebPushMessage(input.deepLinkPath)),
  );
  let sent = 0;
  let removed = 0;
  let failed = 0;
  for (const row of rows) {
    let outcome: WebPushSendOutcome;
    try {
      const endpoint = await revealValue(db, encryption, {
        ciphertext: row.endpointCiphertext,
        nonce: row.endpointNonce,
        keyVersion: row.keyVersion,
        aad: endpointAad(row.accountId, row.id),
      });
      const keys = JSON.parse(
        await revealValue(db, encryption, {
          ciphertext: row.keysCiphertext,
          nonce: row.keysNonce,
          keyVersion: row.keyVersion,
          aad: keysAad(row.accountId, row.id),
        }),
      ) as { p256dh?: unknown; auth?: unknown };
      if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') {
        outcome = { kind: 'gone' };
      } else {
        outcome = await push.send(
          { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
          message,
          { ttlSeconds: WEB_PUSH_TTL_SECONDS, topic: WEB_PUSH_TOPIC },
        );
      }
    } catch {
      outcome = { kind: 'failed', status: null };
    }
    try {
      const mine = and(
        eq(schema.webPushSubscriptions.id, row.id),
        eq(schema.webPushSubscriptions.accountId, row.accountId),
      );
      if (outcome.kind === 'sent') {
        sent += 1;
        await db
          .update(schema.webPushSubscriptions)
          .set({ lastSuccessAt: now, failureCount: 0 })
          .where(mine);
      } else if (outcome.kind === 'gone' || row.failureCount + 1 >= WEB_PUSH_MAX_FAILURES) {
        removed += 1;
        await db.delete(schema.webPushSubscriptions).where(mine);
      } else {
        failed += 1;
        await db
          .update(schema.webPushSubscriptions)
          .set({ failureCount: sql`${schema.webPushSubscriptions.failureCount} + 1` })
          .where(mine);
      }
    } catch {
      // The row could not be updated (the table went away, a lost connection): next time.
    }
  }
  return { sent, removed, failed };
}
