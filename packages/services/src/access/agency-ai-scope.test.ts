import { isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import type { Db } from '../db';
import { checkAgencyAiStanding, listAgencyAiCases } from './agency-ai-scope';
import { agency, caseOf, shareWithAgency, traveller } from './agency-ai.test-support';

describe('agency AI cases and the resource lifecycle (LC-A2)', () => {
  it("leaves a Recently Deleted traveller's cases out and keeps an archived traveller's", async () => {
    const db = drizzle(await createMigratedPglite(), { schema }) as unknown as Db;
    const organization = await agency(db, 'lc-ai-owner@agency.example.test', 'Synthetic Agency');
    const kept = await traveller(db, 'lc-ai-kept@example.test');
    const gone = await traveller(db, 'lc-ai-gone@example.test');
    const keptCase = await caseOf(db, kept.ownerId, kept.applicantId, 'Kept trip');
    await caseOf(db, gone.ownerId, gone.applicantId, 'Gone trip');
    for (const who of [kept, gone]) {
      await shareWithAgency(db, {
        ownerId: who.ownerId,
        applicantId: who.applicantId,
        organization,
        ai: true,
      });
    }
    const now = new Date();
    const standing = await checkAgencyAiStanding(db, {
      connectionId: null,
      organizationId: organization.organizationId,
      accountId: organization.ownerId,
      connectionCreatedAt: now,
      now,
    });
    if (!isOk(standing)) throw new Error(`standing: ${standing.error}`);
    const before = await listAgencyAiCases(db, standing.value, now);
    expect(new Set(before.cases.map((c) => c.applicantId))).toEqual(
      new Set([kept.applicantId, gone.applicantId]),
    );

    await db.insert(schema.applicantLifecycle).values([
      { applicantId: kept.applicantId, archivedAt: now },
      {
        applicantId: gone.applicantId,
        deletedAt: now,
        purgeAfter: new Date(now.getTime() + 30 * 86_400_000),
      },
    ]);
    const after = await listAgencyAiCases(db, standing.value, now);
    expect(after.cases.map((c) => c.missionId)).toEqual([keptCase.missionId]);
    expect(after.notShown).toBe(0);
  });
});
