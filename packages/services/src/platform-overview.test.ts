import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import { getPlatformOverview } from './platform-overview';
import { grantPlatformRole, revokePlatformRole } from './platform-roles';
const client = await createMigratedPglite();
const embedded = drizzle(client, { schema });
const db = embedded as unknown as Db;
let owner: { accountId: string; email: string; bootstrapEmails: string[] };
let outsider: typeof owner;
let roleId: string;
const now = new Date('2026-10-11T12:00:00Z');
beforeAll(async () => {
  const a = await provisionAccount(db, { email: 'overview-owner@example.test' });
  const b = await provisionAccount(db, { email: 'overview-outsider@example.test' });
  if (!a.ok || !b.ok) throw new Error('Synthetic identities');
  owner = { accountId: a.value.id, email: a.value.email, bootstrapEmails: [a.value.email] };
  outsider = { accountId: b.value.id, email: b.value.email, bootstrapEmails: [] };
  const role = await grantPlatformRole(db, {
    actor: owner,
    targetAccountId: owner.accountId,
    role: 'PLATFORM_OWNER',
    reason: 'Synthetic metrics test',
    stepUpSatisfied: true,
  });
  if (!role.ok) throw new Error('Role');
  roleId = role.value.id;
  await db
    .insert(schema.applicants)
    .values({ ownerAccountId: owner.accountId, displayName: 'Synthetic traveller' });
  await db.insert(schema.organizations).values({ name: 'Synthetic agency' });
  await db.insert(schema.productEvents).values([
    { eventType: 'ACCOUNT_ACTIVATED', occurredAt: new Date('2026-10-11T01:00:00Z') },
    { eventType: 'MISSION_CREATED', occurredAt: new Date('2026-10-11T02:00:00Z') },
    { eventType: 'MISSION_CREATED', occurredAt: new Date('2026-08-01T00:00:00Z') },
    { eventType: 'MISSION_CREATED', occurredAt: new Date('2026-10-12T00:00:00Z') },
  ]);
}, 60_000);
afterAll(async () => client.close());
describe('authorized global aggregates and bounded daily event series', () => {
  it('refuses a normal account before exposing platform totals', async () => {
    const result = await getPlatformOverview(db, outsider, now);
    expect(result.ok).toBe(false);
  });
  it('returns exact current totals and only the requested UTC window without private fields', async () => {
    const result = await getPlatformOverview(db, owner, now);
    if (!result.ok) throw new Error('Authorized overview');
    expect(result.value.accounts).toBe(2);
    expect(result.value.travellers).toBe(1);
    expect(result.value.agencies).toBe(1);
    expect(result.value.terminalVersions).toBe(0);
    expect(result.value.activity).toHaveLength(30);
    expect(result.value.activity[29]).toEqual({ day: '2026-10-11', activated: 1, cases: 1 });
    expect(result.value.activity.reduce((sum, day) => sum + day.cases, 0)).toBe(1);
    expect(JSON.stringify(result.value)).not.toContain('example.test');
  });
  it('refuses a revoked owner even when its bootstrap email remains configured', async () => {
    const replacement = await grantPlatformRole(db, {
      actor: owner,
      targetAccountId: outsider.accountId,
      role: 'PLATFORM_OWNER',
      reason: 'Synthetic replacement owner',
      stepUpSatisfied: true,
    });
    expect(replacement.ok).toBe(true);
    const revoked = await revokePlatformRole(db, {
      actor: outsider,
      grantId: roleId,
      reason: 'Synthetic revocation',
      stepUpSatisfied: true,
    });
    expect(revoked.ok).toBe(true);
    expect((await getPlatformOverview(db, owner, now)).ok).toBe(false);
  });
});
