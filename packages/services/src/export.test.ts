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
import { registerDocument } from './documents';
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

async function seedLifecycle(db: Db) {
  const owner = await consented(db, 'export-lifecycle@example.test');
  const traveller = async (displayName: string) => {
    const created = await createApplicant(db, {
      actorAccountId: owner.id,
      ownerAccountId: owner.id,
      displayName,
    });
    if (!isOk(created)) throw new Error('applicant');
    return created.value.id;
  };
  const currentTraveller = await traveller('Current traveller');
  const archivedTraveller = await traveller('Archived traveller');
  const deletedTraveller = await traveller('Deleted traveller');
  const document = async (originalName: string) => {
    const created = await registerDocument(db, {
      actorAccountId: owner.id,
      applicantId: currentTraveller,
      originalName,
      docType: 'passport',
    });
    if (!isOk(created)) throw new Error('document');
    return created.value.id;
  };
  const currentDocument = await document('current.pdf');
  const archivedDocument = await document('archived.pdf');
  const deletedDocument = await document('deleted.pdf');
  return {
    owner,
    currentTraveller,
    archivedTraveller,
    deletedTraveller,
    currentDocument,
    archivedDocument,
    deletedDocument,
  };
}

describe('account export and the resource lifecycle (LC-A2)', () => {
  it(
    'exports every record and labels archived and Recently Deleted ones',
    async () => {
      const db = await freshDb();
      const s = await seedLifecycle(db);
      const now = new Date();
      const purgeAfter = new Date(now.getTime() + 30 * 86_400_000);
      await db.insert(schema.documentLifecycle).values([
        { documentId: s.archivedDocument, applicantId: s.currentTraveller, archivedAt: now },
        {
          documentId: s.deletedDocument,
          applicantId: s.currentTraveller,
          deletedAt: now,
          deletePath: 'DUPLICATE',
          purgeAfter,
        },
      ]);
      await db.insert(schema.applicantLifecycle).values([
        { applicantId: s.archivedTraveller, archivedAt: now },
        { applicantId: s.deletedTraveller, deletedAt: now, purgeAfter },
      ]);
      const data = await exportFor(db, s.owner.id);
      const travellers = new Map(data.applicants.map((a) => [a.applicant.id, a]));
      expect(travellers.size).toBe(3);
      const current = travellers.get(s.currentTraveller);
      expect(current).toBeDefined();
      expect(current && 'status' in current).toBe(false);
      expect(travellers.get(s.archivedTraveller)?.status).toBe('Archived');
      expect(travellers.get(s.deletedTraveller)?.status).toBe('Scheduled for removal');
      const documents = new Map(current?.documents.map((d) => [d.document.id, d]) ?? []);
      expect(documents.size).toBe(3);
      const currentDoc = documents.get(s.currentDocument);
      expect(currentDoc).toBeDefined();
      expect(currentDoc && 'status' in currentDoc).toBe(false);
      expect(documents.get(s.archivedDocument)?.status).toBe('Archived');
      expect(documents.get(s.deletedDocument)?.status).toBe('Scheduled for removal');
    },
    HEAVY_TIMEOUT_MS,
  );

  it(
    'still exports every record with no status labels while the lifecycle tables are missing',
    async () => {
      const client = await createMigratedPglite();
      await client.exec(
        'drop table document_removal_requests, document_lifecycle, applicant_lifecycle, deletion_receipts cascade',
      );
      const db = drizzle(client, { schema }) as unknown as Db;
      const s = await seedLifecycle(db);
      const data = await exportFor(db, s.owner.id);
      expect(data.applicants).toHaveLength(3);
      expect(data.applicants.every((a) => !('status' in a))).toBe(true);
      const documents = data.applicants.flatMap((a) => a.documents);
      expect(documents).toHaveLength(3);
      expect(documents.every((d) => !('status' in d))).toBe(true);
    },
    HEAVY_TIMEOUT_MS,
  );
});
