import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeEach, describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { listAuditEventsForApplicant } from './audit';
import { setConsent } from './consent';
import type { Db } from './db';
import { registerDocumentWithVersion } from './documents';

const migrationsFolder = fileURLToPath(new URL('../../db/migrations', import.meta.url));

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return db as unknown as Db;
}

async function consentedApplicant(db: Db, email: string) {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const account = p.value;
  await setConsent(db, {
    actorAccountId: account.id,
    accountId: account.id,
    type: 'CORE_PROCESSING',
    granted: true,
  });
  const applicant = await createApplicant(db, {
    actorAccountId: account.id,
    ownerAccountId: account.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  return { account, applicantId: applicant.value.id };
}

describe('listAuditEventsForApplicant - SHR-03 "show... accesses": the applicant\'s own transparent activity log', () => {
  let db: Db;
  beforeEach(async () => {
    db = await freshDb();
  });

  it('shows the owner their own applicant-scoped events, newest first, with the actor resolved to an email', async () => {
    const { account, applicantId } = await consentedApplicant(db, 'audit-owner@example.com');
    const first = await registerDocumentWithVersion(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'first.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'key-1',
    });
    expect(isOk(first)).toBe(true);
    const second = await registerDocumentWithVersion(db, {
      actorAccountId: account.id,
      applicantId,
      originalName: 'second.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'key-2',
    });
    expect(isOk(second)).toBe(true);

    const events = await listAuditEventsForApplicant(db, account.id, applicantId);
    const registeredEvents = events.filter((e) => e.eventType === 'DOCUMENT_REGISTERED');
    expect(registeredEvents.length).toBeGreaterThanOrEqual(2);
    // Newest first.
    expect(registeredEvents[0]?.occurredAt.getTime()).toBeGreaterThanOrEqual(
      registeredEvents[1]?.occurredAt.getTime() ?? 0,
    );
    for (const e of registeredEvents) expect(e.actorEmail).toBe('audit-owner@example.com');
  });

  it("never surfaces another account's applicant events (tenant isolation), and returns empty rather than an error for a non-owner", async () => {
    const a = await consentedApplicant(db, 'audit-a@example.com');
    const b = await consentedApplicant(db, 'audit-b@example.com');
    await registerDocumentWithVersion(db, {
      actorAccountId: a.account.id,
      applicantId: a.applicantId,
      originalName: 'a-doc.pdf',
      bucket: 'QUARANTINE',
      objectKey: 'key-a',
    });

    const asStranger = await listAuditEventsForApplicant(db, b.account.id, a.applicantId);
    expect(asStranger).toEqual([]);

    const asOwner = await listAuditEventsForApplicant(db, a.account.id, a.applicantId);
    expect(asOwner.some((e) => e.eventType === 'DOCUMENT_REGISTERED')).toBe(true);
  });

  it('returns an empty list for an unknown applicant id rather than throwing', async () => {
    const { account } = await consentedApplicant(db, 'audit-unknown@example.com');
    const events = await listAuditEventsForApplicant(
      db,
      account.id,
      '00000000-0000-0000-0000-000000000000',
    );
    expect(events).toEqual([]);
  });
});
