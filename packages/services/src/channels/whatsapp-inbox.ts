import { createHash } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { accountPrincipal } from '../access/principal';
import type { SystemScope } from '../access/principal';
import { requireAccess } from '../access/require-access';
import { listApplicants } from '../applicants';
import { appendAuditEvent } from '../audit';
import { type Db, first, schema } from '../db';
import { isMissingRelationError } from '../missing-relation';
import { enqueueNotificationBothChannels } from '../notifications';
import type { KeyManagementPort } from '../ports';
import { protectBytes, revealBytes } from '../protected-fields';
import { checkRateLimit } from '../rate-limit';
import { type Selection, buildSelectedOutput } from '../selected-output';
import {
  LINK_CODE_ATTEMPT_LIMIT,
  LINK_CODE_GLOBAL_ATTEMPT_LIMIT,
  WHATSAPP_SETTINGS_PATH,
  hashLinkCode,
  senderSubject,
} from './whatsapp-link';
import {
  WHATSAPP_ERROR,
  type WhatsAppOutgoing,
  type WhatsAppPort,
  WhatsAppSendError,
} from './whatsapp-port';
import {
  MENU_ROWS,
  type PersonSummary,
  TEXT,
  caseStatusText,
  expiryText,
  missingText,
  personText,
  readIntent,
} from './whatsapp-replies';
import {
  type IdentityChange,
  type InboundMessage,
  type StatusUpdate,
  parseWhatsAppWebhook,
} from './whatsapp-webhook';

/**
 * The WhatsApp inbox (Lane D contract sections 5, 7, 10 and 11).
 *
 * The webhook route verifies Meta's signature and calls `ingestWhatsAppWebhook`, which only
 * stores the delivery, encrypted, and answers. `processWhatsAppInbox` (a system job) then reads
 * each delivery once: it records message ids (a repeat is a no-op), keeps the sender's channel
 * identity, and answers with plain rules. Record reads go through the same access gate and the
 * same selected-output engine as the website, acting as the linked account and never more.
 * Message text is never stored outside the encrypted delivery, which is cleared once handled.
 */

export interface WhatsAppChannelSettings {
  /** Meta's id for VisaStack's business number; messages to any other number are ignored. */
  readonly phoneNumberId: string;
  /** The site origin used in links, for example `https://vs.obsidianglobal.studio`. */
  readonly baseUrl: string;
  /** Where Talk to a Person sends people (a real, watched address). */
  readonly supportEmail: string;
}

export type IngestResult = 'stored' | 'duplicate' | 'unavailable';

function eventAad(eventHash: string): string {
  return `visastack:channel_webhook_event:v1:${eventHash}`;
}

/** Stores one verified delivery. Call only after `verifyWhatsAppSignature` passed. */
export async function ingestWhatsAppWebhook(
  db: Db,
  encryption: KeyManagementPort,
  rawBody: Uint8Array,
  now: Date = new Date(),
): Promise<IngestResult> {
  const eventHash = createHash('sha256').update(rawBody).digest('hex');
  try {
    const sealed = await protectBytes(db, encryption, rawBody, eventAad(eventHash));
    const inserted = await db
      .insert(schema.channelWebhookEvents)
      .values({
        eventHash,
        payloadCiphertext: sealed.ciphertext,
        payloadNonce: sealed.nonce,
        payloadKeyVersion: sealed.keyVersion,
        receivedAt: now,
      })
      .onConflictDoNothing({ target: schema.channelWebhookEvents.eventHash })
      .returning({ id: schema.channelWebhookEvents.id });
    return inserted.length > 0 ? 'stored' : 'duplicate';
  } catch (error) {
    if (isMissingRelationError(error)) return 'unavailable';
    throw error;
  }
}

export interface ProcessInboxOptions {
  readonly encryption: KeyManagementPort;
  readonly whatsapp: WhatsAppPort;
  readonly settings: WhatsAppChannelSettings;
  readonly now?: () => Date;
  /** Most deliveries handled in one run. */
  readonly limit?: number;
  readonly timeBudgetMs?: number;
  /** Remove data past its retention. The daily job does this; a webhook-triggered pass does not. */
  readonly purge?: boolean;
  /** Waits between send retries (tests pass a no-op). */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ProcessInboxResult {
  readonly status: 'ok' | 'unavailable';
  readonly handled: number;
  readonly failed: number;
  readonly sent: number;
  readonly sendFailed: number;
  readonly purged: number;
}

/** Tries per delivery; with the waits between them this spans about four hours. */
export const MAX_EVENT_ATTEMPTS = 8;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
export const EVENT_RETENTION_MS = 7 * DAY_MS;
/** Message ids of connected people. */
export const MESSAGE_RETENTION_MS = 30 * DAY_MS;
/** Senders who never connected (and ended connections): the sender and their message ids. */
export const UNLINKED_RETENTION_MS = 7 * DAY_MS;
/** An unlinked sender gets the welcome at most this often. */
export const WELCOME_GAP_MS = 12 * HOUR_MS;
/** Replies per sender per hour: generous for a person, a ceiling for a script. */
export const REPLY_LIMIT_LINKED = { limit: 30, windowMs: HOUR_MS } as const;
export const REPLY_LIMIT_UNLINKED = { limit: 6, windowMs: HOUR_MS } as const;
/** At most this many travellers are summarised in one reply. */
const MAX_PEOPLE = 5;
/** Waits before resending after a temporary refusal (Meta allows one message per person every few seconds). */
const SEND_RETRY_DELAYS_MS = [1_000, 7_000] as const;

/** The wait before trying a failed delivery again: 1, 2, 4 ... minutes, at most an hour. */
export function retryDelayMs(attempts: number): number {
  return Math.min(HOUR_MS, MINUTE_MS * 2 ** Math.max(0, attempts - 1));
}

interface Reply {
  readonly identityId: string;
  readonly message: WhatsAppOutgoing;
}

interface Context {
  readonly tx: Db;
  readonly settings: WhatsAppChannelSettings;
  readonly now: Date;
}

type IdentityRow = typeof schema.channelIdentities.$inferSelect;
type To = { readonly waId: string };

function link(settings: WhatsAppChannelSettings, path: string): string {
  return new URL(path, settings.baseUrl).toString();
}

async function upsertIdentity(ctx: Context, item: InboundMessage): Promise<IdentityRow> {
  const last4 = item.sender.waId ? item.sender.waId.slice(-4) : null;
  await ctx.tx
    .insert(schema.channelIdentities)
    .values({
      providerScope: item.phoneNumberId,
      externalUserId: item.sender.externalUserId,
      phoneLast4: last4,
      lastInboundAt: item.sentAt,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoUpdate({
      target: [
        schema.channelIdentities.channel,
        schema.channelIdentities.providerScope,
        schema.channelIdentities.externalUserId,
      ],
      set: {
        phoneLast4: sql`coalesce(${last4}, ${schema.channelIdentities.phoneLast4})`,
        lastInboundAt: sql`greatest(${schema.channelIdentities.lastInboundAt}, ${item.sentAt.toISOString()}::timestamptz)`,
        updatedAt: ctx.now,
      },
    });
  // Locked for the rest of this delivery, so two quick messages from one person apply in turn.
  const row = first(
    await ctx.tx
      .select()
      .from(schema.channelIdentities)
      .where(
        and(
          eq(schema.channelIdentities.channel, 'WHATSAPP'),
          eq(schema.channelIdentities.providerScope, item.phoneNumberId),
          eq(schema.channelIdentities.externalUserId, item.sender.externalUserId),
        ),
      )
      .for('update'),
  );
  if (!row) throw new Error('channel identity missing after upsert');
  return row;
}

/** Audits what a connected person did through WhatsApp. Unconnected senders leave no audit rows. */
async function audit(
  ctx: Context,
  identity: IdentityRow,
  eventType: string,
  metadata: Record<string, unknown> = {},
  accountId: string | null = identity.accountId,
): Promise<void> {
  if (!accountId) return;
  await appendAuditEvent(ctx.tx, {
    eventType,
    actorAccountId: accountId,
    method: 'API',
    result: 'ALLOWED',
    resourceType: 'channel_identity',
    resourceId: identity.id,
    metadata: { channel: 'WHATSAPP', ...metadata },
  });
}

const SUMMARY_SELECTION: Selection = {
  layers: [],
  cases: { kind: 'all' },
  documentList: true,
  documentText: [],
  revealIdentifiers: false,
  depth: 'brief',
};

/**
 * The linked account's own records, through the website's access gate and selected-output
 * engine, as that account. No encryption port is passed, so protected values are left out.
 * Travellers come oldest first, so the same five are always shown.
 */
async function summaries(
  ctx: Context,
  accountId: string,
): Promise<{ people: PersonSummary[]; applicantIds: string[] } | null> {
  const applicants = (await listApplicants(ctx.tx, accountId))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .slice(0, MAX_PEOPLE);
  const people: PersonSummary[] = [];
  const applicantIds: string[] = [];
  for (const applicant of applicants) {
    const proof = await requireAccess(
      ctx.tx,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: applicant.id },
      { purpose: 'self' },
    );
    if (!proof.ok || proof.value.actor.kind !== 'applicant_owner') continue;
    const output = await buildSelectedOutput(proof.value, SUMMARY_SELECTION, { now: ctx.now });
    if (!output.ok) return null;
    people.push({ displayName: output.value.person.displayName, output: output.value });
    applicantIds.push(applicant.id);
  }
  return { people, applicantIds };
}

/** The single traveller's own page when there is one, otherwise the list of travellers. */
function recordsPath(applicantIds: readonly string[]): string {
  return applicantIds.length === 1 ? `/app/applicant/${applicantIds[0]}` : '/app/applicants';
}

async function readReply(
  ctx: Context,
  identity: IdentityRow,
  to: To,
  view: 'status' | 'missing' | 'expiry',
): Promise<WhatsAppOutgoing> {
  const accountId = identity.accountId as string;
  const read = await summaries(ctx, accountId);
  if (read === null) return { kind: 'text', to, body: TEXT.unavailable };
  const { people, applicantIds } = read;
  if (people.length === 0) {
    return {
      kind: 'link',
      to,
      body: TEXT.noRecords,
      label: TEXT.openLabel,
      url: link(ctx.settings, '/app/applicants'),
    };
  }
  const body =
    view === 'status'
      ? caseStatusText(people)
      : view === 'missing'
        ? missingText(people)
        : expiryText(people);
  await audit(ctx, identity, 'WHATSAPP_SUMMARY_PREPARED', { view, travellers: people.length });
  return {
    kind: 'link',
    to,
    body,
    label: TEXT.openLabel,
    url: link(ctx.settings, recordsPath(applicantIds)),
  };
}

function menu(to: To, lead?: string): WhatsAppOutgoing {
  return {
    kind: 'list',
    to,
    body: lead ? `${lead}\n\n${TEXT.menuBody}` : TEXT.menuBody,
    buttonLabel: TEXT.menuButton,
    rows: MENU_ROWS,
  };
}

async function linkIdentity(
  ctx: Context,
  identity: IdentityRow,
  item: InboundMessage,
  to: To,
  digits: string,
): Promise<WhatsAppOutgoing> {
  // Per sender, and across every sender, so guessing cannot be spread over many WhatsApp accounts.
  for (const [subjectId, limit] of [
    [senderSubject(identity.externalUserId), LINK_CODE_ATTEMPT_LIMIT],
    ['whatsapp-link:all-senders', LINK_CODE_GLOBAL_ATTEMPT_LIMIT],
  ] as const) {
    const attempt = await checkRateLimit(
      ctx.tx,
      { subjectId, action: 'whatsapp.link_attempt' },
      limit,
      ctx.now,
    );
    if (!attempt.allowed) return { kind: 'text', to, body: TEXT.tooManyAttempts };
  }
  // Judged by when the person sent the code (Meta's signed time), not when it was processed.
  const code = first(
    await ctx.tx
      .select()
      .from(schema.channelLinkCodes)
      .where(
        and(
          eq(schema.channelLinkCodes.codeHash, hashLinkCode(digits)),
          isNull(schema.channelLinkCodes.consumedAt),
          gt(schema.channelLinkCodes.expiresAt, item.sentAt),
          lte(schema.channelLinkCodes.createdAt, item.sentAt),
        ),
      )
      .for('update'),
  );
  if (!code) return { kind: 'text', to, body: TEXT.codeRefused };
  if (identity.status === 'LINKED' && identity.accountId !== code.accountId) {
    return { kind: 'text', to, body: TEXT.alreadyLinkedElsewhere };
  }
  await ctx.tx
    .update(schema.channelLinkCodes)
    .set({ consumedAt: ctx.now })
    .where(eq(schema.channelLinkCodes.id, code.id));
  // A newly proven WhatsApp replaces the account's earlier one: the person holds both.
  const replaced = await ctx.tx
    .update(schema.channelIdentities)
    .set({ status: 'REVOKED', accountId: null, revokedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(schema.channelIdentities.accountId, code.accountId),
        eq(schema.channelIdentities.status, 'LINKED'),
        sql`${schema.channelIdentities.id} <> ${identity.id}`,
      ),
    )
    .returning({ id: schema.channelIdentities.id });
  await ctx.tx
    .update(schema.channelIdentities)
    .set({
      status: 'LINKED',
      accountId: code.accountId,
      linkedAt: ctx.now,
      revokedAt: null,
      optedOutAt: null,
      optChangedAt: item.sentAt,
      optInVersion: code.optInVersion,
      updatedAt: ctx.now,
    })
    .where(eq(schema.channelIdentities.id, identity.id));
  await audit(
    ctx,
    identity,
    'WHATSAPP_CONNECTED',
    { optInVersion: code.optInVersion, replacedEarlier: replaced.length > 0 },
    code.accountId,
  );
  // The account owner hears about every new connection, so one made from a stolen session is seen.
  const ending = identity.phoneLast4 ? ` ending in ${identity.phoneLast4}` : '';
  await enqueueNotificationBothChannels(ctx.tx, {
    eventType: 'WHATSAPP_CONNECTED',
    resourceId: code.id,
    recipientAccountId: code.accountId,
    payload: {
      subject: 'WhatsApp connected to your VisaStack account',
      summary: `A WhatsApp${ending} was connected to your VisaStack account. If this was not you, disconnect it and change your password.`,
      deepLinkPath: WHATSAPP_SETTINGS_PATH,
    },
  });
  return menu(to, TEXT.connected);
}

/** Applies a STOP or START, unless a newer choice from the same person is already recorded. */
async function setMessagesOff(
  ctx: Context,
  identity: IdentityRow,
  item: InboundMessage,
  off: boolean,
): Promise<boolean> {
  if (identity.optChangedAt && item.sentAt.getTime() <= identity.optChangedAt.getTime()) {
    return false;
  }
  const changes = (identity.optedOutAt !== null) !== off;
  await ctx.tx
    .update(schema.channelIdentities)
    .set({
      optedOutAt: off ? (identity.optedOutAt ?? ctx.now) : null,
      optChangedAt: item.sentAt,
      updatedAt: ctx.now,
    })
    .where(eq(schema.channelIdentities.id, identity.id));
  if (changes) {
    await audit(ctx, identity, off ? 'WHATSAPP_MESSAGES_OFF' : 'WHATSAPP_MESSAGES_ON', {
      by: 'person',
    });
  }
  return changes;
}

/** Decides the effect of one inbound message and the reply, if any. */
async function decide(
  ctx: Context,
  identity: IdentityRow,
  item: InboundMessage,
  to: To,
): Promise<WhatsAppOutgoing | null> {
  const intent = readIntent(item);
  if (intent.kind === 'ignore') return null;
  if (intent.kind === 'stop') {
    return (await setMessagesOff(ctx, identity, item, true))
      ? { kind: 'text', to, body: TEXT.stopped }
      : null;
  }
  if (intent.kind === 'start') {
    if (!(await setMessagesOff(ctx, identity, item, false))) return null;
    return identity.status === 'LINKED'
      ? menu(to, TEXT.started)
      : { kind: 'text', to, body: TEXT.started };
  }
  if (intent.kind === 'link') return linkIdentity(ctx, identity, item, to, intent.code);
  if (identity.optedOutAt) return null; // Turned off: say nothing until START.

  if (identity.status !== 'LINKED') {
    const recent =
      identity.lastAutoReplyAt &&
      ctx.now.getTime() - identity.lastAutoReplyAt.getTime() < WELCOME_GAP_MS;
    if (recent || !to.waId) return null;
    await ctx.tx
      .update(schema.channelIdentities)
      .set({ lastAutoReplyAt: ctx.now, updatedAt: ctx.now })
      .where(eq(schema.channelIdentities.id, identity.id));
    return {
      kind: 'link',
      to,
      body: TEXT.welcome,
      label: TEXT.connectLabel,
      url: link(ctx.settings, WHATSAPP_SETTINGS_PATH),
    };
  }

  switch (intent.kind) {
    case 'media':
      await audit(ctx, identity, 'WHATSAPP_DOCUMENT_DECLINED', { mediaType: item.mediaType });
      return {
        kind: 'link',
        to,
        body: TEXT.media,
        label: TEXT.mediaLabel,
        url: link(ctx.settings, '/app/applicants'),
      };
    case 'person':
      await audit(ctx, identity, 'WHATSAPP_PERSON_REQUESTED');
      return { kind: 'text', to, body: personText(ctx.settings.supportEmail) };
    case 'status':
    case 'missing':
    case 'expiry':
      return readReply(ctx, identity, to, intent.kind);
    default:
      return menu(to);
  }
}

async function handleInbound(ctx: Context, item: InboundMessage): Promise<Reply | null> {
  if (item.phoneNumberId !== ctx.settings.phoneNumberId) return null;
  const identity = await upsertIdentity(ctx, item);
  const recorded = await ctx.tx
    .insert(schema.channelMessages)
    .values({
      identityId: identity.id,
      direction: 'IN',
      providerMessageId: item.providerMessageId,
      kind: item.kind,
      state: 'RECEIVED',
      providerTimestamp: item.sentAt,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    })
    .onConflictDoNothing({ target: schema.channelMessages.providerMessageId })
    .returning({ id: schema.channelMessages.id });
  if (recorded.length === 0) return null; // Already handled.

  // The person's choices (STOP, START, a code) apply even when Meta left their number out; only
  // the answer needs a number.
  const to: To = { waId: item.sender.waId ?? '' };
  const message = await decide(ctx, identity, item, to);
  if (!message || !item.sender.waId) return null;

  const limit = identity.status === 'LINKED' ? REPLY_LIMIT_LINKED : REPLY_LIMIT_UNLINKED;
  const allowed = await checkRateLimit(
    ctx.tx,
    { subjectId: senderSubject(identity.externalUserId), action: 'whatsapp.reply' },
    limit,
    ctx.now,
  );
  return allowed.allowed ? { identityId: identity.id, message } : null;
}

const STATE_FOR: Record<StatusUpdate['state'], 'SENT' | 'DELIVERED' | 'READ' | 'FAILED'> = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};
const STATE_RANK = { RECEIVED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 } as const;

async function handleStatus(ctx: Context, status: StatusUpdate): Promise<void> {
  const state = STATE_FOR[status.state];
  // Statuses can arrive out of order: never move a message back (read, then a late "sent").
  const lowerStates = (Object.keys(STATE_RANK) as (keyof typeof STATE_RANK)[]).filter(
    (candidate) => STATE_RANK[candidate] < STATE_RANK[state],
  );
  const updated = await ctx.tx
    .update(schema.channelMessages)
    .set({
      state,
      errorCode: sql`coalesce(${status.errorCodes[0] ?? null}::integer, ${schema.channelMessages.errorCode})`,
      // A later status often has no pricing: keep what an earlier one recorded.
      pricingCategory: sql`coalesce(${status.pricingCategory}::text, ${schema.channelMessages.pricingCategory})`,
      billable: sql`coalesce(${status.billable}::boolean, ${schema.channelMessages.billable})`,
      updatedAt: ctx.now,
    })
    .where(
      and(
        eq(schema.channelMessages.providerMessageId, status.providerMessageId),
        eq(schema.channelMessages.direction, 'OUT'),
        inArray(schema.channelMessages.state, lowerStates),
      ),
    )
    .returning({ identityId: schema.channelMessages.identityId });
  const identityId = updated[0]?.identityId;
  if (identityId && status.errorCodes.includes(WHATSAPP_ERROR.BLOCKED)) {
    await markBlocked(ctx.tx, identityId, ctx.now);
  }
}

/** Meta says the person blocked VisaStack: the same as STOP, until they write START. */
async function markBlocked(db: Db, identityId: string, now: Date): Promise<void> {
  await db
    .update(schema.channelIdentities)
    .set({ optedOutAt: now, optChangedAt: now, updatedAt: now })
    .where(
      and(eq(schema.channelIdentities.id, identityId), isNull(schema.channelIdentities.optedOutAt)),
    );
}

/**
 * Meta reports that a person's number or business-scoped id changed. Either way the connection
 * ends: the old id must lose access, and the person reconnects in a minute with a fresh code.
 */
async function handleIdentityChange(ctx: Context, change: IdentityChange): Promise<void> {
  if (change.phoneNumberId !== ctx.settings.phoneNumberId) return;
  const ended = await ctx.tx
    .update(schema.channelIdentities)
    .set({ status: 'REVOKED', accountId: null, revokedAt: ctx.now, updatedAt: ctx.now })
    .where(
      and(
        eq(schema.channelIdentities.providerScope, change.phoneNumberId),
        eq(schema.channelIdentities.externalUserId, change.externalUserId),
        eq(schema.channelIdentities.status, 'LINKED'),
      ),
    )
    .returning({ id: schema.channelIdentities.id, accountId: schema.channelIdentities.accountId });
  for (const row of ended) {
    await appendAuditEvent(ctx.tx, {
      eventType: 'WHATSAPP_DISCONNECTED',
      actorAccountId: null,
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'channel_identity',
      resourceId: row.id,
      metadata: { channel: 'WHATSAPP', by: change.kind },
    });
  }
}

type Claimed =
  | { readonly outcome: 'none' }
  | { readonly outcome: 'handled'; readonly replies: readonly Reply[] }
  | { readonly outcome: 'failed' };

/** What is kept about a failure: a short fixed reason, never content. */
function failureReason(error: unknown): string {
  return error instanceof SyntaxError ? 'unreadable' : 'failed';
}

/**
 * Claims the oldest delivery that is due and applies everything in it. The work runs in a
 * savepoint, so a failure undoes the delivery's changes but still counts the attempt against
 * that same row and sets when to try it again.
 */
async function handleNextEvent(db: Db, options: ProcessInboxOptions, now: Date): Promise<Claimed> {
  return db.transaction(async (tx) => {
    const event = first(
      await tx
        .select()
        .from(schema.channelWebhookEvents)
        .where(
          and(
            isNull(schema.channelWebhookEvents.processedAt),
            lt(schema.channelWebhookEvents.attempts, MAX_EVENT_ATTEMPTS),
            or(
              isNull(schema.channelWebhookEvents.nextAttemptAt),
              lte(schema.channelWebhookEvents.nextAttemptAt, now),
            ),
          ),
        )
        .orderBy(asc(schema.channelWebhookEvents.receivedAt))
        .limit(1)
        .for('update', { skipLocked: true }),
    );
    if (!event) return { outcome: 'none' } as const;
    try {
      const replies = await tx.transaction(async (work) => {
        const collected: Reply[] = [];
        if (!event.payloadCiphertext || !event.payloadNonce || !event.payloadKeyVersion) {
          return collected;
        }
        const bytes = await revealBytes(work, options.encryption, {
          ciphertext: event.payloadCiphertext,
          nonce: event.payloadNonce,
          keyVersion: event.payloadKeyVersion,
          aad: eventAad(event.eventHash),
        });
        const parsed = parseWhatsAppWebhook(JSON.parse(new TextDecoder().decode(bytes)));
        const ctx: Context = { tx: work, settings: options.settings, now };
        for (const change of parsed.identityChanges) await handleIdentityChange(ctx, change);
        const inbound = [...parsed.inbound].sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
        for (const item of inbound) {
          const reply = await handleInbound(ctx, item);
          if (reply) collected.push(reply);
        }
        for (const status of parsed.statuses) await handleStatus(ctx, status);
        return collected;
      });
      await tx
        .update(schema.channelWebhookEvents)
        .set({
          processedAt: now,
          payloadCiphertext: null,
          payloadNonce: null,
          payloadKeyVersion: null,
          nextAttemptAt: null,
          lastError: null,
        })
        .where(eq(schema.channelWebhookEvents.id, event.id));
      return { outcome: 'handled', replies } as const;
    } catch (error) {
      if (isMissingRelationError(error)) throw error;
      const attempts = event.attempts + 1;
      await tx
        .update(schema.channelWebhookEvents)
        .set({
          attempts,
          nextAttemptAt: new Date(now.getTime() + retryDelayMs(attempts)),
          lastError: failureReason(error),
        })
        .where(eq(schema.channelWebhookEvents.id, event.id));
      return { outcome: 'failed' } as const;
    }
  });
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sends one reply, retrying a temporary refusal (throttling, a timeout, Meta's own errors) after
 * a short wait while the pass still has time. A block from the person is final and turns
 * messages off.
 */
async function send(
  db: Db,
  options: ProcessInboxOptions,
  reply: Reply,
  clock: () => Date,
  deadline: number,
): Promise<boolean> {
  const sleep = options.sleep ?? realSleep;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const { providerMessageId } = await options.whatsapp.send(
        options.settings.phoneNumberId,
        reply.message,
      );
      const now = clock();
      await db
        .insert(schema.channelMessages)
        .values({
          identityId: reply.identityId,
          direction: 'OUT',
          providerMessageId,
          kind: reply.message.kind,
          state: 'SENT',
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: schema.channelMessages.providerMessageId });
      return true;
    } catch (error) {
      if (error instanceof WhatsAppSendError && error.code === WHATSAPP_ERROR.BLOCKED) {
        await markBlocked(db, reply.identityId, clock());
        return false;
      }
      const wait = SEND_RETRY_DELAYS_MS[attempt];
      const retryable = error instanceof WhatsAppSendError && error.retryable;
      if (!retryable || wait === undefined || Date.now() + wait > deadline) return false;
      await sleep(wait);
    }
  }
}

/** Removes what is no longer needed: handled deliveries, old message ids, idle senders, used codes. */
async function purge(db: Db, now: Date): Promise<number> {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const events = await db
    .delete(schema.channelWebhookEvents)
    .where(
      and(
        lt(schema.channelWebhookEvents.receivedAt, ago(EVENT_RETENTION_MS)),
        or(
          isNotNull(schema.channelWebhookEvents.processedAt),
          sql`${schema.channelWebhookEvents.attempts} >= ${MAX_EVENT_ATTEMPTS}`,
        ),
      ),
    )
    .returning({ id: schema.channelWebhookEvents.id });
  const messages = await db
    .delete(schema.channelMessages)
    .where(lt(schema.channelMessages.createdAt, ago(MESSAGE_RETENTION_MS)))
    .returning({ id: schema.channelMessages.id });
  // Deleting an unlinked sender also deletes its message ids.
  const idle = await db
    .delete(schema.channelIdentities)
    .where(
      and(
        inArray(schema.channelIdentities.status, ['PROVISIONAL', 'REVOKED']),
        lt(schema.channelIdentities.lastInboundAt, ago(UNLINKED_RETENTION_MS)),
      ),
    )
    .returning({ id: schema.channelIdentities.id });
  const codes = await db
    .delete(schema.channelLinkCodes)
    .where(
      or(
        isNotNull(schema.channelLinkCodes.consumedAt),
        lt(schema.channelLinkCodes.expiresAt, ago(DAY_MS)),
      ),
    )
    .returning({ id: schema.channelLinkCodes.id });
  return events.length + messages.length + idle.length + codes.length;
}

/**
 * Handles due deliveries, sends each delivery's replies after its changes are saved, and (on the
 * daily pass) removes data past its retention. A reply is sent only after its state change is
 * committed, so a crash can lose a reply but never report something that did not happen.
 */
export async function processWhatsAppInbox(
  _scope: SystemScope<'process-whatsapp-inbox'>,
  db: Db,
  options: ProcessInboxOptions,
): Promise<ProcessInboxResult> {
  const clock = options.now ?? (() => new Date());
  const started = Date.now();
  const limit = options.limit ?? 50;
  const deadline = started + (options.timeBudgetMs ?? 45_000);
  let handled = 0;
  let failed = 0;
  let sent = 0;
  let sendFailed = 0;
  try {
    while (handled + failed < limit && Date.now() < deadline) {
      const claimed = await handleNextEvent(db, options, clock());
      if (claimed.outcome === 'none') break;
      if (claimed.outcome === 'failed') {
        failed += 1;
        continue;
      }
      handled += 1;
      for (const reply of claimed.replies) {
        if (await send(db, options, reply, clock, deadline)) sent += 1;
        else sendFailed += 1;
      }
    }
    const purged = options.purge ? await purge(db, clock()) : 0;
    return { status: 'ok', handled, failed, sent, sendFailed, purged };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { status: 'unavailable', handled, failed, sent, sendFailed, purged: 0 };
    }
    throw error;
  }
}
