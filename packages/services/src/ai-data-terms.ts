import { type Result, err, ok } from '@visastack/core';
import { desc, eq, inArray } from 'drizzle-orm';
import { StaffScope } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, required, schema } from './db';
import { type ServiceError, serviceError } from './errors';

const { AI_PROVIDER_TIERS, AI_TERMS_TEXT_MAX, AI_TRAINING_ANSWERS } = schema;

/** How long a staff scope stays good for: minted for one request, never kept. Same window as document protection. */
const STAFF_SCOPE_MAX_AGE_MS = 5 * 60 * 1000;

/** A genuine, fresh security-admin scope for AI settings, or the refusal to return. */
function staffScopeProblem(staff: unknown): ServiceError | undefined {
  if (
    !StaffScope.isGenuine(staff) ||
    staff.platformAction !== 'AI_SETTINGS_MANAGE' ||
    Date.now() - staff.verifiedAt.getTime() > STAFF_SCOPE_MAX_AGE_MS
  ) {
    return serviceError('forbidden', 'security-admin permission is required');
  }
  return undefined;
}

/**
 * What the provider account behind each AI configuration does with what
 * VisaStack sends it, and the one rule that decides whether a configuration
 * may be used (public beta directive 11.3: "Do not send real passport scans,
 * identity documents or similarly sensitive information to a free AI API
 * when its terms permit using those inputs to improve the provider's
 * products").
 *
 * Owner decision 2026-10-25: terms are recorded and shown, and the platform
 * warns admins, but nothing is blocked until a platform admin switches on
 * "Only Use AI Providers That Do Not Train on Inputs"
 * (`ai_data_rule_settings`, off by default). `decideAiProviderUse` below is
 * the whole rule and the only place it lives; the web gateway
 * (apps/web/src/lib/ai.ts) runs it for the primary configuration and for its
 * fallback before any adapter is built, so no AI task can reach a provider
 * without passing it.
 *
 * Terms are kept per configuration (`ai_provider_config_terms`) because the
 * tier and the training answer belong to the provider account behind that
 * configuration's key.
 */

export type AiProviderTier = (typeof AI_PROVIDER_TIERS)[number];
export type AiTrainingAnswer = (typeof AI_TRAINING_ANSWERS)[number];

/**
 * Which kind of data the platform may be holding right now. Decided at the
 * application edge from the deployment mode and the real-applicant-data
 * capability (apps/web/src/lib/ai.ts `currentAiDataMode`), never by a client.
 * It decides only whether admins are warned; blocking depends on the setting.
 */
export type AiDataMode = 'synthetic_only' | 'real_applicant_data';

export interface AiProviderDataTerms {
  readonly configId: string;
  /** False when nothing has ever been recorded for this configuration (or the table is not there yet): every other field is then "unknown". */
  readonly recorded: boolean;
  readonly tier: AiProviderTier | 'UNKNOWN';
  readonly trainsOnInputs: AiTrainingAnswer;
  readonly retentionDays: number | null;
  readonly region: string | null;
  readonly termsUrl: string | null;
  /** ISO date (YYYY-MM-DD) the terms were read, or null when never recorded. */
  readonly checkedOn: string | null;
  readonly notes: string | null;
  readonly recordedAt: Date | null;
}

export function unknownAiProviderDataTerms(configId: string): AiProviderDataTerms {
  return {
    configId,
    recorded: false,
    tier: 'UNKNOWN',
    trainsOnInputs: 'UNKNOWN',
    retentionDays: null,
    region: null,
    termsUrl: null,
    checkedOn: null,
    notes: null,
    recordedAt: null,
  };
}

/**
 * Why a configuration's terms do not show that it leaves inputs alone.
 * `trains_on_inputs`: recorded as YES. `training_unknown`: recorded, but as
 * UNKNOWN. `terms_unrecorded`: nothing recorded at all. `terms_incomplete`:
 * recorded as NO but without the terms address, so the answer cannot be
 * checked again.
 */
export type AiTermsConcern =
  | 'trains_on_inputs'
  | 'training_unknown'
  | 'terms_unrecorded'
  | 'terms_incomplete';

/** Null when the recorded terms say the provider does not train on inputs, with the address of those terms. */
export function aiTermsConcern(terms: AiProviderDataTerms): AiTermsConcern | null {
  if (!terms.recorded) return 'terms_unrecorded';
  if (terms.trainsOnInputs === 'YES') return 'trains_on_inputs';
  if (terms.trainsOnInputs === 'UNKNOWN') return 'training_unknown';
  if (!terms.termsUrl || !terms.checkedOn) return 'terms_incomplete';
  return null;
}

export interface AiProviderUseInput {
  readonly mode: AiDataMode;
  readonly terms: AiProviderDataTerms;
  /** The platform setting "Only Use AI Providers That Do Not Train on Inputs". */
  readonly requireNoTraining: boolean;
}

export type AiProviderUseDecision =
  | {
      readonly allowed: true;
      /** Set when real applicant data is on and the terms raise a concern: admins are warned, the call still runs. */
      readonly warning: AiTermsConcern | null;
    }
  | { readonly allowed: false; readonly reason: AiTermsConcern };

/**
 * The single data-terms rule every AI call passes through.
 *
 * - Setting on: a configuration runs only when its recorded terms say the
 *   provider does NOT train on inputs, with the address of those terms, in
 *   every mode. Anything else is refused and the gateway treats AI as
 *   unavailable; every manual path keeps working.
 * - Setting off (the default): nothing is refused. When real applicant data
 *   is on and the terms raise a concern, the decision carries a warning that
 *   the admin page shows.
 */
export function decideAiProviderUse(input: AiProviderUseInput): AiProviderUseDecision {
  const concern = aiTermsConcern(input.terms);
  if (input.requireNoTraining && concern) return { allowed: false, reason: concern };
  return { allowed: true, warning: input.mode === 'real_applicant_data' ? concern : null };
}

/** Days after which the admin page asks for the terms to be read again. Advisory only: it never blocks a call. */
export const AI_TERMS_RECHECK_DAYS = 180;

export function isAiTermsCheckDue(terms: AiProviderDataTerms, now: Date = new Date()): boolean {
  if (!terms.checkedOn) return true;
  const checked = Date.parse(`${terms.checkedOn}T00:00:00Z`);
  if (!Number.isFinite(checked)) return true;
  return now.getTime() - checked > AI_TERMS_RECHECK_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Postgres `undefined_table` (42P01) or `undefined_column` (42703), as raised
 * directly or wrapped by the driver: the expected failure between a deploy
 * and the migration that adds these tables.
 */
export function isMissingRelationError(error: unknown): boolean {
  const visit = (value: unknown, depth: number): boolean => {
    if (typeof value !== 'object' || value === null || depth > 3) return false;
    const { code, message, cause } = value as {
      code?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === '42P01' || code === '42703') return true;
    if (typeof message === 'string' && /(relation|column) .* does not exist/i.test(message)) {
      return true;
    }
    return visit(cause, depth + 1);
  };
  return visit(error, 0);
}

export interface AiProviderDataTermsState {
  /** False when the terms could not be read (table not there yet, or a read failure): every configuration is then "unknown". */
  readonly available: boolean;
  readonly byConfigId: ReadonlyMap<string, AiProviderDataTerms>;
}

type TermsRow = typeof schema.aiProviderConfigTerms.$inferSelect;

function termsFromRow(row: TermsRow): AiProviderDataTerms {
  return {
    configId: row.configId,
    recorded: true,
    tier: row.tier,
    trainsOnInputs: row.trainsOnInputs,
    retentionDays: row.retentionDays,
    region: row.region,
    termsUrl: row.termsUrl,
    checkedOn: row.checkedOn,
    notes: row.notes,
    recordedAt: row.createdAt,
  };
}

/**
 * The terms in force (the newest row) for each of `configIds`. No permission
 * check: the gateway itself reads this on behalf of a request that is
 * already otherwise authorized, the same trust level as
 * `getActiveAiProviderConfig`; the admin page reads it after its own
 * permission check.
 *
 * The read runs in its own savepoint so a failure cannot spoil a caller's
 * transaction. If it fails for any reason, every configuration reads as
 * "unknown": shown as a warning, and refused only while the "Only Use AI
 * Providers That Do Not Train on Inputs" setting is on. Only the
 * missing-table case is quiet; anything else is reported.
 */
export async function loadAiProviderDataTerms(
  db: Db,
  configIds: readonly string[],
): Promise<AiProviderDataTermsState> {
  if (configIds.length === 0) return { available: true, byConfigId: new Map() };
  try {
    const rows = await db.transaction(async (inner) =>
      inner
        .select()
        .from(schema.aiProviderConfigTerms)
        .where(inArray(schema.aiProviderConfigTerms.configId, [...configIds]))
        .orderBy(
          desc(schema.aiProviderConfigTerms.createdAt),
          desc(schema.aiProviderConfigTerms.id),
        ),
    );
    const byConfigId = new Map<string, AiProviderDataTerms>();
    for (const row of rows) {
      if (!byConfigId.has(row.configId)) byConfigId.set(row.configId, termsFromRow(row));
    }
    return { available: true, byConfigId };
  } catch (error) {
    if (!isMissingRelationError(error)) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[ai-data-terms] provider terms could not be read; treating as unknown: ${message}`,
      );
    }
    return { available: false, byConfigId: new Map() };
  }
}

export function aiProviderTermsFor(
  state: AiProviderDataTermsState,
  configId: string,
): AiProviderDataTerms {
  return state.byConfigId.get(configId) ?? unknownAiProviderDataTerms(configId);
}

export interface RecordAiProviderDataTermsInput {
  readonly stepUpSatisfied: boolean;
  readonly configId: string;
  readonly tier: AiProviderTier;
  readonly trainsOnInputs: AiTrainingAnswer;
  readonly retentionDays?: number;
  readonly region?: string;
  readonly termsUrl?: string;
  /** ISO date (YYYY-MM-DD). */
  readonly checkedOn: string;
  readonly notes?: string;
  /** Defaults to now; tests pass a fixed clock. */
  readonly now?: Date;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The checks a terms record must pass, shared by `recordAiProviderDataTerms`
 * and the admin forms (so a draft is never created with terms that would
 * then be refused). Returns a plain sentence fragment, or undefined.
 */
export function validateAiProviderDataTerms(
  input: Omit<RecordAiProviderDataTermsInput, 'stepUpSatisfied' | 'configId'>,
): string | undefined {
  if (!(AI_PROVIDER_TIERS as readonly string[]).includes(input.tier)) return 'choose free or paid';
  if (!(AI_TRAINING_ANSWERS as readonly string[]).includes(input.trainsOnInputs)) {
    return 'choose whether the provider may train on what it is sent';
  }
  if (
    input.retentionDays !== undefined &&
    (!Number.isInteger(input.retentionDays) ||
      input.retentionDays < 0 ||
      input.retentionDays > 3650)
  ) {
    return 'retention must be a whole number of days between 0 and 3650';
  }
  if (input.region !== undefined && input.region.trim().length > 120) {
    return 'the region must be 120 characters or fewer';
  }
  if (input.termsUrl !== undefined) {
    const url = input.termsUrl.trim();
    if (!url.startsWith('https://') || url.length > AI_TERMS_TEXT_MAX) {
      return 'the terms address must start with https:// and be 500 characters or fewer';
    }
    if (!URL.canParse(url)) return 'the terms address is not a valid web address';
  }
  if (input.notes !== undefined && input.notes.trim().length > AI_TERMS_TEXT_MAX) {
    return 'notes must be 500 characters or fewer';
  }
  const checked = Date.parse(`${input.checkedOn}T00:00:00Z`);
  if (
    !ISO_DATE.test(input.checkedOn) ||
    !Number.isFinite(checked) ||
    // Date.parse rolls an impossible day (31 February) into the next month.
    new Date(checked).toISOString().slice(0, 10) !== input.checkedOn
  ) {
    return 'enter the date the terms were checked';
  }
  if (checked > (input.now ?? new Date()).getTime() + DAY_MS) {
    return 'the date checked cannot be in the future';
  }
  if (input.trainsOnInputs === 'NO' && input.termsUrl === undefined) {
    return 'a "does not train" answer needs the address of the terms that say so';
  }
  return undefined;
}

/**
 * Record what the provider's terms say for one configuration, as read on
 * `checkedOn`. Security admin and a fresh sign-in check, like every other AI
 * settings change. A new row each time (never an edit), and written to the
 * audit chain with the full answer, so the record of what the platform
 * believed, and who said so, survives.
 */
export async function recordAiProviderDataTerms(
  db: Db,
  staff: StaffScope<'AI_SETTINGS_MANAGE'>,
  input: RecordAiProviderDataTermsInput,
): Promise<Result<AiProviderDataTerms, ServiceError>> {
  const denied = staffScopeProblem(staff);
  if (denied) return err(denied);
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'recording provider terms requires reauthentication'),
    );
  }
  const problem = validateAiProviderDataTerms(input);
  if (problem) return err(serviceError('invalid', problem));

  try {
    return await db.transaction(async (tx) => {
      const config = first(
        await tx
          .select({ id: schema.aiProviderConfigs.id, provider: schema.aiProviderConfigs.provider })
          .from(schema.aiProviderConfigs)
          .where(eq(schema.aiProviderConfigs.id, input.configId))
          .limit(1),
      );
      if (!config) return err(serviceError('not_found', 'configuration not found'));
      const row = required(
        first(
          await tx
            .insert(schema.aiProviderConfigTerms)
            .values({
              configId: config.id,
              tier: input.tier,
              trainsOnInputs: input.trainsOnInputs,
              retentionDays: input.retentionDays ?? null,
              region: input.region?.trim() || null,
              termsUrl: input.termsUrl?.trim() || null,
              checkedOn: input.checkedOn,
              notes: input.notes?.trim() || null,
              recordedByAccountId: staff.accountId,
            })
            .returning(),
        ),
        'ai provider data terms',
      );
      await appendAuditEvent(tx, {
        eventType: 'AI_PROVIDER_TERMS_RECORDED',
        actorAccountId: staff.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'ai_provider_config',
        resourceId: config.id,
        metadata: {
          provider: config.provider,
          tier: row.tier,
          trainsOnInputs: row.trainsOnInputs,
          retentionDays: row.retentionDays,
          region: row.region,
          termsUrl: row.termsUrl,
          checkedOn: row.checkedOn,
        },
      });
      return ok(termsFromRow(row));
    });
  } catch (error) {
    if (isMissingRelationError(error)) {
      return err(
        serviceError(
          'invalid',
          'provider terms cannot be saved until the latest database update has been applied',
        ),
      );
    }
    throw error;
  }
}

// --- The platform setting ---------------------------------------------------

export interface AiDataRuleSetting {
  readonly requireNoTraining: boolean;
  readonly changedAt: Date | null;
  readonly changedByAccountId: string | null;
  /**
   * `saved`: read from the newest row. `default`: no row yet, or the table is
   * not there yet (off). `read_failed`: the setting could not be read for
   * another reason, so it is treated as ON until it can be: a failure must
   * never quietly turn a switched-on protection off.
   */
  readonly source: 'saved' | 'default' | 'read_failed';
}

/**
 * The setting in force. No permission check (the gateway reads it for an
 * already authorized request). Runs in its own savepoint. A missing table
 * reads as off, the owner's chosen default, so a deploy before the migration
 * behaves exactly as before; any other failure reads as on and is reported.
 */
export async function loadAiDataRuleSetting(db: Db): Promise<AiDataRuleSetting> {
  try {
    const row = first(
      await db.transaction(async (inner) =>
        inner
          .select()
          .from(schema.aiDataRuleSettings)
          .orderBy(desc(schema.aiDataRuleSettings.createdAt), desc(schema.aiDataRuleSettings.id))
          .limit(1),
      ),
    );
    if (!row) {
      return {
        requireNoTraining: false,
        changedAt: null,
        changedByAccountId: null,
        source: 'default',
      };
    }
    return {
      requireNoTraining: row.requireNoTraining,
      changedAt: row.createdAt,
      changedByAccountId: row.changedByAccountId,
      source: 'saved',
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return {
        requireNoTraining: false,
        changedAt: null,
        changedByAccountId: null,
        source: 'default',
      };
    }
    const message = error instanceof Error ? error.message : String(error);
    // Read as off (owner 2026-10-25: never block the free tier unless told
    // to). A passing database error must not switch AI off for everyone; the
    // admin page says the setting could not be read.
    console.error(
      `[ai-data-terms] the AI data setting could not be read; treating it as off: ${message}`,
    );
    return {
      requireNoTraining: false,
      changedAt: null,
      changedByAccountId: null,
      source: 'read_failed',
    };
  }
}

export interface SetAiDataRuleSettingInput {
  readonly stepUpSatisfied: boolean;
  readonly requireNoTraining: boolean;
  readonly reason?: string;
}

/**
 * Switch "Only Use AI Providers That Do Not Train on Inputs" on or off.
 * Security admin and a fresh sign-in check, like every other AI settings
 * change; saved as a new row and written to the audit chain with the
 * previous value. Takes effect on the next AI call, with no deploy.
 */
export async function setAiDataRuleSetting(
  db: Db,
  staff: StaffScope<'AI_SETTINGS_MANAGE'>,
  input: SetAiDataRuleSettingInput,
): Promise<Result<AiDataRuleSetting, ServiceError>> {
  const denied = staffScopeProblem(staff);
  if (denied) return err(denied);
  if (!input.stepUpSatisfied) {
    return err(
      serviceError('step_up_required', 'changing the AI data setting requires reauthentication'),
    );
  }
  const reason = input.reason?.trim() || null;
  if (reason !== null && reason.length > AI_TERMS_TEXT_MAX) {
    return err(serviceError('invalid', 'the reason must be 500 characters or fewer'));
  }
  try {
    return await db.transaction(async (tx) => {
      const previous = first(
        await tx
          .select({ requireNoTraining: schema.aiDataRuleSettings.requireNoTraining })
          .from(schema.aiDataRuleSettings)
          .orderBy(desc(schema.aiDataRuleSettings.createdAt), desc(schema.aiDataRuleSettings.id))
          .limit(1),
      );
      const row = required(
        first(
          await tx
            .insert(schema.aiDataRuleSettings)
            .values({
              requireNoTraining: input.requireNoTraining,
              reason,
              changedByAccountId: staff.accountId,
            })
            .returning(),
        ),
        'ai data rule setting',
      );
      await appendAuditEvent(tx, {
        eventType: 'AI_DATA_RULE_CHANGED',
        actorAccountId: staff.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'ai_data_rule_setting',
        resourceId: row.id,
        metadata: {
          requireNoTraining: row.requireNoTraining,
          previousRequireNoTraining: previous?.requireNoTraining ?? false,
          reason,
        },
      });
      return ok({
        requireNoTraining: row.requireNoTraining,
        changedAt: row.createdAt,
        changedByAccountId: row.changedByAccountId,
        source: 'saved' as const,
      });
    });
  } catch (error) {
    if (isMissingRelationError(error)) {
      return err(
        serviceError(
          'invalid',
          'this setting cannot be saved until the latest database update has been applied',
        ),
      );
    }
    throw error;
  }
}
