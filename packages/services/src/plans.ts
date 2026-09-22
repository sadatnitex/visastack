import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { isActiveMember, listApplicantsForOrganization } from './agency';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';
import { getOrganizationEvidenceBytes } from './quotas';

/**
 * Commerce: plans, entitlements, and subscriptions (Commercial V1 COM-01,
 * PRD §12 / master directive Part 5 §6).
 *
 * "Entitlements are data, not hardcoded UI conditions": every entitlement
 * (`seatsAllowed`, `casesPerPeriodAllowed`, `concurrentOpenCasesAllowed`,
 * `storageBytesAllowed`, `aiAllowanceUnitsAllowed`) is a real, admin-editable
 * column on `plans` (`packages/db/src/schema.ts`), never a magic number
 * inlined into a service function or a UI branch. `NULL` on any of those
 * columns means unlimited/no cap, never zero.
 *
 * The three seeded catalog rows (`traveller_free`, `agency_starter`,
 * `agency_pro` -- migration `0053`) carry clearly-provisional placeholder
 * numbers, NOT a product-owner pricing/capacity decision: the PRD is
 * explicit that "numerical allowances/prices are product-owner
 * configuration, not invented market truth." `priceMinorUnits`/`currency`
 * are left unset (`NULL`) for all three seeded rows for exactly that
 * reason -- what this chunk builds is the mechanism (a real, queryable,
 * admin-editable catalog), never a fabricated business decision. A real
 * price is something `updatePlan` sets later, by an actual product owner.
 *
 * Scope boundary, deliberately not crossed here: this file does not gate
 * ANY access or write path in the rest of the application ("never make a
 * plan change alter data authorization" -- PRD §12 verbatim). Reading these
 * entitlements to actually ENFORCE a limit (blocking an upload, an invite,
 * a case) is COM-02's job, a separate, still-open ledger item; this file
 * only makes the numbers real, queryable, and displayable
 * ("Show each meter and its definition"). The existing flat, env-driven
 * `quotas.ts` limits remain the system's only currently-ENFORCED caps;
 * reconciling the two is explicitly COM-02's work, not silently assumed
 * done here.
 *
 * Traveller Free needs no `subscriptions` row at all -- every individual
 * account is implicitly on it (`getPlanByKey(db, TRAVELLER_FREE_PLAN_KEY)`),
 * since there is no self-upgrade path yet and the PRD names no other
 * traveller-facing tier. An organization, by contrast, has NO entitlements
 * at all (`getCurrentPlanForOrganization` returns `undefined`) until a
 * platform owner explicitly `activateSubscription`s one -- "manually
 * activated," never a silent free-tier fallback for agency work.
 *
 * "Cases created per billing period" and "concurrent open cases" are scoped
 * by `missions.ownerOrganizationId` (the case's own "whose case is this"
 * attribution label, explicitly documented as never itself a source of
 * access) -- a workload/ownership definition. "Total retained storage" and
 * the AI-allowance meter instead use `listApplicantsForOrganization`'s
 * grant-based "which applicants does this org currently have real access
 * to" definition (`quotas.ts`'s `getOrganizationEvidenceBytes`) -- a
 * genuine infrastructure-footprint definition, deliberately different
 * because an org can have real data access (and therefore real storage/AI
 * cost) on a case it does not own. Both are named explicitly in each
 * meter's own `definition` string, never left for a caller to guess.
 *
 * "Cases per period" and the AI allowance use a simple trailing
 * `periodDays`-day window ending at `now`, not a real billing-cycle anchor
 * date -- COM-03's billing records (TRIAL/ACTIVE/GRACE/SUSPENDED/CLOSED,
 * invoice periods) do not exist yet. An honestly-provisional placeholder,
 * the same posture NTF-04's own weekly-overdue-follow-up cap already used.
 */

export const TRAVELLER_FREE_PLAN_KEY = 'traveller_free';

export type Plan = typeof schema.plans.$inferSelect;
export type Subscription = typeof schema.subscriptions.$inferSelect;

function nonNegativeOrUndefined(value: number | null | undefined): boolean {
  return value === undefined || value === null || (Number.isFinite(value) && value >= 0);
}

export interface CreatePlanInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly key: string;
  readonly name: string;
  readonly seatsAllowed?: number | null;
  readonly casesPerPeriodAllowed?: number | null;
  readonly concurrentOpenCasesAllowed?: number | null;
  readonly storageBytesAllowed?: number | null;
  readonly aiAllowanceUnitsAllowed?: number | null;
  readonly periodDays?: number;
  readonly priceMinorUnits?: number | null;
  readonly currency?: string | null;
}

function validateEntitlementNumbers(input: {
  readonly seatsAllowed?: number | null;
  readonly casesPerPeriodAllowed?: number | null;
  readonly concurrentOpenCasesAllowed?: number | null;
  readonly storageBytesAllowed?: number | null;
  readonly aiAllowanceUnitsAllowed?: number | null;
  readonly periodDays?: number;
  readonly priceMinorUnits?: number | null;
  readonly currency?: string | null;
}): string | undefined {
  if (
    !nonNegativeOrUndefined(input.seatsAllowed) ||
    !nonNegativeOrUndefined(input.casesPerPeriodAllowed) ||
    !nonNegativeOrUndefined(input.concurrentOpenCasesAllowed) ||
    !nonNegativeOrUndefined(input.storageBytesAllowed) ||
    !nonNegativeOrUndefined(input.aiAllowanceUnitsAllowed) ||
    !nonNegativeOrUndefined(input.priceMinorUnits)
  ) {
    return 'entitlement and price values must be non-negative';
  }
  if (
    input.periodDays !== undefined &&
    (!Number.isFinite(input.periodDays) || input.periodDays <= 0)
  ) {
    return 'periodDays must be a positive number';
  }
  const priceSet = input.priceMinorUnits !== undefined && input.priceMinorUnits !== null;
  const currencySet =
    input.currency !== undefined && input.currency !== null && input.currency.trim().length > 0;
  if (priceSet !== currencySet) {
    return 'priceMinorUnits and currency must be set together, or neither';
  }
  return undefined;
}

/** Add a plan to the catalog. Platform-owner-only, step-up gated -- the same sensitivity class as a platform-role grant. */
export async function createPlan(
  db: Db,
  input: CreatePlanInput,
): Promise<Result<Plan, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can manage plans'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'managing plans requires reauthentication'));
  }
  const key = input.key.trim();
  const name = input.name.trim();
  if (key.length === 0) return err(serviceError('invalid', 'a key is required'));
  if (name.length === 0) return err(serviceError('invalid', 'a name is required'));
  const invalid = validateEntitlementNumbers(input);
  if (invalid) return err(serviceError('invalid', invalid));

  const existing = first(
    await db
      .select({ id: schema.plans.id })
      .from(schema.plans)
      .where(eq(schema.plans.key, key))
      .limit(1),
  );
  if (existing) return err(serviceError('invalid', 'a plan with this key already exists'));

  return db.transaction(async (tx) => {
    const plan = required(
      first(
        await tx
          .insert(schema.plans)
          .values({
            key,
            name,
            seatsAllowed: input.seatsAllowed ?? null,
            casesPerPeriodAllowed: input.casesPerPeriodAllowed ?? null,
            concurrentOpenCasesAllowed: input.concurrentOpenCasesAllowed ?? null,
            storageBytesAllowed: input.storageBytesAllowed ?? null,
            aiAllowanceUnitsAllowed: input.aiAllowanceUnitsAllowed ?? null,
            ...(input.periodDays !== undefined ? { periodDays: input.periodDays } : {}),
            priceMinorUnits: input.priceMinorUnits ?? null,
            currency: input.currency ?? null,
          })
          .returning(),
      ),
      'plan',
    );
    await appendAuditEvent(tx, {
      eventType: 'PLAN_CREATED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'plan',
      resourceId: plan.id,
      metadata: { key, name },
    });
    return ok(plan);
  });
}

export interface UpdatePlanInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly planId: string;
  readonly name?: string;
  readonly active?: boolean;
  readonly seatsAllowed?: number | null;
  readonly casesPerPeriodAllowed?: number | null;
  readonly concurrentOpenCasesAllowed?: number | null;
  readonly storageBytesAllowed?: number | null;
  readonly aiAllowanceUnitsAllowed?: number | null;
  readonly periodDays?: number;
  readonly priceMinorUnits?: number | null;
  readonly currency?: string | null;
}

/**
 * Change a plan's name/active flag/entitlements/price (platform-owner-only,
 * step-up gated). Only fields explicitly present in `input` are touched --
 * the same partial-update discipline `updateTask`/`updateAppointment`
 * already established -- and every changed field is audited alongside its
 * prior value.
 */
export async function updatePlan(
  db: Db,
  input: UpdatePlanInput,
): Promise<Result<Plan, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can manage plans'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'managing plans requires reauthentication'));
  }
  const invalid = validateEntitlementNumbers(input);
  if (invalid) return err(serviceError('invalid', invalid));
  if (input.name !== undefined && input.name.trim().length === 0) {
    return err(serviceError('invalid', 'name cannot be blank'));
  }

  const plan = first(
    await db.select().from(schema.plans).where(eq(schema.plans.id, input.planId)).limit(1),
  );
  if (!plan) return err(serviceError('not_found', 'plan not found'));

  // priceMinorUnits/currency are validated together above only when BOTH
  // are present in this call; a partial update touching just one of the two
  // could otherwise leave the row violating `plans_price_currency_together`
  // against its OWN prior value for the untouched field.
  const nextPriceSet =
    input.priceMinorUnits !== undefined
      ? input.priceMinorUnits !== null
      : plan.priceMinorUnits !== null;
  const nextCurrencySet =
    input.currency !== undefined ? input.currency !== null : plan.currency !== null;
  if (nextPriceSet !== nextCurrencySet) {
    return err(
      serviceError('invalid', 'priceMinorUnits and currency must be set together, or neither'),
    );
  }

  return db.transaction(async (tx) => {
    let changes: Record<string, { readonly before: unknown; readonly after: unknown }> = {};
    const set: Record<string, unknown> = { updatedAt: new Date() };
    const track = <K extends keyof Plan>(key: K, value: Plan[K] | undefined): void => {
      if (value === undefined) return;
      set[key] = value;
      changes = { ...changes, [key]: { before: plan[key], after: value } };
    };
    track('name', input.name?.trim());
    track('active', input.active);
    track('seatsAllowed', input.seatsAllowed);
    track('casesPerPeriodAllowed', input.casesPerPeriodAllowed);
    track('concurrentOpenCasesAllowed', input.concurrentOpenCasesAllowed);
    track('storageBytesAllowed', input.storageBytesAllowed);
    track('aiAllowanceUnitsAllowed', input.aiAllowanceUnitsAllowed);
    track('periodDays', input.periodDays);
    track('priceMinorUnits', input.priceMinorUnits);
    track('currency', input.currency);

    if (Object.keys(changes).length === 0) return ok(plan);

    const updated = required(
      first(
        await tx.update(schema.plans).set(set).where(eq(schema.plans.id, input.planId)).returning(),
      ),
      'plan',
    );
    await appendAuditEvent(tx, {
      eventType: 'PLAN_UPDATED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'plan',
      resourceId: plan.id,
      metadata: { changes },
    });
    return ok(updated);
  });
}

/**
 * The full plan catalog, newest first. Deliberately takes no actor: plan
 * templates and their entitlement numbers are non-sensitive reference data
 * ("Show each meter and its definition"), the same "no gate" shape
 * `listPublishedPackVersions` already uses for its own catalog.
 */
export async function listPlans(
  db: Db,
  options: { readonly activeOnly?: boolean } = {},
): Promise<Plan[]> {
  return db
    .select()
    .from(schema.plans)
    .where(options.activeOnly ? eq(schema.plans.active, true) : undefined)
    .orderBy(desc(schema.plans.createdAt));
}

export async function getPlanByKey(db: Db, key: string): Promise<Plan | undefined> {
  return first(await db.select().from(schema.plans).where(eq(schema.plans.key, key)).limit(1));
}

export interface ActivateSubscriptionInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly organizationId: string;
  readonly planId: string;
  readonly reason: string;
}

/**
 * Manually assign an organization to a plan ("manually activated Agency
 * Starter/Pro templates" -- there is no self-serve checkout; see
 * `NullPaymentPort`). Atomically ends whatever subscription is currently
 * active for this org (if any) and starts the new one, so "the" current
 * plan is never ambiguous and every change is real, queryable history.
 */
export async function activateSubscription(
  db: Db,
  input: ActivateSubscriptionInput,
): Promise<Result<Subscription, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can activate a subscription'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'activating a subscription requires reauthentication'),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const org = first(
    await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));

  const plan = first(
    await db.select().from(schema.plans).where(eq(schema.plans.id, input.planId)).limit(1),
  );
  if (!plan) return err(serviceError('not_found', 'plan not found'));
  if (!plan.active) {
    return err(serviceError('invalid', 'this plan is retired and cannot be newly assigned'));
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    await tx
      .update(schema.subscriptions)
      .set({ endedAt: now })
      .where(
        and(
          eq(schema.subscriptions.organizationId, input.organizationId),
          isNull(schema.subscriptions.endedAt),
        ),
      );
    const subscription = required(
      first(
        await tx
          .insert(schema.subscriptions)
          .values({
            organizationId: input.organizationId,
            planId: input.planId,
            startedAt: now,
            assignedByAccountId: input.actor.accountId,
            reason,
          })
          .returning(),
      ),
      'subscription',
    );
    await appendAuditEvent(tx, {
      eventType: 'SUBSCRIPTION_ACTIVATED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: { organizationId: input.organizationId, planKey: plan.key, reason },
    });
    return ok(subscription);
  });
}

export interface EndSubscriptionInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly organizationId: string;
  readonly reason: string;
}

/**
 * Ends an organization's current subscription without replacing it,
 * dropping it back to "no plan assigned." Idempotent: a no-op
 * (`ended: false`) when nothing is currently active, the same shape
 * `unassignMember` already uses for "nothing to do."
 */
export async function endSubscription(
  db: Db,
  input: EndSubscriptionInput,
): Promise<Result<{ readonly ended: boolean }, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can end a subscription'));
  }
  if (!input.stepUpSatisfied) {
    return err(serviceError('step_up_required', 'ending a subscription requires reauthentication'));
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  return db.transaction(async (tx) => {
    const current = first(
      await tx
        .select()
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.organizationId, input.organizationId),
            isNull(schema.subscriptions.endedAt),
          ),
        )
        .limit(1),
    );
    if (!current) return ok({ ended: false });

    await tx
      .update(schema.subscriptions)
      .set({ endedAt: new Date() })
      .where(eq(schema.subscriptions.id, current.id));
    await appendAuditEvent(tx, {
      eventType: 'SUBSCRIPTION_ENDED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'subscription',
      resourceId: current.id,
      metadata: { organizationId: input.organizationId, reason },
    });
    return ok({ ended: true });
  });
}

/** The organization's current plan, or `undefined` if none has ever been manually activated (or the last one was ended and never replaced). */
export async function getCurrentPlanForOrganization(
  db: Db,
  organizationId: string,
): Promise<Plan | undefined> {
  const row = first(
    await db
      .select({ plan: schema.plans })
      .from(schema.subscriptions)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
      .where(
        and(
          eq(schema.subscriptions.organizationId, organizationId),
          isNull(schema.subscriptions.endedAt),
        ),
      )
      .limit(1),
  );
  return row?.plan;
}

export interface UsageMeter {
  readonly key:
    | 'seats'
    | 'casesPerPeriod'
    | 'concurrentOpenCases'
    | 'storageBytes'
    | 'aiAllowanceUnits';
  readonly label: string;
  readonly definition: string;
  readonly used: number;
  /** null = unlimited (the plan's own column is null), never "no plan." */
  readonly allowed: number | null;
}

export interface OrganizationUsage {
  readonly planAssigned: boolean;
  readonly plan: Plan | undefined;
  readonly meters: readonly UsageMeter[];
}

async function countActiveSeats(db: Db, organizationId: string): Promise<number> {
  const row = first(
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.organizationId, organizationId),
          eq(schema.memberships.active, true),
        ),
      ),
  );
  return row?.n ?? 0;
}

async function countCasesInPeriod(db: Db, organizationId: string, since: Date): Promise<number> {
  const row = first(
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.missions)
      .where(
        and(
          eq(schema.missions.ownerOrganizationId, organizationId),
          gte(schema.missions.createdAt, since),
        ),
      ),
  );
  return row?.n ?? 0;
}

const TERMINAL_MISSION_STATES = ['CLOSED', 'CANCELLED'] as const;

async function countConcurrentOpenCases(db: Db, organizationId: string): Promise<number> {
  const row = first(
    await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.missions)
      .where(
        and(
          eq(schema.missions.ownerOrganizationId, organizationId),
          notInArray(schema.missions.state, [...TERMINAL_MISSION_STATES]),
        ),
      ),
  );
  return row?.n ?? 0;
}

async function sumAiAllowanceUsed(db: Db, organizationId: string, since: Date): Promise<number> {
  const applicants = await listApplicantsForOrganization(db, organizationId);
  if (applicants.length === 0) return 0;
  const row = first(
    await db
      .select({ total: sql<string>`coalesce(sum(${schema.aiExtractionRuns.costUnits}), 0)` })
      .from(schema.aiExtractionRuns)
      .where(
        and(
          inArray(
            schema.aiExtractionRuns.applicantId,
            applicants.map((a) => a.applicantId),
          ),
          gte(schema.aiExtractionRuns.createdAt, since),
        ),
      ),
  );
  return Number(row?.total ?? 0);
}

/**
 * "Show each meter and its definition": every entitlement dimension, its
 * plain-language definition, current usage, and the plan's own allowance
 * (`null` = unlimited) -- for the org's currently active plan, or with
 * `planAssigned: false` and every `allowed` null if none has been
 * activated (usage is still real and shown; there is simply no ceiling to
 * compare it against yet). Only an active member of the organization may
 * view it -- usage/entitlement numbers are real organizational business
 * data, unlike the plan catalog itself.
 */
export async function getUsageForOrganization(
  db: Db,
  input: { readonly actorAccountId: string; readonly organizationId: string; readonly now?: Date },
): Promise<Result<OrganizationUsage, ServiceError>> {
  if (!(await isActiveMember(db, input.actorAccountId, input.organizationId))) {
    return err(serviceError('forbidden', 'not an active member of this organization'));
  }
  const now = input.now ?? new Date();
  const plan = await getCurrentPlanForOrganization(db, input.organizationId);
  const periodStart = new Date(now.getTime() - (plan?.periodDays ?? 30) * 24 * 60 * 60 * 1000);

  const [seatsUsed, casesUsed, concurrentUsed, storageUsed, aiUsed] = await Promise.all([
    countActiveSeats(db, input.organizationId),
    countCasesInPeriod(db, input.organizationId, periodStart),
    countConcurrentOpenCases(db, input.organizationId),
    getOrganizationEvidenceBytes(db, input.organizationId),
    sumAiAllowanceUsed(db, input.organizationId, periodStart),
  ]);

  const meters: UsageMeter[] = [
    {
      key: 'seats',
      label: 'Active seats',
      definition: 'Currently active memberships in this organization.',
      used: seatsUsed,
      allowed: plan?.seatsAllowed ?? null,
    },
    {
      key: 'casesPerPeriod',
      label: 'Cases created this period',
      definition: `Cases (missions) attributed to this organization and created in the trailing ${plan?.periodDays ?? 30} days.`,
      used: casesUsed,
      allowed: plan?.casesPerPeriodAllowed ?? null,
    },
    {
      key: 'concurrentOpenCases',
      label: 'Concurrent open cases',
      definition: 'Cases attributed to this organization not yet CLOSED or CANCELLED.',
      used: concurrentUsed,
      allowed: plan?.concurrentOpenCasesAllowed ?? null,
    },
    {
      key: 'storageBytes',
      label: 'Retained storage',
      definition:
        'Total evidence bytes across every applicant this organization currently has active, accepted access to.',
      used: storageUsed,
      allowed: plan?.storageBytesAllowed ?? null,
    },
    {
      key: 'aiAllowanceUnits',
      label: 'AI allowance',
      definition: `AI extraction cost units consumed (same unit as the platform-wide AI budget) for applicants this organization has active access to, in the trailing ${plan?.periodDays ?? 30} days.`,
      used: aiUsed,
      allowed: plan?.aiAllowanceUnitsAllowed ?? null,
    },
  ];

  return ok({ planAssigned: plan !== undefined, plan, meters });
}
