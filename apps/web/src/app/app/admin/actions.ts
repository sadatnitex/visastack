'use server';

import {
  type PlatformRole,
  type StorageBucket,
  createInvitation,
  getAccountByEmail,
  grantPlatformRole,
  placeLegalHold,
  purgeExpiredDocuments,
  reconcileOrphans,
  releaseLegalHold,
  resetStaffSecondFactor,
  retryErasureJob,
  retryFailedJob,
  reviewOrganization,
  revokeInvitation,
  revokePlatformRole,
  setRetentionPolicy,
  suspendOrganization,
  terminateOrganization,
} from '@visastack/services';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import {
  bootstrapAdminEmails,
  hasPlatformPermission,
  isPlatformOwnerAccount,
} from '../../../lib/admin';
import { parseDocumentTypeInput } from '../../../lib/catalogue-input';
import { triggerErasureWorker } from '../../../lib/jobs';
import { withSession } from '../../../lib/session';
import { STEP_UP_NOT_CONFIGURED_MESSAGE, tryEstablishStepUp } from '../../../lib/step-up';
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
  const named = parseDocumentTypeInput(docType);
  if (!named.ok) return { ok: false, message: named.message };
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return { ok: false, message: 'Retention days must be a positive number.' };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'RETENTION_POLICY_SET'))) {
      return DENIED;
    }
    const set = await setRetentionPolicy(db, {
      actorAccountId: accountId,
      docType: named.key,
      retentionDays,
    });
    if (!set.ok) return { ok: false, message: set.error.message } satisfies ActionState;
    return {
      ok: true,
      message: `Retention for ${named.label ?? named.key} set to ${retentionDays} days.`,
    };
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Place a legal hold on an applicant. Platform-admin only. Step-up gated (master directive §7 "PR 5"). */
export async function placeLegalHoldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const applicantId = String(formData.get('applicantId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  const reviewAtRaw = String(formData.get('reviewAt') ?? '').trim();
  const scope = String(formData.get('scope') ?? 'applicant').trim();
  const missionId = String(formData.get('missionId') ?? '').trim();
  const documentId = String(formData.get('documentId') ?? '').trim();
  if (applicantId.length === 0) return { ok: false, message: 'Enter an applicant ID.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };
  if (reviewAtRaw.length === 0) return { ok: false, message: 'A review date is required.' };
  if (scope === 'mission' && missionId.length === 0) {
    return { ok: false, message: 'Enter the case ID to scope this hold to.' };
  }
  if (scope === 'document' && documentId.length === 0) {
    return { ok: false, message: 'Enter the document ID to scope this hold to.' };
  }
  const reviewAt = new Date(reviewAtRaw);
  if (Number.isNaN(reviewAt.getTime())) {
    return { ok: false, message: 'The review date is not valid.' };
  }

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'LEGAL_HOLD_PLACE'))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'LEGAL_HOLD_PLACE', resourceId: applicantId },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const held = await placeLegalHold(db, {
      actorAccountId: accountId,
      applicantId,
      reason,
      reviewAt,
      stepUpSatisfied: true,
      ...(scope === 'mission' ? { missionId } : {}),
      ...(scope === 'document' ? { documentId } : {}),
    });
    if (!held.ok) return { ok: false, message: held.error.message } satisfies ActionState;
    return { ok: true, message: 'Legal hold placed.' };
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/** Release a legal hold. Platform-admin only. Step-up gated (master directive §7 "PR 5"). */
export async function releaseLegalHoldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const holdId = String(formData.get('holdId') ?? '').trim();
  if (holdId.length === 0) return { ok: false, message: 'Missing hold id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'LEGAL_HOLD_RELEASE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'LEGAL_HOLD_RELEASE', resourceId: holdId },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const released = await releaseLegalHold(db, {
      actorAccountId: accountId,
      holdId,
      stepUpSatisfied: true,
    });
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
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'PROCESSING_JOB_RETRY'))) {
      return DENIED;
    }
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
 * delete anything itself (master directive §7 "PR 4"). Step-up gated as
 * "retention execution" (master directive §7 "PR 5").
 */
export async function purgeExpiredDocumentsAction(
  _prev: ActionState,
  _formData: FormData,
): Promise<ActionState> {
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'RETENTION_PURGE'))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'RETENTION_PURGE', resourceId: 'platform-wide' },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const purged = await purgeExpiredDocuments(db, {
      actorAccountId: accountId,
      stepUpSatisfied: true,
    });
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
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'ERASURE_JOB_RETRY'))) {
      return DENIED;
    }
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
    if (!(await hasPlatformPermission(db, { accountId, email }, 'ORPHAN_RECONCILE'))) return DENIED;
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

/**
 * Verify or reject a pending organization. Platform-admin only (and not a
 * member). Step-up gated as "organization verification" (master directive
 * §7 "PR 5").
 */
export async function reviewOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  const decision = String(formData.get('decision') ?? '') === 'ACTIVE' ? 'ACTIVE' : 'REJECTED';
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'ORGANIZATION_REVIEW'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ORGANIZATION_REVIEW', resourceId: organizationId },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const reviewed = await reviewOrganization(db, {
      reviewerAccountId: accountId,
      organizationId,
      decision,
      stepUpSatisfied: true,
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

/**
 * Suspend an ACTIVE organization. Platform-admin only, step-up gated as
 * "organization suspension" (master directive §7 "PR 5").
 */
export async function suspendOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'ORGANIZATION_SUSPEND'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ORGANIZATION_SUSPEND', resourceId: organizationId },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const suspended = await suspendOrganization(db, {
      reviewerAccountId: accountId,
      organizationId,
      stepUpSatisfied: true,
    });
    if (!suspended.ok) return { ok: false, message: suspended.error.message } satisfies ActionState;
    return { ok: true, message: 'Organization suspended.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/**
 * Terminate an organization (master directive Part 7 §14, PRD PRV-04):
 * permanent, removes platform access, the traveller's own wallet is
 * untouched. Platform-admin only, step-up gated as "organization
 * termination" -- legal from ACTIVE or SUSPENDED, matching
 * `terminateOrganization`'s own precondition.
 */
export async function terminateOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const organizationId = String(formData.get('organizationId') ?? '').trim();
  if (organizationId.length === 0) return { ok: false, message: 'Missing organization id.' };
  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await hasPlatformPermission(db, { accountId, email }, 'ORGANIZATION_TERMINATE'))) {
      return DENIED;
    }
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'ORGANIZATION_TERMINATE', resourceId: organizationId },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const terminated = await terminateOrganization(db, {
      reviewerAccountId: accountId,
      organizationId,
      stepUpSatisfied: true,
    });
    if (!terminated.ok) {
      return { ok: false, message: terminated.error.message } satisfies ActionState;
    }
    return { ok: true, message: 'Organization terminated.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

const VALID_ROLES: readonly PlatformRole[] = [
  'PLATFORM_OWNER',
  'SECURITY_ADMIN',
  'COMPLIANCE_ADMIN',
  'SUPPORT_ADMIN',
];

/**
 * Grant a platform role to the account with the given email. Platform-owner
 * only (master directive §7 "PR 5") — replaces the ADMIN_EMAILS allowlist
 * with an accountable, auditable, revocable model. Step-up gated as
 * "platform-role changes".
 */
export async function grantPlatformRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const targetEmail = String(formData.get('targetEmail') ?? '').trim();
  const role = String(formData.get('role') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  if (targetEmail.length === 0) return { ok: false, message: 'Enter an email address.' };
  if (!VALID_ROLES.includes(role as PlatformRole)) return { ok: false, message: 'Choose a role.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const target = await getAccountByEmail(db, targetEmail);
    if (!target)
      return { ok: false, message: 'No account found for that email.' } satisfies ActionState;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'PLATFORM_ROLE_GRANT', resourceId: target.id },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const granted = await grantPlatformRole(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      targetAccountId: target.id,
      role: role as PlatformRole,
      reason,
      stepUpSatisfied: true,
    });
    if (!granted.ok) return { ok: false, message: granted.error.message } satisfies ActionState;
    return { ok: true, message: `Granted ${role} to ${targetEmail}.` } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/**
 * Revoke a platform role grant. Platform-owner only. Never deletes the row —
 * marks it revoked. Step-up gated as "platform-role changes" (master
 * directive §7 "PR 5").
 */
export async function revokePlatformRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const grantId = String(formData.get('grantId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (grantId.length === 0) return { ok: false, message: 'Missing grant id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'PLATFORM_ROLE_REVOKE', resourceId: grantId },
      '/app/admin',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const revoked = await revokePlatformRole(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      grantId,
      reason,
      stepUpSatisfied: true,
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'Role revoked.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/**
 * A platform owner clears another staff member's authenticator (a lost phone with no backup
 * codes). Needs a recent sign-in, a written reason, and is audited. Never your own account.
 */
export async function resetStaffAuthenticatorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const targetAccountId = String(formData.get('targetAccountId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (targetAccountId.length === 0) return { ok: false, message: 'Missing person.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const stepUp = await tryEstablishStepUp(
      { accountId, action: 'STAFF_SECOND_FACTOR_RESET', resourceId: targetAccountId },
      '/app/admin/access',
    );
    if (stepUp.kind === 'not_configured') {
      return { ok: false, message: STEP_UP_NOT_CONFIGURED_MESSAGE } satisfies ActionState;
    }
    if (stepUp.kind === 'reauth_required') redirect(stepUp.reauthUrl);
    const cleared = await resetStaffSecondFactor(db, {
      actor: { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      targetAccountId,
      reason,
      stepUpSatisfied: true,
    });
    if (!cleared.ok) return { ok: false, message: cleared.error.message } satisfies ActionState;
    return { ok: true, message: 'Authenticator reset. They can set it up again.' };
  });
  if (result.ok) revalidatePath('/app/admin/access');
  return result;
}

/**
 * Invite an email address into the controlled pilot (docs/audits/
 * post-programme-defect-register.md finding #2). Platform-owner only —
 * pilot access is as foundational as role management. Idempotent:
 * re-inviting an email with an existing active invitation is a no-op.
 */
export async function createInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (email.length === 0) return { ok: false, message: 'Enter an email address.' };

  const result = await withSession(async ({ db, accountId, email: actorEmail }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email: actorEmail }))) return DENIED;
    const invited = await createInvitation(db, {
      actorAccountId: accountId,
      email,
      ...(reason.length > 0 ? { reason } : {}),
    });
    if (!invited.ok) return { ok: false, message: invited.error.message } satisfies ActionState;
    return { ok: true, message: `Invited ${email}.` } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}

/**
 * Revoke a pilot invitation. Platform-owner only. Never deletes the row —
 * marks it revoked. Only blocks a not-yet-provisioned future sign-in; an
 * account already provisioned from this invitation is unaffected.
 */
export async function revokeInvitationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const invitationId = String(formData.get('invitationId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (invitationId.length === 0) return { ok: false, message: 'Missing invitation id.' };
  if (reason.length === 0) return { ok: false, message: 'A reason is required.' };

  const result = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return DENIED;
    const revoked = await revokeInvitation(db, {
      actorAccountId: accountId,
      invitationId,
      reason,
    });
    if (!revoked.ok) return { ok: false, message: revoked.error.message } satisfies ActionState;
    return { ok: true, message: 'Invitation revoked.' } satisfies ActionState;
  });
  if (result.ok) revalidatePath('/app/admin');
  return result;
}
