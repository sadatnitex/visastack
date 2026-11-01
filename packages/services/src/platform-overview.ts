import { type Result, err, ok } from '@visastack/core';
import { and, gte, inArray, lte, sql } from 'drizzle-orm';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { lifecycleTablesPresent, presentApplicantCondition } from './lifecycle/foundation';
import { type PlatformAuthInput, hasAnyPlatformRole } from './platform-roles';

export interface PlatformOverview {
  readonly accounts: number;
  readonly travellers: number;
  readonly agencies: number;
  readonly approvedVersions: number;
  readonly terminalVersions: number;
  readonly activity: readonly {
    readonly day: string;
    readonly activated: number;
    readonly cases: number;
  }[];
}

/** Aggregate metadata only; permission is rechecked before any global count. */
export async function getPlatformOverview(
  db: Db,
  actor: PlatformAuthInput,
  now = new Date(),
): Promise<Result<PlatformOverview, ServiceError>> {
  if (!(await hasAnyPlatformRole(db, actor)))
    return err(serviceError('forbidden', 'Platform access is required.'));
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - 29);
  const lifecycle = await lifecycleTablesPresent(db);
  const [accounts, travellers, agencies, documents, events] = await Promise.all([
    db.select({ count: sql<string>`count(*)` }).from(schema.accounts),
    db
      .select({ count: sql<string>`count(*)` })
      .from(schema.applicants)
      // A count of travellers: presentApplicantCondition (a deleted record is leaving).
      .where(lifecycle ? presentApplicantCondition() : undefined),
    db.select({ count: sql<string>`count(*)` }).from(schema.organizations),
    db
      .select({
        approved: sql<string>`count(*) filter (where ${schema.documentVersions.processingStatus} = 'APPROVED')`,
        terminal: sql<string>`count(*) filter (where ${schema.documentVersions.processingStatus} in ('APPROVED', 'FAILED', 'REJECTED'))`,
      })
      .from(schema.documentVersions),
    db
      .select({
        day: sql<string>`to_char(${schema.productEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`,
        activated: sql<string>`count(*) filter (where ${schema.productEvents.eventType} = 'ACCOUNT_ACTIVATED')`,
        cases: sql<string>`count(*) filter (where ${schema.productEvents.eventType} = 'MISSION_CREATED')`,
      })
      .from(schema.productEvents)
      .where(
        and(
          gte(schema.productEvents.occurredAt, start),
          lte(schema.productEvents.occurredAt, now),
          inArray(schema.productEvents.eventType, ['ACCOUNT_ACTIVATED', 'MISSION_CREATED']),
        ),
      )
      .groupBy(sql`to_char(${schema.productEvents.occurredAt} at time zone 'UTC', 'YYYY-MM-DD')`),
  ]);
  const byDay = new Map(events.map((event) => [event.day, event]));
  const activity = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const day = date.toISOString().slice(0, 10);
    const event = byDay.get(day);
    return { day, activated: Number(event?.activated ?? 0), cases: Number(event?.cases ?? 0) };
  });
  return ok({
    accounts: Number(accounts[0]?.count ?? 0),
    travellers: Number(travellers[0]?.count ?? 0),
    agencies: Number(agencies[0]?.count ?? 0),
    approvedVersions: Number(documents[0]?.approved ?? 0),
    terminalVersions: Number(documents[0]?.terminal ?? 0),
    activity,
  });
}
