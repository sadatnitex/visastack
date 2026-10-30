'use server';

import {
  AI_FEATURES,
  AI_FEATURE_LIMIT_MAX,
  AI_FEATURE_LIMIT_MIN,
  isAiFeatureKey,
} from '@visastack/core/ai-features';
import { AI_FEATURE_SETTINGS_UNAVAILABLE, updateAiFeatureSetting } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';
import type { AiFeatureFormState, AiFeatureValues } from './labels';

const AI_FEATURES_PATH = '/app/admin/ai';

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
      // The typed values come back with the person after the sign-in check, to save again.
      const back = new URLSearchParams({
        retry_feature: feature,
        retry_on: values.enabled ? '1' : '0',
        retry_limit: dailyLimit === null ? '' : String(dailyLimit),
      });
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'AI_FEATURES_UPDATE', resourceId: feature },
        `${AI_FEATURES_PATH}?${back.toString()}`,
      );
      if (stepUp.kind === 'not_configured') {
        return reply({ ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE });
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
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
