import {
  type Db,
  type NoPackReason,
  type PackMatch,
  type PackMatchTerms,
  type SelectablePackVersion,
  type TravellerMatchTerms,
  accountPrincipal,
  explainNoFittingPack,
  findMatchingPublicPack,
  listFittingPublicPacks,
  listSelectablePackVersions,
  readTravellerCoverage,
  requireAccess,
} from '@visastack/services';
import { savedCaseMatchTerms, travellerMatchTerms } from './case-choices';
import { reportServerError } from './server-error';

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

/**
 * Why no checklist fits this case, for words on the case page (VS-006). Empty when one fits. A
 * refused gate gives no reasons, never a guess.
 */
export async function whyNoChecklist(db: Db, route: CaseRoute): Promise<readonly NoPackReason[]> {
  const terms = await termsFor(db, route);
  return terms ? explainNoFittingPack(db, terms) : [];
}

/**
 * The checklists this person may pick for the case (VS-006): reviewed public checklists that fit
 * the case's destination and purpose once it names them, plus the case's own agency checklists.
 * An unreviewed test checklist and another agency's checklist are never in it. Fails closed: if
 * the fit cannot be worked out, no public checklist is offered rather than every one.
 */
export async function selectableChecklists(
  db: Db,
  input: {
    readonly accountId: string;
    readonly mission: {
      readonly id: string;
      readonly destination: string | null;
      readonly purpose: string | null;
    };
  },
): Promise<SelectableChecklists> {
  const { accountId, mission } = input;
  const route = savedCaseMatchTerms(mission.destination, mission.purpose);
  let fitting: readonly PackMatch[] | null = null;
  let lookupFailed = false;
  if (route) {
    try {
      fitting = await checklistsToPick(db, { accountId, missionId: mission.id, ...route });
    } catch (error) {
      reportServerError('MissionPage', error, { step: 'selectable checklists' });
      fitting = [];
      lookupFailed = true;
    }
  }
  const listed = await listSelectablePackVersions(db, {
    actorAccountId: accountId,
    missionId: mission.id,
    ...(fitting ? { fitting } : {}),
  });
  return { options: listed.ok ? listed.value : [], fitting, lookupFailed };
}

/** What a person may pick for a case, and the fit it was worked out from. */
export interface SelectableChecklists {
  readonly options: readonly SelectablePackVersion[];
  /** The reviewed public checklists that fit the case's route; null when the case names no route. */
  readonly fitting: readonly PackMatch[] | null;
  /** True when the fit could not be worked out (then no public checklist is offered). */
  readonly lookupFailed: boolean;
}

/** For a case that already holds a checklist, which has nothing to pick. */
export const NOTHING_TO_PICK: SelectableChecklists = {
  options: [],
  fitting: null,
  lookupFailed: false,
};
