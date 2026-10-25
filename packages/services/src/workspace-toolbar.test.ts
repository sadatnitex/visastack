import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db';
import { markNotificationRead } from './notifications';
import { loadWorkspaceToolbarState } from './workspace-toolbar';
const client = await createMigratedPglite();
const local = drizzle(client, { schema });
const db = local as unknown as Db;
let owner: string;
let stranger: string;
let notice: string;
let org: string;
beforeAll(async () => {
  const accounts = await db
    .insert(schema.accounts)
    .values([{ email: 'toolbar-owner@example.test' }, { email: 'toolbar-stranger@example.test' }])
    .returning();
  owner = accounts[0]?.id ?? '';
  stranger = accounts[1]?.id ?? '';
  const organizations = await db
    .insert(schema.organizations)
    .values([
      { name: 'Own synthetic agency' },
      { name: 'Revoked synthetic agency' },
      { name: 'Foreign synthetic agency' },
    ])
    .returning();
  org = organizations[0]?.id ?? '';
  const revoked = organizations[1]?.id ?? '';
  const foreign = organizations[2]?.id ?? '';
  await db.insert(schema.memberships).values([
    { accountId: owner, organizationId: org, role: 'OWNER' },
    { accountId: owner, organizationId: revoked, role: 'OWNER', active: false },
    { accountId: stranger, organizationId: foreign, role: 'OWNER' },
  ]);
  await db
    .insert(schema.plans)
    .values([
      { key: 'traveller_free', name: 'Synthetic traveller free' },
      { key: 'agency_founding_access', name: 'Synthetic Founding Access' },
    ])
    .onConflictDoNothing();
  const agencyPlan =
    (
      await db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.key, 'agency_founding_access'))
        .limit(1)
    )[0]?.id ?? '';
  await db.insert(schema.subscriptions).values(
    [org, revoked, foreign].map((organizationId) => ({
      organizationId,
      planId: agencyPlan,
      assignedByAccountId: owner,
      reason: 'Synthetic toolbar fixture',
    })),
  );
  const notices = await db
    .insert(schema.notifications)
    .values(
      Array.from({ length: 70 }, (_, i) => ({
        recipientAccountId: owner,
        eventType: 'SYNTHETIC',
        channel: 'IN_APP' as const,
        status: 'SENT' as const,
        idempotencyKey: `synthetic-owner-${i}`,
        payload: { subject: 'Synthetic', summary: 'Synthetic', deepLinkPath: '/app/notifications' },
      })),
    )
    .returning({ id: schema.notifications.id });
  notice = notices[0]?.id ?? '';
  await db.insert(schema.notifications).values([
    {
      recipientAccountId: owner,
      eventType: 'SYNTHETIC',
      channel: 'IN_APP',
      status: 'QUEUED',
      idempotencyKey: 'synthetic-queued',
      payload: {},
    },
    {
      recipientAccountId: owner,
      eventType: 'SYNTHETIC',
      channel: 'EMAIL',
      status: 'SENT',
      idempotencyKey: 'synthetic-email',
      payload: {},
    },
    {
      recipientAccountId: stranger,
      eventType: 'SYNTHETIC',
      channel: 'IN_APP',
      status: 'SENT',
      idempotencyKey: 'synthetic-stranger',
      payload: {},
    },
  ]);
});
afterAll(async () => {
  await client.close();
});
describe('toolbar status uses actual account-scoped records', () => {
  it('counts all sent unread in-app notices, beyond the first notification page', async () => {
    const data = await loadWorkspaceToolbarState(db, owner);
    expect(data.unread).toBe(70);
    expect(data.personalPlan?.key).toBe('traveller_free');
    expect(data.agencyPlans.map((plan) => plan.organizationId)).toEqual([org]);
    expect(data.agencyPlans[0]?.key).toBe('agency_founding_access');
  });
  it('reflects a real read action without consuming email or another account notices', async () => {
    const read = await markNotificationRead(db, { actorAccountId: owner, notificationId: notice });
    expect(read.ok).toBe(true);
    expect((await loadWorkspaceToolbarState(db, owner)).unread).toBe(69);
    expect((await loadWorkspaceToolbarState(db, stranger)).unread).toBe(1);
  });
});
