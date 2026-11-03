'use server';

import {
  type AcceptedForm,
  type RequirementCategory,
  isAcceptedForm,
  isRequirementCategory,
} from '@visastack/core';
import { setPackRouteConditions, setRequirementDetails } from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';
import type { ActionState } from './actions';

/**
 * UMPE G2: Pack Studio forms for a requirement's rule details (category, how a document must be
 * provided, when the source's rule took effect, validity after the trip) and a pack's route
 * conditions (application posts, trip start window). A fresh PACK_MANAGE staff scope only; the
 * service checks the rest (draft only, known values, ranges) and audits with counts.
 */

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

/** A fresh pack management scope for this request, or null (the same check as the source forms). */
async function packScope(
  db: Parameters<typeof staffPrincipal>[0],
  accountId: string,
  email: string,
) {
  const staff = await staffPrincipal(
    db,
    { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
    'PACK_MANAGE',
  );
  return staff.ok ? staff.value : null;
}
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

/** "yes", "no" or blank (not stated). */
function triState(formData: FormData, name: string): boolean | null | 'bad' {
  const value = text(formData, name);
  if (value === '') return null;
  if (value === 'yes') return true;
  if (value === 'no') return false;
  return 'bad';
}

/** A whole number, blank for unset, or 'bad'. */
function wholeNumber(formData: FormData, name: string): number | null | 'bad' {
  const value = text(formData, name);
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 'bad';
}

export async function setRequirementDetailsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = text(formData, 'packId');
  const packRequirementId = text(formData, 'requirementId');
  const categoryRaw = text(formData, 'category');
  const formRaw = text(formData, 'acceptedForm');
  const translationNeeded = triState(formData, 'translationNeeded');
  const originalNeeded = triState(formData, 'originalNeeded');
  const statementPeriodMonths = wholeNumber(formData, 'statementPeriodMonths');
  const validMonthsAfterTravel = wholeNumber(formData, 'validMonthsAfterTravel');
  const effectiveRaw = text(formData, 'effectiveSince');
  if (!packRequirementId) return { ok: false, message: 'Missing requirement.' };
  if (categoryRaw && !isRequirementCategory(categoryRaw)) {
    return { ok: false, message: 'Choose a category from the list.' };
  }
  if (formRaw && !isAcceptedForm(formRaw)) {
    return { ok: false, message: 'Choose an accepted form from the list.' };
  }
  if (translationNeeded === 'bad' || originalNeeded === 'bad') {
    return { ok: false, message: 'Choose Yes, No or Not Stated.' };
  }
  if (statementPeriodMonths === 'bad' || validMonthsAfterTravel === 'bad') {
    return { ok: false, message: 'Months must be whole numbers.' };
  }
  let effectiveSince: Date | null = null;
  if (effectiveRaw) {
    const parsed = new Date(`${effectiveRaw}T00:00:00Z`);
    if (
      !DATE_ONLY.test(effectiveRaw) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== effectiveRaw
    ) {
      return { ok: false, message: 'Enter a real date for when the rule took effect.' };
    }
    effectiveSince = parsed;
  }
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const saved = await setRequirementDetails(db, staff, {
      packRequirementId,
      category: categoryRaw ? (categoryRaw as RequirementCategory) : null,
      acceptedForm: formRaw ? (formRaw as AcceptedForm) : null,
      translationNeeded,
      originalNeeded,
      statementPeriodMonths,
      validMonthsAfterTravel,
      effectiveSince,
    });
    return saved.ok
      ? ({ ok: true, message: 'Rule details saved.' } satisfies ActionState)
      : ({ ok: false, message: saved.error.message } satisfies ActionState);
  });
  if (result.ok && packId) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

export async function setRouteConditionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = text(formData, 'packId');
  if (!packId) return { ok: false, message: 'Missing pack.' };
  const consularPosts = String(formData.get('consularPosts') ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const travelFrom = text(formData, 'travelFrom') || null;
  const travelUntil = text(formData, 'travelUntil') || null;
  const result = await withSession(async ({ db, accountId, email }) => {
    const staff = await packScope(db, accountId, email);
    if (!staff) return DENIED;
    const saved = await setPackRouteConditions(db, staff, {
      packId,
      consularPosts,
      travelFrom,
      travelUntil,
    });
    return saved.ok
      ? ({ ok: true, message: 'Who this checklist is for was saved.' } satisfies ActionState)
      : ({ ok: false, message: saved.error.message } satisfies ActionState);
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}
