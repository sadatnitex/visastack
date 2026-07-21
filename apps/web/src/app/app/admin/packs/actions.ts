'use server';

import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { isPlatformAdmin } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

/** Create a pack, then redirect into its Studio page. Platform-admin only. */
export async function createPackAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const key = String(formData.get('key') ?? '').trim();
  const name = String(formData.get('name') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim();
  if (key.length === 0 || name.length === 0) {
    return { ok: false, message: 'Key and name are required.' };
  }

  const outcome = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return { state: DENIED, id: null };
    const created = await createPack(db, {
      actorAccountId: accountId,
      key,
      name,
      ...(description.length > 0 ? { description } : {}),
    });
    if (!created.ok) {
      return { state: { ok: false, message: created.error.message } as ActionState, id: null };
    }
    return { state: { ok: true, message: '' } as ActionState, id: created.value.id };
  });

  if (outcome.id) {
    revalidatePath('/app/admin/packs');
    redirect(`/app/admin/packs/${outcome.id}`);
  }
  return outcome.state;
}

/** Open a new DRAFT version of a pack. Platform-admin only. */
export async function openVersionAction(formData: FormData): Promise<void> {
  const packId = String(formData.get('packId') ?? '').trim();
  if (packId.length === 0) return;
  await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return;
    await addPackVersion(db, { actorAccountId: accountId, packId });
  });
  revalidatePath(`/app/admin/packs/${packId}`);
}

/** Add a cited requirement to a DRAFT version. Platform-admin only. */
export async function addRequirementAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  const kind = String(formData.get('kind') ?? '') === 'DOCUMENT' ? 'DOCUMENT' : 'FIELD';
  const key = String(formData.get('key') ?? '').trim();
  const citation = String(formData.get('citation') ?? '').trim();
  const optional = String(formData.get('optional') ?? '') === 'on';
  if (key.length === 0) {
    return {
      ok: false,
      message: kind === 'FIELD' ? 'Enter the field key.' : 'Enter the document type.',
    };
  }
  if (citation.length === 0) return { ok: false, message: 'Every requirement needs a citation.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const added = await addRequirement(db, {
      actorAccountId: accountId,
      packVersionId,
      kind,
      ...(kind === 'FIELD' ? { fieldKey: key } : { docType: key }),
      citation,
      optional,
    });
    if (!added.ok) return { ok: false, message: added.error.message } satisfies ActionState;
    return { ok: true, message: 'Requirement added.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Approve (freeze) a DRAFT version, then optionally publish. Platform-admin only. */
export async function approveVersionAction(formData: FormData): Promise<void> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return;
  await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return;
    await approvePackVersion(db, { actorAccountId: accountId, packVersionId });
  });
  revalidatePath(`/app/admin/packs/${packId}`);
}

/** Publish an APPROVED version, making it attachable by missions. Platform-admin only. */
export async function publishVersionAction(formData: FormData): Promise<void> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return;
  await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return;
    await publishPackVersion(db, { actorAccountId: accountId, packVersionId });
  });
  revalidatePath(`/app/admin/packs/${packId}`);
}
