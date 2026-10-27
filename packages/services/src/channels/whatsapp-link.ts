import { createHash, randomInt } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { appendAuditEvent } from '../audit';
import { type Db, first, schema } from '../db';
import { type ServiceError, serviceError } from '../errors';
import { isMissingRelationError } from '../missing-relation';
import { checkRateLimit } from '../rate-limit';

/**
 * Connecting a WhatsApp to a VisaStack account (Lane D contract section 6). The only way in: the
 * person, signed in, asks for a code here and sends it from WhatsApp. The inbox job matches it.
 * A sender who writes first is never linked from chat. Only a hash of the code is stored.
 */

/** The opt-in wording the person agreed to; recorded with the connection. */
export const WHATSAPP_OPT_IN_VERSION = 'whatsapp-opt-in/1';

/** The account page where a person connects and disconnects WhatsApp. */
export const WHATSAPP_SETTINGS_PATH = '/app/account/whatsapp';

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
/** Codes one account may create in an hour. */
export const LINK_CODE_CREATE_LIMIT = { limit: 5, windowMs: HOUR_MS } as const;
/** Code attempts one WhatsApp sender may make in an hour. */
export const LINK_CODE_ATTEMPT_LIMIT = { limit: 5, windowMs: HOUR_MS } as const;
/**
 * Code attempts from every sender together in an hour: far above real use at 1,000 people, and
 * with 10-digit codes it keeps the chance of guessing any live code negligible.
 */
export const LINK_CODE_GLOBAL_ATTEMPT_LIMIT = { limit: 200, windowMs: HOUR_MS } as const;

/** Ten digits, shown as `12345-67890`. */
export const LINK_CODE_DIGITS = 10;

function isUniqueViolation(error: unknown): boolean {
  const code =
    (error as { code?: unknown; cause?: { code?: unknown } } | null)?.code ??
    (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return code === '23505';
}

export function hashLinkCode(digits: string): string {
  return createHash('sha256').update(`visastack:whatsapp-link:v1:${digits}`).digest('hex');
}

/** A rate-limit subject that never stores the sender's id itself. */
export function senderSubject(externalUserId: string): string {
  return `whatsapp-sender:${createHash('sha256').update(externalUserId).digest('hex').slice(0, 32)}`;
}

export interface StartLinkResult {
  /** Shown to the person, for example `48210-93715`. */
  readonly code: string;
  /** What the person sends from WhatsApp. */
  readonly message: string;
  /** A `wa.me` link that opens WhatsApp with the message ready, when the business number is known. */
  readonly whatsappHref: string | null;
  readonly expiresAt: Date;
}

/**
 * Creates a fresh code for the signed-in account, replacing any unused one. `optIn` must be the
 * person's explicit agreement to receive VisaStack messages on WhatsApp.
 */
export async function startWhatsAppLink(
  db: Db,
  input: {
    readonly accountId: string;
    readonly optIn: boolean;
    /** The business number in international digits, for the `wa.me` link. */
    readonly businessNumber?: string | null;
    readonly now?: Date;
  },
): Promise<Result<StartLinkResult, ServiceError>> {
  if (!input.optIn) {
    return err(serviceError('invalid', 'Agree to receive VisaStack messages on WhatsApp first.'));
  }
  const now = input.now ?? new Date();
  const decision = await checkRateLimit(
    db,
    { subjectId: `whatsapp-link:${input.accountId}`, action: 'whatsapp.link_code', label: 'code' },
    LINK_CODE_CREATE_LIMIT,
    now,
  );
  if (!decision.allowed) return err(serviceError('rate_limited', decision.reason));

  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS);
  let digits = '';
  // Two live codes are almost never equal; if they are, the unique hash refuses it and a new one is drawn.
  for (let attempt = 0; attempt < 3 && digits === ''; attempt += 1) {
    const candidate = String(randomInt(0, 10 ** LINK_CODE_DIGITS)).padStart(LINK_CODE_DIGITS, '0');
    try {
      await db.transaction(async (tx) => {
        await tx
          .delete(schema.channelLinkCodes)
          .where(
            and(
              eq(schema.channelLinkCodes.accountId, input.accountId),
              isNull(schema.channelLinkCodes.consumedAt),
            ),
          );
        await tx.insert(schema.channelLinkCodes).values({
          accountId: input.accountId,
          codeHash: hashLinkCode(candidate),
          optInVersion: WHATSAPP_OPT_IN_VERSION,
          expiresAt,
          createdAt: now,
        });
      });
      digits = candidate;
    } catch (error) {
      if (isMissingRelationError(error)) {
        return err(serviceError('upstream_error', 'WhatsApp is not available yet.'));
      }
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (digits === '') return err(serviceError('upstream_error', 'Please try again.'));
  const code = `${digits.slice(0, 5)}-${digits.slice(5)}`;
  const message = `LINK ${code}`;
  const number = input.businessNumber?.replace(/\D/g, '') ?? '';
  return ok({
    code,
    message,
    whatsappHref: /^\d{6,20}$/.test(number)
      ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
      : null,
    expiresAt,
  });
}

export interface WhatsAppConnection {
  /** False until migration 0095 has run. */
  readonly available: boolean;
  readonly connected: boolean;
  /** For example `ends in 4321`, when Meta shared a number. */
  readonly maskedNumber: string | null;
  readonly connectedAt: Date | null;
  /** True while the person has turned messages off (STOP) or blocked VisaStack. */
  readonly messagesOff: boolean;
  /** When the unused code expires, if one is waiting. */
  readonly pendingCodeExpiresAt: Date | null;
}

export async function getWhatsAppConnection(
  db: Db,
  accountId: string,
  now: Date = new Date(),
): Promise<WhatsAppConnection> {
  try {
    const identity = first(
      await db
        .select()
        .from(schema.channelIdentities)
        .where(
          and(
            eq(schema.channelIdentities.accountId, accountId),
            eq(schema.channelIdentities.status, 'LINKED'),
          ),
        )
        .limit(1),
    );
    const pending = first(
      await db
        .select({ expiresAt: schema.channelLinkCodes.expiresAt })
        .from(schema.channelLinkCodes)
        .where(
          and(
            eq(schema.channelLinkCodes.accountId, accountId),
            isNull(schema.channelLinkCodes.consumedAt),
            gt(schema.channelLinkCodes.expiresAt, now),
          ),
        )
        .limit(1),
    );
    return {
      available: true,
      connected: identity !== undefined,
      maskedNumber: identity?.phoneLast4 ? `ends in ${identity.phoneLast4}` : null,
      connectedAt: identity?.linkedAt ?? null,
      messagesOff: identity?.optedOutAt != null,
      pendingCodeExpiresAt: pending?.expiresAt ?? null,
    };
  } catch (error) {
    if (!isMissingRelationError(error)) throw error;
    return {
      available: false,
      connected: false,
      maskedNumber: null,
      connectedAt: null,
      messagesOff: false,
      pendingCodeExpiresAt: null,
    };
  }
}

/** Ends the connection from VisaStack's side. VisaStack keeps working the same without it. */
export async function disconnectWhatsApp(
  db: Db,
  input: { readonly accountId: string; readonly now?: Date },
): Promise<Result<{ readonly disconnected: boolean }, ServiceError>> {
  const now = input.now ?? new Date();
  try {
    const disconnected = await db.transaction(async (tx) => {
      await tx
        .delete(schema.channelLinkCodes)
        .where(eq(schema.channelLinkCodes.accountId, input.accountId));
      const ended = await tx
        .update(schema.channelIdentities)
        .set({ status: 'REVOKED', accountId: null, revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(schema.channelIdentities.accountId, input.accountId),
            eq(schema.channelIdentities.status, 'LINKED'),
          ),
        )
        .returning({ id: schema.channelIdentities.id });
      if (ended.length === 0) return false;
      await appendAuditEvent(tx, {
        eventType: 'WHATSAPP_DISCONNECTED',
        actorAccountId: input.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'channel_identity',
        resourceId: ended[0]?.id ?? null,
        metadata: { channel: 'WHATSAPP', by: 'person' },
      });
      return true;
    });
    return ok({ disconnected });
  } catch (error) {
    if (isMissingRelationError(error)) return ok({ disconnected: false });
    throw error;
  }
}
