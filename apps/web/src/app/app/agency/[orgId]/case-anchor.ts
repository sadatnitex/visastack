/**
 * The page anchor of one case's workspace on the agency Cases page.
 *
 * Pure on purpose: no 'use client' and no imports, so server pages, client components and tests
 * can all read it. A value exported from a 'use client' file reaches a server page only as a
 * client reference, never as its real text, and a link built from it came out broken.
 */

/** The stored anchor prefix of a case's workspace (a stored name kept in code, never shown). */
export const CASE_ANCHOR = 'mission-';

/** The anchor id of one case's workspace, for example `mission-<id>`. */
export function caseAnchorId(missionId: string): string {
  return `${CASE_ANCHOR}${missionId}`;
}

/** The address of one case on its agency Cases page, for example `/app/agency/<org>/cases#mission-<id>`. */
export function agencyCaseHref(orgId: string, missionId: string): string {
  return `/app/agency/${orgId}/cases#${caseAnchorId(missionId)}`;
}
