import type { MissingRequirement } from '@visastack/services';
import type { CaseListRowProps, CaseRowProgress } from '../components/case-list-row';
import { destinationFlagCode } from '../components/destination-label';
import { nextStepFor } from './case-next-step';

/** What the Trips list reads about each case; every field is already on the case row. */
export interface CaseListSource {
  readonly id: string;
  readonly title: string;
  readonly state: string;
  readonly destination: string | null;
  readonly purpose: string | null;
  readonly packVersionId: string | null;
}

/** The readiness the page already works out for each case: the counts and the next step. */
export interface CaseListReadiness {
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
  /** The first required item still missing, as a short step, or null. */
  readonly nextStep: string | null;
}

/** Trim a full readiness result to what a row needs, so no checklist detail reaches the row. */
export function caseListReadiness(readiness: {
  readonly requiredCount: number;
  readonly satisfiedRequired: number;
  readonly missing?: readonly MissingRequirement[] | undefined;
}): CaseListReadiness {
  return {
    requiredCount: readiness.requiredCount,
    satisfiedRequired: readiness.satisfiedRequired,
    nextStep: nextStepFor(readiness.missing),
  };
}

/**
 * How far a case is, from the same facts the progress ring uses: no checklist attached, a
 * checklist whose count was not worked out here, a checklist with nothing required, or a count.
 */
export function caseRowProgress(
  mission: Pick<CaseListSource, 'packVersionId'>,
  readiness: CaseListReadiness | undefined,
): CaseRowProgress {
  if (!mission.packVersionId) return { kind: 'no-checklist' };
  if (!readiness) return { kind: 'unread' };
  if (readiness.requiredCount > 0) {
    return { kind: 'counted', done: readiness.satisfiedRequired, total: readiness.requiredCount };
  }
  return { kind: 'none-required' };
}

/** Everything one row draws, for one case. A past case never gets advice about the next step. */
export function caseRowProps(
  mission: CaseListSource,
  readiness: CaseListReadiness | undefined,
  past: boolean,
): CaseListRowProps {
  const progress = caseRowProgress(mission, readiness);
  return {
    id: mission.id,
    title: mission.title,
    state: mission.state,
    destination: mission.destination,
    iso2: destinationFlagCode(mission.destination),
    purpose: mission.purpose,
    progress,
    nextStep: progress.kind === 'counted' ? (readiness?.nextStep ?? null) : null,
    past,
    href: `/app/mission/${mission.id}`,
  };
}
