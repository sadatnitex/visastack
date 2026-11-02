import type { CollectionDisplayStatus, PackMatchTerms } from '@visastack/services';
import type { Tone } from '../../../../../components/ui';
import {
  type CasePurposeOption,
  caseCountry,
  casePurposeGroups,
  countryMatchTerms,
  purposeMatchTerms,
  travellerMatchTerms,
} from '../../../../../lib/case-choices';

/**
 * How a document request finds its published official checklist (UMPE P6): the destination and
 * purpose come from the same pickers as a new case, and any nationality or residence the agency
 * already knows narrows the checklists the same way a traveller's confirmed values do. A purpose of
 * Not Sure Yet finds none: the request starts as the agency's own list.
 */

/** The picker purpose with this label (what a request stores), or null. */
export function purposeByLabel(label: string | null): CasePurposeOption | null {
  if (!label) return null;
  for (const group of casePurposeGroups()) {
    const found = group.options.find((option) => option.label === label);
    if (found) return found;
  }
  return null;
}

export function collectionPackTerms(request: {
  readonly destination: string;
  readonly purpose: string | null;
  readonly nationality: string | null;
  readonly residence: string | null;
}): PackMatchTerms | null {
  const country = caseCountry(request.destination);
  const purpose = purposeByLabel(request.purpose);
  if (!country || !purpose) return null;
  return {
    country: countryMatchTerms(country),
    purpose: purposeMatchTerms(purpose),
    traveller: travellerMatchTerms({
      nationality: request.nationality ? [request.nationality] : [],
      residence: request.residence ? [request.residence] : [],
    }),
  };
}

/** The destination's plain name, or its code when the list does not hold it. */
export function destinationName(iso2: string): string {
  return caseCountry(iso2)?.name ?? iso2;
}

/** The badge tone of each request status (a mark as well as a colour). */
export const STATUS_TONES: Readonly<Record<CollectionDisplayStatus, Tone>> = {
  DRAFT: 'neutral',
  SENT: 'success',
  EXPIRED: 'warning',
  REVOKED: 'danger',
  CLOSED: 'neutral',
};
