'use server';

import {
  BILLING_DUE_DAYS_MAX,
  BILLING_POLICY_DAYS_MAX,
  BILLING_SETTINGS_UNAVAILABLE,
  billingRulesProblem,
  getBillingSettings,
  previewOverdueHandling,
  updateBillingSettings,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormResult } from '../../../../components/form-feedback';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../../lib/step-up';
import { type BillingRulesState, type BillingRulesValues, previewSentence } from './labels';

const BILLING_RULES_PATH = '/app/admin/billing';

const DENIED: FormResult = {
  ok: false,
  message: 'Only the platform owner can change the billing rules.',
};

const NOT_READY: FormResult = {
  ok: false,
  message: 'Billing rules are not available yet. Nothing has changed.',
};

/** A whole number of days typed in a box, null when left empty, undefined when not a number. */
function days(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text.length === 0) return null;
  if (!/^\d{1,4}$/.test(text)) return undefined;
  return Number(text);
}

/** Which box a rule problem is about, so the form can point at it. */
function problemField(message: string): string {
  if (message.startsWith('Payment due')) return 'dueDays';
  if (message.startsWith('Suspended')) return 'suspendAfterDays';
  return 'graceAfterDays';
}

function typedValues(formData: FormData): BillingRulesValues {
  const text = (name: string) => String(formData.get(name) ?? '').trim();
  return {
    dueDays: text('dueDays'),
    overdueHandling: formData.get('overdueHandling') === 'on' ? 'on' : 'off',
    graceAfterDays: text('graceAfterDays'),
    suspendAfterDays: text('suspendAfterDays'),
  };
}

/**
 * Saves the billing rules. Platform owner only, with a fresh sign-in check. Whenever a save turns
 * automatic Grace and Suspended on, or changes its day counts while it is on, the server first
 * answers with a preview of exactly those day counts (how many agencies it moves today); the
 * save goes through only when the same day counts come back with the box ticked. Every reply
 * carries the values as typed, so nothing typed is lost.
 */
export async function saveBillingRulesAction(
  _prev: BillingRulesState,
  formData: FormData,
): Promise<BillingRulesState> {
  const values = typedValues(formData);
  const reply = (
    result: FormResult,
    extra: Partial<BillingRulesState> = {},
  ): BillingRulesState => ({
    ...result,
    values,
    ...extra,
  });
  const dueDays = days(values.dueDays);
  const graceAfterDays = days(values.graceAfterDays);
  const suspendAfterDays = days(values.suspendAfterDays);
  const overdueHandlingEnabled = values.overdueHandling === 'on';
  if (dueDays === null || dueDays === undefined) {
    return reply({
      ok: false,
      message: `Enter how many days after a period starts its invoice is due, up to ${BILLING_DUE_DAYS_MAX}.`,
      field: 'dueDays',
    });
  }
  if (graceAfterDays === undefined || suspendAfterDays === undefined) {
    return reply({
      ok: false,
      message: `Enter the days as whole numbers, up to ${BILLING_POLICY_DAYS_MAX}.`,
      field: graceAfterDays === undefined ? 'graceAfterDays' : 'suspendAfterDays',
    });
  }
  const rules = { dueDays, overdueHandlingEnabled, graceAfterDays, suspendAfterDays };
  const problem = billingRulesProblem(rules);
  if (problem) return reply({ ok: false, message: problem, field: problemField(problem) });

  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_SETTINGS_MANAGE',
    );
    if (!staff.ok) return reply(DENIED);
    const current = await getBillingSettings(db, staff.value);
    if (!current.ok) return reply(DENIED);
    if (!current.value.available) return reply(NOT_READY);
    const needsPreview =
      overdueHandlingEnabled &&
      graceAfterDays !== null &&
      suspendAfterDays !== null &&
      (!current.value.overdueHandlingEnabled ||
        current.value.graceAfterDays !== graceAfterDays ||
        current.value.suspendAfterDays !== suspendAfterDays);
    if (needsPreview) {
      const confirmed =
        formData.get('confirmed') === 'yes' &&
        days(String(formData.get('previewGraceAfterDays') ?? '')) === graceAfterDays &&
        days(String(formData.get('previewSuspendAfterDays') ?? '')) === suspendAfterDays;
      if (!confirmed) {
        const preview = await previewOverdueHandling(db, staff.value, {
          graceAfterDays,
          suspendAfterDays,
        });
        if (!preview.ok) return reply(DENIED);
        return reply(
          {
            ok: false,
            message: `${previewSentence(preview.value)} Tick the box to confirm, then save again.`,
            field: 'confirmed',
          },
          { preview: { graceAfterDays, suspendAfterDays, ...preview.value } },
        );
      }
    }

    let result = await updateBillingSettings(db, staff.value, { ...rules, stepUpSatisfied: false });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'BILLING_SETTINGS_UPDATE', resourceId: 'billing-rules' },
        BILLING_RULES_PATH,
      );
      if (stepUp.kind === 'not_configured') {
        return reply({ ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE });
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      result = await updateBillingSettings(db, staff.value, { ...rules, stepUpSatisfied: true });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return reply(DENIED);
      if (result.error.message === BILLING_SETTINGS_UNAVAILABLE) return reply(NOT_READY);
      if (result.error.code === 'invalid') {
        return reply({
          ok: false,
          message: result.error.message,
          field: problemField(result.error.message),
        });
      }
      return reply({
        ok: false,
        message: 'The rules could not be saved. Reload the page and try again.',
      });
    }
    if (!result.value.changed) {
      return reply({
        ok: true,
        message: 'Nothing to change. These are already the billing rules.',
      });
    }
    revalidatePath(BILLING_RULES_PATH);
    return reply({
      ok: true,
      message: overdueHandlingEnabled
        ? 'Saved. Automatic Grace and Suspended is on from the next daily run.'
        : 'Saved. Automatic Grace and Suspended is off.',
    });
  });
}
