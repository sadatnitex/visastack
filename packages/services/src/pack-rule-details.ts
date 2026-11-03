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
 * readers return catalogue rules only, never a person's data. Details change only while the version is a draft,
 * so a published version never changes; they are not part of the manifest checksum, the same as
 * `maxAgeDays` and `notes` (ADR 0026 D1 keeps format 1 bytes fixed).
 */

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
      metadata: { kind: target.kind, setCount: setKeys.length, setKeys },
    });
    return ok(row ? toDetails(row) : NO_REQUIREMENT_DETAILS);
  });
}

// --- Route conditions (R05) ---------------------------------------------------------------------

/** The route conditions these packs declare, by pack id; a pack that declares none is absent. */
export async function listPackRouteConditions(
  db: Db,
  packIds: readonly string[],
): Promise<Map<string, PackRouteConditions>> {
  const ids = [...new Set(packIds)];
  if (ids.length === 0 || !(await ruleDetailTablesPresent(db))) return new Map();
  const rows = await db
    .select()
    .from(schema.packRouteConditions)
    .where(inArray(schema.packRouteConditions.packId, ids));
  return new Map(
    rows.map(
      (row) =>
        [
          row.packId,
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
    const key = post.toLowerCase();
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
 * Save which application posts and trip start window a pack is for. Nothing declared removes the
 * row, so the pack again narrows by neither. Affects only which checklist a new case is offered;
 * a case already linked keeps its exact version. Audited with counts only.
 */
export async function setPackRouteConditions(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: { readonly packId: string } & PackRouteConditions,
): Promise<Result<PackRouteConditions, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PACK_MANAGE');
  if (denied) return err(denied);
  const actorAccountId = staff.accountId;
  if (!(await ruleDetailTablesPresent(db)))
    return err(serviceError('invalid', RULE_DETAILS_WAITING));
  const cleaned = cleanRouteConditions(input);
  if (!cleaned.ok) return err(serviceError('invalid', cleaned.error));
  const conditions = cleaned.value;
  return db.transaction(async (tx) => {
    const pack = first(
      await tx
        .select({ id: schema.packs.id })
        .from(schema.packs)
        .where(eq(schema.packs.id, input.packId))
        .limit(1)
        .for('update'),
    );
    if (!pack) return err(serviceError('not_found', 'pack not found'));
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
        .values({ packId: input.packId, ...values })
        .onConflictDoUpdate({ target: schema.packRouteConditions.packId, set: values });
    } else {
      await tx
        .delete(schema.packRouteConditions)
        .where(eq(schema.packRouteConditions.packId, input.packId));
    }
    await appendAuditEvent(tx, {
      eventType: 'PACK_ROUTE_CONDITIONS_SET',
      actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'pack',
      resourceId: input.packId,
      metadata: {
        postCount: conditions.consularPosts.length,
        hasTravelFrom: conditions.travelFrom !== null,
        hasTravelUntil: conditions.travelUntil !== null,
      },
    });
    return ok(conditions);
  });
}
