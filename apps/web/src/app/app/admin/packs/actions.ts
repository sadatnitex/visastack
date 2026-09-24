'use server';

import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  clearOfficialFeeStale,
  clearRequirementSourceInaccessible,
  createPack,
  markOfficialFeeStale,
  markRequirementSourceInaccessible,
  publishPackVersion,
  publishToPublicTrust,
  setDocumentExpiryPolicy,
  setPublicTrustContent,
  unpublishFromPublicTrust,
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
  // RUL-01 coverage model (jurisdiction/route/purpose) and the RUL-02/06
  // authoritative flag: previously never read from this form at all, a real
  // pre-existing gap (see requirements-ledger.md RUL-01's own "no admin UI
  // yet" note) that now blocks RUL-06 concretely -- there was no way to
  // create an authoritative pack through the UI, and publishToPublicTrust
  // refuses a non-authoritative one.
  const jurisdiction = String(formData.get('jurisdiction') ?? '').trim();
  const route = String(formData.get('route') ?? '').trim();
  const purpose = String(formData.get('purpose') ?? '').trim();
  const authoritative = String(formData.get('authoritative') ?? '') === 'on';
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
      ...(jurisdiction.length > 0 ? { jurisdiction } : {}),
      ...(route.length > 0 ? { route } : {}),
      ...(purpose.length > 0 ? { purpose } : {}),
      authoritative,
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

/** Parses a human-entered decimal amount (e.g. "100.00") into the currency's smallest unit, using the same currency-aware decimal-digit resolution `formatPrice` (lib/usage-format.ts) uses for display -- symmetric, so a JPY/BHD amount round-trips correctly rather than assuming 2 decimal places. Returns `null` for an unparseable amount or an unrecognized ISO currency code. */
function parseOfficialFeeMinorUnits(amountText: string, currency: string): number | null {
  const parsed = Number(amountText);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  try {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
    const divisor = 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2);
    return Math.round(parsed * divisor);
  } catch {
    return null;
  }
}

/** Author Public Trust Lite content on a DRAFT version (RUL-06). Platform-admin only. */
export async function setPublicTrustContentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  const routeDescription = String(formData.get('routeDescription') ?? '').trim();
  const officialFeeAmountRaw = String(formData.get('officialFeeAmount') ?? '').trim();
  const officialFeeCurrency = String(formData.get('officialFeeCurrency') ?? '')
    .trim()
    .toUpperCase();
  const officialChannelName = String(formData.get('officialChannelName') ?? '').trim();
  const officialChannelUrl = String(formData.get('officialChannelUrl') ?? '').trim();
  const officialReportingUrl = String(formData.get('officialReportingUrl') ?? '').trim();

  let officialFeeMinorUnits: number | null = null;
  if (officialFeeAmountRaw.length > 0) {
    if (officialFeeCurrency.length === 0) {
      return { ok: false, message: 'Enter a currency code (e.g. GBP) alongside the fee amount.' };
    }
    officialFeeMinorUnits = parseOfficialFeeMinorUnits(officialFeeAmountRaw, officialFeeCurrency);
    if (officialFeeMinorUnits === null) {
      return {
        ok: false,
        message: 'Enter a valid non-negative amount and a recognized currency code.',
      };
    }
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const saved = await setPublicTrustContent(db, {
      actorAccountId: accountId,
      packVersionId,
      routeDescription,
      officialFeeMinorUnits,
      officialFeeCurrency: officialFeeMinorUnits !== null ? officialFeeCurrency : null,
      officialChannelName,
      officialChannelUrl,
      officialReportingUrl,
    });
    if (!saved.ok) return { ok: false, message: saved.error.message } satisfies ActionState;
    return { ok: true, message: 'Public trust content saved.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Expose a PUBLISHED, authoritative version on the public trust surface (RUL-06). Platform-admin only. */
export async function publishToPublicTrustAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const published = await publishToPublicTrust(db, { actorAccountId: accountId, packVersionId });
    if (!published.ok) return { ok: false, message: published.error.message } satisfies ActionState;
    return { ok: true, message: 'Now live on the public trust surface.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Remove a version from the public trust surface, without touching its case-readiness usability (RUL-06). Platform-admin only. */
export async function unpublishFromPublicTrustAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const unpublished = await unpublishFromPublicTrust(db, {
      actorAccountId: accountId,
      packVersionId,
    });
    if (!unpublished.ok) {
      return { ok: false, message: unpublished.error.message } satisfies ActionState;
    }
    return { ok: true, message: 'Removed from the public trust surface.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Mark a PUBLISHED version's official fee as no longer current, without opening a new DRAFT (RUL-06). Platform-admin only. */
export async function markOfficialFeeStaleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const marked = await markOfficialFeeStale(db, { actorAccountId: accountId, packVersionId });
    if (!marked.ok) return { ok: false, message: marked.error.message } satisfies ActionState;
    return {
      ok: true,
      message: 'Fee marked stale - hidden on the public page.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}

/** Clear a fee staleness mark once a re-check confirms the amount is current again (RUL-06). Platform-admin only. */
export async function clearOfficialFeeStaleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const packId = String(formData.get('packId') ?? '').trim();
  const packVersionId = String(formData.get('packVersionId') ?? '').trim();
  if (packVersionId.length === 0) return { ok: false, message: 'Missing version id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PACK_MANAGE'))) return DENIED;
    const cleared = await clearOfficialFeeStale(db, { actorAccountId: accountId, packVersionId });
    if (!cleared.ok) return { ok: false, message: cleared.error.message } satisfies ActionState;
    return { ok: true, message: 'Fee restored on the public page.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath(`/app/admin/packs/${packId}`);
  return result;
}
