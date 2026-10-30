'use server';

import {
  AI_FEATURES,
  AI_FEATURE_LIMIT_MAX,
  AI_FEATURE_LIMIT_MIN,
  type AiFeatureKey,
  isAiFeatureKey,
} from '@visastack/core/ai-features';
import { AI_FEATURE_SETTINGS_UNAVAILABLE, updateAiFeatureSetting } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import {
  AI_FEATURE_RETRY_COOKIE,
  AI_FEATURE_RETRY_PATH,
  aiFeatureRetryCookieOptions,
  encodeAiFeatureRetry,
} from '../../../../lib/ai-feature-retry';
import { resolveBaseUrl } from '../../../../lib/base-url';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';
import type { AiFeatureFormState, AiFeatureValues } from './labels';

const AI_FEATURES_PATH = AI_FEATURE_RETRY_PATH;

/**
 * Keeps what was typed across the fresh sign-in check, in a signed httpOnly cookie for this page
 * only (never in the address). Best effort: without it the person simply types again.
 */
async function rememberTyped(accountId: string, feature: AiFeatureKey, values: AiFeatureValues) {
  const value = encodeAiFeatureRetry({ feature, ...values }, accountId);
  if (!value) return;
  (await cookies()).set(
    AI_FEATURE_RETRY_COOKIE,
    value,
    aiFeatureRetryCookieOptions(resolveBaseUrl().startsWith('https://')),
  );
}

/** After a successful save there is nothing left to save again. */
async function forgetTyped() {
  (await cookies()).delete({ name: AI_FEATURE_RETRY_COOKIE, path: AI_FEATURE_RETRY_PATH });
}

const DENIED: FormResult = {
  ok: false,
  message: 'Only the platform owner can change AI features.',
};
const NOT_READY: FormResult = {
  ok: false,
  message: 'AI features cannot be changed yet. Nothing has changed.',
};

/**
 * Saves one AI feature's switch and daily limit. Platform owner only, with a fresh sign-in check.
 * The reply carries what was typed, so nothing is lost after the browser resets the form.
 */
export async function saveAiFeatureAction(
  _prev: AiFeatureFormState,
  formData: FormData,
): Promise<AiFeatureFormState> {
  const featureRaw = String(formData.get('feature') ?? '');
  const values: AiFeatureValues = {
    enabled: formData.get('enabled') === 'on',
    dailyLimit: String(formData.get('dailyLimit') ?? '')
      .trim()
      .slice(0, 8),
  };
  const reply = (result: FormResult): AiFeatureFormState => ({ ...result, values });
  if (!isAiFeatureKey(featureRaw)) {
    return reply({ ok: false, message: 'This AI feature was not found. Reload the page.' });
  }
  const feature = featureRaw;
  let dailyLimit: number | null = null;
  if (values.dailyLimit.length > 0) {
    const parsed = /^\d{1,4}$/.test(values.dailyLimit) ? Number(values.dailyLimit) : Number.NaN;
    if (!(parsed >= AI_FEATURE_LIMIT_MIN && parsed <= AI_FEATURE_LIMIT_MAX)) {
      return reply({
        ok: false,
        message: `Enter Daily Limit per Person as a whole number from ${AI_FEATURE_LIMIT_MIN} to ${AI_FEATURE_LIMIT_MAX}, or leave it empty for the plan’s limit.`,
        field: 'dailyLimit',
      });
    }
    dailyLimit = parsed;
  }
  const name = AI_FEATURES[feature].name;

  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'AI_FEATURES_MANAGE',
    );
    if (!staff.ok) return reply(DENIED);
    const input = { feature, enabled: values.enabled, dailyLimit };
    let result = await updateAiFeatureSetting(db, staff.value, {
      ...input,
      stepUpSatisfied: false,
    });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'AI_FEATURES_UPDATE', resourceId: feature },
        AI_FEATURES_PATH,
      );
      if (stepUp.kind === 'not_configured') {
        return reply({ ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE });
      }
      if (stepUp.kind === 'reauth_required') {
        // The typed values come back with the person after the sign-in check, to save again.
        await rememberTyped(accountId, feature, {
          enabled: values.enabled,
          dailyLimit: dailyLimit === null ? '' : String(dailyLimit),
        });
        redirect(stepUp.reauthUrl);
      }
      result = await updateAiFeatureSetting(db, staff.value, { ...input, stepUpSatisfied: true });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return reply(DENIED);
      if (result.error.message === AI_FEATURE_SETTINGS_UNAVAILABLE) return reply(NOT_READY);
      if (result.error.code === 'invalid') {
        return reply({ ok: false, message: result.error.message, field: 'dailyLimit' });
      }
      return reply({
        ok: false,
        message: 'The change could not be saved. Reload the page and try again.',
      });
    }
    await forgetTyped();
    if (!result.value.changed) {
      return reply({ ok: true, message: `Nothing to change. ${name} is already set this way.` });
    }
    revalidatePath(AI_FEATURES_PATH);
    return reply({
      ok: true,
      message: values.enabled
        ? `Saved. ${name} is on.`
        : `Saved. ${name} is off. What people already have stays, and everything else works as usual.`,
    });
  });
}
