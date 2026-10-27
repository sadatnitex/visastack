import { createHash } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { accountPrincipal } from '../access/principal';
import type { SystemScope } from '../access/principal';
import { requireAccess } from '../access/require-access';
import { listApplicants } from '../applicants';
import { appendAuditEvent } from '../audit';
import { type Db, first, schema } from '../db';
import { isMissingRelationError } from '../missing-relation';
import type { KeyManagementPort } from '../ports';
import { protectBytes, revealBytes } from '../protected-fields';
import { checkRateLimit } from '../rate-limit';
import { type Selection, buildSelectedOutput } from '../selected-output';
import {
  LINK_CODE_ATTEMPT_LIMIT,
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
  type ChannelIntent,
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
  /** Where Talk to a Person sends people; omitted from the reply when unset. */
  readonly supportEmail: string | null;
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
}

export interface ProcessInboxResult {
  readonly status: 'ok' | 'unavailable';
  readonly handled: number;
  readonly failed: number;
  readonly sent: number;
  readonly sendFailed: number;
  readonly purged: number;
}

/** A delivery that failed this many times is left for the purge, never retried forever. */
export const MAX_EVENT_ATTEMPTS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
export const EVENT_RETENTION_MS = 7 * DAY_MS;
export const MESSAGE_RETENTION_MS = 30 * DAY_MS;
/** An unlinked sender gets the welcome at most this often. */
export const WELCOME_GAP_MS = 12 * 60 * 60 * 1000;
/** At most this many travellers are summarised in one reply. */
const MAX_PEOPLE = 5;

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

async function audit(
  ctx: Context,
  identity: IdentityRow,
  eventType: string,
  metadata: Record<string, unknown> = {},
  accountId: string | null = identity.accountId,
): Promise<void> {
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
 */
async function summaries(
  ctx: Context,
  accountId: string,
): Promise<{ people: PersonSummary[]; applicantIds: string[] } | null> {
  const applicants = (await listApplicants(ctx.tx, accountId)).slice(0, MAX_PEOPLE);
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
  to: { waId: string },
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
  await audit(ctx, identity, 'WHATSAPP_SUMMARY_SENT', { view, travellers: people.length });
  return {
    kind: 'link',
    to,
    body,
    label: TEXT.openLabel,
    url: link(ctx.settings, recordsPath(applicantIds)),
  };
}

function menu(to: { waId: string }): WhatsAppOutgoing {
  return { kind: 'list', to, body: TEXT.menuBody, buttonLabel: TEXT.menuButton, rows: MENU_ROWS };
}

async function linkIdentity(
  ctx: Context,
  identity: IdentityRow,
  to: { waId: string },
  digits: string,
): Promise<WhatsAppOutgoing> {
  const attempt = await checkRateLimit(
    ctx.tx,
    { subjectId: senderSubject(identity.externalUserId), action: 'whatsapp.link_attempt' },
    LINK_CODE_ATTEMPT_LIMIT,
    ctx.now,
  );
  if (!attempt.allowed) return { kind: 'text', to, body: TEXT.tooManyAttempts };
  const code = first(
    await ctx.tx
      .select()
      .from(schema.channelLinkCodes)
      .where(
        and(
          eq(schema.channelLinkCodes.codeHash, hashLinkCode(digits)),
          isNull(schema.channelLinkCodes.consumedAt),
          gt(schema.channelLinkCodes.expiresAt, ctx.now),
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
  return {
    kind: 'list',
    to,
    body: `${TEXT.connected}\n\n${TEXT.menuBody}`,
    buttonLabel: TEXT.menuButton,
    rows: MENU_ROWS,
  };
}

/** Decides and applies the effect of one inbound message; returns the reply, if any. */
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
  if (!item.sender.waId) return null; // No number to answer on.
  const to = { waId: item.sender.waId };
  const reply = (message: WhatsAppOutgoing): Reply => ({ identityId: identity.id, message });
  const intent: ChannelIntent = readIntent(item);

  if (intent.kind === 'stop') {
    if (identity.optedOutAt) return null;
    await ctx.tx
      .update(schema.channelIdentities)
      .set({ optedOutAt: ctx.now, updatedAt: ctx.now })
      .where(eq(schema.channelIdentities.id, identity.id));
    await audit(ctx, identity, 'WHATSAPP_MESSAGES_OFF', { by: 'person' });
    return reply({ kind: 'text', to, body: TEXT.stopped });
  }
  if (intent.kind === 'link') return reply(await linkIdentity(ctx, identity, to, intent.code));
  if (intent.kind === 'start') {
    if (identity.optedOutAt) {
      await ctx.tx
        .update(schema.channelIdentities)
        .set({ optedOutAt: null, updatedAt: ctx.now })
        .where(eq(schema.channelIdentities.id, identity.id));
      await audit(ctx, identity, 'WHATSAPP_MESSAGES_ON', { by: 'person' });
    }
    return reply(
      identity.status === 'LINKED'
        ? { ...menu(to), body: `${TEXT.started}\n\n${TEXT.menuBody}` }
        : { kind: 'text', to, body: TEXT.started },
    );
  }
  if (identity.optedOutAt) return null; // Turned off: say nothing until START.

  if (identity.status !== 'LINKED') {
    const recent =
      identity.lastAutoReplyAt &&
      ctx.now.getTime() - identity.lastAutoReplyAt.getTime() < WELCOME_GAP_MS;
    if (recent) return null;
    await ctx.tx
      .update(schema.channelIdentities)
      .set({ lastAutoReplyAt: ctx.now, updatedAt: ctx.now })
      .where(eq(schema.channelIdentities.id, identity.id));
    return reply({
      kind: 'link',
      to,
      body: TEXT.welcome,
      label: TEXT.connectLabel,
      url: link(ctx.settings, WHATSAPP_SETTINGS_PATH),
    });
  }

  switch (intent.kind) {
    case 'media':
      await audit(ctx, identity, 'WHATSAPP_DOCUMENT_DECLINED', { mediaType: item.mediaType });
      return reply({
        kind: 'link',
        to,
        body: TEXT.media,
        label: TEXT.mediaLabel,
        url: link(ctx.settings, '/app/applicants'),
      });
    case 'person':
      await audit(ctx, identity, 'WHATSAPP_PERSON_REQUESTED');
      return reply({ kind: 'text', to, body: personText(ctx.settings.supportEmail) });
    case 'status':
    case 'missing':
    case 'expiry':
      return reply(await readReply(ctx, identity, to, intent.kind));
    default:
      return reply(menu(to));
  }
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
      errorCode: status.errorCodes[0] ?? null,
      pricingCategory: status.pricingCategory,
      billable: status.billable,
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
    await ctx.tx
      .update(schema.channelIdentities)
      .set({ optedOutAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(schema.channelIdentities.id, identityId),
          isNull(schema.channelIdentities.optedOutAt),
        ),
      );
  }
}

async function handleIdentityChange(ctx: Context, change: IdentityChange): Promise<void> {
  if (change.phoneNumberId !== ctx.settings.phoneNumberId) return;
  const where = and(
    eq(schema.channelIdentities.providerScope, change.phoneNumberId),
    eq(schema.channelIdentities.externalUserId, change.externalUserId),
  );
  if (change.kind === 'number_changed') {
    await ctx.tx
      .update(schema.channelIdentities)
      .set({ phoneLast4: change.newWaId ? change.newWaId.slice(-4) : null, updatedAt: ctx.now })
      .where(where);
    return;
  }
  // A new business-scoped id means Meta no longer vouches that this is the same person.
  const ended = await ctx.tx
    .update(schema.channelIdentities)
    .set({ status: 'REVOKED', accountId: null, revokedAt: ctx.now, updatedAt: ctx.now })
    .where(and(where, eq(schema.channelIdentities.status, 'LINKED')))
    .returning();
  for (const row of ended) {
    await appendAuditEvent(ctx.tx, {
      eventType: 'WHATSAPP_DISCONNECTED',
      actorAccountId: null,
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'channel_identity',
      resourceId: row.id,
      metadata: { channel: 'WHATSAPP', by: 'provider_id_change' },
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
 * Claims the oldest waiting delivery and applies everything in it. The work runs in a savepoint,
 * so a failure undoes the delivery's changes but still counts the attempt against that same row.
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
          lastError: null,
        })
        .where(eq(schema.channelWebhookEvents.id, event.id));
      return { outcome: 'handled', replies } as const;
    } catch (error) {
      if (isMissingRelationError(error)) throw error;
      await tx
        .update(schema.channelWebhookEvents)
        .set({ attempts: event.attempts + 1, lastError: failureReason(error) })
        .where(eq(schema.channelWebhookEvents.id, event.id));
      return { outcome: 'failed' } as const;
    }
  });
}

async function send(
  db: Db,
  options: ProcessInboxOptions,
  reply: Reply,
  now: Date,
): Promise<boolean> {
  try {
    const { providerMessageId } = await options.whatsapp.send(
      options.settings.phoneNumberId,
      reply.message,
    );
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
      await db
        .update(schema.channelIdentities)
        .set({ optedOutAt: now, updatedAt: now })
        .where(eq(schema.channelIdentities.id, reply.identityId));
    }
    return false;
  }
}

/** Removes what is no longer needed: handled deliveries, old message ids, idle unlinked senders, used codes. */
async function purge(db: Db, now: Date): Promise<number> {
  const eventCutoff = new Date(now.getTime() - EVENT_RETENTION_MS);
  const messageCutoff = new Date(now.getTime() - MESSAGE_RETENTION_MS);
  const events = await db
    .delete(schema.channelWebhookEvents)
    .where(
      and(
        lt(schema.channelWebhookEvents.receivedAt, eventCutoff),
        or(
          isNotNull(schema.channelWebhookEvents.processedAt),
          sql`${schema.channelWebhookEvents.attempts} >= ${MAX_EVENT_ATTEMPTS}`,
        ),
      ),
    )
    .returning({ id: schema.channelWebhookEvents.id });
  const messages = await db
    .delete(schema.channelMessages)
    .where(lt(schema.channelMessages.createdAt, messageCutoff))
    .returning({ id: schema.channelMessages.id });
  const idle = await db
    .delete(schema.channelIdentities)
    .where(
      and(
        inArray(schema.channelIdentities.status, ['PROVISIONAL', 'REVOKED']),
        lt(schema.channelIdentities.lastInboundAt, messageCutoff),
      ),
    )
    .returning({ id: schema.channelIdentities.id });
  const codes = await db
    .delete(schema.channelLinkCodes)
    .where(
      or(
        isNotNull(schema.channelLinkCodes.consumedAt),
        lt(schema.channelLinkCodes.expiresAt, new Date(now.getTime() - DAY_MS)),
      ),
    )
    .returning({ id: schema.channelLinkCodes.id });
  return events.length + messages.length + idle.length + codes.length;
}

/**
 * Handles waiting deliveries, sends the replies after each delivery's changes are saved, then
 * removes data past its retention. A reply is sent only after its state change is committed, so
 * a crash can lose a reply but never report something that did not happen.
 */
export async function processWhatsAppInbox(
  _scope: SystemScope<'process-whatsapp-inbox'>,
  db: Db,
  options: ProcessInboxOptions,
): Promise<ProcessInboxResult> {
  const clock = options.now ?? (() => new Date());
  const started = Date.now();
  const limit = options.limit ?? 50;
  const budget = options.timeBudgetMs ?? 45_000;
  let handled = 0;
  let failed = 0;
  let sent = 0;
  let sendFailed = 0;
  try {
    while (handled + failed < limit && Date.now() - started < budget) {
      const claimed = await handleNextEvent(db, options, clock());
      if (claimed.outcome === 'none') break;
      if (claimed.outcome === 'failed') {
        failed += 1;
        continue;
      }
      handled += 1;
      for (const reply of claimed.replies) {
        if (await send(db, options, reply, clock())) sent += 1;
        else sendFailed += 1;
      }
    }
    const purged = await purge(db, clock());
    return { status: 'ok', handled, failed, sent, sendFailed, purged };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { status: 'unavailable', handled, failed, sent, sendFailed, purged: 0 };
    }
    throw error;
  }
}
