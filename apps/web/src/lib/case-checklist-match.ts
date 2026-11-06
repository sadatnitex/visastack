import type { Result } from '@visastack/core';
import {
  type Db,
  type Mission,
  type NoPackReason,
  type PackMatch,
  type PackMatchTerms,
  type SelectablePackVersion,
  type ServiceError,
  type TravellerMatchTerms,
  accountPrincipal,
  attachSelectedPackVersion,
  explainNoFittingPack,
  findMatchingPublicPack,
  getMissionForOwner,
  listFittingPublicPacks,
  listFittingStarterPacks,
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
      readonly applicantId: string;
      readonly destination: string | null;
      readonly purpose: string | null;
    };
  },
): Promise<SelectableChecklists> {
  const { accountId, mission } = input;
  // The picker is read through the owner's gate proof for this traveller's record. A refusal
  // means the case could not be read, never "nothing fits".
  const proof = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId: mission.applicantId },
    { purpose: 'self' },
  );
  if (!proof.ok) return { options: [], fitting: null, lookupFailed: true };
  const route = savedCaseMatchTerms(mission.destination, mission.purpose);
  let fitting: readonly PackMatch[] | null = null;
  let starterFitting: readonly PackMatch[] = [];
  let matchTerms: Awaited<ReturnType<typeof termsFor>> | undefined;
  let lookupFailed = false;
  if (route) {
    try {
      const terms = await termsFor(db, { accountId, missionId: mission.id, ...route });
      // A refused gate means the case's details could not be read: never "nothing fits".
      if (terms) {
        matchTerms = terms;
        fitting = await listFittingPublicPacks(db, terms);
        // Starter lists for the same route are offered for the person to pick, kept apart from the
        // reviewed fit so they never count as one and are never linked automatically. They are an
        // addition: if they cannot be read the reviewed lists still show, as before.
        try {
          starterFitting = await listFittingStarterPacks(db, terms);
        } catch (error) {
          reportServerError('MissionPage', error, { step: 'starter checklists' });
        }
      } else lookupFailed = true;
    } catch (error) {
      reportServerError('MissionPage', error, { step: 'selectable checklists' });
      lookupFailed = true;
    }
    // Without a fit, no public checklist is offered rather than every one.
    if (lookupFailed) {
      fitting = [];
      starterFitting = [];
    }
  }
  const listed = await listSelectablePackVersions(proof.value, {
    missionId: mission.id,
    ...(fitting ? { fitting: [...fitting, ...starterFitting] } : {}),
    // The agency's own lists are narrowed to the case's country and purpose too, only when the
    // route was read: a failed lookup keeps offering every list the agency owns, as before.
    ...(matchTerms && !lookupFailed ? { matchTerms } : {}),
  });
  if (!listed.ok) {
    reportServerError('MissionPage', new Error(listed.error.code), {
      step: 'list selectable checklists',
    });
    return { options: [], fitting, lookupFailed: true };
  }
  return { options: listed.value, fitting, lookupFailed };
}

/** What a person may pick for a case, and the fit it was worked out from. */
export interface SelectableChecklists {
  readonly options: readonly SelectablePackVersion[];
  /** The reviewed public checklists that fit the case's route; null when the case names no route. */
  readonly fitting: readonly PackMatch[] | null;
  /**
   * True when the checklists could not be looked up (a failed read, or the case's details could
   * not be read). Then no public checklist is offered, and the page says it could not load them
   * instead of saying none exists.
   */
  readonly lookupFailed: boolean;
}

/** For a case that already holds a checklist, which has nothing to pick. */
export const NOTHING_TO_PICK: SelectableChecklists = {
  options: [],
  fitting: null,
  lookupFailed: false,
};

/**
 * Attach a checklist to the person's own case, only if it is one they may pick (reviewed, or their
 * case's agency's own). Gets the owner's gate proof for the case's traveller and passes it to the
 * checked attach; the web app attaches nowhere else. A case that is not theirs is `not_found`.
 */
export async function attachChecklistFor(
  db: Db,
  accountId: string,
  missionId: string,
  packVersionId: string,
): Promise<Result<Mission, ServiceError>> {
  const owned = await getMissionForOwner(db, accountId, missionId);
  if (!owned.ok) return owned;
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'MANAGE',
    { applicantId: owned.value.applicantId },
    { purpose: 'self' },
  );
  if (!access.ok) return access;
  return attachSelectedPackVersion(access.value, { missionId, packVersionId });
}
