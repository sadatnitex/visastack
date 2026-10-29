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
import { previewSentence } from './labels';

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
function days(formData: FormData, name: string): number | null | undefined {
  const raw = String(formData.get(name) ?? '').trim();
  if (raw.length === 0) return null;
  if (!/^\d{1,4}$/.test(raw)) return undefined;
  return Number(raw);
}

/** Which box a rule problem is about, so the form can point at it. */
function problemField(message: string): string {
  if (message.startsWith('Payment due')) return 'dueDays';
  if (message.startsWith('Suspended')) return 'suspendAfterDays';
  return 'graceAfterDays';
}

/**
 * Saves the billing rules. Platform owner only, with a fresh sign-in check. Turning automatic
 * Grace and Suspended on first shows how many agencies it would move today and needs the box
 * ticked to confirm, so old unpaid invoices are seen before anything moves.
 */
export async function saveBillingRulesAction(
  _prev: FormResult,
  formData: FormData,
): Promise<FormResult> {
  const dueDays = days(formData, 'dueDays');
  const graceAfterDays = days(formData, 'graceAfterDays');
  const suspendAfterDays = days(formData, 'suspendAfterDays');
  const overdueHandlingEnabled = formData.get('overdueHandling') === 'on';
  if (dueDays === null || dueDays === undefined) {
    return {
      ok: false,
      message: `Enter how many days after a period starts its invoice is due, up to ${BILLING_DUE_DAYS_MAX}.`,
      field: 'dueDays',
    };
  }
  if (graceAfterDays === undefined || suspendAfterDays === undefined) {
    return {
      ok: false,
      message: `Enter the days as whole numbers, up to ${BILLING_POLICY_DAYS_MAX}.`,
      field: graceAfterDays === undefined ? 'graceAfterDays' : 'suspendAfterDays',
    };
  }
  const rules = { dueDays, overdueHandlingEnabled, graceAfterDays, suspendAfterDays };
  const problem = billingRulesProblem(rules);
  if (problem) return { ok: false, message: problem, field: problemField(problem) };

  return withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_SETTINGS_MANAGE',
    );
    if (!staff.ok) return DENIED;
    const current = await getBillingSettings(db);
    if (!current.available) return NOT_READY;
    const switchingOn = overdueHandlingEnabled && !current.overdueHandlingEnabled;
    if (switchingOn && formData.get('confirmed') !== 'yes') {
      // Both day counts are present here: the rules check above requires them when switching on.
      const preview = await previewOverdueHandling(db, {
        graceAfterDays: graceAfterDays ?? 0,
        suspendAfterDays: suspendAfterDays ?? 0,
      });
      return {
        ok: false,
        message: `${previewSentence(preview)} Tick the box to confirm, then save again.`,
        field: 'confirmed',
      };
    }

    let result = await updateBillingSettings(db, staff.value, { ...rules, stepUpSatisfied: false });
    if (!result.ok && result.error.code === 'step_up_required') {
      const stepUp = await tryEstablishStepUp(
        { accountId, action: 'BILLING_SETTINGS_UPDATE', resourceId: 'billing-rules' },
        BILLING_RULES_PATH,
      );
      if (stepUp.kind === 'not_configured') {
        return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies FormResult;
      }
      if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
      result = await updateBillingSettings(db, staff.value, { ...rules, stepUpSatisfied: true });
    }
    if (!result.ok) {
      if (result.error.code === 'forbidden') return DENIED;
      if (result.error.message === BILLING_SETTINGS_UNAVAILABLE) return NOT_READY;
      if (result.error.code === 'invalid') {
        return {
          ok: false,
          message: result.error.message,
          field: problemField(result.error.message),
        };
      }
      return { ok: false, message: 'The rules could not be saved. Reload the page and try again.' };
    }
    if (!result.value.changed) {
      return { ok: true, message: 'Nothing to change. These are already the billing rules.' };
    }
    revalidatePath(BILLING_RULES_PATH);
    return {
      ok: true,
      message: overdueHandlingEnabled
        ? 'Saved. Automatic Grace and Suspended is on from the next daily run.'
        : 'Saved. Automatic Grace and Suspended is off.',
    };
  });
}
