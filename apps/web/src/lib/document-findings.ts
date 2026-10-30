import { aiAppLabel } from '@visastack/core/ai-features';
import { isRepeatingFieldKey } from '@visastack/core/catalogue';
import {
  type ProfileEntry,
  type ProposalWithEvidence,
  type ReadingSource,
  isClearReading,
  isFixedFieldKey,
  isTrustedFactStatus,
} from '@visastack/services';
import type { AiProposalViewModel } from '../app/app/applicant/[id]/ai-review';
import { humanizeFieldKey } from './field-key-label';
import { fieldLabel, savableField } from './master-profile';

/** What the profile holds for one detail, as far as a reading needs to know. */
interface ConfirmedValue {
  /** The real value, read on the server. Never sent to the page for a protected detail. */
  readonly value: string;
  readonly isProtected: boolean;
  /** False when a protected value could not be read, so it cannot be compared. */
  readonly comparable: boolean;
}

/**
 * The details a person has confirmed, keyed by field. Only single (non-repeating) details count:
 * a reading for one address among several is settled on that record, not here.
 */
export function confirmedValues(
  profile: readonly ProfileEntry[],
  revealed: boolean,
): ReadonlyMap<string, ConfirmedValue> {
  const confirmed = new Map<string, ConfirmedValue>();
  for (const entry of profile) {
    if (entry.repeatingRecordKey !== null || entry.status === null || entry.value === null)
      continue;
    if (!isTrustedFactStatus(entry.status as never)) continue;
    confirmed.set(entry.fieldKey, {
      value: entry.value,
      isProtected: entry.isProtected,
      comparable: !entry.isProtected || revealed,
    });
  }
  return confirmed;
}

/**
 * Shape one reading for the review screen. The comparison with the profile happens here, on the
 * server: the page only learns that a sensitive or protected detail differs, never its value.
 */
export function findingViewModel(
  { proposal, evidence, fromApp }: ProposalWithEvidence,
  confirmed: ReadonlyMap<string, ConfirmedValue>,
  /** Where the reading came from (decided from the records); omitted when it is not known. */
  source?: ReadingSource,
): AiProposalViewModel {
  const key = proposal.fieldKey;
  const field = key ? savableField(key) : undefined;
  const sensitive = field !== undefined && field.sensitivity !== 'STANDARD';
  const current = key ? confirmed.get(key) : undefined;
  const differs =
    current !== undefined && (!current.comparable || current.value !== (proposal.value ?? ''));
  const showCurrent = current !== undefined && !current.isProtected && !sensitive;
  return {
    id: proposal.id,
    type: proposal.type,
    fieldKey: key,
    ...(key ? { fieldLabel: fieldLabel(key) ?? humanizeFieldKey(key) } : {}),
    value: proposal.value,
    confidence: proposal.confidence,
    rationale: proposal.rationale,
    evidence: evidence.map((e) => ({ snippet: e.snippet, verified: e.verified })),
    clear: isClearReading(proposal, evidence),
    sensitive,
    ...(key && isFixedFieldKey(key) ? { fixed: true } : {}),
    ...(key && isRepeatingFieldKey(key) ? { repeating: true } : {}),
    ...(source ? { source } : {}),
    // A suggestion the person's own AI app made (S21): named by the app, cleaned again here.
    ...(fromApp ? { app: aiAppLabel(fromApp), clear: false } : {}),
    ...(differs ? { difference: { current: showCurrent ? current.value : null } } : {}),
  };
}
