import {
  type AcceptedForm,
  NO_FORMAT_RULES,
  type RequirementCategory,
  type RequirementFormatRules,
  type Result,
  STATEMENT_PERIOD_MONTHS_MAX,
  VALID_MONTHS_AFTER_TRAVEL_MAX,
  err,
  isAcceptedForm,
  isRequirementCategory,
  ok,
  packMatchKey,
} from '@visastack/core';
import { eq, inArray, sql } from 'drizzle-orm';
import { type StaffScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';

/**
 * UMPE G2: the rule details a pack requirement may carry beyond its P1 columns (R02 category, R12
 * format rules, R08 the source's effective date, R22 validity after travel), and the application
 * posts and travel window a pack declares (R05).
 *
 * Both live in side tables, so nothing that already reads or writes packs changes, and the code
 * runs before the migration: readers then answer "nothing declared" (exactly what every row holds)
 * and writers refuse plainly. Writers take a fresh `PACK_MANAGE` staff scope (the access ratchet);
 * readers return catalogue rules only, never a person's data. Both belong to one pack version and
 * change only while it is a draft; when present they are part of its format 2 manifest checksum
 * (ADR 0026 D2: new keys only when set), so a version without them keeps its exact checksum and a
 * published version never changes. */

export interface RequirementDetails extends RequirementFormatRules {
  readonly category: RequirementCategory | null;
  readonly effectiveSince: Date | null;
}

export const NO_REQUIREMENT_DETAILS: RequirementDetails = {
  ...NO_FORMAT_RULES,
  category: null,
  effectiveSince: null,
};

export interface PackRouteConditions {
  /** Application posts (consular jurisdictions) the pack is for; empty means any. */
  readonly consularPosts: readonly string[];
  /** The first and last trip start dates the pack is for (YYYY-MM-DD), or null for open. */
  readonly travelFrom: string | null;
  readonly travelUntil: string | null;
}

export const NO_ROUTE_CONDITIONS: PackRouteConditions = {
  consularPosts: [],
  travelFrom: null,
  travelUntil: null,
};

export const RULE_DETAILS_WAITING =
  'This part of Pack Studio is waiting for a database update. Try again after it runs.';

const CONSULAR_POSTS_MAX = 20;
const CONSULAR_POST_MAX_LENGTH = 120;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const presentHandles = new WeakSet<object>();

/** Whether both G2 side tables exist. Only "present" is remembered per handle. */
export async function ruleDetailTablesPresent(db: Db): Promise<boolean> {
  if (presentHandles.has(db)) return true;
  const rows = await db
    .select({
      present: sql<boolean>`(to_regclass('pack_requirement_details'::text) is not null and to_regclass('pack_route_conditions'::text) is not null)`,
    })
    .from(sql`(select 1) as probe`);
  const found = rows[0]?.present === true;
  if (found) presentHandles.add(db);
  return found;
}

function toDetails(row: typeof schema.packRequirementDetails.$inferSelect): RequirementDetails {
  return {
    category: isRequirementCategory(row.category) ? row.category : null,
    acceptedForm: isAcceptedForm(row.acceptedForm) ? row.acceptedForm : null,
    translationNeeded: row.translationNeeded,
    originalNeeded: row.originalNeeded,
    statementPeriodMonths: row.statementPeriodMonths,
    validMonthsAfterTravel: row.validMonthsAfterTravel,
    effectiveSince: row.effectiveSince,
  };
}

/** The details of these requirements, by requirement id; a requirement with none is absent. */
export async function listRequirementDetails(
  db: Db,
  packRequirementIds: readonly string[],
): Promise<Map<string, RequirementDetails>> {
  const ids = [...new Set(packRequirementIds)];
  if (ids.length === 0 || !(await ruleDetailTablesPresent(db))) return new Map();
  const rows = await db
    .select()
    .from(schema.packRequirementDetails)
    .where(inArray(schema.packRequirementDetails.packRequirementId, ids));
  return new Map(rows.map((row) => [row.packRequirementId, toDetails(row)] as const));
}

export interface RequirementDetailsInput {
  readonly category: RequirementCategory | null;
  readonly acceptedForm: AcceptedForm | null;
  readonly translationNeeded: boolean | null;
  readonly originalNeeded: boolean | null;
  readonly statementPeriodMonths: number | null;
  readonly validMonthsAfterTravel: number | null;
  readonly effectiveSince: Date | null;
}

function wholeIn(value: number | null, min: number, max: number): boolean {
  return value === null || (Number.isInteger(value) && value >= min && value <= max);
}

/** Why these details cannot be saved for a requirement of this kind, or null. */
export function requirementDetailsProblem(
  kind: 'FIELD' | 'DOCUMENT',
  input: RequirementDetailsInput,
): string | null {
  if (input.category !== null && !isRequirementCategory(input.category)) {
    return 'the category is not one of the known categories';
  }
  if (input.acceptedForm !== null && !isAcceptedForm(input.acceptedForm)) {
    return 'the accepted form is not one of the known forms';
  }
  if (!wholeIn(input.statementPeriodMonths, 1, STATEMENT_PERIOD_MONTHS_MAX)) {
    return `the statement period must be a whole number of months from 1 to ${STATEMENT_PERIOD_MONTHS_MAX}`;
  }
  if (!wholeIn(input.validMonthsAfterTravel, 0, VALID_MONTHS_AFTER_TRAVEL_MAX)) {
    return `validity after the trip must be a whole number of months from 0 to ${VALID_MONTHS_AFTER_TRAVEL_MAX}`;
  }
  if (input.effectiveSince !== null && Number.isNaN(input.effectiveSince.getTime())) {
    return 'the date the rule took effect is not a real date';
  }
  const formatSet =
    input.acceptedForm !== null ||
    input.translationNeeded !== null ||
    input.originalNeeded !== null ||
    input.statementPeriodMonths !== null ||
    input.validMonthsAfterTravel !== null;
  if (kind === 'FIELD' && formatSet) return 'format rules only apply to a document requirement';
  return null;
}

/**
 * Save a requirement's details (the whole set; an unset value clears it). Only while its version is
 * a draft. Audited with which details are set, never their values.
 */
export async function setRequirementDetails(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: { readonly packRequirementId: string } & RequirementDetailsInput,
): Promise<Result<RequirementDetails, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PACK_MANAGE');
  if (denied) return err(denied);
  const actorAccountId = staff.accountId;
  if (!(await ruleDetailTablesPresent(db)))
    return err(serviceError('invalid', RULE_DETAILS_WAITING));
  return db.transaction(async (tx) => {
    const target = first(
      await tx
        .select({
          kind: schema.packRequirements.kind,
          packVersionId: schema.packRequirements.packVersionId,
          status: schema.packVersions.status,
        })
        .from(schema.packRequirements)
        .innerJoin(
          schema.packVersions,
          eq(schema.packVersions.id, schema.packRequirements.packVersionId),
        )
        .where(eq(schema.packRequirements.id, input.packRequirementId))
        .limit(1)
        .for('update', { of: schema.packVersions }),
    );
    if (!target) return err(serviceError('not_found', 'requirement not found'));
    if (target.status !== 'DRAFT') {
      return err(
        serviceError('invalid', 'requirements can only change while the version is DRAFT'),
      );
    }
    const problem = requirementDetailsProblem(target.kind, input);
    if (problem) return err(serviceError('invalid', problem));
    const values = {
      category: input.category,
      acceptedForm: input.acceptedForm,
      translationNeeded: input.translationNeeded,
      originalNeeded: input.originalNeeded,
      statementPeriodMonths: input.statementPeriodMonths,
      validMonthsAfterTravel: input.validMonthsAfterTravel,
      effectiveSince: input.effectiveSince,
      updatedByAccountId: actorAccountId,
      updatedAt: new Date(),
    };
    const [row] = await tx
      .insert(schema.packRequirementDetails)
      .values({ packRequirementId: input.packRequirementId, ...values })
      .onConflictDoUpdate({ target: schema.packRequirementDetails.packRequirementId, set: values })
      .returning();
    const setKeys = Object.entries(values)
      .filter(
        ([key, value]) => key !== 'updatedByAccountId' && key !== 'updatedAt' && value !== null,
      )
      .map(([key]) => key)
      .sort();
    await appendAuditEvent(tx, {
      eventType: 'PACK_REQUIREMENT_DETAILS_SET',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: target.packVersionId,
      metadata: {
        packRequirementId: input.packRequirementId,
        kind: target.kind,
        setCount: setKeys.length,
        setKeys,
      },
    });
    return ok(row ? toDetails(row) : NO_REQUIREMENT_DETAILS);
  });
}

// --- Route conditions (R05) ---------------------------------------------------------------------

/**
 * The route conditions these pack versions declare, by version id; a version that declares none is
 * absent.
 */
export async function listPackRouteConditions(
  db: Db,
  packVersionIds: readonly string[],
): Promise<Map<string, PackRouteConditions>> {
  const ids = [...new Set(packVersionIds)];
  if (ids.length === 0 || !(await ruleDetailTablesPresent(db))) return new Map();
  const rows = await db
    .select()
    .from(schema.packRouteConditions)
    .where(inArray(schema.packRouteConditions.packVersionId, ids));
  return new Map(
    rows.map(
      (row) =>
        [
          row.packVersionId,
          {
            consularPosts: row.consularPosts ?? [],
            travelFrom: row.travelFrom,
            travelUntil: row.travelUntil,
          },
        ] as const,
    ),
  );
}

function realDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** The cleaned conditions, or why they cannot be saved. */
export function cleanRouteConditions(
  input: PackRouteConditions,
): Result<PackRouteConditions, string> {
  const seen = new Set<string>();
  const posts: string[] = [];
  for (const raw of input.consularPosts) {
    const post = raw.trim().replace(/\s+/g, ' ');
    if (post.length === 0) continue;
    if (post.length > CONSULAR_POST_MAX_LENGTH) {
      return err(`each application post can be at most ${CONSULAR_POST_MAX_LENGTH} characters`);
    }
    // A post must be matchable: one with no Latin letters or digits could never name a case.
    const key = packMatchKey(post);
    if (key.length === 0) {
      return err('write each application post in English letters, for example Dhaka');
    }
    if (seen.has(key)) continue;
    seen.add(key);
    posts.push(post);
  }
  if (posts.length > CONSULAR_POSTS_MAX) {
    return err(`a checklist can name at most ${CONSULAR_POSTS_MAX} application posts`);
  }
  const from = input.travelFrom?.trim() || null;
  const until = input.travelUntil?.trim() || null;
  if ((from && !realDateOnly(from)) || (until && !realDateOnly(until))) {
    return err('travel dates must be real dates');
  }
  if (from && until && from > until) return err('the first travel date must come before the last');
  return ok({ consularPosts: posts, travelFrom: from, travelUntil: until });
}

/**
 * Save which application posts and trip start window a draft pack version is for. Nothing declared
 * removes the row, so the version again narrows by neither. Only a draft changes: a published
 * version keeps exactly what was reviewed (the conditions are part of its manifest checksum), and a
 * new draft starts from the newest earlier version's conditions. Audited with counts only.
 */
export async function setPackRouteConditions(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: { readonly packVersionId: string } & PackRouteConditions,
): Promise<Result<PackRouteConditions, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PACK_MANAGE');
  if (denied) return err(denied);
  const actorAccountId = staff.accountId;
  if (!(await ruleDetailTablesPresent(db))) {
    return err(serviceError('invalid', RULE_DETAILS_WAITING));
  }
  const cleaned = cleanRouteConditions(input);
  if (!cleaned.ok) return err(serviceError('invalid', cleaned.error));
  const conditions = cleaned.value;
  return db.transaction(async (tx) => {
    const version = first(
      await tx
        .select({ id: schema.packVersions.id, status: schema.packVersions.status })
        .from(schema.packVersions)
        .where(eq(schema.packVersions.id, input.packVersionId))
        .limit(1)
        .for('update'),
    );
    if (!version) return err(serviceError('not_found', 'pack version not found'));
    if (version.status !== 'DRAFT') {
      return err(
        serviceError(
          'invalid',
          'who a checklist is for can only change while the version is DRAFT',
        ),
      );
    }
    const declared =
      conditions.consularPosts.length > 0 ||
      conditions.travelFrom !== null ||
      conditions.travelUntil !== null;
    if (declared) {
      const values = {
        consularPosts: [...conditions.consularPosts],
        travelFrom: conditions.travelFrom,
        travelUntil: conditions.travelUntil,
        updatedByAccountId: actorAccountId,
        updatedAt: new Date(),
      };
      await tx
        .insert(schema.packRouteConditions)
        .values({ packVersionId: input.packVersionId, ...values })
        .onConflictDoUpdate({ target: schema.packRouteConditions.packVersionId, set: values });
    } else {
      await tx
        .delete(schema.packRouteConditions)
        .where(eq(schema.packRouteConditions.packVersionId, input.packVersionId));
    }
    await appendAuditEvent(tx, {
      eventType: 'PACK_ROUTE_CONDITIONS_SET',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack_version',
      resourceId: input.packVersionId,
      metadata: {
        postCount: conditions.consularPosts.length,
        hasTravelFrom: conditions.travelFrom !== null,
        hasTravelUntil: conditions.travelUntil !== null,
      },
    });
    return ok(conditions);
  });
}

/**
 * A new draft starts from the newest earlier version's route conditions (inside the transaction
 * that opens it), so who a checklist is for carries forward and changes only through review.
 * Requirements themselves are added afresh to each draft, so their details start empty. Nothing
 * happens before the G2 tables exist.
 */
export async function copyRouteConditionsForward(
  tx: Db,
  input: { readonly packId: string; readonly toVersionId: string },
): Promise<void> {
  if (!(await ruleDetailTablesPresent(tx))) return;
  await tx.execute(sql`
    insert into ${schema.packRouteConditions}
      (pack_version_id, consular_posts, travel_from, travel_until, updated_by_account_id, updated_at)
    select ${input.toVersionId}, c.consular_posts, c.travel_from, c.travel_until,
           c.updated_by_account_id, now()
      from ${schema.packRouteConditions} c
      join ${schema.packVersions} v on v.id = c.pack_version_id
     where v.pack_id = ${input.packId} and v.id <> ${input.toVersionId}
     order by v.version desc
     limit 1
    on conflict do nothing`);
}

// --- Manifest extras (format 2) -------------------------------------------------------------------

/** The rule details and route conditions a version's manifest carries, when present. */
export interface ManifestExtras {
  readonly details: ReadonlyMap<string, RequirementDetails>;
  readonly routeConditions: PackRouteConditions | null;
}

export const NO_MANIFEST_EXTRAS: ManifestExtras = { details: new Map(), routeConditions: null };

/** Whether a details record holds anything at all (an all-empty row is the same as none). */
export function detailsPresent(details: RequirementDetails | undefined): boolean {
  if (!details) return false;
  return Object.values(details).some((value) => value !== null);
}

/** A version's manifest extras; empty before the G2 tables exist. */
export async function loadManifestExtras(
  db: Db,
  packVersionId: string,
  requirementIds: readonly string[],
): Promise<ManifestExtras> {
  const [details, conditions] = await Promise.all([
    listRequirementDetails(db, requirementIds),
    listPackRouteConditions(db, [packVersionId]),
  ]);
  return { details, routeConditions: conditions.get(packVersionId) ?? null };
}
