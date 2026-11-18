import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type Result, isOk } from '@visastack/core';
import { createPooledDb } from '@visastack/db';
import { startBridge, useLocalBridge } from '@visastack/db/pg-bridge';
import {
  acceptGrant,
  addDocumentVersion,
  createApplicant,
  createGrant,
  createMission,
  createOrganization,
  provisionAccount,
  provisionNeonAccount,
  registerDocument,
  reviewOrganization,
  setConsent,
} from '@visastack/services';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import { type SeededIds, envValue, identity, runDir } from './people';

/**
 * Builds the made-up world of the signed-in guard in a fresh throwaway database: the shipped
 * migrations, then a traveller with a profile, one case, two documents, and an agency whose admin
 * accepted the traveller's sharing. Every record goes in through the same service functions the
 * app uses (no hand-written SQL), so a change to those functions or the schema breaks this file at
 * typecheck, not silently at run time.
 *
 * Runs once per Playwright run (the config's globalSetup) and writes the ids to seeded.json in the
 * run folder. It refuses any database that is not on this machine, and any run on Vercel.
 */
// Playwright loads this file as CommonJS, where `__dirname` is the folder of this file.
const MIGRATIONS = resolve(__dirname, '../../../packages/db/migrations');

export const CASE_TITLE = 'Japan Tourist Visa';
export const ORGANIZATION_NAME = 'Harbour Test Travel Agency';

function must<T>(step: string, result: Result<T, { message: string }>): T {
  if (!isOk(result)) throw new Error(`Seeding failed at ${step}: ${result.error.message}`);
  return result.value;
}

/** The loopback database the app was started with (same rule as db-preload.cjs). */
export function loopbackDatabaseUrl(env: Readonly<Record<string, string | undefined>>): URL {
  if (envValue(env, 'VERCEL')) throw new Error('The CI seed never runs on Vercel.');
  const raw = envValue(env, 'DATABASE_URL');
  if (!raw) throw new Error('The CI seed needs DATABASE_URL.');
  const url = new URL(raw);
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('The CI seed only writes to a database on 127.0.0.1.');
  }
  return url;
}

export async function seed(env = process.env): Promise<SeededIds> {
  const url = loopbackDatabaseUrl(env);
  const bridge = await startBridge({
    listenPort: 0,
    pgHost: '127.0.0.1',
    pgPort: Number(url.port || '5432'),
  });
  useLocalBridge(bridge.port);
  const { db, pool } = createPooledDb(url.toString());
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });

    // The traveller: account (bound to the stand-in identity), consents, profile, case, documents.
    const t = identity('traveller');
    const traveller = must(
      'traveller account',
      await provisionNeonAccount(db, {
        email: t.email,
        neonUserId: t.providerId,
        emailVerified: true,
      }),
    );
    for (const type of ['CORE_PROCESSING', 'SHARING'] as const) {
      must(
        `traveller consent ${type}`,
        await setConsent(db, {
          actorAccountId: traveller.id,
          accountId: traveller.id,
          type,
          granted: true,
        }),
      );
    }
    const applicant = must(
      'traveller profile',
      await createApplicant(db, {
        actorAccountId: traveller.id,
        ownerAccountId: traveller.id,
        displayName: t.name,
      }),
    );
    const mission = must(
      'case',
      await createMission(db, {
        actorAccountId: traveller.id,
        applicantId: applicant.id,
        title: CASE_TITLE,
      }),
    );
    const documentIds: string[] = [];
    for (const [index, originalName] of ['passport-scan.pdf', 'bank-statement.pdf'].entries()) {
      const document = must(
        `document ${originalName}`,
        await registerDocument(db, {
          actorAccountId: traveller.id,
          applicantId: applicant.id,
          originalName,
        }),
      );
      must(
        `document version ${originalName}`,
        await addDocumentVersion(db, {
          actorAccountId: traveller.id,
          documentId: document.id,
          bucket: 'CLEAN',
          // No file is stored: v1 shows no previews (docs/operations/ci-signed-in-guard.md).
          objectKey: `ci-signed-in/${index + 1}`,
          safetyStatus: 'CLEAN',
          processingStatus: 'AWAITING_REVIEW',
        }),
      );
      documentIds.push(document.id);
    }

    // The agency: its admin (the stand-in identity) creates it, a separate made-up platform
    // reviewer activates it, the traveller shares, the admin accepts.
    const a = identity('agencyAdmin');
    const admin = must(
      'agency admin account',
      await provisionNeonAccount(db, {
        email: a.email,
        neonUserId: a.providerId,
        emailVerified: true,
      }),
    );
    const organization = must(
      'agency',
      await createOrganization(db, { actorAccountId: admin.id, name: ORGANIZATION_NAME }),
    );
    const reviewer = must(
      'platform reviewer',
      await provisionAccount(db, {
        email: 'ci.platform.reviewer@example.test',
        emailVerified: true,
      }),
    );
    must(
      'agency activation',
      await reviewOrganization(db, {
        reviewerAccountId: reviewer.id,
        organizationId: organization.id,
        decision: 'ACTIVE',
        stepUpSatisfied: true,
      }),
    );
    const grant = must(
      'sharing',
      await createGrant(db, {
        actorAccountId: traveller.id,
        applicantId: applicant.id,
        recipientOrganizationId: organization.id,
        actions: ['PREVIEW'],
        purpose: 'visa_application',
      }),
    );
    must(
      'sharing accepted',
      await acceptGrant(db, { actorAccountId: admin.id, grantId: grant.id }),
    );

    const ids: SeededIds = {
      travellerAccountId: traveller.id,
      applicantId: applicant.id,
      caseId: mission.id,
      caseTitle: CASE_TITLE,
      documentIds,
      agencyAdminAccountId: admin.id,
      organizationId: organization.id,
      organizationName: ORGANIZATION_NAME,
      grantId: grant.id,
    };
    writeFileSync(join(runDir(env), 'seeded.json'), `${JSON.stringify(ids, null, 2)}\n`);
    return ids;
  } finally {
    await pool.end();
    await bridge.close();
  }
}
