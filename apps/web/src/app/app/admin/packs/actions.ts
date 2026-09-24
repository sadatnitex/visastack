'use server';

import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  clearRequirementSourceInaccessible,
  createPack,
  markRequirementSourceInaccessible,
  publishPackVersion,
  setDocumentExpiryPolicy,
  verifyPackChecksum,
  withdrawPackVersion,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { hasPlatformPermission } from '../../../../lib/admin';
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
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) {
      return { state: DENIED, id: null };
    }
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
export async function openVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  if (packId.length === 0) return { ok: false, message: 'Missing pack id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const opened = await addPackVersion(db, { actorAccountId: accountId, packId });
    if (!opened.ok) return { ok: false, message: opened.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Draft version ${opened.value.version} opened.`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
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
  const maxAgeDaysRaw = String(formData.get('maxAgeDays') ?? '').trim();
  if (key.length === 0) {
    return {
      ok: false,
      message: kind === 'FIELD' ? 'Enter the field key.' : 'Enter the document type.',
    };
  }
  if (citation.length === 0) return { ok: false, message: 'Every requirement needs a citation.' };
  let maxAgeDays: number | undefined;
  if (maxAgeDaysRaw.length > 0) {
    const parsed = Number(maxAgeDaysRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      return { ok: false, message: 'Max age in days must be a positive whole number.' };
    }
    maxAgeDays = parsed;
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const added = await addRequirement(db, {
      actorAccountId: accountId,
      packVersionId,
      kind,
      ...(kind === 'FIELD' ? { fieldKey: key } : { docType: key }),
      citation,
      optional,
      ...(maxAgeDays !== undefined ? { maxAgeDays } : {}),
    });
    if (!added.ok) return { ok: false, message: added.error.message } satisfies ActionState;
    return { ok: true, message: 'Requirement added.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Approve (freeze) a DRAFT version, then optionally publish. Platform-admin only. */
export async function approveVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const approved = await approvePackVersion(db, { actorAccountId: accountId, packVersionId });
    if (!approved.ok) return { ok: false, message: approved.error.message } satisfies ActionState;
    return { ok: true, message: 'Version approved and checksummed.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Recompute a version's manifest checksum and compare it to the frozen value. Platform-admin only. */
export async function verifyChecksumAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version.' };

  return withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const valid = await verifyPackChecksum(db, packVersionId);
    return {
      ok: valid,
      message: valid
        ? 'Checksum matches — the requirement content is unchanged since approval.'
        : 'Checksum mismatch — the requirement content has changed since approval.',
    } satisfies ActionState;
  });
}

/** Publish an APPROVED version, making it attachable by missions. Platform-admin only. */
export async function publishVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const published = await publishPackVersion(db, { actorAccountId: accountId, packVersionId });
    if (!published.ok) {
      return { ok: false, message: published.error.message } satisfies ActionState;
    }
    return {
      ok: true,
      message: 'Version published — attachable by missions now.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Set (or replace) a docType's expiry-reminder threshold ladder (NTF-01). Platform-admin only. */
export async function setDocumentExpiryPolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const docType = String(formData.get('docType') ?? '').trim();
  const thresholdDaysRaw = String(formData.get('thresholdDays') ?? '').trim();
  if (docType.length === 0) return { ok: false, message: 'Enter the document type.' };
  const thresholdDays = thresholdDaysRaw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);
  if (thresholdDays.length === 0 || thresholdDays.some((n) => !Number.isInteger(n) || n < 0)) {
    return {
      ok: false,
      message: 'Enter comma-separated non-negative whole days, e.g. 90,60,30,7,0.',
    };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const saved = await setDocumentExpiryPolicy(db, {
      actorAccountId: accountId,
      docType,
      thresholdDays,
    });
    if (!saved.ok) return { ok: false, message: saved.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Reminder thresholds saved for "${docType}".`,
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin/packs');
  return result;
}

/** Withdraw a PUBLISHED version for cause, explicit and reasoned (RUL-05). Platform-admin only. */
export async function withdrawVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required to withdraw.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const withdrawn = await withdrawPackVersion(db, {
      actorAccountId: accountId,
      packVersionId,
      reason,
    });
    if (!withdrawn.ok) return { ok: false, message: withdrawn.error.message } satisfies ActionState;
    return { ok: true, message: 'Version withdrawn.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Mark one requirement's source as unreachable on re-check (RUL-05). Platform-admin only. */
export async function markSourceInaccessibleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const requirementId = String(formData.get('requirementId') ?? '').trim();
  if (requirementId.length === 0) return { ok: false, message: 'Missing requirement id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const marked = await markRequirementSourceInaccessible(db, {
      actorAccountId: accountId,
      requirementId,
    });
    if (!marked.ok) return { ok: false, message: marked.error.message } satisfies ActionState;
    return { ok: true, message: 'Marked source inaccessible.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Clear a requirement's source-inaccessible mark once a later re-check succeeds (RUL-05). Platform-admin only. */
export async function clearSourceInaccessibleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const requirementId = String(formData.get('requirementId') ?? '').trim();
  if (requirementId.length === 0) return { ok: false, message: 'Missing requirement id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const cleared = await clearRequirementSourceInaccessible(db, {
      actorAccountId: accountId,
      requirementId,
    });
    if (!cleared.ok) return { ok: false, message: cleared.error.message } satisfies ActionState;
    return { ok: true, message: 'Source access restored.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}
