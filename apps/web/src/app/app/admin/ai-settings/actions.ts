'use server';

import { passesThresholds, runEvaluationSuite } from '@visastack/adapters';
import {
  type PlatformAuthInput,
  activateAiProviderConfig,
  createDraftAiProviderConfig,
  emergencyDisableAiProviderConfig,
  getAiProviderConfigById,
  recordAiProviderConfigEvaluation,
  recordAiProviderConfigTest,
  revokeAiProviderConfigKey,
  rollbackAiProviderConfig,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { bootstrapAdminEmails, hasPlatformPermission } from '../../../../lib/admin';
import { resolveTestAdapter, usdToUnits } from '../../../../lib/ai';
import { createKeyManagementPort } from '../../../../lib/providers';
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

/** Save a new DRAFT AI provider configuration. Has no effect on live traffic until activated. Security-admin + step-up gated (Part 8 §5). */
export async function createDraftAiProviderConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const provider = String(formData.get('provider') ?? '').trim();
  const model = String(formData.get('model') ?? '').trim();
  const apiKey = String(formData.get('apiKey') ?? '').trim();
  const reasoningEffort = String(formData.get('reasoningEffort') ?? '').trim();
  const dataPolicyApproved = formData.get('dataPolicyApproved') === 'on';
  const notes = String(formData.get('notes') ?? '').trim();
  const budgetLimitUsd = parsePositiveNumber(formData.get('budgetLimitUsd'));
  const perDocumentBudgetLimitUsd = parsePositiveNumber(formData.get('perDocumentBudgetLimitUsd'));
  const maxAttemptsPerDocument = parsePositiveInt(formData.get('maxAttemptsPerDocument'));
  const maxPagesPerDocument = parsePositiveInt(formData.get('maxPagesPerDocument'));
  const cacheMaxAgeDays = parsePositiveInt(formData.get('cacheMaxAgeDays'));
  const maxConcurrentCalls = parsePositiveInt(formData.get('maxConcurrentCalls'));
  const fallbackEnabled = formData.get('fallbackEnabled') === 'on';
  const fallbackProviderConfigId = String(formData.get('fallbackProviderConfigId') ?? '').trim();

  if (provider.length === 0) return { ok: false, message: 'Choose a provider.' };
  if (model.length === 0) return { ok: false, message: 'Enter a model.' };
  if (apiKey.length === 0) return { ok: false, message: 'Enter an API key.' };
  if (budgetLimitUsd === undefined) {
    return { ok: false, message: 'Enter a positive monthly budget in USD.' };
  }
  if (fallbackEnabled && fallbackProviderConfigId.length === 0) {
    return { ok: false, message: 'Choose a fallback configuration to enable fallback.' };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'AI_SETTINGS_MANAGE'))) {
      return DENIED;
    }
    const encryption = createKeyManagementPort();
    if (!encryption) {
      return {
        ok: false,
        message:
          'Encryption is not configured in this environment (KMS_LOCAL_MASTER_KEY_BASE64 unset).',
      } satisfies ActionState;
    }
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
      model,
      apiKey,
      encryption,
      dataPolicyApproved,
      budgetLimitUnits: usdToUnits(budgetLimitUsd),
      ...(reasoningEffort ? { reasoningEffort } : {}),
      ...(perDocumentBudgetLimitUsd !== undefined
        ? { perDocumentBudgetLimitUnits: usdToUnits(perDocumentBudgetLimitUsd) }
        : {}),
      ...(maxAttemptsPerDocument !== undefined ? { maxAttemptsPerDocument } : {}),
      ...(maxPagesPerDocument !== undefined ? { maxPagesPerDocument } : {}),
      ...(cacheMaxAgeDays !== undefined ? { cacheMaxAgeDays } : {}),
      ...(maxConcurrentCalls !== undefined ? { maxConcurrentCalls } : {}),
      ...(fallbackEnabled ? { fallbackEnabled: true } : {}),
      ...(fallbackProviderConfigId ? { fallbackProviderConfigId } : {}),
      ...(notes ? { notes } : {}),
    });
    if (!draft.ok) return { ok: false, message: draft.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Draft configuration created (${provider} / ${model}).`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(AI_SETTINGS_PATH);
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
  if (result.ok) revalidatePath(AI_SETTINGS_PATH);
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
  if (result.ok) revalidatePath(AI_SETTINGS_PATH);
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
  if (result.ok) revalidatePath(AI_SETTINGS_PATH);
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

    const revoked = await revokeAiProviderConfigKey(db, {
      actor: actor(accountId, email),
      stepUpSatisfied: true,
      configId,
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'API key revoked.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(AI_SETTINGS_PATH);
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
    if (!encryption) {
      return {
        ok: false,
        message:
          'Encryption is not configured in this environment (KMS_LOCAL_MASTER_KEY_BASE64 unset).',
      } satisfies ActionState;
    }
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
    if (!encryption) {
      return {
        ok: false,
        message:
          'Encryption is not configured in this environment (KMS_LOCAL_MASTER_KEY_BASE64 unset).',
      } satisfies ActionState;
    }
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
