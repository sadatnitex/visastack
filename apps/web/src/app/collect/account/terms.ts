import {
  ANY_OF_LABEL,
  NECESSITY_LABELS,
  PROVENANCE_LABELS,
  necessityCanBlock,
} from '@visastack/core';
import type { CollectionItem, EvidenceCandidate, ItemProposal } from '@visastack/services';
import { formatTimestampDate } from '../../../lib/format-date';

/** One choice as the answer form shows it (plain, serialisable data). */
export interface ChoiceView {
  readonly key: string;
  readonly title: string;
  /** Current Copy, Expired Copy, Replaced Copy or Confirmed Detail. */
  readonly label: string;
  readonly detail: string;
  readonly matches: boolean;
}

/** One issued item as the answer form shows it. */
export interface ItemView {
  readonly id: string;
  readonly label: string;
  readonly meta: string;
  readonly note: string | null;
  readonly blocking: boolean;
  readonly kind: 'DOCUMENT' | 'FIELD';
  readonly proposedKey: string | null;
  readonly choices: readonly ChoiceView[];
}

/** Where an item comes from, for the person answering: the agency's own items say so. */
export function itemSource(item: CollectionItem, agencyName: string | null): string {
  if (item.provenance === 'AGENCY_ADDED') {
    return agencyName ? `Requested by ${agencyName}` : 'Requested by the Agency';
  }
  return PROVENANCE_LABELS[item.provenance];
}

function choiceView(candidate: EvidenceCandidate): ChoiceView {
  if (candidate.kind === 'FIELD') {
    return {
      key: candidate.key,
      title: candidate.display,
      label: candidate.label,
      detail: `Saved ${formatTimestampDate(candidate.savedAt)}`,
      matches: true,
    };
  }
  return {
    key: candidate.key,
    title: candidate.title,
    label: candidate.label,
    detail: `Version ${candidate.versionNumber}, saved ${formatTimestampDate(candidate.savedAt)}`,
    matches: candidate.matches,
  };
}

/** The proposals as the form needs them: Title Case labels, no dates as objects. */
export function itemViews(
  proposals: readonly ItemProposal[],
  agencyName: string | null,
): ItemView[] {
  return proposals.map(({ item, candidates, proposedKey }) => ({
    id: item.id,
    label: item.label,
    meta: [
      NECESSITY_LABELS[item.necessity],
      itemSource(item, agencyName),
      ...(item.groupKey ? [ANY_OF_LABEL] : []),
    ].join(' · '),
    note: item.note,
    blocking: necessityCanBlock(item.necessity),
    kind: item.kind,
    proposedKey,
    choices: candidates.map(choiceView),
  }));
}

/** The field name each item's choices are posted under. */
export function choiceFieldName(itemId: string): string {
  return `choice:${itemId}`;
}

/** The address of the answer page for one person. */
export function answerHref(personId?: string): string {
  return personId ? `/collect/account?person=${encodeURIComponent(personId)}` : '/collect/account';
}
