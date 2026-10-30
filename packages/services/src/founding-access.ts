import { eq, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import {
  PLAN_PRICE_FROM_START,
  rulesFromColumns,
  writePlanPrice,
  writePlanRules,
} from './plans-admin';
import { entitlementsSchemaPresent, planColumns } from './plans-schema';

export const AGENCY_FOUNDING_PLAN_KEY = 'agency_founding_access';

/**
 * Runs inside new-organization creation; never changes an existing subscription.
 *
 * S29: Founding Access stays the plan every new agency starts on. What makes it complimentary is
 * the plan's `bypass_limits` flag (an agency plan with no price that lifts every limit), no longer
 * its key; the Plans page refuses to retire it. Before migration 0107 the plan row is written with
 * the columns every database has, and the checks recognise it by its key and zero price as before.
 */
export async function assignFoundingAccess(
  tx: Db,
  organizationId: string,
  creatorAccountId: string,
): Promise<void> {
  if (await entitlementsSchemaPresent(tx)) {
    const [created] = await tx
      .insert(schema.plans)
      .values({
        key: AGENCY_FOUNDING_PLAN_KEY,
        name: 'VisaStack Founding Access',
        priceMinorUnits: 0,
        currency: 'USD',
        audience: 'AGENCY',
        bypassLimits: true,
      })
      .onConflictDoNothing({ target: schema.plans.key })
      .returning(planColumns());
    if (created) {
      // A plan written for the first time gets its rule rows and its price, like any other.
      const now = new Date();
      await writePlanRules(tx, created.id, rulesFromColumns(created), now);
      await writePlanPrice(
        tx,
        created.id,
        { priceMinorUnits: 0, currency: 'USD' },
        { effectiveFrom: PLAN_PRICE_FROM_START, actorAccountId: null, now },
      );
    }
  } else {
    await tx.execute(
      sql`insert into plans (key, name, price_minor_units, currency) values (${AGENCY_FOUNDING_PLAN_KEY}, 'VisaStack Founding Access', 0, 'USD') on conflict (key) do nothing`,
    );
  }
  const plan = required(
    first(
      await tx
        .select(planColumns())
        .from(schema.plans)
        .where(eq(schema.plans.key, AGENCY_FOUNDING_PLAN_KEY)),
    ),
    'founding offer',
  );
  if (!plan.active || plan.priceMinorUnits !== 0 || !plan.bypassLimits) {
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
