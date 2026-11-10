import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type Db, schema } from './db';
import { billingNoticeStillAllowedSql } from './notifications';
import { TRAVELLER_FREE_PLAN_KEY, getPlanByKey } from './plans';

/**
 * The unread notice types that are about a request waiting on the traveller (an agency asked for
 * something, or asked for a better copy). They are counted apart so the phone bar can put a count
 * on Sharing & Requests; every other unread notice counts toward Home. An unread notice is not the
 * same as a request still open, so the screen says "new", never "waiting".
 */
export const REQUEST_NOTICE_EVENT_TYPES = [
  'EVIDENCE_REQUEST_CREATED',
  'EVIDENCE_REPLACEMENT_REQUESTED',
] as const;

export interface WorkspaceToolbarState {
  /** Every sent, unread in-app notice for this account (the bell). */
  readonly unread: number;
  /** The part of `unread` that is about a request (see `REQUEST_NOTICE_EVENT_TYPES`). Never above `unread`; left out by a caller that has none. */
  readonly unreadRequests?: number;
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
      .select({
        count: count(),
        // The same rows, counted a second way: no extra read.
        requests:
          sql<number>`count(*) filter (where ${inArray(schema.notifications.eventType, [...REQUEST_NOTICE_EVENT_TYPES])})`.mapWith(
            Number,
          ),
      })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.recipientAccountId, actorAccountId),
          eq(schema.notifications.channel, 'IN_APP'),
          eq(schema.notifications.status, 'SENT'),
          billingNoticeStillAllowedSql({
            eventType: sql`${schema.notifications.eventType}`,
            recipientAccountId: sql`${schema.notifications.recipientAccountId}`,
            organizationId: sql`${schema.notifications.organizationId}`,
          }),
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
    unreadRequests: unread[0]?.requests ?? 0,
    personalPlan: personalPlan ? { key: personalPlan.key, name: personalPlan.name } : null,
    agencyPlans,
  };
}
