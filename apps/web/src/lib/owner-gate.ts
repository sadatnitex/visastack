import { type Db, accountPrincipal, requireAccess } from '@visastack/services';

/**
 * The central gate opened as the owner of one traveller record (`purpose: 'self'`), for the pages
 * that read Needs Attention. Null when the gate refuses or the actor is not the owner, so a page
 * shows that part as unavailable instead of failing.
 */
export async function openOwnerGate(db: Db, accountId: string, applicantId: string) {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'self' },
  );
  return access.ok && access.value.actor.kind === 'applicant_owner' ? access.value : null;
}
