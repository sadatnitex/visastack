import { createHash } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, eq, lte, ne } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type RuleCondition, isValidRuleCondition } from './rule-conditions';

/**
 * Requirement Packs & Pack Studio (Build Spec §4.5; PRD §4; Commercial V1
 * RUL-01 to RUL-05).
 *
 * A pack is a composable, versioned requirement set. Requirements are authored
 * in a DRAFT version, each carrying a citation (nothing is required without a
 * grounded source). Approval freezes a deterministic manifest + checksum;
 * publishing makes the version immutable and usable by missions. The lifecycle
 * is DRAFT → APPROVED → PUBLISHED, and content can only change while DRAFT.
 * From PUBLISHED, a version reaches exactly one of two terminal states:
 * DEPRECATED (automatic -- a later version of the same pack published) or
 * WITHDRAWN (explicit, reasoned -- pulled for cause).
 *
 * None of these functions check authorization themselves -- like every other
 * function in this file, the caller (the Pack Studio admin Server Action)
 * gates on `hasPlatformPermission(..., 'PACK_MANAGE')` first.
 */

export type Pack = typeof schema.packs.$inferSelect;
export type PackVersion = typeof schema.packVersions.$inferSelect;
export type PackRequirement = typeof schema.packRequirements.$inferSelect;

const DEFAULT_REVIEW_INTERVAL_DAYS = 30;

export interface RequirementInput {
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly fieldKey?: string;
  readonly docType?: string;
  readonly citation: string;
  readonly optional?: boolean;
  readonly notes?: string;
  /** DOCUMENT-only (NTF-01, Part 5 §1): case-specific freshness rule, e.g. "must be dated within 90 days." */
  readonly maxAgeDays?: number;
  /** RUL-03 typed rule AST. Validated against the allowlisted operator shapes before it is ever stored. */
  readonly condition?: RuleCondition;
  readonly sourceUrl?: string;
  readonly sourceTitle?: string;
  readonly publisher?: string;
  readonly officialExtract?: string;
  readonly interpretation?: string;
  readonly sourceType?: string;
  readonly observedDate?: Date;
  readonly changeReason?: string;
}

/** Deterministic manifest for a set of requirements, plus its checksum. */
export function buildManifest(requirements: readonly PackRequirement[]): {
  manifest: { requirements: unknown[] };
  checksum: string;
} {
  // NTF-01's `maxAgeDays` is deliberately NOT included here: this manifest's
  // shape is checksummed and re-verified against every already-published
  // pack version's stored `checksum` (`VerifyChecksumForm`) - adding a key
  // would change `buildManifest`'s output for every EXISTING version too
  // (drizzle returns `null`, not `undefined`, for the new column, and
  // `JSON.stringify` does serialize an explicit `null`), silently breaking
  // verification for every pack approved before this column existed. The
  // staleness rule is still real and still enforced (`missions.ts`'s
  // `buildRequirementMapping`); it just isn't part of this content-integrity
  // checksum, the same way `notes` already isn't.
  const items = requirements
    .map((r) => ({
      kind: r.kind,
      fieldKey: r.fieldKey,
      docType: r.docType,
      citation: r.citation,
      optional: r.optional,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const manifest = { requirements: items };
  const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return { manifest, checksum };
}

/** A published, attachable pack version resolved with its pack identity. */
export interface PublishedPackVersion {
  readonly packVersionId: string;
  readonly packKey: string;
  readonly packName: string;
  readonly version: number;
  readonly requirementCount: number;
}

/**
 * Every PUBLISHED pack version, with its pack identity and requirement count —
 * the catalog a mission owner picks from when attaching a pack.
 */
export async function listPublishedPackVersions(db: Db): Promise<PublishedPackVersion[]> {
  const rows = await db
    .select({
      packVersionId: schema.packVersions.id,
      packKey: schema.packs.key,
      packName: schema.packs.name,
      version: schema.packVersions.version,
    })
    .from(schema.packVersions)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(eq(schema.packVersions.status, 'PUBLISHED'));

  return Promise.all(
    rows.map(async (row) => {
      const reqs = await db
        .select({ id: schema.packRequirements.id })
        .from(schema.packRequirements)
        .where(eq(schema.packRequirements.packVersionId, row.packVersionId));
      return { ...row, requirementCount: reqs.length };
    }),
  );
}

/** Create a pack (its first version is added separately). */
export async function createPack(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly key: string;
    readonly name: string;
    readonly description?: string;
    readonly ownerOrganizationId?: string;
    /** RUL-01 coverage model: which population/route this pack covers. */
    readonly jurisdiction?: string;
    readonly route?: string;
    readonly purpose?: string;
    readonly nationalityApplicability?: readonly string[];
    readonly residenceApplicability?: readonly string[];
    /** RUL-02: whether author/reviewer distinctness is enforced on this pack's versions. False for an agency's own custom checklist. */
    readonly authoritative?: boolean;
  },
): Promise<Result<Pack, ServiceError>> {
  if (input.key.trim().length === 0 || input.name.trim().length === 0) {
    return err(serviceError('invalid', 'pack key and name are required'));
  }
  return db.transaction(async (tx) => {
    const pack = required(
      first(
        await tx
          .insert(schema.packs)
          .values({
            key: input.key.trim(),
            name: input.name.trim(),
            description: input.description ?? null,
            ownerOrganizationId: input.ownerOrganizationId ?? null,
            jurisdiction: input.jurisdiction ?? null,
            route: input.route ?? null,
            purpose: input.purpose ?? null,
            nationalityApplicability: input.nationalityApplicability
              ? [...input.nationalityApplicability]
              : null,
            residenceApplicability: input.residenceApplicability
              ? [...input.residenceApplicability]
              : null,
            authoritative: input.authoritative ?? false,
          })
          .returning(),
      ),
      'pack',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_CREATED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack',
      resourceId: pack.id,
      metadata: { key: pack.key },
    });
    return ok(pack);
  });
}

/** Open a new DRAFT version of a pack. */
export async function addPackVersion(
  db: Db,
  input: { readonly actorAccountId: string; readonly packId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const pack = first(
    await db.select().from(schema.packs).where(eq(schema.packs.id, input.packId)).limit(1),
  );
  if (!pack) return err(serviceError('not_found', 'pack not found'));

  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ version: schema.packVersions.version })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.packId, input.packId));
    const nextVersion = existing.reduce((max, r) => Math.max(max, r.version), 0) + 1;

    const version = required(
      first(
        await tx
          .insert(schema.packVersions)
          .values({
            packId: input.packId,
            version: nextVersion,
            authoredByAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_OPENED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: version.id,
      metadata: { packId: input.packId, version: nextVersion },
    });
    return ok(version);
  });
}

async function loadVersion(db: Db, id: string): Promise<PackVersion | undefined> {
  return first(
    await db.select().from(schema.packVersions).where(eq(schema.packVersions.id, id)).limit(1),
  );
}

/** Add a cited requirement to a DRAFT pack version. */
export async function addRequirement(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string } & RequirementInput,
): Promise<Result<PackRequirement, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'DRAFT') {
    return err(serviceError('invalid', 'requirements can only change while the version is DRAFT'));
  }
  if (input.citation.trim().length === 0) {
    return err(serviceError('invalid', 'every requirement must carry a citation'));
  }
  if (input.kind === 'FIELD' && !input.fieldKey) {
    return err(serviceError('invalid', 'a FIELD requirement needs a fieldKey'));
  }
  if (input.kind === 'DOCUMENT' && !input.docType) {
    return err(serviceError('invalid', 'a DOCUMENT requirement needs a docType'));
  }
  if (input.maxAgeDays !== undefined) {
    if (input.kind !== 'DOCUMENT') {
      return err(serviceError('invalid', 'maxAgeDays only applies to a DOCUMENT requirement'));
    }
    if (!Number.isInteger(input.maxAgeDays) || input.maxAgeDays <= 0) {
      return err(serviceError('invalid', 'maxAgeDays must be a positive integer'));
    }
  }
  if (input.condition !== undefined && !isValidRuleCondition(input.condition)) {
    return err(serviceError('invalid', 'condition is not a recognized rule shape'));
  }

  return db.transaction(async (tx) => {
    const requirement = required(
      first(
        await tx
          .insert(schema.packRequirements)
          .values({
            packVersionId: input.packVersionId,
            kind: input.kind,
            fieldKey: input.fieldKey ?? null,
            docType: input.docType ?? null,
            citation: input.citation.trim(),
            optional: input.optional ?? false,
            notes: input.notes ?? null,
            maxAgeDays: input.maxAgeDays ?? null,
            condition: input.condition ?? null,
            sourceUrl: input.sourceUrl ?? null,
            sourceTitle: input.sourceTitle ?? null,
            publisher: input.publisher ?? null,
            officialExtract: input.officialExtract ?? null,
            interpretation: input.interpretation ?? null,
            sourceType: input.sourceType ?? null,
            observedDate: input.observedDate ?? null,
            changeReason: input.changeReason ?? null,
            authorAccountId: input.actorAccountId,
          })
          .returning(),
      ),
      'requirement',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_REQUIREMENT_ADDED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: input.packVersionId,
      metadata: {
        kind: input.kind,
        fieldKey: input.fieldKey ?? null,
        docType: input.docType ?? null,
        maxAgeDays: input.maxAgeDays ?? null,
        hasCondition: input.condition !== undefined,
      },
    });
    return ok(requirement);
  });
}

export async function listRequirements(db: Db, packVersionId: string): Promise<PackRequirement[]> {
  return db
    .select()
    .from(schema.packRequirements)
    .where(eq(schema.packRequirements.packVersionId, packVersionId));
}

/** Every pack (Pack Studio overview), newest first. */
export async function listPacks(db: Db): Promise<Pack[]> {
  const rows = await db.select().from(schema.packs);
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** Load one pack by id. */
export async function getPack(db: Db, packId: string): Promise<Pack | undefined> {
  return first(await db.select().from(schema.packs).where(eq(schema.packs.id, packId)).limit(1));
}

/** Versions of a pack, highest version first. */
export async function listPackVersions(db: Db, packId: string): Promise<PackVersion[]> {
  const rows = await db
    .select()
    .from(schema.packVersions)
    .where(eq(schema.packVersions.packId, packId));
  return [...rows].sort((a, b) => b.version - a.version);
}

/**
 * Approve a DRAFT version (admin/reviewer action). Freezes the manifest +
 * checksum; the version becomes immutable content.
 *
 * RUL-02 "author and reviewer must be distinct" is enforced here, for an
 * `authoritative` pack only: the account approving (the reviewer) must
 * differ from `authoredByAccountId` (whoever opened this DRAFT version). An
 * agency's own non-authoritative custom pack has no such restriction.
 *
 * RUL-05 "initial next-review <=30 days unless documented reason": defaults
 * `nextReviewDate` to 30 days out when omitted; a caller-supplied date
 * further out requires a non-empty `reviewIntervalReason`.
 */
export async function approvePackVersion(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly packVersionId: string;
    readonly nextReviewDate?: Date;
    readonly reviewIntervalReason?: string;
    readonly effectiveDate?: Date;
  },
): Promise<Result<PackVersion, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'DRAFT') {
    return err(serviceError('invalid', 'only a DRAFT version can be approved'));
  }
  const requirements = await listRequirements(db, input.packVersionId);
  if (requirements.length === 0) {
    return err(serviceError('invalid', 'cannot approve a version with no requirements'));
  }

  const now = new Date();
  const defaultNextReview = new Date(
    now.getTime() + DEFAULT_REVIEW_INTERVAL_DAYS * 24 * 60 * 60 * 1000,
  );
  const nextReviewDate = input.nextReviewDate ?? defaultNextReview;
  if (
    nextReviewDate.getTime() > defaultNextReview.getTime() &&
    (input.reviewIntervalReason === undefined || input.reviewIntervalReason.trim().length === 0)
  ) {
    return err(
      serviceError(
        'invalid',
        `a next-review date more than ${DEFAULT_REVIEW_INTERVAL_DAYS} days out requires a documented reason`,
      ),
    );
  }

  const pack = await getPack(db, version.packId);
  if (pack?.authoritative && version.authoredByAccountId === input.actorAccountId) {
    return err(
      serviceError(
        'forbidden',
        'this pack requires the reviewer to be different from the version author',
      ),
    );
  }

  const { manifest, checksum } = buildManifest(requirements);

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.packVersions)
          .set({
            status: 'APPROVED',
            manifest,
            checksum,
            approvedByAccountId: input.actorAccountId,
            approvedAt: now,
            nextReviewDate,
            reviewIntervalReason: input.reviewIntervalReason ?? null,
            effectiveDate: input.effectiveDate ?? null,
            updatedAt: now,
          })
          .where(eq(schema.packVersions.id, input.packVersionId))
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_APPROVED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
      metadata: { checksum, nextReviewDate: nextReviewDate.toISOString() },
    });
    return ok(updated);
  });
}

/**
 * Publish an APPROVED version, making it usable by missions. Any other
 * still-PUBLISHED version of the SAME pack is automatically superseded
 * (DEPRECATED, `supersededAt` set) in the same transaction -- mirroring
 * `activateSubscription`'s auto-ending of a prior subscription -- so at most
 * one version of a pack is ever current at a time. Content and any mission
 * already bound to the superseded version's exact `packVersionId` are
 * untouched; only its own `status` changes.
 */
export async function publishPackVersion(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'APPROVED') {
    return err(serviceError('invalid', 'only an APPROVED version can be published'));
  }
  return db.transaction(async (tx) => {
    const now = new Date();
    const updated = required(
      first(
        await tx
          .update(schema.packVersions)
          .set({ status: 'PUBLISHED', publishedAt: now, updatedAt: now })
          .where(eq(schema.packVersions.id, input.packVersionId))
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_PUBLISHED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
    });

    const superseded = await tx
      .update(schema.packVersions)
      .set({ status: 'DEPRECATED', supersededAt: now, updatedAt: now })
      .where(
        and(
          eq(schema.packVersions.packId, version.packId),
          eq(schema.packVersions.status, 'PUBLISHED'),
          ne(schema.packVersions.id, updated.id),
        ),
      )
      .returning({ id: schema.packVersions.id });
    for (const row of superseded) {
      await appendAuditEvent(tx, {
        eventType: 'PACK_VERSION_SUPERSEDED',
        actorAccountId: input.actorAccountId,
        action: 'MANAGE',
        method: 'SYSTEM',
        result: 'ALLOWED',
        resourceType: 'pack_version',
        resourceId: row.id,
        metadata: { supersededByPackVersionId: updated.id },
      });
    }

    return ok(updated);
  });
}

/**
 * Withdraw a PUBLISHED version for cause (RUL-05: source turned out wrong,
 * unsafe, or inaccessible) -- always explicit and reasoned, unlike the
 * automatic DEPRECATED transition above. A version still in DRAFT/APPROVED
 * was never live; discard or correct it with a new version instead.
 */
export async function withdrawPackVersion(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly packVersionId: string;
    readonly reason: string;
  },
): Promise<Result<PackVersion, ServiceError>> {
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'PUBLISHED') {
    return err(serviceError('invalid', 'only a PUBLISHED version can be withdrawn'));
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    const updated = required(
      first(
        await tx
          .update(schema.packVersions)
          .set({
            status: 'WITHDRAWN',
            withdrawnAt: now,
            withdrawnByAccountId: input.actorAccountId,
            withdrawnReason: reason,
            updatedAt: now,
          })
          .where(eq(schema.packVersions.id, input.packVersionId))
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_WITHDRAWN',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
      reason,
    });
    return ok(updated);
  });
}

/** Mark one requirement's source as unreachable on re-check (RUL-05). Cleared by `clearRequirementSourceInaccessible` once a later re-check succeeds. */
export async function markRequirementSourceInaccessible(
  db: Db,
  input: { readonly actorAccountId: string; readonly requirementId: string },
): Promise<Result<PackRequirement, ServiceError>> {
  return setRequirementSourceInaccessible(db, input, new Date());
}

export async function clearRequirementSourceInaccessible(
  db: Db,
  input: { readonly actorAccountId: string; readonly requirementId: string },
): Promise<Result<PackRequirement, ServiceError>> {
  return setRequirementSourceInaccessible(db, input, null);
}

async function setRequirementSourceInaccessible(
  db: Db,
  input: { readonly actorAccountId: string; readonly requirementId: string },
  sourceInaccessibleAt: Date | null,
): Promise<Result<PackRequirement, ServiceError>> {
  const requirement = first(
    await db
      .select()
      .from(schema.packRequirements)
      .where(eq(schema.packRequirements.id, input.requirementId))
      .limit(1),
  );
  if (!requirement) return err(serviceError('not_found', 'requirement not found'));

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.packRequirements)
          .set({ sourceInaccessibleAt })
          .where(eq(schema.packRequirements.id, input.requirementId))
          .returning(),
      ),
      'requirement',
    );
    await appendAuditEvent(tx, {
      eventType:
        sourceInaccessibleAt === null
          ? 'PACK_REQUIREMENT_SOURCE_RESTORED'
          : 'PACK_REQUIREMENT_SOURCE_INACCESSIBLE',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_requirement',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

/** Verify a version's stored checksum matches its current requirements. */
export async function verifyPackChecksum(db: Db, packVersionId: string): Promise<boolean> {
  const version = await loadVersion(db, packVersionId);
  if (!version || !version.checksum) return false;
  const { checksum } = buildManifest(await listRequirements(db, packVersionId));
  return checksum === version.checksum;
}

export interface PackVersionDueForReview {
  readonly packVersionId: string;
  readonly packId: string;
  readonly packKey: string;
  readonly packName: string;
  readonly version: number;
  readonly nextReviewDate: Date;
}

/**
 * PUBLISHED versions whose next-review date has passed (RUL-05 "scheduled
 * review queue"), most overdue first. `lte` against a nullable column
 * naturally excludes a null `nextReviewDate` (SQL: `NULL <= x` is never
 * true), so no separate not-null filter is needed; the `.filter` below only
 * narrows the TypeScript type to match what the query already guarantees.
 */
export async function listPackVersionsDueForReview(
  db: Db,
  now: Date = new Date(),
): Promise<PackVersionDueForReview[]> {
  const rows = await db
    .select({
      packVersionId: schema.packVersions.id,
      packId: schema.packs.id,
      packKey: schema.packs.key,
      packName: schema.packs.name,
      version: schema.packVersions.version,
      nextReviewDate: schema.packVersions.nextReviewDate,
    })
    .from(schema.packVersions)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(
      and(
        eq(schema.packVersions.status, 'PUBLISHED'),
        lte(schema.packVersions.nextReviewDate, now),
      ),
    );
  return rows
    .filter((r): r is typeof r & { nextReviewDate: Date } => r.nextReviewDate !== null)
    .sort((a, b) => a.nextReviewDate.getTime() - b.nextReviewDate.getTime());
}

/**
 * A requirement's identity across versions: `addRequirement` always inserts
 * a fresh row (a new DRAFT version never copies a prior version's rows
 * forward), so no two versions ever share a requirement row id, even for a
 * requirement that is otherwise completely unchanged. `kind` + the relevant
 * identifier (`fieldKey` for FIELD, `docType` for DOCUMENT) is what
 * `buildRequirementMapping` (missions.ts) already keys readiness lookups
 * on -- the same natural identity, reused here for a diff instead of a
 * database id.
 */
function requirementNaturalKey(req: PackRequirement): string {
  return `${req.kind}:${req.kind === 'FIELD' ? (req.fieldKey ?? '') : (req.docType ?? '')}`;
}

/** Authorable requirement fields compared directly by `===` for a diff (excludes `condition`/`observedDate`, compared separately below since neither is `===`-comparable). */
const DIFFABLE_SCALAR_FIELDS = [
  'citation',
  'optional',
  'maxAgeDays',
  'sourceUrl',
  'sourceTitle',
  'publisher',
  'officialExtract',
  'interpretation',
  'sourceType',
  'changeReason',
] as const satisfies readonly (keyof PackRequirement)[];

/** Every field name that differs between two requirements sharing the same natural key. Empty when they are equivalent. */
function changedRequirementFields(from: PackRequirement, to: PackRequirement): string[] {
  const changed: string[] = DIFFABLE_SCALAR_FIELDS.filter((field) => from[field] !== to[field]);
  if (JSON.stringify(from.condition) !== JSON.stringify(to.condition)) changed.push('condition');
  const fromObserved = from.observedDate?.getTime() ?? null;
  const toObserved = to.observedDate?.getTime() ?? null;
  if (fromObserved !== toObserved) changed.push('observedDate');
  return changed;
}

export interface RequirementDiffEntry {
  readonly key: string;
  readonly kind: 'FIELD' | 'DOCUMENT';
  readonly change: 'added' | 'removed' | 'changed' | 'unchanged';
  readonly from: PackRequirement | null;
  readonly to: PackRequirement | null;
  /** Which authorable fields differ. Always empty for 'added'/'removed'/'unchanged'. */
  readonly changedFields: readonly string[];
}

export interface PackVersionDiff {
  readonly fromVersion: PackVersion;
  readonly toVersion: PackVersion;
  readonly entries: readonly RequirementDiffEntry[];
}

/**
 * Structural diff between two versions of the SAME pack's requirement sets
 * (RUL-05 "diff between versions"). Requirements are matched by their
 * natural identity (`requirementNaturalKey`), not by row id -- see that
 * function's own comment for why a row-id match would never work here.
 * Entries are sorted by key for a stable, deterministic ordering.
 */
export async function diffPackVersions(
  db: Db,
  fromVersionId: string,
  toVersionId: string,
): Promise<Result<PackVersionDiff, ServiceError>> {
  const [fromVersion, toVersion] = await Promise.all([
    loadVersion(db, fromVersionId),
    loadVersion(db, toVersionId),
  ]);
  if (!fromVersion) return err(serviceError('not_found', 'from version not found'));
  if (!toVersion) return err(serviceError('not_found', 'to version not found'));
  if (fromVersion.packId !== toVersion.packId) {
    return err(serviceError('invalid', 'both versions must belong to the same pack'));
  }

  const [fromReqs, toReqs] = await Promise.all([
    listRequirements(db, fromVersionId),
    listRequirements(db, toVersionId),
  ]);
  const fromByKey = new Map(fromReqs.map((r) => [requirementNaturalKey(r), r]));
  const toByKey = new Map(toReqs.map((r) => [requirementNaturalKey(r), r]));
  const keys = [...new Set([...fromByKey.keys(), ...toByKey.keys()])].sort();

  const entries: RequirementDiffEntry[] = keys.map((key) => {
    const kind = key.startsWith('FIELD:') ? 'FIELD' : 'DOCUMENT';
    const from = fromByKey.get(key) ?? null;
    const to = toByKey.get(key) ?? null;
    if (!from) return { key, kind, change: 'added', from: null, to, changedFields: [] };
    if (!to) return { key, kind, change: 'removed', from, to: null, changedFields: [] };
    const changedFields = changedRequirementFields(from, to);
    return {
      key,
      kind,
      change: changedFields.length > 0 ? 'changed' : 'unchanged',
      from,
      to,
      changedFields,
    };
  });

  return ok({ fromVersion, toVersion, entries });
}
