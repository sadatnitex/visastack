import { type PermissionAction, type Result, err, ok } from '@visastack/core';
import { and, eq } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import { StepUpProof } from './access/step-up-proof';
import { aiAssistAvailable } from './agency-ai-ready';
import { appendAuditEvent } from './audit';
import { first, schema } from './db';

/**
 * "Let This Agency Use AI Tools on What I Share" (S22, ADR 0021 S22 amendment): the traveller's
 * own choice, per agency grant, to let that agency's AI tools read what the grant already shares.
 * It is the permission `AI_ASSIST` on the grant: off on every grant until the traveller turns it
 * on, never part of making a grant, and never anyone else's choice.
 *
 * - Turning it on needs a fresh identity check (decision D2), the same proof as re-sharing
 *   (`SHARE` on the record), and a live agency grant that already lets the agency see details
 *   (`VIEW_METADATA`): the AI tools never read more than the grant shares.
 * - Turning it off needs nothing more than the owner's own access, and works on any grant.
 * - Every change is audited as `GRANT_AI_ASSIST_CHANGED` (the grant, the agency, on or off) and
 *   takes effect on the agency AI gate's very next call (it reads the grant on every call).
 * - Before migration 0108 the permission cannot be stored: the answer is `not_available` and
 *   nothing is written.
 */

export type GrantAiAssistRefusal =
  | 'not_owner'
  | 'not_available'
  | 'not_found'
  /** Not a grant to an agency, ended, or one that shares no details. */
  | 'not_agency_grant'
  | 'step_up_required';

/** The step-up a traveller passes to turn AI tools on: `SHARE` on their own record. */
export const GRANT_AI_ASSIST_STEP_UP_ACTION: PermissionAction = 'SHARE';

const LIVE = new Set(['ACTIVE', 'PAUSED', 'PENDING_ACCEPTANCE']);

/** Whether a grant's stored actions include the AI permission. */
export function grantAllowsAiAssist(actions: readonly string[]): boolean {
  return actions.includes('AI_ASSIST');
}

export async function setGrantAiAssist(
  proof: AuthorizedApplicant<'VIEW_METADATA'>,
  input: {
    readonly grantId: string;
    readonly allow: boolean;
    /** Required to turn it on: a fresh identity check for `SHARE` on this record. */
    readonly stepUp?: StepUpProof;
  },
): Promise<Result<{ readonly changed: boolean; readonly allowed: boolean }, GrantAiAssistRefusal>> {
  if (
    !AuthorizedApplicant.isGenuine(proof, 'VIEW_METADATA') ||
    proof.actor.kind !== 'applicant_owner' ||
    proof.resource.kind !== 'applicant' ||
    !proof.applicant.ownerAccountId
  ) {
    return err('not_owner');
  }
  const ownerAccountId = proof.applicant.ownerAccountId;
  const applicantId = proof.applicant.id;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.grantId)) {
    return err('not_found');
  }
  const tx = proof.tx;
  if (!(await aiAssistAvailable(tx))) return err('not_available');
  if (
    input.allow &&
    !StepUpProof.covers(input.stepUp, {
      accountId: ownerAccountId,
      action: GRANT_AI_ASSIST_STEP_UP_ACTION,
      resourceId: applicantId,
    })
  ) {
    return err('step_up_required');
  }
  return tx.transaction(async (inner) => {
    const grant = first(
      await inner
        .select({
          id: schema.grants.id,
          actions: schema.grants.actions,
          status: schema.grants.status,
          expiryAt: schema.grants.expiryAt,
          organizationId: schema.grants.recipientOrganizationId,
        })
        .from(schema.grants)
        .where(and(eq(schema.grants.id, input.grantId), eq(schema.grants.applicantId, applicantId)))
        .limit(1)
        .for('update'),
    );
    if (!grant) return err('not_found' as const);
    const has = grantAllowsAiAssist(grant.actions);
    if (has === input.allow) return ok({ changed: false, allowed: has });
    if (input.allow) {
      const live =
        LIVE.has(grant.status) &&
        (grant.expiryAt === null || grant.expiryAt.getTime() > Date.now());
      if (!grant.organizationId || !live || !grant.actions.includes('VIEW_METADATA')) {
        return err('not_agency_grant' as const);
      }
    }
    const actions = input.allow
      ? [...grant.actions, 'AI_ASSIST' as const]
      : grant.actions.filter((action) => action !== 'AI_ASSIST');
    await inner
      .update(schema.grants)
      .set({ actions, updatedAt: new Date() })
      .where(eq(schema.grants.id, grant.id));
    await appendAuditEvent(inner, {
      eventType: 'GRANT_AI_ASSIST_CHANGED',
      actorAccountId: ownerAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      applicantId,
      resourceType: 'grant',
      resourceId: grant.id,
      metadata: {
        allowed: input.allow,
        ...(grant.organizationId ? { organizationId: grant.organizationId } : {}),
      },
    });
    return ok({ changed: true, allowed: input.allow });
  });
}
