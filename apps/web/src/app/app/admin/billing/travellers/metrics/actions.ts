'use server';

import {
  TRAVELLER_HEALTH_UNAVAILABLE,
  type TravellerHealthThresholds,
  getTravellerHealthSettings,
  travellerThresholdsProblem,
  updateTravellerHealthSettings,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../../lib/admin';
import { withSession } from '../../../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../../../lib/step-up';
import {
  THRESHOLD_FIELDS,
  type ThresholdField,
  type ThresholdsState,
  type ThresholdsValues,
  thresholdProblemField,
} from './labels';

/**
 * Saves the alert thresholds of the traveller plan health signals (ADR 0025 section 12.6, T6).
 * Platform owner only (`PLANS_MANAGE`), with a fresh sign-in check, exactly as Billing Rules.
 * Every reply carries the values as typed, so nothing typed is lost.
 */

const METRICS_PATH = '/app/admin/billing/travellers/metrics';

const DENIED: FormResult = {
  ok: false,
  message: 'Only the platform owner can change the alert thresholds.',
};

const NOT_READY: FormResult = {
  ok: false,
  message: `${TRAVELLER_HEALTH_UNAVAILABLE} Nothing has changed.`,
};

const WHOLE_NUMBER: Readonly<Record<ThresholdField, string>> = {
  checkoutSuccessMinPercent: 'Enter checkout success as a whole number from 0 to 100.',
  confirmationMaxMinutes: 'Enter time to confirm as a whole number of minutes from 1 to 1440.',
  stuckConfirmingMax: 'Enter stuck confirming as a whole number from 0 to 1000.',
  needsCheckMax: 'Enter needs a check as a whole number from 0 to 1000.',
};

function typedValues(formData: FormData): ThresholdsValues {
  const text = (name: ThresholdField) => String(formData.get(name) ?? '').trim();
  return {
    checkoutSuccessMinPercent: text('checkoutSuccessMinPercent'),
    confirmationMaxMinutes: text('confirmationMaxMinutes'),
    stuckConfirmingMax: text('stuckConfirmingMax'),
    needsCheckMax: text('needsCheckMax'),
  };
}

/** The four boxes as whole numbers, or the first box that does not hold one. */
function wholeNumbers(
  values: ThresholdsValues,
):
  | { readonly ok: true; readonly value: TravellerHealthThresholds }
  | { readonly ok: false; readonly field: ThresholdField } {
  for (const field of THRESHOLD_FIELDS) {
    if (!/^\d{1,4}$/.test(values[field])) return { ok: false, field };
  }
  return {
    ok: true,
    value: {
      checkoutSuccessMinPercent: Number(values.checkoutSuccessMinPercent),
      confirmationMaxMinutes: Number(values.confirmationMaxMinutes),
      stuckConfirmingMax: Number(values.stuckConfirmingMax),
      needsCheckMax: Number(values.needsCheckMax),
    },
  };
}

/** Saves the four alert thresholds. Platform owner only, with a fresh sign-in check. */
export async function saveTravellerThresholdsAction(
  _prev: ThresholdsState,
  formData: FormData,
): Promise<ThresholdsState> {
  const values = typedValues(formData);
  const reply = (result: FormResult): ThresholdsState => ({ ...result, values });
  const parsed = wholeNumbers(values);
  if (!parsed.ok) {
    return reply({ ok: false, message: WHOLE_NUMBER[parsed.field], field: parsed.field });
  }
  const thresholds = parsed.value;
  const problem = travellerThresholdsProblem(thresholds);
  if (problem) {
    return reply({
      ok: false,
      message: problem,
      field: thresholdProblemField(problem, thresholds),
    });
  }

  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PLANS_MANAGE',
    );
    if (!staff.ok) return reply(DENIED);
    // Before the database is updated nothing can be saved: say so before asking for a sign-in.
    const current = await getTravellerHealthSettings(db, staff.value);
    if (!current.ok) return reply(DENIED);
    if (!current.value.available) return reply(NOT_READY);

    let result = await updateTravellerHealthSettings(db, staff.value, {
      ...thresholds,
      stepUpSatisfied: false,
    });
    if (!result.ok && result.error.code === 'step_up_required') {
      // What was typed comes back after the sign-in check (four whole numbers, nothing else).
      const typed = new URLSearchParams({
        success: String(thresholds.checkoutSuccessMinPercent),
        minutes: String(thresholds.confirmationMaxMinutes),
        stuck: String(thresholds.stuckConfirmingMax),
        check: String(thresholds.needsCheckMax),
      });
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'TRAVELLER_THRESHOLDS_UPDATE', resourceId: 'traveller-thresholds' },
        `${METRICS_PATH}?${typed.toString()}#thresholds-title`,
      );
      if (stepUp.kind === 'not_configured') {
        return reply({ ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE });
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      result = await updateTravellerHealthSettings(db, staff.value, {
        ...thresholds,
        stepUpSatisfied: true,
      });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return reply(DENIED);
      if (result.error.message === TRAVELLER_HEALTH_UNAVAILABLE) return reply(NOT_READY);
      if (result.error.code === 'invalid') {
        return reply({
          ok: false,
          message: result.error.message,
          field: thresholdProblemField(result.error.message, thresholds),
        });
      }
      return reply({
        ok: false,
        message: 'The thresholds could not be saved. Reload the page and try again.',
      });
    }
    if (!result.value.changed) {
      return reply({
        ok: true,
        message: 'Nothing to change. These are already the alert thresholds.',
      });
    }
    revalidatePath(METRICS_PATH);
    return reply({
      ok: true,
      message: 'Saved. The health signals are now checked against these thresholds.',
    });
  });
}
