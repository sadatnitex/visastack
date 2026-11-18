'use server';

import {
  type Db,
  PROFILE_VALUE_ACCESS,
  RATE_LIMITS,
  accountPrincipal,
  appendAuditEvent,
  checkRateLimit,
  openOwnProfileValue,
  openPendingSuggestionValue,
  requireAccess,
} from '@visastack/services';
import { createKeyManagementPort } from '../../../../lib/providers';
import { reportServerError } from '../../../../lib/server-error';
import { withSession } from '../../../../lib/session';

/**
 * ESS1: what Show or Edit gets back for one protected profile detail. The value goes to the
 * component that asked and stays in its memory only. A refusal carries no reason, so a detail of
 * someone else's record looks exactly like one that does not exist.
 */
export type RevealProfileValueResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false };

/** What Show gets back for one pending AI app suggestion about a protected detail. */
export type RevealSuggestionResult =
  | {
      readonly ok: true;
      readonly value: string | null;
      readonly rationale: string | null;
      readonly snippets: readonly string[];
    }
  | { readonly ok: false };

const NOT_SHOWN = { ok: false } as const;

function wellFormed(...ids: readonly unknown[]): boolean {
  return ids.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100);
}

/**
 * A signed-in account asked for a value of a record that is not theirs (or does not exist). One
 * PROFILE_VALUE_ACCESS DENIED row, written alike for a real and a made-up record (no applicant
 * column, ids only, never a value), bounded per account so a loop cannot flood the audit chain.
 * Writing can never change the answer: a failure here is swallowed.
 */
async function recordRefused(
  db: Db,
  accountId: string,
  applicantRef: string,
  resource: { readonly type: 'profile_fact' | 'ai_suggestion'; readonly id: string },
): Promise<void> {
  try {
    const budget = await checkRateLimit(
      db,
      { subjectId: accountId, action: 'profile_value.refused_audit' },
      RATE_LIMITS.HIDDEN_RECORD_PROBE_AUDIT,
    );
    if (!budget.allowed) return;
    await db.transaction(async (tx) => {
      await appendAuditEvent(tx, {
        eventType: PROFILE_VALUE_ACCESS,
        actorAccountId: accountId,
        action: 'VIEW_METADATA',
        result: 'DENIED',
        method: 'API',
        resourceType: resource.type,
        resourceId: resource.id,
        reason: 'not_owner',
        metadata: { applicantRef },
      });
    });
  } catch {
    // The answer never depends on the audit write.
  }
}

/** The owner's proof for this record, or null (the refusal is recorded). */
async function ownerProof(
  db: Db,
  accountId: string,
  applicantId: string,
  resource: { readonly type: 'profile_fact' | 'ai_suggestion'; readonly id: string },
  purpose: 'profile_view' | 'ai_app_suggestions',
) {
  let refused = false;
  const gate = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    {
      purpose,
      onRefused: () => {
        refused = true;
      },
    },
  );
  if (!gate.ok) {
    if (refused) await recordRefused(db, accountId, applicantId, resource);
    return null;
  }
  return gate.value;
}

/**
 * Opens the current value of one saved detail on the signed-in person's own record, for the
 * profile page's Show and Edit. The page itself never carries a protected value (ESS1), so this is
 * the only way one reaches the browser there.
 *
 * Who may: the owner of the record only, through the central access gate; the service then opens
 * that one fact alone and audits the answer (PROFILE_VALUE_ACCESS). A stranger, a fact of another
 * record, a missing or malformed id, a value that will not open, all get the same `{ ok: false }`.
 * A value saved before encryption needs no key, so it still opens when the key setting fails.
 */
export async function revealProfileValueAction(
  applicantId: string,
  factId: string,
): Promise<RevealProfileValueResult> {
  if (!wellFormed(applicantId, factId)) return NOT_SHOWN;
  return withSession(async ({ db, accountId }) => {
    const proof = await ownerProof(
      db,
      accountId,
      applicantId,
      { type: 'profile_fact', id: factId },
      'profile_view',
    );
    if (!proof) return NOT_SHOWN;
    let encryption: ReturnType<typeof createKeyManagementPort>;
    try {
      encryption = createKeyManagementPort();
    } catch (error) {
      // Only an encrypted value needs the key; one saved before encryption still opens.
      reportServerError('profile.reveal_key_setting', error);
      encryption = undefined;
    }
    const opened = await openOwnProfileValue(proof, { factId, encryption });
    return opened.ok ? { ok: true, value: opened.value.value } : NOT_SHOWN;
  });
}

/**
 * Opens the words of one pending AI app suggestion about a protected detail (the value suggested,
 * the app's reason, the phrases it quoted), which My Profile leaves out until the owner chooses
 * Show. Same rule and the same audit as a saved value.
 */
export async function revealSuggestionValueAction(
  applicantId: string,
  proposalId: string,
): Promise<RevealSuggestionResult> {
  if (!wellFormed(applicantId, proposalId)) return NOT_SHOWN;
  return withSession(async ({ db, accountId }) => {
    const proof = await ownerProof(
      db,
      accountId,
      applicantId,
      { type: 'ai_suggestion', id: proposalId },
      'ai_app_suggestions',
    );
    if (!proof) return NOT_SHOWN;
    const opened = await openPendingSuggestionValue(proof, { proposalId });
    if (!opened.ok) return NOT_SHOWN;
    const { value, rationale, snippets } = opened.value;
    return { ok: true, value, rationale, snippets };
  });
}
