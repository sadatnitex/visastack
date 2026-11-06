import { isStarterPackKey } from '@visastack/core';
import { type ServiceError, serviceError } from './errors';

/**
 * The one rule for whether a checklist may go on a case (VS-006), shared by the checked attach
 * and by Prepare Again so the two can never disagree. Pure: no database here.
 *
 * A checklist may go on a case when it is published and is either a reviewed public checklist (no
 * owning agency, marked authoritative), a starter checklist (the agency's own reading of country
 * files, public, labelled not official, and only ever picked by the person, never linked for them),
 * or owned by the agency the case belongs to. A case with no agency (a personal case) therefore only
 * takes reviewed public and starter checklists.
 */

export const NOT_REVIEWED_WORDS =
  'This checklist has not been reviewed yet, so it cannot be attached.';
export const NOT_PUBLISHED_WORDS = 'Only a published checklist can be attached.';
export const NOT_FOUND_WORDS = 'pack version not found';

/** What the rule needs to know about a pack version. */
export interface SelectionTarget {
  readonly status: string;
  readonly authoritative: boolean;
  readonly ownerOrganizationId: string | null;
  /** The pack's key; a starter checklist is known by it. */
  readonly packKey?: string | null;
}

/**
 * Why a checklist may not go on a case, or null when it may. The order matters: another agency's
 * checklist is answered as "not found" before anything else (even when it is a draft), so its
 * existence and state are not revealed; then publication; then review.
 */
export function selectionRefusal(
  target: SelectionTarget,
  caseOrganizationId: string | null,
): ServiceError | null {
  if (target.ownerOrganizationId !== null && target.ownerOrganizationId !== caseOrganizationId) {
    return serviceError('not_found', NOT_FOUND_WORDS);
  }
  if (target.status !== 'PUBLISHED') return serviceError('invalid', NOT_PUBLISHED_WORDS);
  if (
    target.ownerOrganizationId === null &&
    !target.authoritative &&
    !(target.packKey != null && isStarterPackKey(target.packKey))
  ) {
    return serviceError('invalid', NOT_REVIEWED_WORDS);
  }
  return null;
}
