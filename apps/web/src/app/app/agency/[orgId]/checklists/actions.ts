'use server';

import { serviceErrorMessage } from '../../../../../lib/service-error-message';

import {
  AGENCY_CHECKLIST_REFUSAL,
  type AgencyChecklistScope,
  type Db,
  addAgencyItem,
  agencyChecklistPrincipal,
  discardAgencyDraft,
  makeAgencyCopy,
  publishAgencyDraft,
  removeAgencyItem,
  startAgencyListUpdate,
  updateAgencyItem,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseDocumentTypeInput } from '../../../../../lib/catalogue-input';
import { withSession } from '../../../../../lib/session';

/**
 * Agency checklists (Owner, 6 Nov 2026): every action mints a fresh scope for the signed-in account
 * (`agencyChecklistPrincipal`, a live check that this person is an owner or admin of this open
 * agency) and hands it to the service, which puts the agency in every query. The agency id comes
 * from a hidden field, but the signed-in account never does, so a changed field gets "not found".
 */

export interface ChecklistActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ChecklistActionState = { ok: false, message: AGENCY_CHECKLIST_REFUSAL };

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/** Runs one change with a fresh scope; the screen sees a plain message either way. */
async function act(
  orgId: string,
  run: (scope: AgencyChecklistScope, db: Db) => Promise<ChecklistActionState>,
): Promise<ChecklistActionState> {
  return withSession(async ({ db, accountId }) => {
    const scope = await agencyChecklistPrincipal(db, accountId, orgId);
    if (!scope.ok) return DENIED;
    return run(scope.value, db);
  });
}

const NECESSITIES = ['MANDATORY', 'RECOMMENDED', 'OPTIONAL'] as const;

function listPath(orgId: string): string {
  return `/app/agency/${orgId}/checklists`;
}

/** One list's page; the list's id rides in the query, never in a folder name. */
function editPath(orgId: string): string {
  return `${listPath(orgId)}/edit`;
}

/** Copies a shared list into the agency's own, then opens it to edit. */
export async function copyListAction(
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  const orgId = field(formData, 'organizationId');
  let target: string | null = null;
  const result = await act(orgId, async (scope, db) => {
    const made = await makeAgencyCopy(db, scope, {
      fromPackVersionId: field(formData, 'packVersionId'),
    });
    if (!made.ok) return { ok: false, message: await serviceErrorMessage(made.error) };
    target = `${editPath(orgId)}?pack=${made.value.packId}`;
    return { ok: true, message: 'Your copy is ready.' };
  });
  if (result.ok && target) {
    revalidatePath(listPath(orgId));
    redirect(target);
  }
  return result;
}

/** Starts an update of the agency's published list: a draft copy to change. */
export async function startUpdateAction(
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  const orgId = field(formData, 'organizationId');
  const packId = field(formData, 'packId');
  const result = await act(orgId, async (scope, db) => {
    const started = await startAgencyListUpdate(db, scope, { packId });
    return started.ok
      ? { ok: true, message: 'A draft is open. Change it, then publish.' }
      : { ok: false, message: await serviceErrorMessage(started.error) };
  });
  if (result.ok) revalidatePath(editPath(orgId));
  return result;
}

/** Changes one item of the open draft. */
export async function saveItemAction(
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  const orgId = field(formData, 'organizationId');
  const docTypeRaw = field(formData, 'docType');
  const necessity = NECESSITIES.find((n) => n === field(formData, 'necessity'));
  let docType: string | undefined;
  if (docTypeRaw !== '') {
    const named = parseDocumentTypeInput(docTypeRaw);
    if (!named.ok) return { ok: false, message: named.message };
    docType = named.key;
  }
  const result = await act(orgId, async (scope, db) => {
    const changed = await updateAgencyItem(db, scope, {
      requirementId: field(formData, 'requirementId'),
      patch: {
        ...(docType ? { docType } : {}),
        ...(necessity ? { necessity } : {}),
        notes: field(formData, 'wording'),
        interpretation: field(formData, 'appliesWhen'),
      },
    });
    return changed.ok
      ? { ok: true, message: 'Item saved.' }
      : { ok: false, message: await serviceErrorMessage(changed.error) };
  });
  if (result.ok) revalidatePath(editPath(orgId));
  return result;
}

/** Removes one item from the open draft. */
export async function removeItemAction(
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  const orgId = field(formData, 'organizationId');
  const result = await act(orgId, async (scope, db) => {
    const removed = await removeAgencyItem(db, scope, {
      requirementId: field(formData, 'requirementId'),
    });
    return removed.ok
      ? { ok: true, message: 'Item removed.' }
      : { ok: false, message: await serviceErrorMessage(removed.error) };
  });
  if (result.ok) revalidatePath(editPath(orgId));
  return result;
}

/** Adds the agency's own item to the open draft. */
export async function addItemAction(
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  const orgId = field(formData, 'organizationId');
  const named = parseDocumentTypeInput(field(formData, 'docType'));
  if (!named.ok) return { ok: false, message: named.message };
  const necessity = NECESSITIES.find((n) => n === field(formData, 'necessity')) ?? 'RECOMMENDED';
  const result = await act(orgId, async (scope, db) => {
    const added = await addAgencyItem(db, scope, {
      packVersionId: field(formData, 'packVersionId'),
      wording: field(formData, 'wording'),
      docType: named.key,
      necessity,
      appliesWhen: field(formData, 'appliesWhen'),
    });
    return added.ok
      ? { ok: true, message: 'Item added.' }
      : { ok: false, message: await serviceErrorMessage(added.error) };
  });
  if (result.ok) revalidatePath(editPath(orgId));
  return result;
}

/** Publishes the open draft as the next version of the agency's list. */
export async function publishDraftAction(
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  const orgId = field(formData, 'organizationId');
  const result = await act(orgId, async (scope, db) => {
    const published = await publishAgencyDraft(db, scope, {
      packVersionId: field(formData, 'packVersionId'),
    });
    return published.ok
      ? { ok: true, message: 'Published. New cases use this version.' }
      : { ok: false, message: await serviceErrorMessage(published.error) };
  });
  if (result.ok) {
    revalidatePath(editPath(orgId));
    revalidatePath(listPath(orgId));
  }
  return result;
}

/** Throws away the open draft. The published version stays as it is. */
export async function discardDraftAction(
  _prev: ChecklistActionState,
  formData: FormData,
): Promise<ChecklistActionState> {
  const orgId = field(formData, 'organizationId');
  const result = await act(orgId, async (scope, db) => {
    const discarded = await discardAgencyDraft(db, scope, {
      packVersionId: field(formData, 'packVersionId'),
    });
    return discarded.ok
      ? { ok: true, message: 'Draft discarded.' }
      : { ok: false, message: await serviceErrorMessage(discarded.error) };
  });
  if (result.ok) {
    revalidatePath(editPath(orgId));
    revalidatePath(listPath(orgId));
  }
  return result;
}
