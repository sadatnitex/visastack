import type { Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { orgGrantPermits } from './agency';
import { getApplicant } from './applicants';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { listMembershipsForAccount } from './organizations';

/**
 * EVI-05 (assurance ladder): "Display separate statements: applicant
 * declared; document supplied; named machine checks performed; agency
 * reviewed; issuer confirmed if evidence supports it." Scoped to FACTS: the
 * master profile already carries most of this exact ladder as
 * `factVersions.status` (Build Spec §9: DECLARED / DOCUMENT_SUPPORTED /
 * AGENCY_REVIEWED, with the comment "Generic 'Verified' is forbidden"), and
 * the PRD's E3 description ("exact claim") is fact-shaped, not
 * document-shaped. Four of the five statements below read off data this
 * codebase already has; only "issuer confirmed" needed a new table
 * (`issuerVerifications`, `packages/db/src/schema.ts`). E0-E3 are a
 * derived, secondary summary label the PRD itself calls "internal"; the
 * five statements are always assembled and shown regardless of tier, never
 * collapsed into the one opaque status badge `profile-editor.tsx` renders
 * today.
 *
 * Documents get a narrower slice of this: `listIssuerVerificationsForDocument`
 * only, surfaced on the Document Vault page alongside the review outcome
 * (EVI-03) and lifecycle (EVI-04) badges already there. A full parallel
 * ladder for documents would mostly restate those existing badges:
 * "document supplied" is trivially true for any registered document, and
 * machine checks/agency review are already visible as the safety/
 * processing/review badges, so only the genuinely new axis (issuer
 * confirmation) is added there, rather than a second, overlapping view type.
 */

export type AssuranceTier = 'E0' | 'E1' | 'E2' | 'E3';

export interface MachineCheckSummary {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string | null;
  readonly performedAt: Date;
}

export interface AgencyReviewSummary {
  readonly missionId: string;
  readonly missionTitle: string;
  readonly outcome: 'ACCEPTED' | 'REJECTED';
  readonly reason: string | null;
  readonly decidedByAccountId: string;
  readonly decidedAt: Date;
}

export type IssuerVerification = typeof schema.issuerVerifications.$inferSelect;

export interface IssuerConfirmationSummary {
  readonly issuerIdentity: string;
  readonly contactMethod: string;
  readonly exactClaim: string;
  readonly response: string;
  readonly validUntil: Date;
  readonly expired: boolean;
  readonly verifiedByAccountId: string;
  readonly createdAt: Date;
}

export interface FactAssuranceView {
  readonly factId: string;
  readonly fieldKey: string;
  readonly applicantDeclared: boolean;
  readonly documentSupplied: boolean;
  readonly machineChecks: readonly MachineCheckSummary[];
  readonly agencyReviews: readonly AgencyReviewSummary[];
  readonly issuerConfirmations: readonly IssuerConfirmationSummary[];
  readonly tier: AssuranceTier;
}

/**
 * A secondary summary label, never the primary UI (the five statements
 * above are). "E2 is never proof of authenticity" (PRD): reaching E2 needs a
 * document PLUS at least one passing named check or an accepted agency
 * review behind it, not either alone, and it is capped there no matter how
 * many checks passed; only a live issuer confirmation reaches E3. "Checks
 * can fail or expire" applies here too: an expired issuer confirmation
 * (`validUntil` in the past) does not count toward E3.
 *
 * An accepted agency review with no document behind it (a purely
 * declarative field a case manager accepted on the applicant's word alone)
 * is real, non-trivial progress over a bare declaration, so it still lifts
 * the tier to E1 rather than being erased back to E0 for lack of a
 * document; it is capped there rather than reaching E2, which the PRD
 * reserves for a document plus a check or review, not a review alone.
 * (`hasMachineCheck` can never be true without `documentSupplied` also
 * being true: every machine check here is computed from a source document,
 * so that combination cannot occur in practice.)
 */
export function deriveAssuranceTier(input: {
  readonly documentSupplied: boolean;
  readonly hasMachineCheck: boolean;
  readonly hasAgencyReview: boolean;
  readonly hasLiveIssuerConfirmation: boolean;
}): AssuranceTier {
  if (input.hasLiveIssuerConfirmation) return 'E3';
  if (input.documentSupplied && (input.hasMachineCheck || input.hasAgencyReview)) return 'E2';
  if (input.documentSupplied || input.hasAgencyReview) return 'E1';
  return 'E0';
}

interface FactRow {
  readonly factId: string;
  readonly fieldKey: string;
  readonly status: string | null;
  readonly sourceDocumentVersionId: string | null;
}

async function loadFactRows(db: Db, applicantId: string, factId?: string): Promise<FactRow[]> {
  return db
    .select({
      factId: schema.facts.id,
      fieldKey: schema.fieldDefinitions.key,
      status: schema.factVersions.status,
      sourceDocumentVersionId: schema.factVersions.sourceDocumentVersionId,
    })
    .from(schema.facts)
    .innerJoin(
      schema.fieldDefinitions,
      eq(schema.fieldDefinitions.id, schema.facts.fieldDefinitionId),
    )
    .leftJoin(schema.factVersions, eq(schema.facts.currentVersionId, schema.factVersions.id))
    .where(
      factId
        ? and(eq(schema.facts.applicantId, applicantId), eq(schema.facts.id, factId))
        : eq(schema.facts.applicantId, applicantId),
    );
}

/**
 * Shared assembly for both the single-fact and whole-applicant views:
 * batches every side-query once regardless of how many facts are being
 * assembled (same discipline as `wallet.ts`'s `getWalletView`), rather than
 * running it once per fact.
 */
async function buildFactAssuranceViews(
  db: Db,
  rows: readonly FactRow[],
): Promise<FactAssuranceView[]> {
  const factIds = rows.map((r) => r.factId);
  const documentVersionIds = [
    ...new Set(rows.flatMap((r) => (r.sourceDocumentVersionId ? [r.sourceDocumentVersionId] : []))),
  ];

  const [scans, extractions, classifications, issuerRows, evidenceRows] = await Promise.all([
    documentVersionIds.length > 0
      ? db
          .select()
          .from(schema.documentScanResults)
          .where(inArray(schema.documentScanResults.documentVersionId, documentVersionIds))
      : Promise.resolve([]),
    documentVersionIds.length > 0
      ? db
          .select()
          .from(schema.extractionRuns)
          .where(inArray(schema.extractionRuns.documentVersionId, documentVersionIds))
      : Promise.resolve([]),
    documentVersionIds.length > 0
      ? db
          .select()
          .from(schema.documentClassifications)
          .where(inArray(schema.documentClassifications.documentVersionId, documentVersionIds))
      : Promise.resolve([]),
    factIds.length > 0
      ? db
          .select()
          .from(schema.issuerVerifications)
          .where(inArray(schema.issuerVerifications.factId, factIds))
      : Promise.resolve([]),
    factIds.length > 0
      ? db
          .select({
            factId: schema.selectedEvidence.factId,
            missionId: schema.selectedEvidence.missionId,
            packRequirementId: schema.selectedEvidence.packRequirementId,
          })
          .from(schema.selectedEvidence)
          .where(inArray(schema.selectedEvidence.factId, factIds))
      : Promise.resolve([]),
  ]);

  const missionIds = [...new Set(evidenceRows.map((r) => r.missionId))];
  const [missions, decisions] = await Promise.all([
    missionIds.length > 0
      ? db.select().from(schema.missions).where(inArray(schema.missions.id, missionIds))
      : Promise.resolve([]),
    missionIds.length > 0
      ? db
          .select()
          .from(schema.missionDecisions)
          .where(inArray(schema.missionDecisions.missionId, missionIds))
      : Promise.resolve([]),
  ]);
  const missionTitles = new Map(missions.map((m) => [m.id, m.title]));

  // Latest decision per (missionId, packRequirementId): the same
  // append-only convention `missionDecisions` documents itself: "the latest
  // row per requirement is 'the' decision".
  const latestDecisionByRequirement = new Map<string, (typeof decisions)[number]>();
  for (const decision of decisions) {
    const key = `${decision.missionId}:${decision.packRequirementId}`;
    const existing = latestDecisionByRequirement.get(key);
    if (!existing || decision.createdAt.getTime() > existing.createdAt.getTime()) {
      latestDecisionByRequirement.set(key, decision);
    }
  }

  const now = new Date();

  return rows.map((row) => {
    const documentSupplied = row.sourceDocumentVersionId !== null;

    const machineChecks: MachineCheckSummary[] = row.sourceDocumentVersionId
      ? [
          ...scans
            .filter((s) => s.documentVersionId === row.sourceDocumentVersionId)
            .map((s) => ({
              name: `Malware scan (${s.scannerName})`,
              passed: s.safe && !s.scanErrored,
              detail: s.detail,
              performedAt: s.scannedAt,
            })),
          ...extractions
            .filter((e) => e.documentVersionId === row.sourceDocumentVersionId)
            .map((e) => ({
              name: `Extraction (${e.parserName})`,
              passed: e.status === 'SUCCEEDED',
              detail:
                e.errorCode ?? (e.warnings && e.warnings.length > 0 ? e.warnings.join('; ') : null),
              performedAt: e.createdAt,
            })),
          ...classifications
            .filter((c) => c.documentVersionId === row.sourceDocumentVersionId)
            .map((c) => ({
              name: 'Classification',
              passed: c.classifiedType !== null && !c.reviewRequired,
              detail: c.rationale,
              performedAt: c.createdAt,
            })),
        ]
      : [];

    const requirementKeys = evidenceRows
      .filter((e) => e.factId === row.factId)
      .map((e) => `${e.missionId}:${e.packRequirementId}`);
    const agencyReviews: AgencyReviewSummary[] = requirementKeys
      .map((key) => latestDecisionByRequirement.get(key))
      .filter((d): d is NonNullable<typeof d> => d !== undefined)
      .map((d) => ({
        missionId: d.missionId,
        missionTitle: missionTitles.get(d.missionId) ?? d.missionId,
        outcome: d.outcome,
        reason: d.reason,
        decidedByAccountId: d.decidedByAccountId,
        decidedAt: d.createdAt,
      }));

    const issuerConfirmations: IssuerConfirmationSummary[] = issuerRows
      .filter((v) => v.factId === row.factId)
      .map((v) => ({
        issuerIdentity: v.issuerIdentity,
        contactMethod: v.contactMethod,
        exactClaim: v.exactClaim,
        response: v.response,
        validUntil: v.validUntil,
        expired: v.validUntil.getTime() <= now.getTime(),
        verifiedByAccountId: v.verifiedByAccountId,
        createdAt: v.createdAt,
      }));

    const tier = deriveAssuranceTier({
      documentSupplied,
      hasMachineCheck: machineChecks.some((c) => c.passed),
      hasAgencyReview: agencyReviews.some((a) => a.outcome === 'ACCEPTED'),
      hasLiveIssuerConfirmation: issuerConfirmations.some((c) => !c.expired),
    });

    return {
      factId: row.factId,
      fieldKey: row.fieldKey,
      // Every current fact version was written through `editFact`, which
      // only ever accepts the applicant owner as actor (sharing a write
      // path to facts with an org is separate, not-yet-built work), so any
      // fact with a current version at all was, definitionally, declared by
      // the applicant. There is no reachable "declared by someone else" case
      // to distinguish it from today.
      applicantDeclared: row.status !== null,
      documentSupplied,
      machineChecks,
      agencyReviews,
      issuerConfirmations,
      tier,
    };
  });
}

/**
 * The owner's assurance view for a single fact. Owner-only, matching
 * `editFact`'s own current authorization: there is no org-facing
 * fact-sharing pathway yet to check against instead.
 */
export async function getFactAssurance(
  db: Db,
  input: { readonly actorAccountId: string; readonly applicantId: string; readonly factId: string },
): Promise<Result<FactAssuranceView, ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to view this assurance record'));
  }
  const row = first(await loadFactRows(db, input.applicantId, input.factId));
  if (!row) return err(serviceError('not_found', 'fact not found for this applicant'));
  const [view] = await buildFactAssuranceViews(db, [row]);
  return ok(required(view, 'assurance view'));
}

/**
 * Every fact's assurance view for an applicant, in one batch: the shape
 * the Master Profile page needs to break its single status badge into the
 * PRD's five separate statements per field. Owner-only, same reasoning as
 * `getFactAssurance`.
 */
export async function listApplicantAssurance(
  db: Db,
  input: { readonly actorAccountId: string; readonly applicantId: string },
): Promise<Result<readonly FactAssuranceView[], ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to view this assurance record'));
  }
  const rows = await loadFactRows(db, input.applicantId);
  return ok(await buildFactAssuranceViews(db, rows));
}

/**
 * Records tier E3 for a fact or document: "issuer identity/contact method,
 * exact claim, response, date and validity, not a staff checkbox claiming
 * verification" (PRD); every substantive field is required and trimmed
 * non-empty, and the row cannot outlive `validUntil` without a fresh one.
 *
 * Deliberately NOT owner-permitted, unlike `recordDocumentReview` (EVI-03):
 * the top assurance tier only means something if it is independent of the
 * party whose claim it is, so letting an applicant self-certify their own
 * E3 would undercut the one guarantee this tier exists to give. Requires a
 * MANAGE-level org grant, the same bar `recordMissionDecision` uses,
 * reflecting how consequential this record is (a COMMENT-level bar, as
 * `recordDocumentReview` uses, is not enough here), checked with
 * `missionId` when the caller has one so a mission-scoped grant counts, not
 * only an applicant-wide one.
 */
export async function recordIssuerVerification(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly applicantId: string;
    readonly factId?: string;
    readonly documentId?: string;
    readonly missionId?: string;
    readonly issuerIdentity: string;
    readonly contactMethod: string;
    readonly exactClaim: string;
    readonly response: string;
    readonly validUntil: Date;
  },
): Promise<Result<IssuerVerification, ServiceError>> {
  if (!input.factId && !input.documentId) {
    return err(serviceError('invalid', 'an issuer verification must cover a fact or a document'));
  }
  const requiredFields = {
    issuerIdentity: input.issuerIdentity,
    contactMethod: input.contactMethod,
    exactClaim: input.exactClaim,
    response: input.response,
  };
  for (const [field, value] of Object.entries(requiredFields)) {
    if (value.trim().length === 0) return err(serviceError('invalid', `${field} is required`));
  }
  if (input.validUntil.getTime() <= Date.now()) {
    return err(serviceError('invalid', 'validUntil must be in the future'));
  }

  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));

  if (input.factId) {
    const fact = first(
      await db
        .select({ applicantId: schema.facts.applicantId })
        .from(schema.facts)
        .where(eq(schema.facts.id, input.factId))
        .limit(1),
    );
    if (!fact || fact.applicantId !== input.applicantId) {
      return err(serviceError('not_found', 'fact not found for this applicant'));
    }
  }
  if (input.documentId) {
    const document = first(
      await db
        .select({ applicantId: schema.documents.applicantId })
        .from(schema.documents)
        .where(eq(schema.documents.id, input.documentId))
        .limit(1),
    );
    if (!document || document.applicantId !== input.applicantId) {
      return err(serviceError('not_found', 'document not found for this applicant'));
    }
  }

  let authorized = false;
  const memberships = await listMembershipsForAccount(db, input.actorAccountId);
  for (const membership of memberships) {
    if (!membership.active) continue;
    if (
      await orgGrantPermits(
        db,
        membership.organization.id,
        input.applicantId,
        'MANAGE',
        input.missionId,
      )
    ) {
      authorized = true;
      break;
    }
  }
  if (!authorized) {
    return err(
      serviceError(
        'forbidden',
        'not authorized to record an issuer verification for this applicant',
      ),
    );
  }

  const resourceId = required(input.factId ?? input.documentId, 'issuer verification target');

  return db.transaction(async (tx) => {
    const verification = required(
      first(
        await tx
          .insert(schema.issuerVerifications)
          .values({
            applicantId: input.applicantId,
            factId: input.factId ?? null,
            documentId: input.documentId ?? null,
            issuerIdentity: input.issuerIdentity.trim(),
            contactMethod: input.contactMethod.trim(),
            exactClaim: input.exactClaim.trim(),
            response: input.response.trim(),
            validUntil: input.validUntil,
            verifiedByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'issuer verification',
    );
    await appendAuditEvent(tx, {
      eventType: 'ISSUER_VERIFICATION_RECORDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId: input.applicantId,
      resourceType: input.factId ? 'fact' : 'document',
      resourceId,
      metadata: { factId: input.factId ?? null, documentId: input.documentId ?? null },
    });
    return ok(verification);
  });
}

/** Every issuer confirmation recorded against a document, newest first (Document Vault page). */
export async function listIssuerVerificationsForDocument(
  db: Db,
  documentId: string,
): Promise<IssuerVerification[]> {
  return db
    .select()
    .from(schema.issuerVerifications)
    .where(eq(schema.issuerVerifications.documentId, documentId))
    .orderBy(desc(schema.issuerVerifications.createdAt));
}

/**
 * Every issuer confirmation recorded against a fact, newest first: the
 * fact-scoped sibling of `listIssuerVerificationsForDocument` (e.g. the
 * agency console, which already resolves a requirement's selected evidence
 * through the authorized `listSelectedEvidenceForOrg` before calling this).
 */
export async function listIssuerVerificationsForFact(
  db: Db,
  factId: string,
): Promise<IssuerVerification[]> {
  return db
    .select()
    .from(schema.issuerVerifications)
    .where(eq(schema.issuerVerifications.factId, factId))
    .orderBy(desc(schema.issuerVerifications.createdAt));
}
