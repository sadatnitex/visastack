import { asc, eq, sql } from 'drizzle-orm';
import { type Db, schema } from './db';
import { resolveEntitlements } from './entitlements';

/** One traveller profile the account owns, and the evidence bytes it holds. */
export interface TravellerProfileStorage {
  readonly applicantId: string;
  readonly displayName: string;
  readonly usedBytes: number;
}

export interface TravellerPlanSummary {
  /** The plan every traveller is on (Traveller Free), or null when no plan row exists. */
  readonly plan: { readonly key: string; readonly name: string } | null;
  /** Evidence bytes across every profile the account owns (the account storage limit counts these). */
  readonly usedBytes: number;
  /** Each owned profile with its own bytes (each profile has its own storage limit), oldest first. */
  readonly profiles: readonly TravellerProfileStorage[];
}

/**
 * The signed-in traveller's own plan and storage, for Plan & Usage. Scoped to the actor: it reads
 * only the profiles that account owns, never anyone else's. Every traveller is on the traveller
 * plan (no traveller subscriptions yet); its AI rules are read with `getAiUsageToday`, and its
 * capacity limits are not enforced on travellers, so none are returned. The bytes use the same
 * definition as the upload limits (`getAccountEvidenceBytes`, `getApplicantEvidenceBytes`): every
 * stored version of every document.
 */
export async function getTravellerPlanSummary(
  db: Db,
  input: { readonly actorAccountId: string; readonly now?: Date },
): Promise<TravellerPlanSummary> {
  const [entitlements, rows] = await Promise.all([
    resolveEntitlements(db, { accountId: input.actorAccountId }, input.now ?? new Date()),
    db
      .select({
        applicantId: schema.applicants.id,
        displayName: schema.applicants.displayName,
        usedBytes: sql<string>`coalesce(sum(${schema.documentVersions.sizeBytes}), 0)`,
      })
      .from(schema.applicants)
      .leftJoin(schema.documents, eq(schema.documents.applicantId, schema.applicants.id))
      .leftJoin(
        schema.documentVersions,
        eq(schema.documentVersions.documentId, schema.documents.id),
      )
      .where(eq(schema.applicants.ownerAccountId, input.actorAccountId))
      .groupBy(schema.applicants.id)
      .orderBy(asc(schema.applicants.createdAt), asc(schema.applicants.id)),
  ]);
  const profiles = rows.map((row) => ({
    applicantId: row.applicantId,
    displayName: row.displayName,
    usedBytes: Number(row.usedBytes),
  }));
  const plan = entitlements.plan;
  return {
    plan: plan ? { key: plan.key, name: plan.name } : null,
    usedBytes: profiles.reduce((total, profile) => total + profile.usedBytes, 0),
    profiles,
  };
}
