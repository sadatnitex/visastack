import { describeGrantScope } from '../components/selected-scope-summary';
import { formatTimestampDate } from './format-date';
import { categoryLabel } from './master-profile';
import { plural } from './plural';

/** What a grant row needs to say what is shared and until when, all from data the page already read. */
export interface GrantRowLineInput {
  readonly status: string;
  readonly actions: readonly string[];
  readonly missionId: string | null;
  readonly categories: readonly string[] | null;
  readonly documentIds: readonly string[] | null;
  readonly expiryAt: string | Date | null;
  /** How many documents the record holds, or null when the document list could not be read. */
  readonly totalDocuments: number | null;
  /** The access has run out or been revoked (the page's own test, which also looks at the clock). */
  readonly ended: boolean;
}

/** More parts than this are counted instead of listed, so the row stays one short line of values. */
const PARTS_LISTED = 1;

function partsLine(labels: readonly string[]): string {
  return labels.length <= PARTS_LISTED
    ? `Profile: ${labels.join('')}`
    : `Profile: ${plural(labels.length, 'part')}`;
}

/**
 * One line under a grant's name: what they receive and until when, for example
 * "Documents: 3 of 12. Ends 12 Dec 2026". It follows the same scope rules as the grant's own
 * summary (`describeGrantScope`), so the row never says more or less than the panel does.
 */
export function grantRowLine(grant: GrantRowLineInput): string {
  const scope = describeGrantScope({
    // AI tools are their own line elsewhere, never part of what is received.
    actions: grant.actions.filter((action) => action !== 'AI_ASSIST'),
    caseGrant: Boolean(grant.missionId),
    partLabels: (grant.categories ?? []).map((category) => categoryLabel(category)),
    documentNames: (grant.documentIds ?? []).map((id) => id),
    hasDocuments: true,
    partsWhen: 'atSharing',
  });
  const parts: string[] = [];
  if (scope.profile.kind === 'case') parts.push('One case');
  if (scope.profile.kind === 'whole') parts.push('Profile: all');
  if (scope.profile.kind === 'parts') parts.push(partsLine(scope.profile.labels));
  const documents = scope.documents;
  if (documents.kind === 'every') {
    parts.push(
      grant.totalDocuments === null ? 'Documents: all' : `Documents: all ${grant.totalDocuments}`,
    );
  } else if (documents.kind === 'inParts') {
    parts.push('Documents: in those parts');
  } else if (documents.kind === 'chosen') {
    parts.push(
      grant.totalDocuments === null
        ? `Documents: ${documents.names.length}`
        : `Documents: ${documents.names.length} of ${grant.totalDocuments}`,
    );
  }
  if (parts.length === 0) parts.push('No profile details or documents');
  const day = grant.expiryAt ? formatTimestampDate(grant.expiryAt) : null;
  if (grant.status === 'REVOKED') parts.push('Ended');
  else if (grant.ended) parts.push(day ? `Ended ${day}` : 'Ended');
  else parts.push(day ? `Ends ${day}` : 'No end date');
  return parts.join('. ');
}
