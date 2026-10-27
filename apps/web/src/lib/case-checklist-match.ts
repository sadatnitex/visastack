import {
  type Db,
  type PackMatch,
  type PackMatchTerms,
  type TravellerMatchTerms,
  accountPrincipal,
  findMatchingPublicPack,
  listFittingPublicPacks,
  readTravellerCoverage,
  requireAccess,
} from '@visastack/services';
import { travellerMatchTerms } from './case-choices';

/**
 * The published checklists that fit a case, worked out the same way when a case is started (to
 * link the one that fits) and when it first opens (to say whether there is one to pick). Who the
 * case is for comes from that traveller's confirmed nationality and residence, read through the
 * access gate for this case.
 */

/** The traveller's match terms, or null when the gate refuses this account the case. */
async function travellerTermsFor(
  db: Db,
  accountId: string,
  missionId: string,
): Promise<TravellerMatchTerms | null> {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { missionId },
    { purpose: 'owner_checklist_match' },
  );
  if (!access.ok) return null;
  return travellerMatchTerms(await readTravellerCoverage(access.value));
}

interface CaseRoute {
  readonly accountId: string;
  readonly missionId: string;
  readonly country: readonly string[];
  readonly purpose: readonly string[];
}

async function termsFor(db: Db, route: CaseRoute): Promise<PackMatchTerms | null> {
  const traveller = await travellerTermsFor(db, route.accountId, route.missionId);
  return traveller ? { country: route.country, purpose: route.purpose, traveller } : null;
}

/** The one checklist that certainly covers this case and its traveller, to link on its own; or null. */
export async function checklistToLink(db: Db, route: CaseRoute): Promise<PackMatch | null> {
  const terms = await termsFor(db, route);
  return terms ? findMatchingPublicPack(db, terms) : null;
}

/**
 * The checklists the person could pick for this case: none known to be meant only for other
 * people. Each says whether it is known to cover the traveller (`coversTraveller`).
 */
export async function checklistsToPick(db: Db, route: CaseRoute): Promise<readonly PackMatch[]> {
  const terms = await termsFor(db, route);
  return terms ? listFittingPublicPacks(db, terms) : [];
}
