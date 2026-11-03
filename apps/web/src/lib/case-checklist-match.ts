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

interface CaseSideTerms {
  readonly traveller: TravellerMatchTerms;
  /** UMPE G2 (R05): the case's saved application post and trip start, compared when a pack declares them. */
  readonly consularPost: string | null;
  readonly travelStart: Date | null;
}

/** The traveller's match terms and the case's saved details, or null when the gate refuses. */
async function caseSideTermsFor(
  db: Db,
  accountId: string,
  missionId: string,
): Promise<CaseSideTerms | null> {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { missionId },
    { purpose: 'owner_checklist_match' },
  );
  if (!access.ok) return null;
  const traveller = travellerMatchTerms(await readTravellerCoverage(access.value));
  // A proof for this case carries the case itself; anything else gives no case details.
  const { resource } = access.value;
  const mission = resource && resource.kind === 'mission' ? resource.mission : null;
  return {
    traveller,
    consularPost: mission?.jurisdiction?.trim() || null,
    travelStart: mission?.travelStartDate ?? null,
  };
}

interface CaseRoute {
  readonly accountId: string;
  readonly missionId: string;
  readonly country: readonly string[];
  readonly purpose: readonly string[];
}

async function termsFor(db: Db, route: CaseRoute): Promise<PackMatchTerms | null> {
  const side = await caseSideTermsFor(db, route.accountId, route.missionId);
  return side
    ? {
        country: route.country,
        purpose: route.purpose,
        traveller: side.traveller,
        consularPost: side.consularPost,
        travelStart: side.travelStart,
      }
    : null;
}

/** The one checklist that certainly covers this case and its traveller, to link on its own; or null. */
export async function checklistToLink(db: Db, route: CaseRoute): Promise<PackMatch | null> {
  const terms = await termsFor(db, route);
  return terms ? findMatchingPublicPack(db, terms) : null;
}

/**
 * The checklists the person could pick for this case: none known to be meant only for other
 * people, or for another application post or travel window. Each says whether it is known to cover
 * the traveller (`coversTraveller`) and which case details it still needs (`needs`).
 */
export async function checklistsToPick(db: Db, route: CaseRoute): Promise<readonly PackMatch[]> {
  const terms = await termsFor(db, route);
  return terms ? listFittingPublicPacks(db, terms) : [];
}
