import { and, count, eq, isNull } from 'drizzle-orm';
import { type Db, schema } from './db';
import { TRAVELLER_FREE_PLAN_KEY, getPlanByKey } from './plans';

export interface WorkspaceToolbarState {
  readonly unread: number;
  readonly personalPlan: { readonly key: string; readonly name: string } | null;
  readonly agencyPlans: readonly {
    readonly organizationId: string;
    readonly key: string;
    readonly name: string;
  }[];
}

/** Saved entitlements and actually-sent unread notices for the session account only. */
export async function loadWorkspaceToolbarState(
  db: Db,
  actorAccountId: string,
): Promise<WorkspaceToolbarState> {
  const [unread, personalPlan, agencyPlans] = await Promise.all([
    db
      .select({ count: count() })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.recipientAccountId, actorAccountId),
          eq(schema.notifications.channel, 'IN_APP'),
          eq(schema.notifications.status, 'SENT'),
        ),
      ),
    getPlanByKey(db, TRAVELLER_FREE_PLAN_KEY),
    db
      .selectDistinct({
        organizationId: schema.memberships.organizationId,
        key: schema.plans.key,
        name: schema.plans.name,
      })
      .from(schema.memberships)
      .innerJoin(
        schema.subscriptions,
        eq(schema.subscriptions.organizationId, schema.memberships.organizationId),
      )
      .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
      .where(
        and(
          eq(schema.memberships.accountId, actorAccountId),
          eq(schema.memberships.active, true),
          isNull(schema.subscriptions.endedAt),
        ),
      ),
  ]);
  return {
    unread: unread[0]?.count ?? 0,
    personalPlan: personalPlan ? { key: personalPlan.key, name: personalPlan.name } : null,
    agencyPlans,
  };
}
