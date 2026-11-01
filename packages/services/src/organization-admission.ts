/**
 * The agency statuses that may still invite and admit people: an active agency, and one waiting
 * for review (so it can build its team). A suspended, rejected or closed (withdrawn or
 * terminated) agency takes nobody. One rule for team invitations (`invitations.ts`) and client
 * invitations (`client-invitations.ts`), so the two cannot drift (lane Z review).
 */
export const OPEN_ORGANIZATION_STATUSES: readonly string[] = ['ACTIVE', 'PENDING_VERIFICATION'];
