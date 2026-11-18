import { sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import type { Db } from './db';
import { generateInvitationToken, hashInvitationToken } from './invitation-tokens';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';

/**
 * Whether migration 0138 (DECL1) has run: the three invitation enums hold DECLINED and the sharing
 * invitation check allows it. Until then a decline cannot be stored (a write would fail), so the
 * accept screens show no Decline and the decline actions refuse with the plain answer.
 *
 * Read from the catalogue, so it never fails a surrounding transaction the way a write of an
 * unknown enum value would. A "yes" is kept per database handle (migrations are additive); a "no"
 * never is, so the screens offer Decline from the first request after the migration.
 */
const READY = new WeakSet<object>();

export const INVITATION_DECLINE_PRESENT = sql<boolean>`(
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
    where e.enumlabel = 'DECLINED'
      and t.typname in (
        'client_invitation_status', 'contributor_request_status', 'organization_invitation_status'
      )) = 3
  and exists (
    select 1 from pg_constraint
    where conname = 'sharing_invitations_status_check'
      and pg_get_constraintdef(oid) like '%''DECLINED''%'
  )
)`;

export async function invitationDeclineAvailable(db: Db): Promise<boolean> {
  if (READY.has(db)) return true;
  const rows = await db
    .select({ ready: INVITATION_DECLINE_PRESENT })
    .from(sql`(select 1) as probe`);
  const ready = rows[0]?.ready === true;
  if (ready) READY.add(db);
  return ready;
}

/** The four kinds of invitation a person can decline, with the audit names each one uses. */
export type DeclinableInvitationKind = 'sharing' | 'client' | 'contributor' | 'organization';

export const INVITATION_DECLINE_EVENTS: Readonly<
  Record<DeclinableInvitationKind, { readonly eventType: string; readonly resourceType: string }>
> = {
  sharing: { eventType: 'SHARING_INVITATION_DECLINED', resourceType: 'sharing_invitation' },
  client: { eventType: 'CLIENT_INVITATION_DECLINED', resourceType: 'client_invitation' },
  contributor: { eventType: 'CONTRIBUTOR_REQUEST_DECLINED', resourceType: 'contributor_request' },
  organization: {
    eventType: 'ORGANIZATION_INVITATION_DECLINED',
    resourceType: 'organization_invitation',
  },
};

/**
 * The first step of every decline: counts the try against the signed-in account (before the link
 * is looked up, so links cannot be tried in bulk), then checks that migration 0138 has run. False
 * means refuse with the kind's one plain answer and record nothing (a limited burst must not fill
 * the permanent audit log).
 */
export async function declineMayProceed(db: Db, actorAccountId: string): Promise<boolean> {
  const decision = await checkRateLimit(
    db,
    { subjectId: actorAccountId, action: 'invitation.decline', label: 'invitation' },
    RATE_LIMITS.INVITATION_DECLINE_ACCOUNT,
  );
  if (!decision.allowed) return false;
  return invitationDeclineAvailable(db);
}

/**
 * A token hash nobody holds: what a declined invitation keeps in place of its own (the column is
 * NOT NULL and unique), so the link it was sent with never matches a row again. Made with the same
 * helpers as issuance.
 */
export function unusableInvitationTokenHash(): string {
  return hashInvitationToken(generateInvitationToken());
}

/**
 * Records a refused decline: the kind and who tried, nothing else. Never the invitation, an
 * applicant, an address or a name, so the record says nothing about an invitation that was not
 * theirs. A failure to record never changes the refusal.
 */
export async function recordDeclineRefused(
  db: Db,
  input: {
    readonly kind: DeclinableInvitationKind;
    readonly actorAccountId: string;
  },
): Promise<void> {
  const names = INVITATION_DECLINE_EVENTS[input.kind];
  try {
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: names.eventType,
        actorAccountId: input.actorAccountId,
        method: 'MANUAL',
        result: 'DENIED',
        resourceType: names.resourceType,
        reason: 'not_available',
      });
    });
  } catch {
    // The refusal stands either way; only the record of it is missing.
  }
}
