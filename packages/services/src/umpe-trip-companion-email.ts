/**
 * UMPE UX6: the invitation email for someone travelling with the organiser.
 *
 * The organiser's server side calls this right after `addCompanion` or `resendInvitation`, with the
 * delivery those returned. The link is sealed (AES-GCM through the key service) before it enters
 * the outbox, so a copy of the database never holds a usable link; the worker reads the invitation
 * row again at send time (see `companionInvitationStillDeliverable`), so a person who was removed,
 * declined, joined or lapsed in between is never emailed.
 *
 * Nothing here looks an account up by an address, writes anything that depends on whether an
 * address has an account, or returns delivery detail: the organiser gets the same answer for every
 * address. The raw token is used once to seal and is never returned, logged or audited.
 */
import { type Result, err, ok } from '@visastack/core';
import { and, eq, gt, ne } from 'drizzle-orm';
import type { AuthorizedApplicant } from './access/require-access';
import { companionsReady } from './access/trip-companion-access';
import { type Db, first, schema } from './db';
import { type ServiceError, keyedError } from './errors';
import { queueInvitationEmail } from './invitation-email';
import { hashInvitationToken } from './invitation-tokens';
import type { KeyManagementPort } from './ports';
import type { CompanionInvitationDelivery } from './umpe-trip-companions';
import { ownerAccountOf } from './umpe-trip-service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Queue the invitation email for one person on the organiser's own trip. Only the invitation that
 * is live right now can be sent: the row must still be INVITED on this trip (which this account
 * owns), unexpired, and hold both the address and the token hash of the delivery. Anything else is
 * the one plain refusal. A copy of an older invitation still waiting in the outbox is cancelled, so
 * only the newest link goes out. Call after the invitation's own transaction has committed.
 */
export async function queueCompanionInvitation(
  proof: AuthorizedApplicant<'MANAGE'>,
  input: {
    readonly tripId: string;
    readonly companionId: string;
    readonly invitation: CompanionInvitationDelivery;
    readonly encryption: KeyManagementPort;
  },
): Promise<Result<{ readonly queued: true }, ServiceError>> {
  const owner = ownerAccountOf(proof, 'MANAGE');
  if (!owner.ok) return owner;
  const db: Db = proof.tx;
  if (!UUID.test(input.tripId) || !UUID.test(input.companionId)) {
    return err(keyedError('not_found', 'umpe_trip_companion_email.that_person_is_not_on_this'));
  }
  if (!(await companionsReady(db)))
    return err(keyedError('invalid', 'umpe_trip_companion_email.that_person_is_not_on_this'));
  return db.transaction(async (tx) => {
    const companions = schema.umpeTripCompanions;
    const row = first(
      await tx
        .select({ id: companions.id, email: companions.email, expiresAt: companions.expiresAt })
        .from(companions)
        .innerJoin(schema.umpeTrips, eq(schema.umpeTrips.id, companions.tripId))
        .where(
          and(
            eq(companions.id, input.companionId),
            eq(companions.tripId, input.tripId),
            eq(schema.umpeTrips.ownerAccountId, owner.value),
            eq(companions.state, 'INVITED'),
            eq(companions.tokenHash, hashInvitationToken(input.invitation.rawToken)),
            gt(companions.expiresAt, new Date()),
          ),
        )
        .limit(1),
    );
    if (!row?.email || !row.expiresAt || row.email !== input.invitation.recipientEmail) {
      return err(keyedError('not_found', 'umpe_trip_companion_email.that_person_is_not_on_this'));
    }
    // The newest is queued first (the key service is called before anything is cancelled, so no
    // lock is held across it), then every older waiting email is cancelled. A replay of the same
    // delivery queues nothing new and cancels nothing, so what is waiting stays waiting.
    const newest = await queueInvitationEmail(tx, {
      kind: 'companion',
      invitationId: row.id,
      email: row.email,
      rawToken: input.invitation.rawToken,
      encryption: input.encryption,
      issue: row.expiresAt.toISOString(),
    });
    await tx
      .update(schema.notifications)
      .set({ status: 'CANCELLED' })
      .where(
        and(
          eq(schema.notifications.resourceId, row.id),
          eq(schema.notifications.status, 'QUEUED'),
          ne(schema.notifications.idempotencyKey, newest.idempotencyKey),
        ),
      );
    return ok({ queued: true as const });
  });
}
