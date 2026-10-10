import { and, eq, isNull } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';

export const AGENCY_FOUNDING_PLAN_KEY = 'agency_founding_access';

/** Runs inside new-organization creation; never changes an existing subscription. */
export async function assignFoundingAccess(
  tx: Db,
  organizationId: string,
  creatorAccountId: string,
): Promise<void> {
  await tx
    .insert(schema.plans)
    .values({
      key: AGENCY_FOUNDING_PLAN_KEY,
      name: 'VisaStack Founding Access',
      priceMinorUnits: 0,
      currency: 'USD',
    })
    .onConflictDoNothing({ target: schema.plans.key });
  const plan = required(
    first(
      await tx.select().from(schema.plans).where(eq(schema.plans.key, AGENCY_FOUNDING_PLAN_KEY)),
    ),
    'founding offer',
  );
  if (!plan.active || plan.priceMinorUnits !== 0) {
    throw new Error('The complimentary founding offer is unavailable.');
  }
  const subscription = required(
    first(
      await tx
        .insert(schema.subscriptions)
        .values({
          organizationId,
          planId: plan.id,
          assignedByAccountId: creatorAccountId,
          reason: 'Complimentary Founding Access for a new organization',
        })
        .returning(),
    ),
    'founding subscription',
  );
  await appendAuditEvent(tx, {
    eventType: 'SUBSCRIPTION_ACTIVATED',
    actorAccountId: creatorAccountId,
    method: 'SYSTEM',
    result: 'ALLOWED',
    resourceType: 'subscription',
    resourceId: subscription.id,
    metadata: { organizationId, planKey: AGENCY_FOUNDING_PLAN_KEY, complimentary: true },
  });
}

/** A commercial offer only; this grants no object permissions or operational assurance. */
export async function hasFoundingAccess(tx: Db, organizationId: string): Promise<boolean> {
  return Boolean(
    first(
      await tx
        .select({ id: schema.subscriptions.id })
        .from(schema.subscriptions)
        .innerJoin(schema.plans, eq(schema.subscriptions.planId, schema.plans.id))
        .where(
          and(
            eq(schema.subscriptions.organizationId, organizationId),
            isNull(schema.subscriptions.endedAt),
            eq(schema.plans.key, AGENCY_FOUNDING_PLAN_KEY),
            eq(schema.plans.priceMinorUnits, 0),
            eq(schema.plans.active, true),
          ),
        )
        .limit(1),
    ),
  );
}
