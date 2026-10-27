'use server';

import { randomUUID } from 'node:crypto';
import { CATALOGUE_MODULES, CATALOGUE_PURPOSE_FAMILIES } from '@visastack/core/catalogue';
import {
  editFact,
  registerFieldDefinition,
  setExemption,
  setSectionOpen,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { savableField } from '../../../../lib/master-profile';
import { createKeyManagementPort } from '../../../../lib/providers';
import { withSession } from '../../../../lib/session';
import { otherItemSavedLine } from '../../../../lib/success-lines';
import type { ActionState } from './actions';

/**
 * Opening a section, marking a detail as not applying, and saving a free "something else" item.
 * Each one runs the same owner-only, consent-checked, audited service the rest of the profile uses;
 * names are checked against the catalogue there, never trusted from the form.
 */

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

function refresh(applicantId: string): void {
  revalidatePath(`/app/applicant/${applicantId}`, 'layout');
}

export async function setSectionOpenAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = text(formData, 'applicantId');
  const sectionKey = text(formData, 'sectionKey');
  const open = text(formData, 'open') === 'true';
  const result = await withSession(({ db, accountId }) =>
    setSectionOpen(db, { actorAccountId: accountId, applicantId, sectionKey, open }),
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  refresh(applicantId);
  return { ok: true, message: open ? 'Section opened.' : 'Section closed.' };
}

/** Opens every closed section a chosen purpose suggests. The list is rebuilt here, never read from the form. */
export async function openSuggestedSectionsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = text(formData, 'applicantId');
  const family = text(formData, 'family');
  if (!CATALOGUE_PURPOSE_FAMILIES.some((candidate) => candidate.key === family)) {
    return { ok: false, message: 'Choose a purpose first.' };
  }
  const keys = CATALOGUE_MODULES.filter(
    (module) =>
      !module.internal &&
      !module.defaultOpen &&
      (module.suggestedFor ?? []).some((candidate) => candidate === family),
  ).map((module) => module.key);
  const outcome = await withSession(async ({ db, accountId }) => {
    let opened = 0;
    for (const sectionKey of keys) {
      const result = await setSectionOpen(db, {
        actorAccountId: accountId,
        applicantId,
        sectionKey,
        open: true,
      });
      if (!result.ok) return { error: result.error.message, opened };
      opened += 1;
    }
    return { error: null, opened };
  });
  refresh(applicantId);
  if (outcome.error) return { ok: false, message: outcome.error };
  return {
    ok: true,
    message: `${outcome.opened} suggested section${outcome.opened === 1 ? '' : 's'} opened.`,
  };
}

export async function setExemptionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = text(formData, 'applicantId');
  const kind = text(formData, 'kind');
  const targetKey = text(formData, 'targetKey');
  const on = text(formData, 'on') === 'true';
  if (kind !== 'FIELD_NOT_APPLICABLE' && kind !== 'RECORD_NONE') {
    return { ok: false, message: 'Unknown choice.' };
  }
  const result = await withSession(({ db, accountId }) =>
    setExemption(db, { actorAccountId: accountId, applicantId, kind, targetKey, on }),
  );
  if (!result.ok) return { ok: false, message: result.error.message };
  refresh(applicantId);
  return { ok: true, message: on ? 'Marked.' : 'Mark removed.' };
}

/** Saves one "something else" item for a section: what it is, its details, a date and a note. */
export async function saveOtherItemAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = text(formData, 'applicantId');
  const sectionKey = text(formData, 'sectionKey');
  const title = text(formData, 'title');
  const dateText = text(formData, 'date');
  const module = CATALOGUE_MODULES.find(
    (candidate) => candidate.key === sectionKey && !candidate.internal,
  );
  if (!module) return { ok: false, message: 'Unknown section.' };
  if (title === '') return { ok: false, message: 'Say what it is first.', field: 'title' };
  if (dateText !== '' && Number.isNaN(new Date(dateText).getTime())) {
    return { ok: false, message: 'Enter a valid date.', field: 'date' };
  }

  const entries: readonly (readonly [string, string])[] = [
    ['section', module.key],
    ['title', title],
    ['details', text(formData, 'details')],
    ['date', dateText],
    ['note', text(formData, 'note')],
  ];
  const recordKey = randomUUID();
  const result = await withSession(async ({ db, accountId }) => {
    const encryption = createKeyManagementPort();
    for (const [suffix, value] of entries) {
      if (value === '') continue;
      const def = savableField(`other_item_${module.pack}_${suffix}`);
      if (!def) return { ok: false, message: 'This section cannot hold extra items yet.' };
      await registerFieldDefinition(db, {
        key: def.key,
        dataType: def.type === 'date' ? 'date' : 'string',
        sensitivity: def.sensitivity,
        repeating: def.repeating,
        packId: def.packId,
      });
      const edit = await editFact(db, {
        actorAccountId: accountId,
        applicantId,
        fieldKey: def.key,
        value,
        repeatingRecordKey: recordKey,
        ...(encryption ? { encryption } : {}),
      });
      if (!edit.ok) return { ok: false, message: edit.error.message };
    }
    return { ok: true, message: otherItemSavedLine(module.label) };
  });
  if (result.ok) refresh(applicantId);
  return result;
}
