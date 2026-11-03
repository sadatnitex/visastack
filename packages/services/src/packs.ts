import { createHash } from 'node:crypto';
import {
  REQUIREMENT_GROUP_MODES,
  type RequirementGroupMode,
  type RequirementNecessity,
  type RequirementProvenance,
  type Result,
  err,
  isRequirementNecessity,
  isRequirementProvenance,
  ok,
  optionalFlagFor,
  provenanceAllowsNecessity,
  requirementNecessity,
  requirementProvenance,
} from '@visastack/core';
import { type SQL, and, eq, getTableColumns, isNotNull, lte, ne, sql } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isHttpUrl } from './external-url';
import {
  type ManifestExtras,
  NO_MANIFEST_EXTRAS,
  type PackRouteConditions,
  type RequirementDetails,
  copyRouteConditionsForward,
  detailsPresent,
  loadManifestExtras,
  ruleDetailTablesPresent,
} from './pack-rule-details';
import { recordProductEvent } from './product-events';
import { type RuleCondition, isValidRuleCondition } from './rule-conditions';
import { queueRuleImpact } from './umpe-rule-impact-queue';

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
  /**
   * UMPE P1 (ADR 0026 D3): how necessary this requirement is. When given, the stored `optional`
   * flag is derived from it (`optionalFlagFor`) so older readers keep agreeing; a conflicting
   * `optional` is refused. CONDITIONAL needs a valid `condition`.
   */
  readonly necessity?: RequirementNecessity;
  /** Who asked for it. Omitted means an official requirement. */
  readonly provenance?: RequirementProvenance;
  /** Alternatives: requirements of one version sharing a group key are satisfied by any one of them. Needs `groupMode`. */
  readonly groupKey?: string;
  /** How the group is satisfied; ANY_OF is the only mode. Needs `groupKey`. */
  readonly groupMode?: RequirementGroupMode;
}

/**
 * Which serializer a manifest uses (ADR 0026 D1, D2). Format 1 is frozen forever: every version
 * approved before the UMPE rule upgrade, and every later version that uses no new rule field.
 * Format 2 carries the new rule fields.
 */
export type ManifestFormat = 1 | 2;

/** The stored format of a version: NULL is format 1; anything unknown is null (never verified). */
export function manifestFormatOf(version: {
  readonly manifestFormat: number | null;
}): ManifestFormat | null {
  if (version.manifestFormat === null || version.manifestFormat === 1) return 1;
  return version.manifestFormat === 2 ? 2 : null;
}

/**
 * Whether any requirement uses a rule field that only format 2 can record: a P1 column, a G2 rule
 * detail, or route conditions on the version.
 */
export function usesFormat2Fields(
  requirements: readonly PackRequirement[],
  extras: ManifestExtras = NO_MANIFEST_EXTRAS,
): boolean {
  return (
    extras.routeConditions !== null ||
    requirements.some(
      (r) =>
        r.necessity != null ||
        r.provenance != null ||
        r.groupKey != null ||
        r.groupMode != null ||
        detailsPresent(extras.details.get(r.id)),
    )
  );
}

/**
 * The format approval gives a set of requirements: format 2 only when a row uses a new rule
 * field, otherwise format 1, the exact bytes every older version was approved with (ADR 0026 D2).
 * The one rule both approval and the draft manifest download use.
 */
export function manifestFormatFor(
  requirements: readonly PackRequirement[],
  extras: ManifestExtras = NO_MANIFEST_EXTRAS,
): ManifestFormat {
  return usesFormat2Fields(requirements, extras) ? 2 : 1;
}

/** UTF-16 code unit order (JavaScript's default comparison), locale independent. */
function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * A JSON value with every object's keys in UTF-16 code unit order, so the format 2 checksum of
 * a condition never depends on how the database or a driver happened to order its keys.
 */
function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      codeUnitCompare(a, b),
    );
    return Object.fromEntries(entries.map(([key, inner]) => [key, canonicalJson(inner)]));
  }
  return value;
}

/**
 * UMPE G2 rule detail fields sealed into a format 2 item and compared by a diff, in this fixed
 * order (then the effective date). One list, so the checksum and the diff never disagree.
 */
const DIFFABLE_DETAIL_FIELDS = [
  'category',
  'acceptedForm',
  'translationNeeded',
  'originalNeeded',
  'statementPeriodMonths',
  'validMonthsAfterTravel',
] as const;

/** The G2 rule detail keys a format 2 item appends, in this fixed order, each only when set. */
function format2Details(details: RequirementDetails | undefined): Record<string, unknown> {
  if (!details) return {};
  const out: Record<string, unknown> = {};
  for (const key of DIFFABLE_DETAIL_FIELDS) if (details[key] !== null) out[key] = details[key];
  return details.effectiveSince === null
    ? out
    : { ...out, effectiveSince: details.effectiveSince.toISOString() };
}

/** One format 2 item: the five legacy keys first, then each new key only when it is set. */
function format2Item(r: PackRequirement, details?: RequirementDetails): Record<string, unknown> {
  return {
    kind: r.kind,
    fieldKey: r.fieldKey,
    docType: r.docType,
    citation: r.citation,
    optional: r.optional,
    ...(r.necessity != null ? { necessity: r.necessity } : {}),
    ...(r.provenance != null ? { provenance: r.provenance } : {}),
    ...(r.groupKey != null ? { groupKey: r.groupKey } : {}),
    ...(r.groupMode != null ? { groupMode: r.groupMode } : {}),
    ...(r.condition != null ? { condition: canonicalJson(r.condition) } : {}),
    ...format2Details(details),
  };
}

/**
 * Deterministic manifest for a set of requirements, plus its checksum.
 *
 * Format 1 (the default) is byte-identical forever (ADR 0026 D1; pinned by
 * umpe-no-loss-golden.test.ts). Format 2 is `{ formatVersion: 2, requirements }`, items sorted by
 * UTF-16 code unit order of each item's JSON (a verifier in another language must compare UTF-16
 * code units, not code points), and the new keys appear only when set (ADR 0026 D2).
 */
export function buildManifest(
  requirements: readonly PackRequirement[],
  format: ManifestFormat = 1,
  extras: ManifestExtras = NO_MANIFEST_EXTRAS,
): {
  manifest: { formatVersion?: 2; requirements: unknown[]; routeConditions?: unknown };
  checksum: string;
} {
  if (format === 2) {
    const keyed = requirements.map((r) => {
      const item = format2Item(r, extras.details.get(r.id));
      return { item, text: JSON.stringify(item) };
    });
    keyed.sort((a, b) => codeUnitCompare(a.text, b.text));
    // UMPE G2: route conditions appear only when the version declares them (ADR 0026 D2).
    const conditions = extras.routeConditions;
    const manifest = {
      formatVersion: 2 as const,
      requirements: keyed.map((k) => k.item),
      ...(conditions
        ? {
            routeConditions: {
              consularPosts: [...conditions.consularPosts],
              travelFrom: conditions.travelFrom,
              travelUntil: conditions.travelUntil,
            },
          }
        : {}),
    };
    const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    return { manifest, checksum };
  }
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
    .sort((a, b) => {
      const left = JSON.stringify(a);
      const right = JSON.stringify(b);
      // Format 1 order is ICU collation (frozen: ADR 0026 D1). Collation is
      // not a total order: distinct strings can compare equal (NFC vs NFD,
      // zero-width characters), which left their order to whatever order the
      // database returned rows in. The UTF-16 tie-break only orders pairs the
      // collation called equal, so every manifest without such a tie keeps
      // its exact bytes and checksum.
      const collated = left.localeCompare(right);
      if (collated !== 0) return collated;
      return left < right ? -1 : left > right ? 1 : 0;
    });
  const manifest = { requirements: items };
  const checksum = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
  return { manifest, checksum };
}

/**
 * Migration 0116 (UMPE P1) adds four columns to `pack_requirements` and one to `pack_versions`.
 * The code deploys before the migration runs, and a plain `select()` (or any insert, which names
 * every column) would fail until then. So reads ask once whether the columns exist and, until
 * they do, select the original columns and report the new ones as empty, which is exactly what
 * every row holds. Pack Studio changes wait for the migration (`packStudioWaiting`). Only a
 * positive answer is remembered: columns are never removed, and a missing answer is asked again.
 */
const PACK_RULE_COLUMN_COUNT = 5;
/** How long a "not yet" answer is trusted before asking again, so pages do not ask every read. */
const MISSING_ANSWER_TTL_MS = 60_000;
let packRuleColumnsPresent = false;
let packRuleColumnsMissingSince: number | null = null;

export async function packRuleColumnsReady(db: Db): Promise<boolean> {
  if (packRuleColumnsPresent) return true;
  if (
    packRuleColumnsMissingSince !== null &&
    Date.now() - packRuleColumnsMissingSince < MISSING_ANSWER_TTL_MS
  ) {
    return false;
  }
  const result = await db.execute(sql`
    select count(*)::int as present from information_schema.columns
    where table_schema = current_schema()
      and ((table_name = 'pack_requirements'
            and column_name in ('necessity', 'provenance', 'group_key', 'group_mode'))
        or (table_name = 'pack_versions' and column_name = 'manifest_format'))`);
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows;
  const present = Number((rows?.[0] as { present?: unknown } | undefined)?.present ?? 0);
  packRuleColumnsPresent = present === PACK_RULE_COLUMN_COUNT;
  packRuleColumnsMissingSince = packRuleColumnsPresent ? null : Date.now();
  return packRuleColumnsPresent;
}

/** Tests that drop the 0116 columns from their own database forget the remembered answer. */
export function resetPackRuleColumnsCheckForTests(): void {
  packRuleColumnsPresent = false;
  packRuleColumnsMissingSince = null;
}

function omitKeys<T extends Record<string, unknown>, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const omitted = new Set<PropertyKey>(keys);
  return Object.fromEntries(Object.entries(value).filter(([key]) => !omitted.has(key))) as Omit<
    T,
    K
  >;
}

// Built on first use, never while this module loads: modules that load packs.ts with a
// stand-in for @visastack/db (adapter and route tests) must not touch the schema at import.
function legacyRequirementColumns() {
  return omitKeys(getTableColumns(schema.packRequirements), [
    'necessity',
    'provenance',
    'groupKey',
    'groupMode',
  ]);
}
function legacyPackVersionColumns() {
  return omitKeys(getTableColumns(schema.packVersions), ['manifestFormat']);
}

export async function selectRequirementRows(
  db: Db,
  where: SQL | undefined,
): Promise<PackRequirement[]> {
  if (await packRuleColumnsReady(db)) {
    return db.select().from(schema.packRequirements).where(where);
  }
  const rows = await db
    .select(legacyRequirementColumns())
    .from(schema.packRequirements)
    .where(where);
  return rows.map((row) => ({
    ...row,
    necessity: null,
    provenance: null,
    groupKey: null,
    groupMode: null,
  }));
}

async function selectPackVersionRows(db: Db, where: SQL | undefined): Promise<PackVersion[]> {
  if (await packRuleColumnsReady(db)) {
    return db.select().from(schema.packVersions).where(where);
  }
  const rows = await db.select(legacyPackVersionColumns()).from(schema.packVersions).where(where);
  return rows.map((row) => ({ ...row, manifestFormat: null }));
}

const PACK_STUDIO_WAITING =
  'Pack Studio is waiting for a database update before packs can change. Try again after it runs.';

/** A refusal while migration 0116 has not run (every pack write names the new columns), else null. */
async function packStudioWaiting(db: Db): Promise<Result<never, ServiceError> | null> {
  return (await packRuleColumnsReady(db))
    ? null
    : err(serviceError('invalid', PACK_STUDIO_WAITING));
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
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
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
    // UMPE G2: who the checklist is for carries forward into the new draft.
    await copyRouteConditionsForward(tx, {
      actorAccountId: input.actorAccountId,
      packId: input.packId,
      toVersionId: version.id,
    });
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
  return first(await selectPackVersionRows(db, eq(schema.packVersions.id, id)));
}

/** The row just written, read back through the reader that works before migration 0116. */
async function reloadVersion(db: Db, id: string): Promise<PackVersion> {
  return required(await loadVersion(db, id), 'pack version');
}

async function reloadRequirement(db: Db, id: string): Promise<PackRequirement> {
  return required(
    first(await selectRequirementRows(db, eq(schema.packRequirements.id, id))),
    'requirement',
  );
}

const GROUP_KEY_MAX_LENGTH = 80;

interface AuthoredRuleFields {
  readonly optional: boolean;
  readonly necessity: RequirementNecessity | null;
  readonly provenance: RequirementProvenance | null;
  readonly groupKey: string | null;
  readonly groupMode: RequirementGroupMode | null;
}

/**
 * The UMPE P1 rule fields of one new requirement, checked (ADR 0026 D3). Necessity and
 * provenance come only from the shared lists. When necessity is given the stored `optional` flag
 * follows it, so older readers of the row keep agreeing; a contradicting `optional` is refused
 * rather than silently overwritten. Mandatory If It Applies needs the rule saying when; a plain
 * Mandatory item with such a rule is refused, because that is what Mandatory If It Applies means.
 * A group key and its mode come together.
 */
function authoredRuleFields(input: RequirementInput): Result<AuthoredRuleFields, string> {
  const necessity = input.necessity ?? null;
  if (necessity !== null && !isRequirementNecessity(necessity)) {
    return err('necessity is not one of the known words');
  }
  const provenance = input.provenance ?? null;
  if (provenance !== null && !isRequirementProvenance(provenance)) {
    return err('who asked for it is not one of the known sources');
  }
  let optional = input.optional ?? false;
  if (necessity !== null) {
    const implied = optionalFlagFor(necessity);
    if (input.optional !== undefined && input.optional !== implied) {
      return err('the optional flag does not match the necessity');
    }
    optional = implied;
    if (necessity === 'CONDITIONAL' && input.condition === undefined) {
      return err('Mandatory If It Applies needs a rule saying when it applies');
    }
    if (necessity === 'MANDATORY' && input.condition !== undefined) {
      return err('a requirement that applies only sometimes is Mandatory If It Applies');
    }
  }
  // UMPE G2 (S08): an observation from VisaStack cases is never a mandate, so it must say it is
  // Recommended or Optional (a legacy row with no necessity would read as Mandatory).
  if (
    provenance === 'FIELD_OBSERVATION' &&
    (necessity === null || !provenanceAllowsNecessity(provenance, necessity))
  ) {
    return err('an item observed in VisaStack cases can only be Recommended or Optional');
  }
  const groupKey = input.groupKey === undefined ? null : input.groupKey.trim();
  const groupMode = input.groupMode ?? null;
  if (groupKey === '') return err('a group of alternatives needs a name');
  if (groupKey !== null && groupKey.length > GROUP_KEY_MAX_LENGTH) {
    return err(`a group name can be at most ${GROUP_KEY_MAX_LENGTH} characters`);
  }
  if ((groupKey === null) !== (groupMode === null)) {
    return err('a group of alternatives needs both its name and how it is satisfied');
  }
  if (groupMode !== null && !(REQUIREMENT_GROUP_MODES as readonly string[]).includes(groupMode)) {
    return err('a group of alternatives can only be satisfied by any one of its items');
  }
  return ok({ optional, necessity, provenance, groupKey, groupMode });
}

/**
 * Why a requirement set may not be approved or published, or null (UMPE P1, R07). Every stored
 * condition must still be a recognised rule; a Mandatory If It Applies item must carry one; a
 * group of alternatives must have at least two items and one mode. Checked again at approval and
 * at publication, because a stored row can only be trusted as far as these checks go.
 */
function ruleSetProblem(requirements: readonly PackRequirement[]): string | null {
  for (const r of requirements) {
    if (r.condition != null && !isValidRuleCondition(r.condition)) {
      return 'a requirement has a rule for when it applies that is not in a recognised shape; fix it in a new draft version';
    }
    if (r.necessity === 'CONDITIONAL' && r.condition == null) {
      return 'a Mandatory If It Applies requirement has no rule saying when it applies';
    }
    if ((r.groupKey === null) !== (r.groupMode === null)) {
      return 'a group of alternatives is missing its name or how it is satisfied';
    }
    if (
      r.provenance === 'FIELD_OBSERVATION' &&
      (r.necessity === null || !provenanceAllowsNecessity(r.provenance, r.necessity))
    ) {
      return 'an item observed in VisaStack cases can only be Recommended or Optional';
    }
  }
  const groupSizes = new Map<string, number>();
  for (const r of requirements) {
    if (r.groupKey !== null) groupSizes.set(r.groupKey, (groupSizes.get(r.groupKey) ?? 0) + 1);
  }
  for (const [group, size] of groupSizes) {
    if (size < 2) return `the group of alternatives "${group}" needs at least two items`;
  }
  return null;
}

/** Add a cited requirement to a DRAFT pack version. */
export async function addRequirement(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string } & RequirementInput,
): Promise<Result<PackRequirement, ServiceError>> {
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  // UMPE G2: the FIELD_OBSERVATION word arrives with the same migration as the rule detail tables,
  // so until they exist such an item waits instead of failing in the database.
  if (input.provenance === 'FIELD_OBSERVATION' && !(await ruleDetailTablesPresent(db))) {
    return err(serviceError('invalid', PACK_STUDIO_WAITING));
  }
  return db.transaction(async (tx) => {
    const version = first(
      await tx
        .select()
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, input.packVersionId))
        .limit(1)
        .for('update'),
    );
    if (!version) return err(serviceError('not_found', 'pack version not found'));
    if (version.status !== 'DRAFT') {
      return err(
        serviceError('invalid', 'requirements can only change while the version is DRAFT'),
      );
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
    const rule = authoredRuleFields(input);
    if (!rule.ok) return err(serviceError('invalid', rule.error));
    if (
      input.sourceUrl !== undefined &&
      input.sourceUrl.trim() !== '' &&
      !isHttpUrl(input.sourceUrl)
    ) {
      return err(serviceError('invalid', 'sourceUrl must be an http or https URL'));
    }

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
            optional: rule.value.optional,
            necessity: rule.value.necessity,
            provenance: rule.value.provenance,
            groupKey: rule.value.groupKey,
            groupMode: rule.value.groupMode,
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
        necessity: rule.value.necessity,
        provenance: rule.value.provenance,
        groupKey: rule.value.groupKey,
      },
    });
    return ok(requirement);
  });
}

/** Record a human source review only while the version is still a draft. */
export async function recordRequirementSourceReview(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly requirementId: string;
    readonly sourceUrl: string;
    readonly sourceTitle: string;
    readonly publisher: string;
    readonly observedDate: Date;
  },
): Promise<Result<PackRequirement, ServiceError>> {
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  const now = new Date();
  if (
    !isHttpUrl(input.sourceUrl) ||
    input.sourceUrl.length > 2048 ||
    !input.sourceTitle.trim() ||
    input.sourceTitle.length > 240 ||
    !input.publisher.trim() ||
    input.publisher.length > 160 ||
    !Number.isFinite(input.observedDate.getTime()) ||
    input.observedDate > now
  ) {
    return err(
      serviceError('invalid', 'provide a source link, title, publisher and valid checked date'),
    );
  }
  return db.transaction(async (tx) => {
    const target = first(
      await tx
        .select({ requirement: schema.packRequirements, status: schema.packVersions.status })
        .from(schema.packRequirements)
        .innerJoin(
          schema.packVersions,
          eq(schema.packVersions.id, schema.packRequirements.packVersionId),
        )
        .where(eq(schema.packRequirements.id, input.requirementId))
        .limit(1)
        .for('update'),
    );
    if (!target) return err(serviceError('not_found', 'requirement not found'));
    if (target.status !== 'DRAFT')
      return err(
        serviceError(
          'invalid',
          'source records are frozen after approval; create a new draft version',
        ),
      );
    const updated = required(
      first(
        await tx
          .update(schema.packRequirements)
          .set({
            sourceUrl: input.sourceUrl.trim(),
            sourceTitle: input.sourceTitle.trim(),
            publisher: input.publisher.trim(),
            observedDate: input.observedDate,
            sourceInaccessibleAt: null,
          })
          .where(eq(schema.packRequirements.id, input.requirementId))
          .returning(),
      ),
      'requirement',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_REQUIREMENT_SOURCE_REVIEWED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.packVersionId,
      metadata: { requirementId: updated.id, observedDate: input.observedDate.toISOString() },
    });
    return ok(updated);
  });
}

export async function listRequirements(db: Db, packVersionId: string): Promise<PackRequirement[]> {
  return selectRequirementRows(db, eq(schema.packRequirements.packVersionId, packVersionId));
}

/**
 * The manifest format of one pack version (NULL is format 1), or null when the version is
 * missing or records a format this code does not know. Before migration 0116 every version is
 * format 1.
 */
export async function getManifestFormat(
  db: Db,
  packVersionId: string,
): Promise<ManifestFormat | null> {
  if (!(await packRuleColumnsReady(db))) {
    const exists = await db
      .select({ id: schema.packVersions.id })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, packVersionId))
      .limit(1);
    return exists.length > 0 ? 1 : null;
  }
  const version = first(
    await db
      .select({ manifestFormat: schema.packVersions.manifestFormat })
      .from(schema.packVersions)
      .where(eq(schema.packVersions.id, packVersionId))
      .limit(1),
  );
  return version ? manifestFormatOf(version) : null;
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

/** Load one pack version by id (case-readiness UI, §10: resolving a mission's attached version back to its pack for the authoritative/custom distinction). */
export async function getPackVersion(db: Db, id: string): Promise<PackVersion | undefined> {
  return loadVersion(db, id);
}

/** Versions of a pack, highest version first. */
export async function listPackVersions(db: Db, packId: string): Promise<PackVersion[]> {
  const rows = await selectPackVersionRows(db, eq(schema.packVersions.packId, packId));
  return [...rows].sort((a, b) => b.version - a.version);
}

// Source records preserve human verification, not an automated legal judgment.
function sourceRecordsComplete(requirements: readonly PackRequirement[], now: Date): boolean {
  return (
    requirements.length > 0 &&
    !requirements.some(
      (requirement) =>
        !requirement.sourceUrl ||
        !isHttpUrl(requirement.sourceUrl) ||
        !requirement.sourceTitle?.trim() ||
        !requirement.publisher?.trim() ||
        !requirement.citation.trim() ||
        !requirement.observedDate ||
        !Number.isFinite(requirement.observedDate.getTime()) ||
        requirement.observedDate.getTime() > now.getTime() ||
        requirement.sourceInaccessibleAt !== null,
    )
  );
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
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  return db.transaction(async (tx) => {
    const version = first(
      await tx
        .select()
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, input.packVersionId))
        .limit(1)
        .for('update'),
    );
    if (!version) return err(serviceError('not_found', 'pack version not found'));
    if (version.status !== 'DRAFT') {
      return err(serviceError('invalid', 'only a DRAFT version can be approved'));
    }
    const requirements = await listRequirements(tx, input.packVersionId);
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

    const pack = await getPack(tx, version.packId);
    if (pack?.authoritative && version.authoredByAccountId === input.actorAccountId) {
      return err(
        serviceError(
          'forbidden',
          'this pack requires the reviewer to be different from the version author',
        ),
      );
    }

    // Source metadata records human verification; it does not prove legal accuracy.
    // Custom checklists keep their existing manual approval path.
    if (pack?.authoritative) {
      const incomplete = !sourceRecordsComplete(requirements, now);
      if (incomplete) {
        return err(
          serviceError(
            'invalid',
            'authoritative requirements need accessible cited sources, publisher and a recorded verification date',
          ),
        );
      }
    }

    const problem = ruleSetProblem(requirements);
    if (problem) return err(serviceError('invalid', problem));

    const extras = await loadManifestExtras(
      tx,
      input.packVersionId,
      requirements.map((r) => r.id),
    );
    const manifestFormat = manifestFormatFor(requirements, extras);
    const { manifest, checksum } = buildManifest(requirements, manifestFormat, extras);

    const updated = required(
      first(
        await tx
          .update(schema.packVersions)
          .set({
            status: 'APPROVED',
            manifest,
            checksum,
            manifestFormat,
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
      metadata: { checksum, manifestFormat, nextReviewDate: nextReviewDate.toISOString() },
    });
    // OPS-04 source review: a reviewer signing off a version's sources.
    await recordProductEvent(tx, {
      eventType: 'SOURCE_REVIEWED',
      accountId: input.actorAccountId,
      dimension: 'VERSION_APPROVED',
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
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  return db.transaction(async (tx) => {
    const version = first(
      await tx
        .select()
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, input.packVersionId))
        .limit(1)
        .for('update'),
    );
    if (!version) return err(serviceError('not_found', 'pack version not found'));
    if (version.status !== 'APPROVED') {
      return err(serviceError('invalid', 'only an APPROVED version can be published'));
    }
    const pack = await getPack(tx, version.packId);
    const requirements = await listRequirements(tx, version.id);
    const problem = ruleSetProblem(requirements);
    if (problem) return err(serviceError('invalid', problem));
    if (pack?.authoritative) {
      const now = new Date();
      if (
        !version.approvedByAccountId ||
        !version.approvedAt ||
        version.approvedByAccountId === version.authoredByAccountId ||
        !version.nextReviewDate ||
        version.nextReviewDate <= now ||
        !sourceRecordsComplete(requirements, now)
      ) {
        return err(
          serviceError(
            'invalid',
            'official sources need a current, separate review before publication',
          ),
        );
      }
    }
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
    // UMPE P11: note that this version's impact on active cases needs assessing. No person data
    // is read or written here; a gated step flags the cases (see umpe-rule-impact-service.ts).
    await queueRuleImpact(tx, { packId: version.packId, packVersionId: updated.id });

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
    const updated = await reloadVersion(
      tx,
      required(
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
            .returning({ id: schema.packVersions.id }),
        ),
        'pack version',
      ).id,
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
    await selectRequirementRows(db, eq(schema.packRequirements.id, input.requirementId)),
  );
  if (!requirement) return err(serviceError('not_found', 'requirement not found'));

  return db.transaction(async (tx) => {
    const updated = await reloadRequirement(
      tx,
      required(
        first(
          await tx
            .update(schema.packRequirements)
            .set({ sourceInaccessibleAt })
            .where(eq(schema.packRequirements.id, input.requirementId))
            .returning({ id: schema.packRequirements.id }),
        ),
        'requirement',
      ).id,
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
    await recordProductEvent(tx, {
      eventType: 'SOURCE_REVIEWED',
      accountId: input.actorAccountId,
      dimension: sourceInaccessibleAt === null ? 'SOURCE_RESTORED' : 'SOURCE_UNREACHABLE',
    });
    return ok(updated);
  });
}

/**
 * Author Public Trust Lite content (RUL-06, directive §9) on a DRAFT
 * version -- the same "content only changes while DRAFT, then freezes"
 * discipline every other requirement field already follows. Partial-update
 * semantics matching `updateMissionCaseDetails`: an omitted field is left
 * untouched, a provided one (including an empty string) is set/cleared.
 * `officialFeeMinorUnits`/`officialFeeCurrency` are a single logical unit --
 * touching either requires both to end up set together or both cleared
 * together, never one without the other (mirrors `plans.priceMinorUnits`'s
 * own paired-nullability rule, enforced here rather than only by the DB
 * CHECK constraint so the caller gets a clear `invalid` result).
 */
export async function setPublicTrustContent(
  db: Db,
  input: {
    readonly actorAccountId: string;
    readonly packVersionId: string;
    readonly routeDescription?: string;
    readonly officialFeeMinorUnits?: number | null;
    readonly officialFeeCurrency?: string | null;
    readonly officialChannelName?: string;
    readonly officialChannelUrl?: string;
    readonly officialReportingUrl?: string;
  },
): Promise<Result<PackVersion, ServiceError>> {
  const waiting = await packStudioWaiting(db);
  if (waiting) return waiting;
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'DRAFT') {
    return err(
      serviceError('invalid', 'public trust content can only change while the version is DRAFT'),
    );
  }
  const feeTouched =
    input.officialFeeMinorUnits !== undefined || input.officialFeeCurrency !== undefined;
  if (feeTouched) {
    const amount = input.officialFeeMinorUnits;
    const currency = input.officialFeeCurrency;
    const bothCleared = amount == null && currency == null;
    if (!bothCleared) {
      if (amount == null || currency == null || currency.trim().length === 0) {
        return err(
          serviceError(
            'invalid',
            'official fee amount and currency must be set together, or both cleared',
          ),
        );
      }
      if (!Number.isInteger(amount) || amount < 0) {
        return err(
          serviceError('invalid', 'official fee must be a non-negative integer (minor units)'),
        );
      }
    }
  }
  for (const [label, url] of [
    ['official channel URL', input.officialChannelUrl],
    ['official reporting URL', input.officialReportingUrl],
  ] as const) {
    if (url !== undefined && url.trim() !== '' && !isHttpUrl(url)) {
      return err(serviceError('invalid', `${label} must be an http or https URL`));
    }
  }

  return db.transaction(async (tx) => {
    const updated = required(
      first(
        await tx
          .update(schema.packVersions)
          .set({
            ...(input.routeDescription !== undefined
              ? { routeDescription: input.routeDescription.trim() || null }
              : {}),
            ...(feeTouched
              ? {
                  officialFeeMinorUnits: input.officialFeeMinorUnits ?? null,
                  officialFeeCurrency: input.officialFeeCurrency?.trim() || null,
                }
              : {}),
            ...(input.officialChannelName !== undefined
              ? { officialChannelName: input.officialChannelName.trim() || null }
              : {}),
            ...(input.officialChannelUrl !== undefined
              ? { officialChannelUrl: input.officialChannelUrl.trim() || null }
              : {}),
            ...(input.officialReportingUrl !== undefined
              ? { officialReportingUrl: input.officialReportingUrl.trim() || null }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(schema.packVersions.id, input.packVersionId))
          .returning(),
      ),
      'pack version',
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_PUBLIC_TRUST_CONTENT_SET',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

/**
 * Expose a PUBLISHED, authoritative version's Public Trust Lite content on
 * the public route (RUL-06). Deliberately separate from `publishPackVersion`
 * (case-readiness usability): a version can be usable by missions without
 * ever appearing on the public trust surface, and exposure never carries
 * forward automatically when a newer version supersedes this one -- the new
 * version needs its own explicit opt-in, so a not-yet-reviewed publish never
 * silently goes live publicly (directive §9/§12 grounding discipline).
 * Restricted to an `authoritative` pack: showing an agency's own unreviewed
 * custom checklist as a public "trust" surface would itself be the
 * "unjustified endorsement" the directive forbids.
 */
export async function publishToPublicTrust(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (version.status !== 'PUBLISHED') {
    return err(
      serviceError('invalid', 'only a PUBLISHED version can be shown on the public trust surface'),
    );
  }
  if (!version.routeDescription || version.routeDescription.trim().length === 0) {
    return err(
      serviceError('invalid', 'a route description is required before publishing to public trust'),
    );
  }
  const pack = await getPack(db, version.packId);
  if (!pack?.authoritative) {
    return err(
      serviceError(
        'forbidden',
        'only an authoritative pack can be shown on the public trust surface',
      ),
    );
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    const updated = await reloadVersion(
      tx,
      required(
        first(
          await tx
            .update(schema.packVersions)
            .set({ publicTrustPublishedAt: now, updatedAt: now })
            .where(eq(schema.packVersions.id, input.packVersionId))
            .returning({ id: schema.packVersions.id }),
        ),
        'pack version',
      ).id,
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_PUBLIC_TRUST_PUBLISHED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

/** Remove a version from the public trust surface without changing its case-readiness usability. */
export async function unpublishFromPublicTrust(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));
  if (!version.publicTrustPublishedAt) {
    return err(
      serviceError('invalid', 'this version is not currently shown on the public trust surface'),
    );
  }

  return db.transaction(async (tx) => {
    const updated = await reloadVersion(
      tx,
      required(
        first(
          await tx
            .update(schema.packVersions)
            .set({ publicTrustPublishedAt: null, updatedAt: new Date() })
            .where(eq(schema.packVersions.id, input.packVersionId))
            .returning({ id: schema.packVersions.id }),
        ),
        'pack version',
      ).id,
    );
    await appendAuditEvent(tx, {
      eventType: 'PACK_VERSION_PUBLIC_TRUST_UNPUBLISHED',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
    });
    return ok(updated);
  });
}

/** Mark a PUBLISHED version's official fee as no longer current, without requiring a new DRAFT version (RUL-06, mirrors `markRequirementSourceInaccessible`). The public read (`getPublicTrustRoute`) removes the amount and falls back to the official source while this is set. */
export async function markOfficialFeeStale(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  return setOfficialFeeStale(db, input, new Date());
}

/** Clear a fee staleness mark once a re-check confirms the amount is current again. */
export async function clearOfficialFeeStale(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
): Promise<Result<PackVersion, ServiceError>> {
  return setOfficialFeeStale(db, input, null);
}

async function setOfficialFeeStale(
  db: Db,
  input: { readonly actorAccountId: string; readonly packVersionId: string },
  officialFeeStaleAt: Date | null,
): Promise<Result<PackVersion, ServiceError>> {
  const version = await loadVersion(db, input.packVersionId);
  if (!version) return err(serviceError('not_found', 'pack version not found'));

  return db.transaction(async (tx) => {
    const updated = await reloadVersion(
      tx,
      required(
        first(
          await tx
            .update(schema.packVersions)
            .set({ officialFeeStaleAt, updatedAt: new Date() })
            .where(eq(schema.packVersions.id, input.packVersionId))
            .returning({ id: schema.packVersions.id }),
        ),
        'pack version',
      ).id,
    );
    await appendAuditEvent(tx, {
      eventType:
        officialFeeStaleAt === null
          ? 'PACK_VERSION_OFFICIAL_FEE_RESTORED'
          : 'PACK_VERSION_OFFICIAL_FEE_STALE',
      actorAccountId: input.actorAccountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: updated.id,
    });
    await recordProductEvent(tx, {
      eventType: 'SOURCE_REVIEWED',
      accountId: input.actorAccountId,
      dimension: officialFeeStaleAt === null ? 'FEE_CONFIRMED' : 'FEE_STALE',
    });
    return ok(updated);
  });
}

export interface PublicTrustRouteSource {
  readonly publisher: string | null;
  readonly sourceTitle: string | null;
  readonly sourceUrl: string | null;
}

export interface PublicTrustRoute {
  readonly packKey: string;
  readonly packName: string;
  readonly jurisdiction: string | null;
  readonly route: string | null;
  readonly purpose: string | null;
  readonly routeDescription: string;
  readonly version: number;
  readonly effectiveDate: Date | null;
  readonly nextReviewDate: Date | null;
  /** Null whenever the fee is unset, marked stale, or this version's own review date has passed -- directive §9: "if fee stale/unverified, remove amount [and] show official source link/status." */
  readonly officialFee: { readonly minorUnits: number; readonly currency: string } | null;
  readonly officialChannelName: string | null;
  readonly officialChannelUrl: string | null;
  readonly officialReportingUrl: string | null;
  /** The distinct official sources cited across this version's requirements -- the route's "official source," aggregated rather than duplicating a second single-source field on the version itself. */
  readonly officialSources: readonly PublicTrustRouteSource[];
}

async function toPublicTrustRoute(
  db: Db,
  pack: Pack,
  version: Omit<PackVersion, 'manifestFormat'>,
  now: Date,
): Promise<PublicTrustRoute> {
  const feeCurrent =
    version.officialFeeMinorUnits !== null &&
    version.officialFeeCurrency !== null &&
    version.officialFeeStaleAt === null &&
    (version.nextReviewDate === null || version.nextReviewDate.getTime() > now.getTime());

  const requirements = await listRequirements(db, version.id);
  const seen = new Set<string>();
  const officialSources: PublicTrustRouteSource[] = [];
  for (const req of requirements) {
    if (!req.publisher && !req.sourceTitle && !req.sourceUrl) continue;
    const key = `${req.publisher ?? ''}|${req.sourceTitle ?? ''}|${req.sourceUrl ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    officialSources.push({
      publisher: req.publisher,
      sourceTitle: req.sourceTitle,
      sourceUrl: req.sourceUrl,
    });
  }

  return {
    packKey: pack.key,
    packName: pack.name,
    jurisdiction: pack.jurisdiction,
    route: pack.route,
    purpose: pack.purpose,
    // Not-null by construction: both public-read paths below only ever call
    // this with a version whose `routeDescription` has already been checked.
    routeDescription: version.routeDescription as string,
    version: version.version,
    effectiveDate: version.effectiveDate,
    nextReviewDate: version.nextReviewDate,
    officialFee: feeCurrent
      ? {
          minorUnits: version.officialFeeMinorUnits as number,
          currency: version.officialFeeCurrency as string,
        }
      : null,
    officialChannelName: version.officialChannelName,
    officialChannelUrl: version.officialChannelUrl,
    officialReportingUrl: version.officialReportingUrl,
    officialSources,
  };
}

/**
 * The public, unauthenticated Public Trust Lite read (RUL-06, directive §9).
 * Resolves a pack's current PUBLISHED version ONLY when that exact version
 * has been explicitly opted into public display (`publishToPublicTrust`) --
 * see that function's own doc comment for why exposure never carries
 * forward to a newer version automatically. Returns `null` for anything not
 * meant to be public: no matching pack, a non-authoritative (agency custom)
 * pack, or no currently-published trust content -- the caller renders this
 * as the directive's own "honest unavailable status," never a fabricated
 * fallback.
 */
export async function getPublicTrustRoute(
  db: Db,
  packKey: string,
): Promise<PublicTrustRoute | null> {
  const pack = first(
    await db.select().from(schema.packs).where(eq(schema.packs.key, packKey)).limit(1),
  );
  if (!pack || !pack.authoritative) return null;

  // The public read never needs the manifest format, so it reads only the original columns.
  const version = first(
    await db
      .select(legacyPackVersionColumns())
      .from(schema.packVersions)
      .where(
        and(eq(schema.packVersions.packId, pack.id), eq(schema.packVersions.status, 'PUBLISHED')),
      )
      .limit(1),
  );
  if (!version || !version.publicTrustPublishedAt || !version.routeDescription) return null;

  return toPublicTrustRoute(db, pack, version, new Date());
}

/** Every route currently live on the public trust surface (admin overview, Pack Studio catalog page), most-recently-published first. */
export async function listPublicTrustPublished(db: Db): Promise<PublicTrustRoute[]> {
  const rows = await db
    .select({ pack: schema.packs, version: legacyPackVersionColumns() })
    .from(schema.packVersions)
    .innerJoin(schema.packs, eq(schema.packs.id, schema.packVersions.packId))
    .where(
      and(
        eq(schema.packVersions.status, 'PUBLISHED'),
        eq(schema.packs.authoritative, true),
        isNotNull(schema.packVersions.publicTrustPublishedAt),
      ),
    );
  const now = new Date();
  const sorted = [...rows].sort(
    (a, b) =>
      (b.version.publicTrustPublishedAt?.getTime() ?? 0) -
      (a.version.publicTrustPublishedAt?.getTime() ?? 0),
  );
  return Promise.all(sorted.map((row) => toPublicTrustRoute(db, row.pack, row.version, now)));
}

/** Verify a version's stored checksum matches its current requirements. */
export async function verifyPackChecksum(db: Db, packVersionId: string): Promise<boolean> {
  const version = await loadVersion(db, packVersionId);
  if (!version || !version.checksum) return false;
  // Each version is verified with the serializer that produced its checksum (ADR 0026 D2).
  const format = manifestFormatOf(version);
  if (format === null) return false;
  const requirements = await listRequirements(db, packVersionId);
  const extras = await loadManifestExtras(
    db,
    packVersionId,
    requirements.map((r) => r.id),
  );
  const { checksum } = buildManifest(requirements, format, extras);
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
  'groupKey',
  'groupMode',
] as const satisfies readonly (keyof PackRequirement)[];

/** Which G2 rule details differ; an absent record reads as all unset. */
function changedDetailFields(
  from: RequirementDetails | undefined,
  to: RequirementDetails | undefined,
): string[] {
  const changed: string[] = DIFFABLE_DETAIL_FIELDS.filter(
    (field) => (from?.[field] ?? null) !== (to?.[field] ?? null),
  );
  if ((from?.effectiveSince?.getTime() ?? null) !== (to?.effectiveSince?.getTime() ?? null)) {
    changed.push('effectiveSince');
  }
  return changed;
}

function sameRouteConditions(
  a: PackRouteConditions | null,
  b: PackRouteConditions | null,
): boolean {
  const key = (c: PackRouteConditions | null) =>
    c ? JSON.stringify([[...c.consularPosts].sort(), c.travelFrom, c.travelUntil]) : 'none';
  return key(a) === key(b);
}

/** Every field name that differs between two requirements sharing the same natural key. Empty when they are equivalent. */
function changedRequirementFields(from: PackRequirement, to: PackRequirement): string[] {
  const changed: string[] = DIFFABLE_SCALAR_FIELDS.filter((field) => from[field] !== to[field]);
  // A legacy row and a row that spells out the same meaning are not a change (UMPE P1).
  if (requirementNecessity(from) !== requirementNecessity(to)) changed.push('necessity');
  if (requirementProvenance(from) !== requirementProvenance(to)) changed.push('provenance');
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
  /** UMPE G2: whether the application posts or travel window differ between the versions. */
  readonly routeConditionsChanged: boolean;
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
  const [fromExtras, toExtras] = await Promise.all([
    loadManifestExtras(
      db,
      fromVersionId,
      fromReqs.map((r) => r.id),
    ),
    loadManifestExtras(
      db,
      toVersionId,
      toReqs.map((r) => r.id),
    ),
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
    const changedFields = [
      ...changedRequirementFields(from, to),
      ...changedDetailFields(fromExtras.details.get(from.id), toExtras.details.get(to.id)),
    ];
    return {
      key,
      kind,
      change: changedFields.length > 0 ? 'changed' : 'unchanged',
      from,
      to,
      changedFields,
    };
  });

  return ok({
    fromVersion,
    toVersion,
    entries,
    routeConditionsChanged: !sameRouteConditions(
      fromExtras.routeConditions,
      toExtras.routeConditions,
    ),
  });
}
