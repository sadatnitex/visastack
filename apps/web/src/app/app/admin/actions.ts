'use server';

import {
  type StorageBucket,
  placeLegalHold,
  purgeExpiredDocuments,
  reconcileOrphans,
  releaseLegalHold,
  retryErasureJob,
  retryFailedJob,
  reviewOrganization,
  setRetentionPolicy,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { isPlatformAdmin } from '../../../lib/admin';
import { triggerErasureWorker } from '../../../lib/jobs';
import { withSession } from '../../../lib/session';
import { createStorage } from '../../../lib/storage';

/** Result surfaced back to the client for inline feedback. */
export interface ActionState {
  readonly ok: boolean;
  readonly message: string;
}

const DENIED: ActionState = { ok: false, message: 'Not authorized.' };

/** Set (upsert) the retention policy for a document type. Platform-admin only. */
export async function setRetentionPolicyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const docType = String(formData.get('docType') ?? '').trim();
  const retentionDays = Number(String(formData.get('retentionDays') ?? ''));
  if (docType.length === 0) return { ok: false, message: 'Enter a document type.' };
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { ok: false, message: 'Retention days must be a positive number.' };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const set = await setRetentionPolicy(db, { actorAccountId: accountId, docType, retentionDays });
    if (!set.ok) return { ok: false, message: set.error.message } satisfies ActionState;
    return { ok: true, message: `Retention for ${docType} set to ${retentionDays} days.` };
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Place a legal hold on an applicant. Platform-admin only. */
export async function placeLegalHoldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (applicantId.length === 0) return { ok: false, message: 'Enter an applicant ID.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const held = await placeLegalHold(db, { actorAccountId: accountId, applicantId, reason });
    if (!held.ok) return { ok: false, message: held.error.message } satisfies ActionState;
    return { ok: true, message: 'Legal hold placed.' };
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Release a legal hold. Platform-admin only. */
export async function releaseLegalHoldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const holdId = String(formData.get('holdId') ?? '').trim();
  if (holdId.length === 0) return { ok: false, message: 'Missing hold id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const released = await releaseLegalHold(db, { actorAccountId: accountId, holdId });
    if (!released.ok) return { ok: false, message: released.error.message } satisfies ActionState;
    return { ok: true, message: 'Legal hold released.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Re-queue a FAILED intake job with a fresh retry budget. Platform-admin only. */
export async function retryJobAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  if (jobId.length === 0) return { ok: false, message: 'Missing job id.' };
  const result = await withSession(async ({ db, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const retried = await retryFailedJob(db, jobId);
    if (!retried) {
      return {
        ok: false,
        message: 'That job is no longer failed — it may have already been retried.',
      } satisfies ActionState;
    }
    return { ok: true, message: 'Job re-queued for another attempt.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/**
 * Queue every document past its retention policy (never one under an active
 * legal hold) for erasure. Platform-admin only. Irreversible once the erasure
 * worker verifies the bytes are gone — this only queues the work; it does not
 * delete anything itself (master directive §7 "PR 4").
 */
export async function purgeExpiredDocumentsAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const purged = await purgeExpiredDocuments(db, { actorAccountId: accountId });
    if (!purged.ok) return { ok: false, message: purged.error.message } satisfies ActionState;
    const { queuedForErasure, blockedByHold } = purged.value;
    if (queuedForErasure === 0 && blockedByHold === 0) {
      return { ok: true, message: 'Nothing was eligible to purge.' } satisfies ActionState;
    }
    const parts = [
      queuedForErasure > 0
        ? `${queuedForErasure} document${queuedForErasure === 1 ? '' : 's'} queued for deletion`
        : null,
      blockedByHold > 0 ? `${blockedByHold} skipped (now under legal hold)` : null,
    ].filter((part): part is string => part !== null);
    return { ok: true, message: `${parts.join('; ')}.` } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath('/app/admin');
    // Queuing is synchronous; the actual byte deletion is not (master
    // directive §7 "PR 4"). Kick the erasure worker now for near-instant
    // cleanup in the common case — /api/jobs/process-erasure is the backstop.
    after(() => triggerErasureWorker());
  }
  return result;
}

/** Re-queue a FAILED or BLOCKED_BY_HOLD erasure job with a fresh retry budget. Platform-admin only. */
export async function retryErasureJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const jobId = String(formData.get('jobId') ?? '').trim();
  if (jobId.length === 0) return { ok: false, message: 'Missing job id.' };
  const result = await withSession(async ({ db, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const retried = await retryErasureJob(db, jobId);
    if (!retried) {
      return {
        ok: false,
        message: 'That job is no longer failed or blocked — it may have already been retried.',
      } satisfies ActionState;
    }
    return {
      ok: true,
      message: 'Erasure job re-queued for another attempt.',
    } satisfies ActionState;
  });
  if (result.ok) {
    revalidatePath('/app/admin');
    after(() => triggerErasureWorker());
  }
  return result;
}

/**
 * Run the orphan reconciliation sweep (master directive §7 "PR 4") across
 * both storage buckets. Dry run by default — only explicit `mode=mutate`
 * corrects anything, and even then only the one unambiguous, reversible
 * finding (a metadata row with no backing bytes and no remaining reference).
 * Platform-admin only.
 */
export async function reconcileOrphansAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const dryRun = String(formData.get('mode') ?? 'dry-run') !== 'mutate';
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const storage = createStorage(db);
    const buckets: readonly StorageBucket[] = ['CLEAN', 'QUARANTINE'];
    const reports = await Promise.all(
      buckets.map((bucket) =>
        reconcileOrphans(db, storage, { actorAccountId: accountId, bucket, dryRun }),
      ),
    );
    const totals = reports.reduce(
      (sum, r) => ({
        dbReferencesWithoutBlob: sum.dbReferencesWithoutBlob + r.dbReferencesWithoutBlob.length,
        blobsWithoutDbReference: sum.blobsWithoutDbReference + r.blobsWithoutDbReference.length,
        duplicateReferences: sum.duplicateReferences + r.duplicateReferences.length,
        sizeOrHashMismatches: sum.sizeOrHashMismatches + r.sizeOrHashMismatches.length,
        verifiedButStillPresent: sum.verifiedButStillPresent + r.verifiedButStillPresent.length,
        cleaned: sum.cleaned + r.cleaned,
      }),
      {
        dbReferencesWithoutBlob: 0,
        blobsWithoutDbReference: 0,
        duplicateReferences: 0,
        sizeOrHashMismatches: 0,
        verifiedButStillPresent: 0,
        cleaned: 0,
      },
    );
    const total =
      totals.dbReferencesWithoutBlob +
      totals.blobsWithoutDbReference +
      totals.duplicateReferences +
      totals.sizeOrHashMismatches +
      totals.verifiedButStillPresent;
    if (total === 0)
      return { ok: true, message: 'No drift found. Storage is consistent.' } satisfies ActionState;
    const summary = [
      totals.dbReferencesWithoutBlob > 0
        ? `${totals.dbReferencesWithoutBlob} reference${totals.dbReferencesWithoutBlob === 1 ? '' : 's'} with no bytes`
        : null,
      totals.blobsWithoutDbReference > 0
        ? `${totals.blobsWithoutDbReference} blob${totals.blobsWithoutDbReference === 1 ? '' : 's'} with no reference`
        : null,
      totals.duplicateReferences > 0
        ? `${totals.duplicateReferences} duplicate reference(s)`
        : null,
      totals.sizeOrHashMismatches > 0
        ? `${totals.sizeOrHashMismatches} size/hash mismatch(es)`
        : null,
      totals.verifiedButStillPresent > 0
        ? `${totals.verifiedButStillPresent} verified-deleted object(s) still present`
        : null,
    ]
      .filter((part): part is string => part !== null)
      .join(', ');
    const action = dryRun
      ? 'Dry run'
      : `Cleaned ${totals.cleaned} dangling reference${totals.cleaned === 1 ? '' : 's'}`;
    return { ok: true, message: `${action}: ${summary}.` } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Verify or reject a pending organization. Platform-admin only (and not a member). */
export async function reviewOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '') === 'ACTIVE' ? 'ACTIVE' : 'REJECTED';
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!isPlatformAdmin(email)) return DENIED;
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: accountId,
      organizationId,
      decision,
    });
    if (!reviewed.ok) return { ok: false, message: reviewed.error.message } satisfies ActionState;
    return {
      ok: true,
      message: decision === 'ACTIVE' ? 'Organization verified.' : 'Organization rejected.',
    } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}
