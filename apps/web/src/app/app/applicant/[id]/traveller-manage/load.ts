import 'server-only';
import {
  type Db,
  type TravellerManageView,
  accountPrincipal,
  getTravellerManageView,
  requireAccess,
} from '@visastack/services';

/**
 * The traveller's lifecycle state and allowed actions for their own page, read through the
 * central gate as the owner. Null when the lifecycle tables do not exist yet, the reader is not
 * the owner, or the read fails: the Manage menu is then simply not shown.
 */
export async function loadTravellerManage(
  db: Db,
  accountId: string,
  applicantId: string,
): Promise<TravellerManageView | null> {
  try {
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'self' },
    );
    if (!access.ok || access.value.actor.kind !== 'applicant_owner') return null;
    const view = await getTravellerManageView(access.value);
    return view.ok ? view.value : null;
  } catch (error) {
    console.error(
      `[traveller-manage] state could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
