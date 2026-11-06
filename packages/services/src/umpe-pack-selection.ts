import { type Result, err, ok } from '@visastack/core';
import { STARTER_KEY_PREFIX, isStarterPackKey } from '@visastack/core';
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { AuthorizedApplicant } from './access';
import { first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type Mission, attachPackVersion } from './missions';
import { NOT_FOUND_WORDS, selectionRefusal } from './pack-selectable';
import type { PublishedPackVersion } from './packs';

/**
 * Which checklists a person may pick for a case, and the one checked way to attach it (VS-006).
 *
 * `attachPackVersion` stays the low-level primitive: it checks only that the case is the actor's
 * and that the version is published, so many fixtures attach test packs through it. The web app
 * never calls it, and inside the services only this file and Prepare Again (which applies the same
 * rule, `selectionRefusal`) may. A person (or a link made on a person's behalf) can attach a
 * checklist only when it is one of:
 * - a reviewed public checklist (no owning agency, marked authoritative), or
 * - a checklist owned by the agency the case belongs to.
 * A published checklist nobody has reviewed (no owner, not authoritative) is never selectable, and
 * another agency's private checklist is never visible or attachable. Cases already pinned to a
 * checklist are not touched by any of this: a pinned version is never re-filtered, so a case keeps
 * working with the exact version it holds even if that version is later withdrawn or overdue.
 */

/** One checklist a person may pick for a case. */
export interface SelectablePackVersion extends PublishedPackVersion {
  /** True for a reviewed public checklist, false for the agency's own or a starter checklist. */
  readonly authoritative: boolean;
  /** True for a starter checklist: the agency's reading of country files, not official. */
  readonly starter: boolean;
  /** True when it belongs to the agency this case belongs to. */
  readonly ownedByCaseAgency: boolean;
  /** When the published version is due its regular review (`pack_versions.next_review_date`). */
  readonly nextReviewDate: Date | null;
  /** True when that date has passed. A warning, never a reason to hide it. */
  readonly reviewOverdue: boolean;
}

/**
 * The owner's gate proof for this action, and the case it names, or a refusal. A copied or
 * wrong-action proof, or one for someone who is not the record owner, is `forbidden`. A case that
 * does not exist or belongs to another traveller is the same `not_found` either way, so nothing is
 * revealed about cases outside the proof.
 */
async function ownedCase<A extends 'MANAGE' | 'VIEW_METADATA'>(
  access: AuthorizedApplicant<A>,
  action: A,
  missionId: string,
): Promise<Result<Mission, ServiceError>> {
  if (!AuthorizedApplicant.isGenuine(access, action) || access.actor.kind !== 'applicant_owner') {
    return err(serviceError('forbidden', 'only the record owner can choose its checklist'));
  }
  const mission = first(
    await access.tx
      .select()
      .from(schema.missions)
      .where(eq(schema.missions.id, missionId))
      .limit(1),
  );
  if (!mission || mission.applicantId !== access.applicant.id) {
    return err(serviceError('not_found', 'case not found'));
  }
  return ok(mission);
}

/** Whether a date has passed, comparing instants. */
function isPast(date: Date | null, now: Date): boolean {
  return date !== null && date.getTime() < now.getTime();
}

/**
 * The checklists a person may pick for this case, in name order.
 *
 * `fitting` narrows the reviewed public ones: pass the checklists that fit the case's destination
 * and purpose (`listFittingPublicPacks`) once the case names them, so the picker never offers a
 * checklist for another route. Omit it for a case with no destination or purpose to narrow by. An
 * empty `fitting` list means no reviewed public checklist is offered, which is the honest answer
 * when none covers the route; the agency's own checklists are still listed.
 */
export async function listSelectablePackVersions(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
  input: {
    readonly missionId: string;
    readonly fitting?: readonly { readonly packVersionId: string }[];
    readonly now?: Date;
  },
): Promise<Result<SelectablePackVersion[], ServiceError>> {
  const mission = await ownedCase(access, 'VIEW_METADATA', input.missionId);
  if (!mission.ok) return mission;
  const db = access.tx;
  const caseAgencyId = mission.value.ownerOrganizationId;
  const now = input.now ?? new Date();

  const reviewedPublic = and(
    isNull(schema.packs.ownerOrganizationId),
    eq(schema.packs.authoritative, true),
  );
  // A starter checklist is public and not authoritative. It is listed only when it fits the case's
  // route (`fitting` names it), never in the open, so the picker never offers every country.
  const starterPublic = and(
    isNull(schema.packs.ownerOrganizationId),
    eq(schema.packs.authoritative, false),
    like(schema.packs.key, `${STARTER_KEY_PREFIX}%`),
  );
  const rows = await db
    .select({
      packVersionId: schema.packVersions.id,
      packKey: schema.packs.key,
      packName: schema.packs.name,
      version: schema.packVersions.version,
      authoritative: schema.packs.authoritative,
      ownerOrganizationId: schema.packs.ownerOrganizationId,
      nextReviewDate: schema.packVersions.nextReviewDate,
    })
    .from(schema.packVersions)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(
      and(
        eq(schema.packVersions.status, 'PUBLISHED'),
        caseAgencyId
          ? or(reviewedPublic, starterPublic, eq(schema.packs.ownerOrganizationId, caseAgencyId))
          : or(reviewedPublic, starterPublic),
      ),
    );

  const fittingIds = input.fitting ? new Set(input.fitting.map((f) => f.packVersionId)) : null;
  const allowed = rows.filter((row) => {
    if (row.ownerOrganizationId !== null) return true;
    // A starter checklist needs a route to fit; without one nothing starter is offered.
    if (isStarterPackKey(row.packKey)) {
      return fittingIds?.has(row.packVersionId) === true;
    }
    return fittingIds === null || fittingIds.has(row.packVersionId);
  });
  if (allowed.length === 0) return ok([]);

  const counts = new Map<string, number>();
  const requirementRows = await db
    .select({ packVersionId: schema.packRequirements.packVersionId })
    .from(schema.packRequirements)
    .where(
      inArray(
        schema.packRequirements.packVersionId,
        allowed.map((row) => row.packVersionId),
      ),
    );
  for (const row of requirementRows) {
    counts.set(row.packVersionId, (counts.get(row.packVersionId) ?? 0) + 1);
  }

  return ok(
    allowed
      .map(
        (row): SelectablePackVersion => ({
          packVersionId: row.packVersionId,
          packKey: row.packKey,
          packName: row.packName,
          version: row.version,
          requirementCount: counts.get(row.packVersionId) ?? 0,
          authoritative: row.authoritative,
          starter: isStarterPackKey(row.packKey),
          ownedByCaseAgency: row.ownerOrganizationId !== null,
          nextReviewDate: row.nextReviewDate,
          reviewOverdue: isPast(row.nextReviewDate, now),
        }),
      )
      .sort((a, b) => a.packName.localeCompare(b.packName, 'en') || b.version - a.version),
  );
}

/**
 * Attach a checklist to a case only if it is one the person may pick (see the top of this file).
 *
 * The version's row is locked for sharing while the check and the attach run in one transaction,
 * so a checklist cannot be withdrawn between the check and the attach. Refusals:
 * - owned by an agency other than the case's: `not_found`, the same answer as a version that does
 *   not exist and given before anything else (even for a draft), so another agency's private
 *   checklist is not revealed;
 * - not published (draft, superseded or withdrawn): `invalid`;
 * - published but unreviewed (no owner, not authoritative): `invalid`.
 * The caller passes the owner's gate proof (MANAGE) and the case must be that record's; a proof
 * for another traveller's case is the same `not_found` as a missing case.
 */
export async function attachSelectedPackVersion(
  access: AuthorizedApplicant<'MANAGE'>,
  input: {
    readonly missionId: string;
    readonly packVersionId: string;
  },
): Promise<Result<Mission, ServiceError>> {
  const owned = await ownedCase(access, 'MANAGE', input.missionId);
  if (!owned.ok) return owned;
  return access.tx.transaction(async (tx) => {
    const target = first(
      await tx
        .select({
          status: schema.packVersions.status,
          authoritative: schema.packs.authoritative,
          ownerOrganizationId: schema.packs.ownerOrganizationId,
          packKey: schema.packs.key,
        })
        .from(schema.packVersions)
        .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
        .where(eq(schema.packVersions.id, input.packVersionId))
        .limit(1)
        .for('share'),
    );
    if (!target) return err(serviceError('not_found', NOT_FOUND_WORDS));
    const refusal = selectionRefusal(target, owned.value.ownerOrganizationId);
    if (refusal) return err(refusal);
    return attachPackVersion(tx, {
      actorAccountId: access.applicant.ownerAccountId,
      missionId: input.missionId,
      packVersionId: input.packVersionId,
    });
  });
}

/** What a person should be told about the checklist a case is pinned to, if anything. */
export type PinnedPackNotice =
  | { readonly kind: 'WITHDRAWN'; readonly since: Date | null }
  | { readonly kind: 'REVIEW_OVERDUE'; readonly since: Date }
  | { readonly kind: 'NOT_REVIEWED' }
  | { readonly kind: 'STARTER' };

/**
 * A plain notice for the checklist a case holds. It never removes or replaces the checklist: a case
 * keeps the exact version it was pinned to. A withdrawn version outranks everything else; a
 * review date that has passed is a warning, not a block; a published public checklist nobody
 * reviewed says so. Only a published version can be overdue, since only it is still in use.
 */
export function pinnedPackNotice(
  version: {
    readonly status: string;
    readonly withdrawnAt: Date | null;
    readonly nextReviewDate: Date | null;
  },
  pack: {
    readonly authoritative: boolean;
    readonly ownerOrganizationId: string | null;
    /** The pack's key; a starter checklist is known by it. */
    readonly key?: string | null;
  },
  now: Date = new Date(),
): PinnedPackNotice | null {
  if (version.status === 'WITHDRAWN') return { kind: 'WITHDRAWN', since: version.withdrawnAt };
  if (pack.ownerOrganizationId === null && !pack.authoritative) {
    return pack.key != null && isStarterPackKey(pack.key)
      ? { kind: 'STARTER' }
      : { kind: 'NOT_REVIEWED' };
  }
  if (
    version.status === 'PUBLISHED' &&
    version.nextReviewDate &&
    isPast(version.nextReviewDate, now)
  ) {
    return { kind: 'REVIEW_OVERDUE', since: version.nextReviewDate };
  }
  return null;
}
