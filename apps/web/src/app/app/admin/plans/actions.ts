'use server';

import { formatMoney, isIsoCurrencyCode, normalizeCurrencyCode, parseMoney } from '@visastack/core';
import {
  AI_FEATURE_KEYS,
  AI_FEATURE_LIMIT_MAX,
  AI_FEATURE_LIMIT_MIN,
} from '@visastack/core/ai-features';
import {
  CAPACITY_KEYS,
  type EntitlementKey,
  aiEntitlementKey,
  aiFeatureOfKey,
} from '@visastack/core/entitlements';
import {
  PLAN_PERIOD_DAYS_MAX,
  PLAN_PRICE_MAX_MINOR_UNITS,
  type PlanDraft,
  type PlanRuleInput,
  getPlanLatestPrice,
  pendingDowngradesSentence,
  previewPlanRetire,
  retirePlan,
  savePlan,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { resolveBaseUrl } from '../../../../lib/base-url';
import {
  PLAN_FORM_RETRY_COOKIE,
  PLAN_FORM_RETRY_PATH,
  encodePlanFormRetry,
  planFormRetryCookieOptions,
} from '../../../../lib/plan-form-retry';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';
import {
  BYTES_PER_MB,
  type PlanFormState,
  type PlanFormValues,
  type RetireFormState,
  aiFeatureName,
  featureLimitField,
  featureOnField,
  limitField,
  planFieldNames,
} from './labels';

const PLANS_PATH = PLAN_FORM_RETRY_PATH;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const DENIED: FormResult = { ok: false, message: 'Only the platform owner can change plans.' };
const NOT_FOUND: FormResult = { ok: false, message: 'This plan was not found. Reload the page.' };

/**
 * What was typed, by field. A field the form did not show (Limits on Traveller Free, AI features on
 * an agency plan, the internal invitations key) is absent, so the save leaves that rule as it is.
 */
function typedValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of planFieldNames()) {
    const raw = formData.get(name);
    if (typeof raw === 'string') values[name] = raw.trim().slice(0, 120);
  }
  return values;
}

/** The largest Storage in MB a plan can hold. */
const STORAGE_MB_MAX = Math.floor(Number.MAX_SAFE_INTEGER / BYTES_PER_MB);

/** The form field a service refusal points at. */
function formField(field: string | undefined): string | undefined {
  if (field === undefined) return undefined;
  if (field === 'name' || field === 'periodDays' || field === 'price' || field === 'currency') {
    return field;
  }
  const feature = aiFeatureOfKey(field);
  if (feature !== null) return featureLimitField(feature);
  return `limit.${field}`;
}

type Parsed = { readonly draft: PlanDraft } | { readonly problem: FormResult };

/** Reads the typed values into a draft, or the first problem, pointing at its field. */
function parseDraft(values: PlanFormValues): Parsed {
  const read = (name: string): string => values[name] ?? '';
  const problem = (message: string, field: string): Parsed => ({
    problem: { ok: false, message, field },
  });
  const periodText = read('periodDays');
  if (!/^\d{1,3}$/.test(periodText)) {
    return problem(
      `Enter the billing period as a whole number of days from 1 to ${PLAN_PERIOD_DAYS_MAX}.`,
      'periodDays',
    );
  }
  const amount = read('price');
  const currencyText = read('currency');
  let price: PlanDraft['price'] = null;
  if (amount.length > 0 || currencyText.length > 0) {
    if (!isIsoCurrencyCode(currencyText)) {
      return problem('Enter a three-letter currency code, for example BDT.', 'currency');
    }
    const currency = normalizeCurrencyCode(currencyText);
    // The amount is read in the currency typed beside it, with that currency's own decimals.
    const minor = parseMoney(amount, currency, PLAN_PRICE_MAX_MINOR_UNITS);
    if (minor === null) {
      return problem(
        `Enter the price as an amount in ${currency}, for example 2,500.00, or leave both price boxes empty for no price.`,
        'price',
      );
    }
    price = { priceMinorUnits: minor, currency };
  }
  const rules: Partial<Record<EntitlementKey, PlanRuleInput>> = {};
  for (const key of CAPACITY_KEYS) {
    const text = values[limitField(key)];
    if (text === undefined) continue;
    if (text.length === 0) {
      rules[key] = { included: true, limit: null };
      continue;
    }
    if (key === 'storage_bytes') {
      if (!/^\d{1,10}$/.test(text) || Number(text) > STORAGE_MB_MAX) {
        return problem(
          `Enter Storage in MB as a whole number up to ${STORAGE_MB_MAX.toLocaleString('en-US')}, or leave it empty for Unlimited.`,
          limitField(key),
        );
      }
      rules[key] = { included: true, limit: Number(text) * BYTES_PER_MB };
      continue;
    }
    if (!/^\d{1,10}$/.test(text)) {
      return problem('Enter a whole number, or leave it empty for Unlimited.', limitField(key));
    }
    rules[key] = { included: true, limit: Number(text) };
  }
  for (const feature of AI_FEATURE_KEYS) {
    const text = values[featureLimitField(feature)];
    // The AI features are on the form only for Traveller Free; absent, the rule is left as it is.
    if (text === undefined) continue;
    const on = values[featureOnField(feature)] === 'on';
    if (!on) {
      if (text.length > 0) {
        return problem(
          `${aiFeatureName(feature)} is off, so its daily limit is not kept. Switch it on, or empty the box.`,
          featureLimitField(feature),
        );
      }
      rules[aiEntitlementKey(feature)] = { included: false, limit: null };
      continue;
    }
    // Empty: no plan limit for this feature; the admin's daily limit still applies (S28 round 2).
    if (text.length === 0) {
      rules[aiEntitlementKey(feature)] = { included: true, limit: null };
      continue;
    }
    const limit = /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
    if (!(limit >= AI_FEATURE_LIMIT_MIN && limit <= AI_FEATURE_LIMIT_MAX)) {
      return problem(
        `Enter the daily limit for ${aiFeatureName(feature)} as a whole number from ${AI_FEATURE_LIMIT_MIN} to ${AI_FEATURE_LIMIT_MAX}, or leave it empty for no plan limit.`,
        featureLimitField(feature),
      );
    }
    rules[aiEntitlementKey(feature)] = { included: true, limit };
  }
  return {
    draft: { name: read('name'), periodDays: Number(periodText), price, rules },
  };
}

async function rememberTyped(accountId: string, form: string, values: PlanFormValues) {
  const value = encodePlanFormRetry({ form, fields: values }, accountId);
  if (!value) return;
  (await cookies()).set(
    PLAN_FORM_RETRY_COOKIE,
    value,
    planFormRetryCookieOptions(resolveBaseUrl().startsWith('https://')),
  );
}

async function forgetTyped() {
  (await cookies()).delete({ name: PLAN_FORM_RETRY_COOKIE, path: PLAN_FORM_RETRY_PATH });
}

/**
 * Creates or saves one plan. Platform owner only, with a fresh sign-in check for every save. A
 * changed price is shown first with what it means (from each agency's next billing period) and
 * saved only once the box is ticked. Every reply carries what was typed.
 */
export async function savePlanAction(
  _prev: PlanFormState,
  formData: FormData,
): Promise<PlanFormState> {
  const planIdRaw = String(formData.get('planId') ?? '');
  const planId = planIdRaw.length === 0 ? undefined : planIdRaw;
  const values = typedValues(formData);
  const reply = (result: FormResult, extra: Partial<PlanFormState> = {}): PlanFormState => ({
    ...result,
    values,
    ...extra,
  });
  if (planId !== undefined && !ID.test(planId)) return reply(NOT_FOUND);
  const parsed = parseDraft(values);
  if ('problem' in parsed) return reply(parsed.problem);
  const { draft } = parsed;

  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PLANS_MANAGE',
    );
    if (!staff.ok) return reply(DENIED);
    if (planId !== undefined) {
      // Only this plan's newest price is read, never the whole list (round 2).
      const current = await getPlanLatestPrice(db, staff.value, planId);
      if (!current.ok) return reply(current.error.code === 'forbidden' ? DENIED : NOT_FOUND);
      const before = current.value;
      const samePrice =
        (before === null && draft.price === null) ||
        (before !== null &&
          draft.price !== null &&
          before.priceMinorUnits === draft.price.priceMinorUnits &&
          before.currency === draft.price.currency);
      if (!samePrice && formData.get('confirmPrice') !== 'yes') {
        const pricePreview = {
          before: before ? formatMoney(before.priceMinorUnits, before.currency) : null,
          after: draft.price
            ? formatMoney(draft.price.priceMinorUnits, draft.price.currency)
            : 'no price',
        };
        // The first save of a new price only shows what it means. Not a failure.
        return formData.get('pricePreviewed') === 'yes'
          ? reply(
              {
                ok: false,
                message: 'Tick the box to confirm the new price, then save again.',
                field: 'confirmPrice',
              },
              { pricePreview },
            )
          : reply({ ok: true, message: '' }, { pricePreview });
      }
    }
    const input = { ...(planId !== undefined ? { planId } : {}), draft };
    let result = await savePlan(db, staff.value, { ...input, stepUpSatisfied: false });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'PLANS_UPDATE', resourceId: planId ?? 'new' },
        PLANS_PATH,
      );
      if (stepUp.kind === 'not_configured') {
        return reply({ ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE });
      }
      if (stepUp.kind === 'reauth_required') {
        // What was typed comes back after the sign-in check, to save again.
        await rememberTyped(accountId, planId ?? 'new', values);
        redirect(stepUp.reauthUrl);
      }
      result = await savePlan(db, staff.value, { ...input, stepUpSatisfied: true });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return reply(DENIED);
      if (result.error.code === 'not_found') return reply(NOT_FOUND);
      const field = formField(result.error.field);
      return reply({
        ok: false,
        message: result.error.message,
        ...(field !== undefined ? { field } : {}),
      });
    }
    await forgetTyped();
    revalidatePath(PLANS_PATH);
    if (result.value.created) {
      // A new plan is listed above; the New Plan form starts empty again.
      return { ok: true, message: `Saved. ${draft.name.trim()} can now be given to agencies.` };
    }
    if (!result.value.changed) {
      return reply({ ok: true, message: 'Nothing to change. This plan is already set this way.' });
    }
    return reply({
      ok: true,
      message: result.value.priceChanged
        ? "Saved. The new price applies from each agency's next billing period."
        : 'Saved.',
    });
  });
}

/**
 * Retires one plan. The first press shows how many agencies keep it; the second, with the box
 * ticked, retires it. Platform owner only, with a fresh sign-in check.
 */
export async function retirePlanAction(
  _prev: RetireFormState,
  formData: FormData,
): Promise<RetireFormState> {
  const planId = String(formData.get('planId') ?? '');
  if (!ID.test(planId)) return NOT_FOUND;
  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PLANS_MANAGE',
    );
    if (!staff.ok) return DENIED;
    if (formData.get('confirmRetire') !== 'yes') {
      const preview = await previewPlanRetire(db, staff.value, planId);
      if (!preview.ok) return DENIED;
      // Scheduled plan changes to this plan are cancelled first; the preview says so plainly.
      const waiting =
        preview.value.pendingDowngrades > 0
          ? { waiting: pendingDowngradesSentence(preview.value.pendingDowngrades) }
          : {};
      return formData.get('retirePreviewed') === 'yes' && preview.value.pendingDowngrades === 0
        ? {
            ok: false,
            message: 'Tick the box to confirm, then choose Retire Plan again.',
            field: 'confirmRetire',
            agenciesKeepingIt: preview.value.agenciesOnIt,
          }
        : { ok: true, message: '', agenciesKeepingIt: preview.value.agenciesOnIt, ...waiting };
    }
    let result = await retirePlan(db, staff.value, { planId, stepUpSatisfied: false });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'PLANS_UPDATE', resourceId: planId },
        PLANS_PATH,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE };
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      result = await retirePlan(db, staff.value, { planId, stepUpSatisfied: true });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return DENIED;
      if (result.error.code === 'not_found') return NOT_FOUND;
      return { ok: false, message: result.error.message };
    }
    revalidatePath(PLANS_PATH);
    return {
      ok: true,
      retired: true,
      message:
        result.value.agenciesKeepingIt === 0
          ? 'Retired. Nobody new can be put on this plan.'
          : `Retired. Nobody new can be put on this plan; ${result.value.agenciesKeepingIt === 1 ? '1 agency keeps it' : `${result.value.agenciesKeepingIt} agencies keep it`}.`,
    };
  });
}
