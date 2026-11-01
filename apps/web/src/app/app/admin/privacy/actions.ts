'use server';

import { listAllApplicants } from '@visastack/services';
import { bootstrapAdminEmails, isPlatformAdmin, staffPrincipal } from '../../../../lib/admin';
import { withSession } from '../../../../lib/session';

/** One applicant the legal hold picker may offer: only the id and the name. */
export interface ApplicantMatch {
  readonly id: string;
  readonly displayName: string;
}

export type ApplicantSearchResult =
  | { readonly ok: true; readonly matches: readonly ApplicantMatch[] }
  | { readonly ok: false; readonly message: string };

/** The server never takes more than this many characters of search text. */
const SEARCH_MAX_CHARS = 100;

/**
 * Searches applicants by name (or a whole applicant id) for the legal hold picker on Privacy, as the
 * person types (WP-SB7). The same role check as the page: a platform administrator holding the
 * applicant directory permission, with the authenticator code rule. At most 20 matches, and only
 * the id and the name of each; anyone else gets the same refusal whatever exists.
 */
export async function searchApplicantsAction(text: unknown): Promise<ApplicantSearchResult> {
  const search = typeof text === 'string' ? text.trim().slice(0, SEARCH_MAX_CHARS) : '';
  return withSession(async ({ db, accountId, email }) => {
    const refused = { ok: false, message: 'Not authorized.' } as const;
    if (!(await isPlatformAdmin(db, { accountId, email }))) return refused;
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'APPLICANT_DIRECTORY_VIEW',
    );
    if (!staff.ok) return refused;
    const found = await listAllApplicants(db, staff.value, { search });
    if (!found.ok) return refused;
    return {
      ok: true,
      matches: found.value.map((entry) => ({ id: entry.id, displayName: entry.displayName })),
    } as const;
  });
}
