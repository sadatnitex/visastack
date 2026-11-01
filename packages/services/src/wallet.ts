import type { AccountId, AgencyId, ApplicantId, DocumentId, Result } from '@visastack/core';
import { err, ok } from '@visastack/core';
import { authorize } from '@visastack/policy';
import { and, eq, inArray } from 'drizzle-orm';
import { accountPrincipal } from './access/principal';
import { requireAccess } from './access/require-access';
import { getApplicant } from './applicants';
import { type Db, first, schema } from './db';
import type { Document } from './documents';
import { type ServiceError, serviceError } from './errors';
import { presentDocumentCondition } from './lifecycle/foundation/conditions';
import { lifecycleTablesPresent } from './lifecycle/foundation/presence';
import { applyReplacement } from './lifecycle/replace/replace';
import { documentCategory, loadGrantsForPolicy } from './sharing';

/**
 * The Document Wallet (EVI-04): "show current, expiring, expired and
 * superseded documents; where each version is used; and who has access."
 * Read-only view plus the one write action that actually changes wallet
 * state, `supersedeDocument` ("passport renewal updates the wallet,
 * preserves the old passport and flags cases using it").
 */

export type DocumentLifecycleStatus = 'UNKNOWN' | 'CURRENT' | 'EXPIRING' | 'EXPIRED' | 'SUPERSEDED';

/**
 * The PRD gives no exact "expiring soon" window for this specific wallet
 * badge (unlike, say, SHR-01's exact 30/90-day grant durations). 30 days is
 * a provisional, clearly-documented default, kept as-is deliberately: NTF-01
 * (Part 5 §1) has since formalized the general mechanism - `expiry.ts`'s
 * `classifyExpiry`, a full 90/60/30/7/0 reminder ladder configurable by
 * document type - but this wallet badge stays this simpler, always-30-day,
 * four-state (`CURRENT`/`EXPIRING`/`EXPIRED`/`SUPERSEDED`) categorization on
 * purpose; upgrading it to the richer ladder is a UX choice for a future
 * pass, not a gap in NTF-01 itself. See `expiry.ts` and the applicant
 * "Expiry" tab for the authoritative, docType-aware classification.
 */
const EXPIRING_SOON_DAYS = 30;

export function documentLifecycleStatus(
  document: Pick<Document, 'expiresAt' | 'supersededByDocumentId'>,
  now: Date = new Date(),
): DocumentLifecycleStatus {
  if (document.supersededByDocumentId) return 'SUPERSEDED';
  if (!document.expiresAt) return 'UNKNOWN';
  if (document.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  const expiringThreshold = now.getTime() + EXPIRING_SOON_DAYS * 24 * 60 * 60 * 1000;
  if (document.expiresAt.getTime() <= expiringThreshold) return 'EXPIRING';
  return 'CURRENT';
}

export interface WalletMissionUsage {
  readonly missionId: string;
  readonly missionTitle: string;
}

export interface WalletAccessEntry {
  readonly kind: 'account' | 'organization';
  readonly label: string;
}

export interface WalletDocumentView {
  readonly document: Document;
  readonly status: DocumentLifecycleStatus;
  readonly usedInMissions: readonly WalletMissionUsage[];
  readonly accessibleTo: readonly WalletAccessEntry[];
}

/**
 * The owner's own view of their wallet. "An agency cannot browse unselected
 * wallet contents to find something useful" is satisfied structurally, not
 * by a check here: this function is owner-only, and no agency-facing
 * caller of it exists anywhere in `apps/web` (an agency's own visibility
 * into an applicant's documents flows entirely through the separate,
 * already-scoped `getRecipientWorkspace`/evidence-request paths).
 *
 * "Who has access" deliberately omits a mission-scoped grant unless it is
 * ALSO applicant-wide reaching: `authorize()` is evaluated here with no
 * specific mission in the resource (there is no single mission to check a
 * whole-wallet view against), and a grant genuinely scoped to one mission
 * has no unconditional access to report, only access within that one
 * mission's own context, which this whole-wallet view does not claim.
 */
export async function getWalletView(
  db: Db,
  input: { readonly actorAccountId: string; readonly applicantId: string },
): Promise<Result<readonly WalletDocumentView[], ServiceError>> {
  const applicant = await getApplicant(db, input.applicantId);
  if (!applicant) return err(serviceError('not_found', 'applicant not found'));
  if (applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'not authorized to view this wallet'));
  }

  // CAS-08: a contributor-submitted document whose contributor did not opt
  // into wallet reuse is walletVisible: false - it stays usable evidence
  // for the case it was submitted to (missions.ts's own docType matching
  // is untouched), but never appears in the applicant's own browsable
  // wallet. Every normal, owner-uploaded document defaults true and is
  // unaffected.
  // Archived documents stay in the wallet (the Documents page lists them under Archived); a
  // document in Recently Deleted or being removed never shows here.
  const lifecycle = await lifecycleTablesPresent(db);
  const documents = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.applicantId, input.applicantId),
        eq(schema.documents.walletVisible, true),
        lifecycle ? presentDocumentCondition() : undefined,
      ),
    );

  const usageRows = await db
    .select({
      documentId: schema.selectedEvidence.documentId,
      missionId: schema.missions.id,
      missionTitle: schema.missions.title,
    })
    .from(schema.selectedEvidence)
    .innerJoin(schema.missions, eq(schema.missions.id, schema.selectedEvidence.missionId))
    .where(eq(schema.missions.applicantId, input.applicantId));

  const policyGrants = await loadGrantsForPolicy(db, input.applicantId);
  const now = new Date();

  const orgIds = [
    ...new Set(
      policyGrants.flatMap((g) => (g.recipientOrganizationId ? [g.recipientOrganizationId] : [])),
    ),
  ];
  const accountIds = [
    ...new Set(policyGrants.flatMap((g) => (g.recipientAccountId ? [g.recipientAccountId] : []))),
  ];
  const orgLabels = new Map<string, string>();
  const orgActive = new Map<string, boolean>();
  if (orgIds.length > 0) {
    const rows = await db
      .select({
        id: schema.organizations.id,
        name: schema.organizations.name,
        status: schema.organizations.status,
      })
      .from(schema.organizations)
      .where(inArray(schema.organizations.id, orgIds));
    for (const r of rows) {
      orgLabels.set(r.id, r.name);
      orgActive.set(r.id, r.status === 'ACTIVE');
    }
  }
  const accountLabels = new Map<string, string>();
  if (accountIds.length > 0) {
    const rows = await db
      .select({ id: schema.accounts.id, email: schema.accounts.email })
      .from(schema.accounts)
      .where(inArray(schema.accounts.id, accountIds));
    for (const r of rows) accountLabels.set(r.id, r.email);
  }

  return ok(
    documents.map((doc) => {
      const usedInMissions = usageRows
        .filter((r) => r.documentId === doc.id)
        .map((r) => ({ missionId: r.missionId, missionTitle: r.missionTitle }));

      const category = documentCategory(doc.docType);
      const accessibleTo: WalletAccessEntry[] = [];
      for (const grant of policyGrants) {
        const decision = authorize({
          actor: grant.recipientOrganizationId
            ? {
                kind: 'organization_member',
                accountId: 'wallet-access-check' as AccountId,
                membership: {
                  organizationId: grant.recipientOrganizationId as AgencyId,
                  role: 'ADMIN',
                  active: true,
                  // SHR-02: a suspended/closed org must not show as "has
                  // access" here even while its grant row is still ACTIVE.
                  organizationActive: orgActive.get(grant.recipientOrganizationId) ?? false,
                },
              }
            : { kind: 'individual_recipient', accountId: grant.recipientAccountId as AccountId },
          action: 'PREVIEW',
          resource: {
            applicantId: input.applicantId as ApplicantId,
            documentId: doc.id as DocumentId,
            ...(category ? { category } : {}),
          },
          context: { now, purpose: grant.purpose, stepUpSatisfied: false, grants: [grant] },
        });
        if (!decision.allowed) continue;
        if (grant.recipientOrganizationId) {
          const label = orgLabels.get(grant.recipientOrganizationId);
          if (label) accessibleTo.push({ kind: 'organization', label });
        } else if (grant.recipientAccountId) {
          const label = accountLabels.get(grant.recipientAccountId);
          if (label) accessibleTo.push({ kind: 'account', label });
        }
      }

      return {
        document: doc,
        status: documentLifecycleStatus(doc, now),
        usedInMissions,
        accessibleTo,
      };
    }),
  );
}

/**
 * Passport renewal (EVI-04): links `oldDocumentId` forward to
 * `newDocumentId`, never mutating or deleting the old row (its bytes,
 * metadata, and every historical mission snapshot that already embedded it
 * stay exactly as they were). Every mission currently using the old
 * document as selected evidence gets a real, visible `missionTask`, the
 * "flags cases using it" this requires; both documents must belong to the
 * SAME applicant, and only that applicant's owner may call this.
 *
 * Kept with its old signature for older tests; it has no caller outside tests. After the owner
 * check it delegates to the shared replace logic (lifecycle/replace), which also refuses the same
 * document, a loop and a document that is not current. Every new caller uses `replaceDocument`,
 * which in addition refuses a newer document that is not usable yet or of another kind.
 */
export async function supersedeDocument(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly oldDocumentId: string;
    readonly newDocumentId: string;
  },
): Promise<Result<{ readonly flaggedMissionIds: readonly string[] }, ServiceError>> {
  const lifecycle = await lifecycleTablesPresent(db);
  const present = lifecycle ? presentDocumentCondition() : undefined;
  const oldDocument = first(
    await db
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, input.oldDocumentId), present)),
  );
  if (!oldDocument) return err(serviceError('not_found', 'document not found'));
  const newDocument = first(
    await db
      .select()
      .from(schema.documents)
      .where(and(eq(schema.documents.id, input.newDocumentId), present)),
  );
  if (!newDocument) return err(serviceError('not_found', 'replacement document not found'));
  if (oldDocument.applicantId !== newDocument.applicantId) {
    return err(serviceError('invalid', 'both documents must belong to the same applicant'));
  }
  const applicant = await getApplicant(db, oldDocument.applicantId);
  if (!applicant || applicant.ownerAccountId !== input.actorAccountId) {
    return err(serviceError('forbidden', 'only the applicant owner can supersede a document'));
  }
  const access = await requireAccess(
    db,
    accountPrincipal(input.actorAccountId),
    'MANAGE',
    { applicantId: oldDocument.applicantId },
    { purpose: 'self' },
  );
  if (!access.ok) return access;
  const replaced = await applyReplacement(
    access.value,
    { oldDocumentId: input.oldDocumentId, newDocumentId: input.newDocumentId },
    { legacy: true },
  );
  if (!replaced.ok) return replaced;
  return ok({ flaggedMissionIds: replaced.value.flaggedMissionIds });
}
