import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { type StaffScope, staffPrincipal } from './access/principal';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { setConsent } from './consent';
import type { Db } from './db';
import { listAllApplicants, listRecentAuditEvents } from './platform-reads';
import { seedStaffAccount, staffScopeFor } from './platform-roles.test-support';

/** S2, M13: the two platform-wide reads need the specific platform role, checked inside the service. */

async function freshDb(): Promise<Db> {
  return drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
}

async function seedTraveller(db: Db, email: string, name: string) {
  const provisioned = await provisionAccount(db, { email });
  if (!isOk(provisioned)) throw new Error('provision');
  const id = provisioned.value.id;
  await setConsent(db, {
    actorAccountId: id,
    accountId: id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  await createApplicant(db, { actorAccountId: id, ownerAccountId: id, displayName: name });
}

describe('platform-wide reads need the specific platform role', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
    await seedTraveller(db, 'a@example.com', 'A');
    await seedTraveller(db, 'b@example.com', 'B');
  });

  it('lists every applicant for a compliance administrator', async () => {
    const admin = await seedStaffAccount(db, 'COMPLIANCE_ADMIN', 'compliance@example.com');
    const scope = await staffScopeFor(db, admin, 'APPLICANT_DIRECTORY_VIEW');
    const listed = await listAllApplicants(db, scope);
    expect(isOk(listed)).toBe(true);
    if (isOk(listed)) {
      expect(listed.value.map((a) => a.displayName).sort()).toEqual(['A', 'B']);
    }
  });

  it('never gives a support, quality or security administrator the applicant directory', async () => {
    for (const role of ['SUPPORT_ADMIN', 'QUALITY_ADMIN', 'SECURITY_ADMIN'] as const) {
      const admin = await seedStaffAccount(db, role, `${role}@example.com`);
      expect((await staffPrincipal(db, admin, 'APPLICANT_DIRECTORY_VIEW')).ok).toBe(false);
    }
  });

  it('shows the audit trail to a security administrator, newest first and bounded', async () => {
    const admin = await seedStaffAccount(db, 'SECURITY_ADMIN', 'security@example.com');
    await appendAuditEvent(db, {
      eventType: 'TEST_EVENT',
      method: 'MANUAL',
      result: 'ALLOWED',
    });
    const scope = await staffScopeFor(db, admin, 'AUDIT_TRAIL_VIEW');
    const listed = await listRecentAuditEvents(db, scope, 2);
    expect(isOk(listed)).toBe(true);
    if (!isOk(listed)) return;
    expect(listed.value).toHaveLength(2);
    expect(listed.value[0]?.eventType).toBe('TEST_EVENT');
    expect(listed.value[0]?.seq).toBeGreaterThan(listed.value[1]?.seq ?? 0);
    // A silly limit is clamped, never unbounded and never an error.
    const clamped = await listRecentAuditEvents(db, scope, Number.MAX_SAFE_INTEGER);
    expect(isOk(clamped)).toBe(true);
  });

  it('never gives a compliance or support administrator the audit trail', async () => {
    for (const role of ['COMPLIANCE_ADMIN', 'SUPPORT_ADMIN', 'QUALITY_ADMIN'] as const) {
      const admin = await seedStaffAccount(db, role, `${role}-audit@example.com`);
      expect((await staffPrincipal(db, admin, 'AUDIT_TRAIL_VIEW')).ok).toBe(false);
    }
  });

  it('refuses a cast object and a scope for another action, inside the service', async () => {
    const forged = {
      kind: 'staff',
      accountId: 'x',
      platformAction: 'APPLICANT_DIRECTORY_VIEW',
      verifiedAt: new Date(),
    } as unknown as StaffScope<'APPLICANT_DIRECTORY_VIEW'>;
    const refused = await listAllApplicants(db, forged);
    expect(isOk(refused)).toBe(false);

    const admin = await seedStaffAccount(db, 'SECURITY_ADMIN', 'other@example.com');
    const wrong = (await staffScopeFor(
      db,
      admin,
      'AI_SETTINGS_MANAGE',
    )) as unknown as StaffScope<'AUDIT_TRAIL_VIEW'>;
    expect(isOk(await listRecentAuditEvents(db, wrong))).toBe(false);
  });

  it('refuses a scope that has gone stale', async () => {
    const admin = await seedStaffAccount(db, 'SECURITY_ADMIN', 'stale@example.com');
    const scope = await staffScopeFor(db, admin, 'AUDIT_TRAIL_VIEW');
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60_000;
    try {
      expect(isOk(await listRecentAuditEvents(db, scope))).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });
});
