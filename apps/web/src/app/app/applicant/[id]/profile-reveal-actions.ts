'use server';

import { getApplicant, isProtectedPlaceholder, listApplicantProfile } from '@visastack/services';
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

const NOT_SHOWN: RevealProfileValueResult = { ok: false };

/**
 * Opens the current value of one saved detail on the signed-in person's own record, for the
 * profile page's Show and Edit. The page itself never carries a protected value (ESS1), so this is
 * the only way one reaches the browser there.
 *
 * Who may: the owner of the record only, checked the same way a profile save checks it (the
 * record's owner account is the signed-in account). Anyone else, a missing record or a fact of
 * another record gets the same empty refusal, and nothing is opened with the key for them.
 *
 * Not audited: the owner reading their own profile was never recorded as an event (the page used
 * to open these values on every visit), and no audit kind exists for it. Recorded as not done in
 * docs/upgrades/programme/ess/ESS1-records.md rather than adding a new kind here.
 */
export async function revealProfileValueAction(
  applicantId: string,
  factId: string,
): Promise<RevealProfileValueResult> {
  if (
    typeof applicantId !== 'string' ||
    typeof factId !== 'string' ||
    applicantId.length === 0 ||
    factId.length === 0 ||
    applicantId.length > 100 ||
    factId.length > 100
  ) {
    return NOT_SHOWN;
  }
  return withSession(async ({ db, accountId }) => {
    let owned = false;
    try {
      const applicant = await getApplicant(db, applicantId);
      owned = applicant?.ownerAccountId === accountId;
    } catch {
      // A malformed id reads as a missing record.
      owned = false;
    }
    if (!owned) return NOT_SHOWN;
    let encryption: ReturnType<typeof createKeyManagementPort>;
    try {
      encryption = createKeyManagementPort();
    } catch (error) {
      reportServerError('profile.reveal_key_setting', error);
      return NOT_SHOWN;
    }
    const entries = await listApplicantProfile(db, applicantId, encryption);
    const entry = entries.find((candidate) => candidate.factId === factId);
    if (!entry || entry.value === null || isProtectedPlaceholder(entry.value)) return NOT_SHOWN;
    return { ok: true, value: entry.value };
  });
}
