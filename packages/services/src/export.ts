import { type Result, err, ok } from '@visastack/core';
import { eq, inArray, or } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type ConsentRecord, getConsents, listConsentHistory } from './consent';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { RATE_LIMITS, checkRateLimit } from './rate-limit';

/**
 * Account data export (Build Spec §13; PRD §2 — data portability; master
 * directive §7 "PR 4": "every account-linked personal or behavioural record
 * promised by the product, including product measurement events").
 *
 * Assembles a complete, structured, JSON-serializable snapshot of everything
 * the account owns or is linked to. Deliberately excludes: secrets, internal
 * cryptographic material (audit hash chain, blob signing), other users' data,
 * and unrelated organization data — a grant this account holds as recipient
 * is included (it's this account's access), but the *other* grants on that
 * same applicant, or the granting organization's internal records, are not.
 * Self-service only; the export itself is audited.
 */

/**
 * PRV-04 (master directive Part 7 §14): "manifest" is its own named export
 * requirement, distinct from the data itself -- an honest accounting of
 * what this export actually contains, what is deliberately excluded (by
 * design, permanent), and what is a genuine current gap (a known-issues.md
 * item, expected to close later). Counts are derived from the very data
 * already assembled below, never a separate query, so the manifest can
 * never drift from what the export actually contains.
 */
export interface AccountExportManifest {
  readonly counts: {
    readonly applicants: number;
    readonly facts: number;
    readonly factVersions: number;
    readonly documents: number;
    readonly documentVersions: number;
    readonly missions: number;
    readonly missionSnapshots: number;
    readonly grantsReceived: number;
    readonly grantsGranted: number;
    readonly evidenceRequests: number;
    readonly aiExtractionRuns: number;
    readonly auditEvents: number;
    readonly productEvents: number;
    readonly consentHistoryEntries: number;
  };
  readonly excludedByDesign: ReadonlyArray<{ readonly item: string; readonly reason: string }>;
  readonly knownGaps: ReadonlyArray<{ readonly item: string; readonly reason: string }>;
}

export interface AccountExport {
  readonly account: typeof schema.accounts.$inferSelect;
  readonly consents: Awaited<ReturnType<typeof getConsents>>;
  /** Full grant/revoke history, not just current state (directive Part 7 §14: "consent/share history"). */
  readonly consentHistory: readonly ConsentRecord[];
  readonly memberships: ReadonlyArray<typeof schema.memberships.$inferSelect>;
  readonly assignments: ReadonlyArray<typeof schema.assignments.$inferSelect>;
  readonly grantsReceived: ReadonlyArray<typeof schema.grants.$inferSelect>;
  readonly missionNotesAuthored: ReadonlyArray<typeof schema.missionNotes.$inferSelect>;
  readonly productEvents: ReadonlyArray<typeof schema.productEvents.$inferSelect>;
  readonly applicants: ReadonlyArray<{
    readonly applicant: typeof schema.applicants.$inferSelect;
    readonly facts: ReadonlyArray<{
      readonly fact: typeof schema.facts.$inferSelect;
      readonly versions: ReadonlyArray<typeof schema.factVersions.$inferSelect>;
    }>;
    readonly documents: ReadonlyArray<{
      readonly document: typeof schema.documents.$inferSelect;
      readonly versions: ReadonlyArray<typeof schema.documentVersions.$inferSelect>;
      readonly nameVersions: ReadonlyArray<typeof schema.documentNameVersions.$inferSelect>;
      readonly scanResults: ReadonlyArray<typeof schema.documentScanResults.$inferSelect>;
    }>;
    readonly missions: ReadonlyArray<{
      readonly mission: typeof schema.missions.$inferSelect;
      readonly snapshots: ReadonlyArray<typeof schema.missionSnapshots.$inferSelect>;
    }>;
    readonly grantsGranted: ReadonlyArray<typeof schema.grants.$inferSelect>;
    readonly evidenceRequests: ReadonlyArray<typeof schema.evidenceRequests.$inferSelect>;
    readonly aiRuns: ReadonlyArray<{
      readonly run: typeof schema.aiExtractionRuns.$inferSelect;
      readonly proposals: ReadonlyArray<typeof schema.fieldProposals.$inferSelect>;
    }>;
  }>;
  readonly auditEvents: ReadonlyArray<typeof schema.auditEvents.$inferSelect>;
  readonly exportedAt: string;
  readonly manifest: AccountExportManifest;
}

export async function exportAccount(
  db: Db,
  input: { readonly actorAccountId: string; readonly accountId: string },
): Promise<Result<AccountExport, ServiceError>> {
  if (input.actorAccountId !== input.accountId) {
    return err(serviceError('forbidden', 'an account may only export its own data'));
  }
  const account = (
    await db.select().from(schema.accounts).where(eq(schema.accounts.id, input.accountId)).limit(1)
  )[0];
  if (!account) return err(serviceError('not_found', 'account not found'));

  // A full account snapshot is the heaviest read in the product; it is already
  // step-up gated (apps/web), this additionally bounds how often one account
  // can trigger it.
  const rateLimit = await checkRateLimit(
    db,
    { subjectId: input.actorAccountId, action: 'account.export', label: 'export' },
    RATE_LIMITS.ACCOUNT_EXPORT,
  );
  if (!rateLimit.allowed) return err(serviceError('rate_limited', rateLimit.reason));

  const applicantRows = await db
    .select()
    .from(schema.applicants)
    .where(eq(schema.applicants.ownerAccountId, input.accountId));
  const applicantIds = applicantRows.map((a) => a.id);

  const applicants = await Promise.all(
    applicantRows.map(async (applicant) => {
      const factRows = await db
        .select()
        .from(schema.facts)
        .where(eq(schema.facts.applicantId, applicant.id));
      const facts = await Promise.all(
        factRows.map(async (fact) => ({
          fact,
          versions: await db
            .select()
            .from(schema.factVersions)
            .where(eq(schema.factVersions.factId, fact.id)),
        })),
      );

      const docRows = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.applicantId, applicant.id));
      const documents = await Promise.all(
        docRows.map(async (document) => {
          const versions = await db
            .select()
            .from(schema.documentVersions)
            .where(eq(schema.documentVersions.documentId, document.id));
          const versionIds = versions.map((v) => v.id);
          return {
            document,
            versions,
            nameVersions: await db
              .select()
              .from(schema.documentNameVersions)
              .where(eq(schema.documentNameVersions.documentId, document.id)),
            scanResults:
              versionIds.length > 0
                ? await db
                    .select()
                    .from(schema.documentScanResults)
                    .where(inArray(schema.documentScanResults.documentVersionId, versionIds))
                : [],
          };
        }),
      );

      const missionRows = await db
        .select()
        .from(schema.missions)
        .where(eq(schema.missions.applicantId, applicant.id));
      const missions = await Promise.all(
        missionRows.map(async (mission) => ({
          mission,
          snapshots: await db
            .select()
            .from(schema.missionSnapshots)
            .where(eq(schema.missionSnapshots.missionId, mission.id)),
        })),
      );

      const grantsGranted = await db
        .select()
        .from(schema.grants)
        .where(eq(schema.grants.applicantId, applicant.id));

      const evidenceRequests = await db
        .select()
        .from(schema.evidenceRequests)
        .where(eq(schema.evidenceRequests.applicantId, applicant.id));

      const aiRunRows = await db
        .select()
        .from(schema.aiExtractionRuns)
        .where(eq(schema.aiExtractionRuns.applicantId, applicant.id));
      const aiRuns = await Promise.all(
        aiRunRows.map(async (run) => ({
          run,
          proposals: await db
            .select()
            .from(schema.fieldProposals)
            .where(eq(schema.fieldProposals.aiExtractionRunId, run.id)),
        })),
      );

      return { applicant, facts, documents, missions, grantsGranted, evidenceRequests, aiRuns };
    }),
  );

  const [
    memberships,
    assignments,
    grantsReceived,
    missionNotesAuthored,
    productEvents,
    consentHistory,
  ] = await Promise.all([
    db.select().from(schema.memberships).where(eq(schema.memberships.accountId, input.accountId)),
    db
      .select()
      .from(schema.assignments)
      .where(eq(schema.assignments.memberAccountId, input.accountId)),
    db.select().from(schema.grants).where(eq(schema.grants.recipientAccountId, input.accountId)),
    db
      .select()
      .from(schema.missionNotes)
      .where(eq(schema.missionNotes.authorAccountId, input.accountId)),
    db
      .select()
      .from(schema.productEvents)
      .where(eq(schema.productEvents.accountId, input.accountId)),
    listConsentHistory(db, input.accountId),
  ]);

  const auditEvents = await db
    .select()
    .from(schema.auditEvents)
    .where(
      or(
        eq(schema.auditEvents.actorAccountId, input.accountId),
        applicantIds.length > 0 ? inArray(schema.auditEvents.applicantId, applicantIds) : undefined,
      ),
    );

  await db.transaction(async (tx) => {
    await appendAuditEvent(tx, {
      eventType: 'ACCOUNT_EXPORTED',
      actorAccountId: input.accountId,
      action: 'EXPORT_PROFILE',
      result: 'ALLOWED',
      method: 'API',
      resourceType: 'account',
      resourceId: input.accountId,
    });
  });

  const manifest: AccountExportManifest = {
    counts: {
      applicants: applicants.length,
      facts: applicants.reduce((n, a) => n + a.facts.length, 0),
      factVersions: applicants.reduce(
        (n, a) => n + a.facts.reduce((m, f) => m + f.versions.length, 0),
        0,
      ),
      documents: applicants.reduce((n, a) => n + a.documents.length, 0),
      documentVersions: applicants.reduce(
        (n, a) => n + a.documents.reduce((m, d) => m + d.versions.length, 0),
        0,
      ),
      missions: applicants.reduce((n, a) => n + a.missions.length, 0),
      missionSnapshots: applicants.reduce(
        (n, a) => n + a.missions.reduce((m, mi) => m + mi.snapshots.length, 0),
        0,
      ),
      grantsReceived: grantsReceived.length,
      grantsGranted: applicants.reduce((n, a) => n + a.grantsGranted.length, 0),
      evidenceRequests: applicants.reduce((n, a) => n + a.evidenceRequests.length, 0),
      aiExtractionRuns: applicants.reduce((n, a) => n + a.aiRuns.length, 0),
      auditEvents: auditEvents.length,
      productEvents: productEvents.length,
      consentHistoryEntries: consentHistory.length,
    },
    excludedByDesign: [
      {
        item: "other people's restricted data",
        reason:
          "this export is self-service and scoped strictly to what this account owns, authored, or was granted access to -- another applicant, organization, or account's own records are never included, even for data this account can currently view through a share",
      },
      {
        item: 'agency-internal notes about this account, written by someone else',
        reason:
          'missionNotesAuthored is scoped to notes THIS account authored; a note an agency wrote about this traveller, with a different author, is never included regardless of its visibility setting',
      },
    ],
    knownGaps: [
      {
        item: 'original document bytes',
        reason:
          'document metadata (name, size, hash, scan result) is included for every version; the original file bytes themselves are not yet -- directive Part 7 §14 requires these delivered through a durable, ZIP-safe async export job, which does not exist yet (known-issues.md item 77)',
      },
    ],
  };

  return ok({
    account,
    consents: await getConsents(db, input.accountId),
    consentHistory,
    memberships,
    assignments,
    grantsReceived,
    missionNotesAuthored,
    productEvents,
    applicants,
    auditEvents,
    exportedAt: new Date().toISOString(),
    manifest,
  });
}
