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
  /** What starts ticked: the person's own earlier picks when they came back, else the proposal. */
  readonly initialKeys: readonly string[];
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
  /** Keys the person had ticked before confirming it was them; only keys still on offer count. */
  picks?: ReadonlySet<string>,
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
    initialKeys: picks
      ? candidates.flatMap((c) => (picks.has(c.key) ? [c.key] : []))
      : proposedKey
        ? [proposedKey]
        : [],
    choices: candidates.map(choiceView),
  }));
}

/** The field name each item's choices are posted under. */
export function choiceFieldName(itemId: string): string {
  return `choice:${itemId}`;
}

/** The address of the answer page for one person, optionally keeping what they had ticked. */
export function answerHref(personId?: string, picks?: readonly string[]): string {
  if (!personId) return '/collect/account';
  const base = `/collect/account?person=${encodeURIComponent(personId)}`;
  if (!picks) return base;
  const kept = `${base}&pick=${encodeURIComponent(picks.join(','))}`;
  // A very long list is not kept in the address; nothing starts ticked, so nothing is shared
  // by surprise, and the person ticks again.
  return kept.length <= MAX_RETURN_LENGTH ? kept : `${base}&pick=`;
}

const MAX_RETURN_LENGTH = 1800;

/** The picks a returning address carries, or undefined when it carries none. */
export function picksFrom(value: string | string[] | undefined): ReadonlySet<string> | undefined {
  if (typeof value !== 'string') return undefined;
  return new Set(value.split(',').filter((key) => /^(document|detail):[0-9a-f-]{36}$/.test(key)));
}
