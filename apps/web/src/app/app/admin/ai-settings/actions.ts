'use server';

import { passesThresholds, runEvaluationSuite } from '@visastack/adapters';
import {
  type AiProviderDataTerms,
  type AiProviderTier,
  type AiTrainingAnswer,
  type PlatformAuthInput,
  type RecordAiProviderDataTermsInput,
  activateAiProviderConfig,
  aiProviderTermsFor,
  createDraftAiProviderConfig,
  deleteDraftAiProviderConfig,
  emergencyDisableAiProviderConfig,
  getAiProviderConfigById,
  loadAiProviderDataTerms,
  recordAiProviderConfigEvaluation,
  recordAiProviderConfigTest,
  recordAiProviderDataTerms,
  revokeAiProviderConfigKey,
  rollbackAiProviderConfig,
  setAiDataRuleSetting,
  updateDraftAiProviderConfig,
  validateAiProviderDataTerms,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, hasPlatformPermission, staffPrincipal } from '../../../../lib/admin';
import { resolveTestAdapter, usdToUnits } from '../../../../lib/ai';
import { clearAiCapabilityCache } from '../../../../lib/capabilities';
import { createKeyManagementPort } from '../../../../lib/providers';
import { forgetReadinessSignals } from '../../../../lib/readiness-signals';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';

// Fixed, synthetic content only -- the directive's own explicit instruction
// for this journey step ("do not use customer documents"). Any provider
// response (or none at all) is fine; this only proves the configured
// credentials and network path actually work end to end.
const SYNTHETIC_TEST_DOCUMENT_TEXT =
  'This is a synthetic connectivity test for the VisaStack AI Gateway admin console. It is not a real document and does not describe a real person. Respond with no field proposals.';
const SYNTHETIC_TEST_ALLOWED_FIELD_KEYS = ['fullName'] as const;

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };
const AI_SETTINGS_PATH = '/app/admin/ai-settings';
// rollbackAiProviderConfig/emergencyDisableAiProviderConfig take no target id
// -- they always act on "whatever is currently ACTIVE" -- so step-up here is
// bound to a fixed platform-wide resource, the same convention
// purgeExpiredDocumentsAction (../actions.ts) already uses for an identical
// no-target-id, platform-wide mutation.
const PLATFORM_WIDE_RESOURCE_ID = 'platform-wide';

/**
 * After a settings change: refresh this page and drop this server's cached AI capability answer
 * (other servers catch up within a minute) and its remembered readiness facts, so the AI provider
 * gate fails closed here until readiness is read again.
 */
function settingsChanged(): void {
  clearAiCapabilityCache();
  forgetReadinessSignals();
  revalidatePath(AI_SETTINGS_PATH);
}

function actor(accountId: string, email: string): PlatformAuthInput {
  return { accountId, email, bootstrapEmails: bootstrapAdminEmails() };
}

/** Parses an optional positive number field; blank or invalid means "not set" (the caller omits the key entirely, matching the service's own optional-field convention). */
function parsePositiveNumber(raw: FormDataEntryValue | null): number | undefined {
  const str = String(raw ?? '').trim();
  if (str.length === 0) return undefined;
  const parsed = Number(str);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveInt(raw: FormDataEntryValue | null): number | undefined {
  const parsed = parsePositiveNumber(raw);
  return parsed === undefined ? undefined : Math.floor(parsed);
}

type TermsFields = Omit<RecordAiProviderDataTermsInput, 'stepUpSatisfied' | 'configId'>;

/**
 * Reads the Provider Data Terms fields. `undefined` when the plan was left as
 * "Not Recorded Yet" and nothing else was filled in (draft form only); a
 * string when something is missing or would be refused, checked with the same
 * rules the service applies so a draft is never saved with terms it then
 * refuses.
 */
function parseTermsFields(formData: FormData): TermsFields | string | undefined {
  const tier = String(formData.get('termsTier') ?? '').trim();
  const trains = String(formData.get('termsTrains') ?? 'UNKNOWN').trim();
  const checkedOn = String(formData.get('termsCheckedOn') ?? '').trim();
  const retentionRaw = String(formData.get('termsRetentionDays') ?? '').trim();
  const region = String(formData.get('termsRegion') ?? '').trim();
  const termsUrl = String(formData.get('termsUrl') ?? '').trim();
  const notes = String(formData.get('termsNotes') ?? '').trim();
  if (tier.length === 0) {
    const anythingElse =
      trains !== 'UNKNOWN' ||
      [checkedOn, retentionRaw, region, termsUrl, notes].some((value) => value.length > 0);
    return anythingElse ? 'Choose Free or Paid so the data terms can be saved.' : undefined;
  }
  if (tier !== 'FREE' && tier !== 'PAID') return 'Choose Free or Paid.';
  if (trains !== 'YES' && trains !== 'NO' && trains !== 'UNKNOWN') {
    return 'Choose whether the provider may train on what it is sent.';
  }
  if (checkedOn.length === 0) return 'Enter the date you checked the terms.';
  const retentionDays = retentionRaw.length > 0 ? Number(retentionRaw) : undefined;
  const fields: TermsFields = {
    tier: tier as AiProviderTier,
    trainsOnInputs: trains as AiTrainingAnswer,
    checkedOn,
    ...(retentionDays !== undefined ? { retentionDays } : {}),
    ...(region ? { region } : {}),
    ...(termsUrl ? { termsUrl } : {}),
    ...(notes ? { notes } : {}),
  };
  const problem = validateAiProviderDataTerms(fields);
  return problem ? `${problem.charAt(0).toUpperCase()}${problem.slice(1)}.` : fields;
}

/** The configuration settings every draft form sends (create, edit, and edit as new draft). */
interface ConfigFields {
  readonly model: string;
  readonly apiKey: string;
  readonly reasoningEffort: string;
  readonly dataPolicyApproved: boolean;
  readonly notes: string;
  readonly budgetLimitUsd: number;
  readonly perDocumentBudgetLimitUsd: number | undefined;
  readonly maxAttemptsPerDocument: number | undefined;
  readonly maxPagesPerDocument: number | undefined;
  readonly cacheMaxAgeDays: number | undefined;
  readonly maxConcurrentCalls: number | undefined;
  readonly fallbackEnabled: boolean;
  readonly fallbackProviderConfigId: string;
}

/** Reads the shared settings, or a message naming what is missing. The key is checked by each caller. */
function parseConfigFields(formData: FormData): ConfigFields | string {
  const model = String(formData.get('model') ?? '').trim();
  const budgetLimitUsd = parsePositiveNumber(formData.get('budgetLimitUsd'));
  const fallbackEnabled = formData.get('fallbackEnabled') === 'on';
  const fallbackProviderConfigId = String(formData.get('fallbackProviderConfigId') ?? '').trim();
  if (model.length === 0) return 'Enter a model.';
  if (budgetLimitUsd === undefined) return 'Enter a positive monthly budget in USD.';
  if (fallbackEnabled && fallbackProviderConfigId.length === 0) {
    return 'Choose a fallback configuration to enable fallback.';
  }
  return {
    model,
    apiKey: String(formData.get('apiKey') ?? '').trim(),
    reasoningEffort: String(formData.get('reasoningEffort') ?? '').trim(),
    dataPolicyApproved: formData.get('dataPolicyApproved') === 'on',
    notes: String(formData.get('notes') ?? '').trim(),
    budgetLimitUsd,
    perDocumentBudgetLimitUsd: parsePositiveNumber(formData.get('perDocumentBudgetLimitUsd')),
    maxAttemptsPerDocument: parsePositiveInt(formData.get('maxAttemptsPerDocument')),
    maxPagesPerDocument: parsePositiveInt(formData.get('maxPagesPerDocument')),
    cacheMaxAgeDays: parsePositiveInt(formData.get('cacheMaxAgeDays')),
    maxConcurrentCalls: parsePositiveInt(formData.get('maxConcurrentCalls')),
    fallbackEnabled,
    fallbackProviderConfigId,
  };
}

/** The service's settings input for parsed fields; optional settings left blank are omitted. */
function configSettings(fields: ConfigFields) {
  return {
    model: fields.model,
    dataPolicyApproved: fields.dataPolicyApproved,
    budgetLimitUnits: usdToUnits(fields.budgetLimitUsd),
    ...(fields.reasoningEffort ? { reasoningEffort: fields.reasoningEffort } : {}),
    ...(fields.perDocumentBudgetLimitUsd !== undefined
      ? { perDocumentBudgetLimitUnits: usdToUnits(fields.perDocumentBudgetLimitUsd) }
      : {}),
    ...(fields.maxAttemptsPerDocument !== undefined
      ? { maxAttemptsPerDocument: fields.maxAttemptsPerDocument }
      : {}),
    ...(fields.maxPagesPerDocument !== undefined
      ? { maxPagesPerDocument: fields.maxPagesPerDocument }
      : {}),
    ...(fields.cacheMaxAgeDays !== undefined ? { cacheMaxAgeDays: fields.cacheMaxAgeDays } : {}),
    ...(fields.maxConcurrentCalls !== undefined
      ? { maxConcurrentCalls: fields.maxConcurrentCalls }
      : {}),
    ...(fields.fallbackEnabled ? { fallbackEnabled: true } : {}),
    ...(fields.fallbackProviderConfigId
      ? { fallbackProviderConfigId: fields.fallbackProviderConfigId }
      : {}),
    ...(fields.notes ? { notes: fields.notes } : {}),
  };
}

/** The recorded terms of a configuration as fields to record again, or undefined when none are recorded. */
function carriedTerms(terms: AiProviderDataTerms): TermsFields | undefined {
  if (!terms.recorded || terms.tier === 'UNKNOWN' || terms.checkedOn === null) return undefined;
  return {
    tier: terms.tier,
    trainsOnInputs: terms.trainsOnInputs,
    checkedOn: terms.checkedOn,
    ...(terms.retentionDays !== null ? { retentionDays: terms.retentionDays } : {}),
    ...(terms.region ? { region: terms.region } : {}),
    ...(terms.termsUrl ? { termsUrl: terms.termsUrl } : {}),
    ...(terms.notes ? { notes: terms.notes } : {}),
  };
}

const ENCRYPTION_NOT_CONFIGURED: ActionState = {
  ok: false,
  message:
    'Encryption is not configured in this environment (set up the key service or the local key).',
};

/**
 * Save a new DRAFT AI provider configuration. Has no effect on live traffic until activated.
 * Security-admin + step-up gated (Part 8 §5). With `copyApiKeyFromConfigId` ("Edit as New
 * Draft") the key may be left blank and the saved key of that configuration is reused.
 */
export async function createDraftAiProviderConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = String(formData.get('provider') ?? '').trim();
  const copyApiKeyFromConfigId = String(formData.get('copyApiKeyFromConfigId') ?? '').trim();
  if (provider.length === 0) return { ok: false, message: 'Choose a provider.' };
  const fields = parseConfigFields(formData);
  if (typeof fields === 'string') return { ok: false, message: fields };
  if (fields.apiKey.length === 0 && copyApiKeyFromConfigId.length === 0) {
    return { ok: false, message: 'Enter an API key.' };
  }
  const terms = parseTermsFields(formData);
  if (typeof terms === 'string') return { ok: false, message: terms };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const encryption = createKeyManagementPort();
    if (!encryption) return ENCRYPTION_NOT_CONFIGURED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_CREATE_DRAFT', resourceId: 'new' },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const draft = await createDraftAiProviderConfig(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
      provider,
      apiKey: fields.apiKey,
      ...(copyApiKeyFromConfigId ? { copyApiKeyFromConfigId } : {}),
      encryption,
      ...configSettings(fields),
    });
    if (!draft.ok) return { ok: false, message: draft.error.message } satisfies ActionState;
    // A reused key is the same provider account, so the terms recorded for it still describe
    // it: they are recorded again for the new draft, through the same checks and audit.
    const carried =
      !terms && copyApiKeyFromConfigId && !fields.apiKey
        ? carriedTerms(
            aiProviderTermsFor(
              await loadAiProviderDataTerms(db, [copyApiKeyFromConfigId]),
              copyApiKeyFromConfigId,
            ),
          )
        : undefined;
    const termsToRecord = terms ?? carried;
    if (termsToRecord) {
      const staff = await staffPrincipal(db, actor(accountId, email), 'AI_SETTINGS_MANAGE');
      if (!staff.ok) return DENIED;
      const recorded = await recordAiProviderDataTerms(db, staff.value, {
        stepUpSatisfied: true,
        configId: draft.value.id,
        ...termsToRecord,
      });
      if (!recorded.ok) {
        return {
          ok: true,
          message: `Draft configuration created (${provider} / ${fields.model}), but its data terms were not saved: ${recorded.error.message}.`,
        } satisfies ActionState;
      }
    }
    return {
      ok: true,
      message: `Draft configuration created (${provider} / ${fields.model}).`,
    } satisfies ActionState;
  });
  if (result.ok) settingsChanged();
  return result;
}

/**
 * Edit a DRAFT in place (only a draft: it has never run). The form sends the whole
 * configuration; a blank key keeps the saved one. Security-admin + step-up gated.
 */
export async function updateDraftAiProviderConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const configId = String(formData.get('configId') ?? '').trim();
  if (configId.length === 0) return { ok: false, message: 'Missing configuration id.' };
  const fields = parseConfigFields(formData);
  if (typeof fields === 'string') return { ok: false, message: fields };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const encryption = createKeyManagementPort();
    if (!encryption) return ENCRYPTION_NOT_CONFIGURED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_EDIT_DRAFT', resourceId: configId },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const updated = await updateDraftAiProviderConfig(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
      configId,
      encryption,
      ...(fields.apiKey ? { apiKey: fields.apiKey } : {}),
      ...configSettings(fields),
    });
    if (!updated.ok) return { ok: false, message: updated.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Draft saved (${updated.value.provider} / ${updated.value.model}).`,
    } satisfies ActionState;
  });
  if (result.ok) settingsChanged();
  return result;
}

/** Delete a DRAFT with its encrypted key and data terms. Security-admin + step-up gated. */
export async function deleteDraftAiProviderConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const configId = String(formData.get('configId') ?? '').trim();
  if (configId.length === 0) return { ok: false, message: 'Missing configuration id.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_DELETE_DRAFT', resourceId: configId },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const deleted = await deleteDraftAiProviderConfig(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
      configId,
    });
    if (!deleted.ok) return { ok: false, message: deleted.error.message } satisfies ActionState;
    return { ok: true, message: 'Draft deleted.' } satisfies ActionState;
  });
  if (result.ok) settingsChanged();
  return result;
}

/** Activate a DRAFT configuration -- the atomic single-winner switch (Part 8 §5). Security-admin + step-up gated. */
export async function activateAiProviderConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const configId = String(formData.get('configId') ?? '').trim();
  if (configId.length === 0) return { ok: false, message: 'Missing configuration id.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_ACTIVATE', resourceId: configId },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const activated = await activateAiProviderConfig(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
      configId,
    });
    if (!activated.ok) return { ok: false, message: activated.error.message } satisfies ActionState;
    return { ok: true, message: 'Configuration activated.' } satisfies ActionState;
  });
  if (result.ok) settingsChanged();
  return result;
}

/** Roll back to the last eligible known-good configuration (Part 8 §5: "rollback: last eligible known-good only"). Works even with nothing currently ACTIVE, e.g. right after an emergency-disable. Security-admin + step-up gated. */
export async function rollbackAiProviderConfigAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_ROLLBACK', resourceId: PLATFORM_WIDE_RESOURCE_ID },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const rolledBack = await rollbackAiProviderConfig(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
    });
    if (!rolledBack.ok) {
      return { ok: false, message: rolledBack.error.message } satisfies ActionState;
    }
    return {
      ok: true,
      message: 'Rolled back to the last eligible configuration.',
    } satisfies ActionState;
  });
  if (result.ok) settingsChanged();
  return result;
}

/** Take the current ACTIVE configuration out of service immediately; no replacement is auto-promoted (Part 8 §5 "emergency-disable"). Security-admin + step-up gated. */
export async function emergencyDisableAiProviderConfigAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_EMERGENCY_DISABLE', resourceId: PLATFORM_WIDE_RESOURCE_ID },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const disabled = await emergencyDisableAiProviderConfig(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
    });
    if (!disabled.ok) return { ok: false, message: disabled.error.message } satisfies ActionState;
    return { ok: true, message: 'AI extraction disabled platform-wide.' } satisfies ActionState;
  });
  if (result.ok) settingsChanged();
  return result;
}

/** Revoke a configuration's API key -- one-way; disqualifies this version from ever being activated or rolled back to again (Part 8 §5 "cannot resurrect: revoked key"). Disables it too if it happens to be the currently-ACTIVE version. Security-admin + step-up gated. */
export async function revokeAiProviderConfigKeyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const configId = String(formData.get('configId') ?? '').trim();
  if (configId.length === 0) return { ok: false, message: 'Missing configuration id.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_REVOKE_KEY', resourceId: configId },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    // With the key service, every other configuration holding the same key is revoked too.
    const encryption = createKeyManagementPort();
    const revoked = await revokeAiProviderConfigKey(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
      configId,
      ...(encryption ? { encryption } : {}),
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'API key revoked.' } satisfies ActionState;
  });
  if (result.ok) settingsChanged();
  return result;
}

/**
 * Synthetic connection test against one specific configuration's own
 * credentials -- never a customer document (Part 8 §5 / J15's own admin
 * journey: "config OpenAI; test; activate"). Works on a DRAFT before it is
 * ever activated, which is the whole point: an admin can prove a key/model
 * pair actually round-trips before ever letting it touch live traffic.
 * Deliberately bypasses `runExtraction`'s budget/cache/kill-switch machinery
 * and never writes to `ai_extraction_runs` -- this is a smoke test, not a
 * billable extraction. Security-admin + step-up gated, like every other
 * action here; the outcome is always recorded as an audit event regardless of
 * whether the test itself succeeded, so a failed credential is never silently
 * unlogged.
 */
export async function testAiProviderConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const configId = String(formData.get('configId') ?? '').trim();
  if (configId.length === 0) return { ok: false, message: 'Missing configuration id.' };

  return withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const config = await getAiProviderConfigById(db, actor(accountId, email), configId);
    if (!config.ok) return { ok: false, message: config.error.message } satisfies ActionState;

    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_TEST_CONNECTION', resourceId: configId },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const encryption = createKeyManagementPort();
    if (!encryption) return ENCRYPTION_NOT_CONFIGURED;
    const adapter = await resolveTestAdapter(db, encryption, config.value);
    if (!adapter) {
      return {
        ok: false,
        message: `The "${config.value.provider}" provider is not supported by this deployment.`,
      } satisfies ActionState;
    }

    const outcome = await adapter.extract({
      documentVersionId: 'connection-test',
      text: SYNTHETIC_TEST_DOCUMENT_TEXT,
      allowedFieldKeys: SYNTHETIC_TEST_ALLOWED_FIELD_KEYS,
    });
    const message = outcome.ok
      ? `Connection succeeded (${outcome.result.usage.latencyMs}ms).`
      : `Connection failed: ${outcome.code} -- ${outcome.message}`;
    await recordAiProviderConfigTest(db, {
      actor: actor(accountId, email),
      configId,
      ok: outcome.ok,
      message,
    });
    return { ok: outcome.ok, message } satisfies ActionState;
  });
}

/**
 * Task evaluation against one specific configuration's own credentials --
 * the admin journey's OTHER named §5 step, distinct from and heavier than
 * the synthetic connection test above: runs the full 13-case eval harness
 * dataset (`@visastack/adapters`'s `runEvaluationSuite`, shared with the
 * standalone `pnpm --filter @visastack/adapters eval` CLI script, Part 8
 * AI-10) rather than one synthetic call, and reports the same
 * precision/recall/hallucination/evidence-accuracy/prompt-injection
 * thresholds that script checks. Like the connection test, this never
 * touches `runExtraction`'s budget/cache/kill-switch machinery and never
 * writes to `ai_extraction_runs` -- an evaluation run is not a billable
 * extraction, and every case here uses the harness's own fixed synthetic
 * documents, never a customer document. Security-admin + step-up gated
 * (a distinct `AI_SETTINGS_RUN_EVALUATION` step-up action id); the outcome
 * is always recorded as an audit event, pass or fail.
 */
export async function runAiProviderConfigEvaluationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const configId = String(formData.get('configId') ?? '').trim();
  if (configId.length === 0) return { ok: false, message: 'Missing configuration id.' };

  return withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const config = await getAiProviderConfigById(db, actor(accountId, email), configId);
    if (!config.ok) return { ok: false, message: config.error.message } satisfies ActionState;

    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_RUN_EVALUATION', resourceId: configId },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const encryption = createKeyManagementPort();
    if (!encryption) return ENCRYPTION_NOT_CONFIGURED;
    const adapter = await resolveTestAdapter(db, encryption, config.value);
    if (!adapter) {
      return {
        ok: false,
        message: `The "${config.value.provider}" provider is not supported by this deployment.`,
      } satisfies ActionState;
    }

    const { report, scores } = await runEvaluationSuite(adapter);
    const passed = passesThresholds(report);
    const message = passed
      ? `Evaluation PASSED (${scores.length} cases; precision ${(report.precision * 100).toFixed(1)}%, recall ${(report.recall * 100).toFixed(1)}%, hallucination ${(report.hallucinationRate * 100).toFixed(1)}%, evidence ${(report.evidenceAccuracy * 100).toFixed(1)}%).`
      : `Evaluation FAILED (${scores.length} cases; precision ${(report.precision * 100).toFixed(1)}%, recall ${(report.recall * 100).toFixed(1)}%, hallucination ${(report.hallucinationRate * 100).toFixed(1)}%, evidence ${(report.evidenceAccuracy * 100).toFixed(1)}%${report.anyCaseErrored ? '; one or more cases errored' : ''}${report.promptInjectionResisted ? '' : '; prompt injection NOT resisted'}).`;

    await recordAiProviderConfigEvaluation(db, {
      actor: actor(accountId, email),
      configId,
      passed,
      caseCount: scores.length,
      precision: report.precision,
      recall: report.recall,
      hallucinationRate: report.hallucinationRate,
      evidenceAccuracy: report.evidenceAccuracy,
      promptInjectionResisted: report.promptInjectionResisted,
      anyCaseErrored: report.anyCaseErrored,
      totalCostUnits: report.totalCostUnits,
    });
    return { ok: passed, message } satisfies ActionState;
  });
}

/**
 * Record a fresh reading of a provider's data terms for one configuration
 * (owner decision 2026-10-25). Security admin and a fresh sign-in check;
 * saved as a new entry and written to the audit history.
 */
export async function recordAiProviderTermsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const configId = String(formData.get('configId') ?? '').trim();
  if (configId.length === 0) return { ok: false, message: 'Missing configuration id.' };
  const terms = parseTermsFields(formData);
  if (terms === undefined) return { ok: false, message: 'Choose Free or Paid.' };
  if (typeof terms === 'string') return { ok: false, message: terms };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_RECORD_TERMS', resourceId: configId },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const staff = await staffPrincipal(db, actor(accountId, email), 'AI_SETTINGS_MANAGE');
    if (!staff.ok) return DENIED;
    const recorded = await recordAiProviderDataTerms(db, staff.value, {
      stepUpSatisfied: true,
      configId,
      ...terms,
    });
    if (!recorded.ok) return { ok: false, message: recorded.error.message } satisfies ActionState;
    return { ok: true, message: 'Data terms saved.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(AI_SETTINGS_PATH);
  return result;
}

/**
 * Turn "Only Use AI Providers That Do Not Train on Inputs" on or off (owner
 * decision 2026-10-25: off by default). Security admin and a fresh sign-in
 * check; takes effect on the next AI call and is written to the audit
 * history.
 */
export async function setAiDataRuleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requireNoTraining = formData.get('requireNoTraining') === 'on';
  const reason = String(formData.get('reason') ?? '').trim();

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'AI_SETTINGS_DATA_RULE', resourceId: PLATFORM_WIDE_RESOURCE_ID },
      AI_SETTINGS_PATH,
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);

    const staff = await staffPrincipal(db, actor(accountId, email), 'AI_SETTINGS_MANAGE');
    if (!staff.ok) return DENIED;
    const saved = await setAiDataRuleSetting(db, staff.value, {
      stepUpSatisfied: true,
      requireNoTraining,
      ...(reason ? { reason } : {}),
    });
    if (!saved.ok) return { ok: false, message: saved.error.message } satisfies ActionState;
    return {
      ok: true,
      message: requireNoTraining
        ? 'Turned on. AI now runs only on providers recorded as not training on inputs.'
        : 'Turned off. AI runs on the active provider whatever its data terms.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(AI_SETTINGS_PATH);
  return result;
}
