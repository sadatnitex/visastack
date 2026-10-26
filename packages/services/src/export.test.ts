import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import { provisionAccount } from './accounts';
import { createApplicant } from './applicants';
import { setConsent } from './consent';
import type { Db } from './db';
import { exportAccount } from './export';
import { buildExportCsvTables } from './export-csv';
import { createMission } from './missions';
import { acceptGrant, createGrant } from './sharing';

/** Per-case sharing exceptions (ADR 0017) in the owner's account export, and nowhere else. */

const HEAVY_TIMEOUT_MS = 60_000;

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

async function consented(db: Db, email: string) {
  const account = await provisionAccount(db, { email });
  if (!isOk(account)) throw new Error('provision');
  for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
    await setConsent(db, {
      actorAccountId: account.value.id,
      accountId: account.value.id,
      type,
      granted: true,
    });
  }
  return account.value;
}

async function seed() {
  const db = await freshDb();
  const owner = await consented(db, 'export-owner@example.test');
  const recipient = await consented(db, 'export-recipient@example.test');
  const applicant = await createApplicant(db, {
    actorAccountId: owner.id,
    ownerAccountId: owner.id,
    displayName: 'Owner',
  });
  if (!isOk(applicant)) throw new Error('applicant');
  const kept = await createMission(db, {
    actorAccountId: owner.id,
    applicantId: applicant.value.id,
    title: 'Japan trip 2025',
  });
  const excluded = await createMission(db, {
    actorAccountId: owner.id,
    applicantId: applicant.value.id,
    title: 'Japan trip 2026',
  });
  if (!isOk(kept) || !isOk(excluded)) throw new Error('missions');
  const grantTo = async (missionId?: string) => {
    const created = await createGrant(db, {
      actorAccountId: owner.id,
      applicantId: applicant.value.id,
      recipientAccountId: recipient.id,
      actions: ['VIEW_METADATA'],
      purpose: missionId ? 'one case' : 'all cases',
      ...(missionId ? { missionId } : {}),
    });
    if (!isOk(created)) throw new Error('grant');
    await acceptGrant(db, { actorAccountId: recipient.id, grantId: created.value.id });
    return created.value.id;
  };
  const allCases = await grantTo();
  const oneCase = await grantTo(kept.value.id);
  await db.insert(schema.grantCaseExclusions).values({
    grantId: allCases,
    missionId: excluded.value.id,
    applicantId: applicant.value.id,
    createdByAccountId: owner.id,
  });
  return { db, owner, recipient, allCases, oneCase, excludedCase: excluded.value.id };
}

async function exportFor(db: Db, accountId: string) {
  const result = await exportAccount(db, { actorAccountId: accountId, accountId });
  if (!isOk(result)) throw new Error('export');
  return result.value;
}

describe('account export: per-case sharing exceptions', () => {
  it(
    'lists each exception under the grant it narrows, in the JSON and the CSV',
    async () => {
      const s = await seed();
      const data = await exportFor(s.db, s.owner.id);
      const grants = data.applicants[0]?.grantsGranted ?? [];
      const byId = new Map(grants.map((g) => [g.id, g.caseExceptions]));
      expect(byId.get(s.allCases)).toEqual([
        {
          missionId: s.excludedCase,
          caseTitle: 'Japan trip 2026',
          excludedAt: expect.any(Date),
          excludedByAccountId: s.owner.id,
        },
      ]);
      expect(byId.get(s.oneCase)).toEqual([]);
      expect(data.manifest.counts.caseExceptions).toBe(1);

      const csv = buildExportCsvTables(data).find((t) => t.name === 'grants_granted.csv')?.csv;
      const [header, ...rows] = (csv ?? '').split('\r\n');
      expect(header?.split(',')).toContain('caseExceptions');
      const allCasesRow = rows.find((row) => row.startsWith(s.allCases));
      expect(allCasesRow).toContain(s.excludedCase);
      expect(allCasesRow).toContain('Japan trip 2026');
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    "never tells the recipient: their own export carries no exception or the excluded case's title",
    async () => {
      const s = await seed();
      const data = await exportFor(s.db, s.recipient.id);
      const text = JSON.stringify(data);
      expect(data.grantsReceived.map((g) => g.id).sort()).toEqual([s.allCases, s.oneCase].sort());
      expect(data.manifest.counts.caseExceptions).toBe(0);
      expect(text).not.toContain('Japan trip 2026');
      expect(text).not.toContain(s.excludedCase);
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'still exports before migration 0090 has run, with no exceptions',
    async () => {
      const s = await seed();
      await s.db.execute(sql`drop table grant_case_exclusions`);
      const data = await exportFor(s.db, s.owner.id);
      expect(data.applicants[0]?.grantsGranted.every((g) => g.caseExceptions.length === 0)).toBe(
        true,
      );
      expect(data.manifest.counts.caseExceptions).toBe(0);
    },
    HEAVY_TIMEOUT_MS,
  );
});
