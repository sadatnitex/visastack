import {
  type Result,
  err,
  formatBillingDate,
  isIsoCurrencyCode,
  normalizeCurrencyCode,
  ok,
} from '@visastack/core';
import { and, desc, eq, gte, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import { isActiveMember, listApplicantsForOrganization } from './agency';
import { excludingDeterministicRuns } from './ai-run-kinds';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  cancelQueuedNotificationsForResource,
  enqueueNotificationBothChannels,
} from './notifications';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';
import { recordProductEvent } from './product-events';
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
 * traveller-facing tier. New organizations receive an explicit complimentary
 * Founding Access subscription in their creation transaction. Existing
 * organizations retain their recorded subscriptions, including no-plan states;
 * paid offer changes remain platform-owner and step-up gated.
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
 *
 * Downgrade grace periods (master directive Part 5 §7's "effective dates;
 * warning/grace; blocks NEW capacity use after grace; deletes nothing") are
 * a SEPARATE, explicitly-scheduled path alongside `activateSubscription`'s
 * immediate cutover, not a variant of it: `scheduleDowngrade` inserts a
 * `scheduledDowngrades` row for a caller-chosen future `effectiveAt`
 * (defaulting to 14 days out) rather than touching `subscriptions` at all,
 * so the organization's CURRENT plan -- and everything
 * entitlement-enforcement.ts checks against it -- stays exactly what it was
 * until a daily sweep (`executeScheduledDowngrade`, invoked by
 * `triggerDowngradeSweep`, `apps/web/src/lib/jobs.ts`) actually applies it.
 * "Blocks NEW capacity use after grace" therefore costs nothing extra here
 * -- once the sweep flips the org onto the lower plan, the existing checks
 * simply start comparing against smaller numbers, the same as any other
 * plan assignment; "deletes nothing" holds for the identical reason. Both
 * `activateSubscription` and `endSubscription` auto-cancel any still-PENDING
 * scheduled downgrade the instant they touch an organization's plan
 * directly, so a stale schedule can never silently reapply itself over an
 * admin's later, more immediate decision.
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
  // S30 (audit M6): a price needs a real currency, or every page showing it would have to guess.
  if (currencySet && !isIsoCurrencyCode(input.currency ?? '')) {
    return 'currency must be a three-letter ISO 4217 code, for example BDT';
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
            currency: input.currency ? normalizeCurrencyCode(input.currency) : null,
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
    track(
      'currency',
      typeof input.currency === 'string' ? normalizeCurrencyCode(input.currency) : input.currency,
    );

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
    // OPS-04 plan usage: an organization's plan changed. No account is recorded:
    // this is a commercial fact about the organization, not about the platform
    // owner who happened to record it.
    await recordProductEvent(tx, {
      eventType: 'PLAN_CHANGED',
      accountId: null,
      organizationId: input.organizationId,
      dimension: 'SUBSCRIPTION_ACTIVATED',
    });
    await supersedePendingDowngrade(tx, input.organizationId, input.actor.accountId, now);
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

    const now = new Date();
    await tx
      .update(schema.subscriptions)
      .set({ endedAt: now })
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
    await supersedePendingDowngrade(tx, input.organizationId, input.actor.accountId, now);
    return ok({ ended: true });
  });
}

/**
 * Auto-cancels any still-PENDING scheduled downgrade for this organization,
 * as a side effect of an immediate plan change (`activateSubscription`) or
 * an unassignment (`endSubscription`) that makes it stale -- left in place,
 * it would later fire and silently re-apply a now-irrelevant plan change
 * (or worse, undo the change this call just made). MUST be called from
 * inside the caller's own transaction, mirroring every other multi-effect
 * mutation in this file.
 */
async function supersedePendingDowngrade(
  tx: Db,
  organizationId: string,
  actorAccountId: string,
  now: Date,
): Promise<void> {
  const pending = first(
    await tx
      .select({ id: schema.scheduledDowngrades.id })
      .from(schema.scheduledDowngrades)
      .where(
        and(
          eq(schema.scheduledDowngrades.organizationId, organizationId),
          eq(schema.scheduledDowngrades.status, 'PENDING'),
        ),
      )
      .limit(1),
  );
  if (!pending) return;
  await tx
    .update(schema.scheduledDowngrades)
    .set({
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledByAccountId: actorAccountId,
      cancelledReason: 'superseded by an immediate plan change',
      updatedAt: now,
    })
    .where(eq(schema.scheduledDowngrades.id, pending.id));
  await appendAuditEvent(tx, {
    eventType: 'DOWNGRADE_CANCELLED',
    actorAccountId,
    action: 'MANAGE',
    method: 'SYSTEM',
    result: 'ALLOWED',
    resourceType: 'scheduled_downgrade',
    resourceId: pending.id,
    reason: 'superseded by an immediate plan change',
    metadata: { organizationId },
  });
  await cancelQueuedNotificationsForResource(tx, pending.id);
}

const DOWNGRADE_COMPARISON_DIMENSIONS = [
  'seatsAllowed',
  'casesPerPeriodAllowed',
  'concurrentOpenCasesAllowed',
  'storageBytesAllowed',
  'aiAllowanceUnitsAllowed',
] as const;

/**
 * True if `to` is not MORE generous than `from` on any entitlement
 * dimension (`null` = unlimited = the largest possible value). The gate
 * `scheduleDowngrade` uses to refuse being used for what is actually an
 * upgrade, or a mixed change that increases some dimension, in disguise.
 */
function isDowngrade(from: Plan, to: Plan): boolean {
  return DOWNGRADE_COMPARISON_DIMENSIONS.every((dimension) => {
    const fromValue = from[dimension] ?? Number.POSITIVE_INFINITY;
    const toValue = to[dimension] ?? Number.POSITIVE_INFINITY;
    return toValue <= fromValue;
  });
}

async function activeOwnerAccountIds(tx: Db, organizationId: string): Promise<string[]> {
  const rows = await tx
    .select({ accountId: schema.memberships.accountId })
    .from(schema.memberships)
    .where(
      and(
        eq(schema.memberships.organizationId, organizationId),
        eq(schema.memberships.role, 'OWNER'),
        eq(schema.memberships.active, true),
      ),
    );
  return rows.map((r) => r.accountId);
}

export type ScheduledDowngrade = typeof schema.scheduledDowngrades.$inferSelect;

/** Default warning/grace window when `scheduleDowngrade` isn't given an explicit `effectiveAt`. */
const DEFAULT_DOWNGRADE_GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface ScheduleDowngradeInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly organizationId: string;
  readonly toPlanId: string;
  readonly reason: string;
  /** Must be in the future. Defaults to `now + 14 days` when omitted. */
  readonly effectiveAt?: Date;
  readonly now?: Date;
}

/**
 * Schedule a future, warned plan change for an organization currently on a
 * more generous plan -- see this file's own top doc comment for how this
 * differs from `activateSubscription`'s immediate cutover. Refuses a target
 * plan that is not actually a downgrade on every dimension (`isDowngrade`);
 * an upgrade or a lateral change should go through `activateSubscription`
 * instead, immediately, with no reason to warn anyone first. Sends one
 * warning notification to the organization's active owner(s) -- the PRD's
 * own "warning" requirement -- with the exact effective date.
 */
export async function scheduleDowngrade(
  db: Db,
  input: ScheduleDowngradeInput,
): Promise<Result<ScheduledDowngrade, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can schedule a downgrade'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'scheduling a downgrade requires reauthentication'),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const now = input.now ?? new Date();
  const effectiveAt = input.effectiveAt ?? new Date(now.getTime() + DEFAULT_DOWNGRADE_GRACE_MS);
  if (effectiveAt.getTime() <= now.getTime()) {
    return err(serviceError('invalid', 'effectiveAt must be in the future'));
  }

  const org = first(
    await db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(eq(schema.organizations.id, input.organizationId))
      .limit(1),
  );
  if (!org) return err(serviceError('not_found', 'organization not found'));

  const toPlan = first(
    await db.select().from(schema.plans).where(eq(schema.plans.id, input.toPlanId)).limit(1),
  );
  if (!toPlan) return err(serviceError('not_found', 'plan not found'));
  if (!toPlan.active) {
    return err(serviceError('invalid', 'this plan is retired and cannot be newly assigned'));
  }

  const fromPlan = await getCurrentPlanForOrganization(db, input.organizationId);
  if (!fromPlan) {
    return err(
      serviceError(
        'invalid',
        'this organization has no current subscription to downgrade from -- use activateSubscription',
      ),
    );
  }
  if (!isDowngrade(fromPlan, toPlan)) {
    return err(
      serviceError(
        'invalid',
        'the target plan is not a downgrade from the current plan on every dimension -- use activateSubscription for an immediate change',
      ),
    );
  }

  const existingPending = first(
    await db
      .select({ id: schema.scheduledDowngrades.id })
      .from(schema.scheduledDowngrades)
      .where(
        and(
          eq(schema.scheduledDowngrades.organizationId, input.organizationId),
          eq(schema.scheduledDowngrades.status, 'PENDING'),
        ),
      )
      .limit(1),
  );
  if (existingPending) {
    return err(serviceError('invalid', 'a downgrade is already scheduled for this organization'));
  }

  try {
    return await db.transaction(async (tx) => {
      const downgrade = required(
        first(
          await tx
            .insert(schema.scheduledDowngrades)
            .values({
              organizationId: input.organizationId,
              fromPlanId: fromPlan.id,
              toPlanId: toPlan.id,
              effectiveAt,
              requestedByAccountId: input.actor.accountId,
              reason,
            })
            .returning(),
        ),
        'scheduled downgrade',
      );
      await appendAuditEvent(tx, {
        eventType: 'DOWNGRADE_SCHEDULED',
        actorAccountId: input.actor.accountId,
        action: 'MANAGE',
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'scheduled_downgrade',
        resourceId: downgrade.id,
        reason,
        metadata: {
          organizationId: input.organizationId,
          fromPlanKey: fromPlan.key,
          toPlanKey: toPlan.key,
          effectiveAt: effectiveAt.toISOString(),
        },
      });
      for (const ownerAccountId of await activeOwnerAccountIds(tx, input.organizationId)) {
        await enqueueNotificationBothChannels(tx, {
          eventType: 'DOWNGRADE_SCHEDULED',
          resourceId: downgrade.id,
          recipientAccountId: ownerAccountId,
          organizationId: input.organizationId,
          payload: {
            subject: 'A plan change is scheduled for your organization',
            summary: `Your plan will change from ${fromPlan.name} to ${toPlan.name} on ${formatBillingDate(effectiveAt)}.`,
            deepLinkPath: `/app/agency/${input.organizationId}/plan`,
          },
        });
      }
      return ok(downgrade);
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(serviceError('invalid', 'a downgrade is already scheduled for this organization'));
    }
    throw error;
  }
}

export interface CancelScheduledDowngradeInput {
  readonly actor: PlatformAuthInput;
  readonly stepUpSatisfied: boolean;
  readonly downgradeId: string;
  readonly reason: string;
}

/**
 * Cancel a still-PENDING scheduled downgrade. Idempotent: cancelling an
 * already-cancelled downgrade returns it unchanged, the same shape
 * `revokeSupportGrant` already uses for "nothing left to do." Refuses once
 * the downgrade has already EXECUTED -- the plan change it describes has
 * already happened and cannot be undone by cancelling the record of it.
 */
export async function cancelScheduledDowngrade(
  db: Db,
  input: CancelScheduledDowngradeInput,
): Promise<Result<ScheduledDowngrade, ServiceError>> {
  if (!(await isPlatformOwner(db, input.actor))) {
    return err(serviceError('forbidden', 'only a platform owner can cancel a scheduled downgrade'));
  }
  if (!input.stepUpSatisfied) {
    return err(
      serviceError(
        'step_up_required',
        'cancelling a scheduled downgrade requires reauthentication',
      ),
    );
  }
  const reason = input.reason.trim();
  if (reason.length === 0) return err(serviceError('invalid', 'a reason is required'));

  const existing = first(
    await db
      .select()
      .from(schema.scheduledDowngrades)
      .where(eq(schema.scheduledDowngrades.id, input.downgradeId))
      .limit(1),
  );
  if (!existing) return err(serviceError('not_found', 'scheduled downgrade not found'));
  if (existing.status === 'CANCELLED') return ok(existing);
  if (existing.status === 'EXECUTED') {
    return err(serviceError('invalid', 'this downgrade has already taken effect'));
  }

  return db.transaction(async (tx) => {
    const cancelled = required(
      first(
        await tx
          .update(schema.scheduledDowngrades)
          .set({
            status: 'CANCELLED',
            cancelledAt: new Date(),
            cancelledByAccountId: input.actor.accountId,
            cancelledReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(schema.scheduledDowngrades.id, input.downgradeId))
          .returning(),
      ),
      'scheduled downgrade',
    );
    await appendAuditEvent(tx, {
      eventType: 'DOWNGRADE_CANCELLED',
      actorAccountId: input.actor.accountId,
      action: 'MANAGE',
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'scheduled_downgrade',
      resourceId: cancelled.id,
      reason,
      metadata: { organizationId: cancelled.organizationId },
    });
    await cancelQueuedNotificationsForResource(tx, cancelled.id);
    return ok(cancelled);
  });
}

/** PENDING scheduled downgrades whose effective date has arrived -- ready for `executeScheduledDowngrade`. */
export async function listDueDowngrades(
  db: Db,
  now: Date = new Date(),
): Promise<ScheduledDowngrade[]> {
  return db
    .select()
    .from(schema.scheduledDowngrades)
    .where(
      and(
        eq(schema.scheduledDowngrades.status, 'PENDING'),
        lte(schema.scheduledDowngrades.effectiveAt, now),
      ),
    );
}

/**
 * Apply a due scheduled downgrade: ends the organization's current
 * subscription and starts the new (lower) one, the same atomic cutover
 * `activateSubscription` itself performs, then marks the schedule EXECUTED.
 * System operation -- invoked only by the sweep (`triggerDowngradeSweep`,
 * `apps/web/src/lib/jobs.ts`), never directly by a user, so it takes no
 * actor/step-up. Re-checks both that the downgrade is still due AND that
 * the organization's current subscription still matches what was scheduled
 * -- it always should, since `activateSubscription`/`endSubscription` both
 * auto-cancel any PENDING downgrade the instant they touch this
 * organization's plan -- but this is the same defense-in-depth re-check
 * `executeAccountDeletion` already applies to its own grace window.
 */
export async function executeScheduledDowngrade(
  db: Db,
  input: { readonly downgradeId: string; readonly now?: Date },
): Promise<Result<ScheduledDowngrade, ServiceError>> {
  const pending = first(
    await db
      .select()
      .from(schema.scheduledDowngrades)
      .where(
        and(
          eq(schema.scheduledDowngrades.id, input.downgradeId),
          eq(schema.scheduledDowngrades.status, 'PENDING'),
        ),
      )
      .limit(1),
  );
  if (!pending) return err(serviceError('not_found', 'no pending scheduled downgrade'));
  const now = input.now ?? new Date();
  if (now.getTime() < pending.effectiveAt.getTime()) {
    return err(serviceError('invalid', 'effective date has not arrived'));
  }

  return db.transaction(async (tx) => {
    const current = first(
      await tx
        .select()
        .from(schema.subscriptions)
        .where(
          and(
            eq(schema.subscriptions.organizationId, pending.organizationId),
            isNull(schema.subscriptions.endedAt),
          ),
        )
        .limit(1),
    );
    if (!current || current.planId !== pending.fromPlanId) {
      return err(
        serviceError(
          'invalid',
          "this organization's plan changed since this downgrade was scheduled",
        ),
      );
    }

    const toPlan = first(
      await tx.select().from(schema.plans).where(eq(schema.plans.id, pending.toPlanId)).limit(1),
    );
    if (!toPlan) return err(serviceError('not_found', 'plan not found'));

    await tx
      .update(schema.subscriptions)
      .set({ endedAt: now })
      .where(eq(schema.subscriptions.id, current.id));
    const subscription = required(
      first(
        await tx
          .insert(schema.subscriptions)
          .values({
            organizationId: pending.organizationId,
            planId: pending.toPlanId,
            startedAt: now,
            assignedByAccountId: pending.requestedByAccountId,
            reason: `Scheduled downgrade executed: ${pending.reason}`,
          })
          .returning(),
      ),
      'subscription',
    );
    const executed = required(
      first(
        await tx
          .update(schema.scheduledDowngrades)
          .set({ status: 'EXECUTED', executedAt: now, updatedAt: now })
          .where(eq(schema.scheduledDowngrades.id, pending.id))
          .returning(),
      ),
      'scheduled downgrade',
    );
    await appendAuditEvent(tx, {
      eventType: 'DOWNGRADE_EXECUTED',
      actorAccountId: pending.requestedByAccountId,
      action: 'MANAGE',
      method: 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: {
        organizationId: pending.organizationId,
        planKey: toPlan.key,
        scheduledDowngradeId: pending.id,
      },
    });
    await recordProductEvent(tx, {
      eventType: 'PLAN_CHANGED',
      accountId: null,
      organizationId: pending.organizationId,
      dimension: 'DOWNGRADE_EXECUTED',
    });
    for (const ownerAccountId of await activeOwnerAccountIds(tx, pending.organizationId)) {
      await enqueueNotificationBothChannels(tx, {
        eventType: 'DOWNGRADE_EXECUTED',
        resourceId: executed.id,
        recipientAccountId: ownerAccountId,
        organizationId: pending.organizationId,
        payload: {
          subject: 'Your plan has changed',
          summary: `Your organization's plan changed to ${toPlan.name}.`,
          deepLinkPath: `/app/agency/${pending.organizationId}/plan`,
        },
      });
    }
    return ok(executed);
  });
}

/** The organization's currently pending scheduled downgrade, if any (read-only). */
export async function getPendingDowngradeForOrganization(
  db: Db,
  organizationId: string,
): Promise<ScheduledDowngrade | undefined> {
  return first(
    await db
      .select()
      .from(schema.scheduledDowngrades)
      .where(
        and(
          eq(schema.scheduledDowngrades.organizationId, organizationId),
          eq(schema.scheduledDowngrades.status, 'PENDING'),
        ),
      )
      .limit(1),
  );
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

export async function countActiveSeats(db: Db, organizationId: string): Promise<number> {
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

export async function countCasesInPeriod(
  db: Db,
  organizationId: string,
  since: Date,
): Promise<number> {
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

export async function countConcurrentOpenCases(db: Db, organizationId: string): Promise<number> {
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
          excludingDeterministicRuns(schema.aiExtractionRuns.modelVersion),
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
  input: {
    readonly actorAccountId: string;
    readonly organizationId: string;
    readonly now?: Date;
    /** Platform-owner read access for any organization, mirroring this file's platform-owner-only write gates -- optional so every existing member-facing call site keeps its exact prior behavior when it doesn't pass these. */
    readonly actorEmail?: string;
    readonly bootstrapEmails?: readonly string[];
  },
): Promise<Result<OrganizationUsage, ServiceError>> {
  const authorized =
    (await isActiveMember(db, input.actorAccountId, input.organizationId)) ||
    (input.actorEmail !== undefined &&
      (await isPlatformOwner(db, {
        accountId: input.actorAccountId,
        email: input.actorEmail,
        bootstrapEmails: input.bootstrapEmails ?? [],
      })));
  if (!authorized) {
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
      label: 'Team Members',
      definition: 'People with an active place in your agency.',
      used: seatsUsed,
      allowed: plan?.seatsAllowed ?? null,
    },
    {
      key: 'casesPerPeriod',
      label: 'New Cases',
      definition: `Cases your agency started in the last ${plan?.periodDays ?? 30} days.`,
      used: casesUsed,
      allowed: plan?.casesPerPeriodAllowed ?? null,
    },
    {
      key: 'concurrentOpenCases',
      label: 'Open Cases',
      definition: 'Cases of your agency that are not closed or cancelled yet.',
      used: concurrentUsed,
      allowed: plan?.concurrentOpenCasesAllowed ?? null,
    },
    {
      key: 'storageBytes',
      label: 'Storage',
      definition:
        'Files kept for every traveller who currently shares their record with your agency.',
      used: storageUsed,
      allowed: plan?.storageBytesAllowed ?? null,
    },
    {
      key: 'aiAllowanceUnits',
      label: 'AI Allowance',
      definition: `Automatic document reading used in the last ${plan?.periodDays ?? 30} days for travellers who share their record with your agency.`,
      used: aiUsed,
      allowed: plan?.aiAllowanceUnitsAllowed ?? null,
    },
  ];

  return ok({ planAssigned: plan !== undefined, plan, meters });
}
