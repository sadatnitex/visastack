import { aiAppLabel } from '@visastack/core/ai-features';
import { isIssueDateKey, isRepeatingFieldKey } from '@visastack/core/catalogue';
import {
  type ProfileEntry,
  type ProposalWithEvidence,
  type ReadingSource,
  isClearReading,
  isFixedFieldKey,
  isTrustedFactStatus,
} from '@visastack/services';
import type { AiProposalViewModel } from '../app/app/applicant/[id]/ai-review';
import { isProtectedDetail } from '../app/app/applicant/[id]/profile-protected';
import { humanizeFieldKey } from './field-key-label';
import { fieldLabel, savableField } from './master-profile';
import { profileField } from './profile-fields';

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
  reading: ProposalWithEvidence,
  confirmed: ReadonlyMap<string, ConfirmedValue>,
  /** Where the reading came from (decided from the records); omitted when it is not known. */
  source?: ReadingSource,
  options: {
    /**
     * ESS1, My Profile: a suggestion about a protected detail carries none of its words (value,
     * reason, quoted phrases) and no sign of whether it equals the saved value; Show opens them for
     * the owner through the reveal action.
     */
    readonly withholdProtected?: boolean;
  } = {},
): AiProposalViewModel {
  const { proposal, evidence, fromApp, issueDate } = reading;
  const key = proposal.fieldKey;
  const field = key ? savableField(key) : undefined;
  if (options.withholdProtected && key && isProtectedDetail(key, field?.sensitivity)) {
    return withheldViewModel(reading, confirmed, source);
  }
  const sensitive = field !== undefined && field.sensitivity !== 'STANDARD';
  const current = key ? confirmed.get(key) : undefined;
  const differs =
    current !== undefined && (!current.comparable || current.value !== (proposal.value ?? ''));
  const showCurrent = current !== undefined && !current.isProtected && !sensitive;
  // How the value is changed by hand: a date as a date, a fixed list as that list, else as text.
  const choices = key ? profileField(key)?.options : undefined;
  const editor: AiProposalViewModel['editor'] =
    field?.type === 'date'
      ? { kind: 'date' }
      : choices && proposal.value !== null && choices.includes(proposal.value)
        ? { kind: 'choice', options: choices }
        : undefined;
  return {
    id: proposal.id,
    type: proposal.type,
    fieldKey: key,
    ...(key ? { fieldLabel: fieldLabel(key) ?? humanizeFieldKey(key) } : {}),
    value: proposal.value,
    ...(editor ? { editor } : {}),
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
    // The document's own issue date: only a hint for the date a changed detail took effect.
    ...(issueDate ? { issueDate } : {}),
    ...(issueDate && key && isIssueDateKey(key) ? { ownIssueDate: true } : {}),
  };
}

/**
 * A suggestion about a protected detail, as My Profile sends it (ESS1): the field, how it is
 * edited, where it came from, and nothing of its words. When the profile already holds a value for
 * it, the choice is always offered, worded so it never says whether the two are the same.
 */
function withheldViewModel(
  { proposal, fromApp, issueDate }: ProposalWithEvidence,
  confirmed: ReadonlyMap<string, ConfirmedValue>,
  source?: ReadingSource,
): AiProposalViewModel {
  const key = proposal.fieldKey as string;
  const field = savableField(key);
  return {
    id: proposal.id,
    type: proposal.type,
    fieldKey: key,
    fieldLabel: fieldLabel(key) ?? humanizeFieldKey(key),
    value: null,
    // Plain text or a date: a fixed list could not show a value it does not know yet.
    ...(field?.type === 'date' ? { editor: { kind: 'date' as const } } : {}),
    confidence: proposal.confidence,
    rationale: null,
    evidence: [],
    clear: false,
    sensitive: true,
    withheld: true,
    ...(isFixedFieldKey(key) ? { fixed: true } : {}),
    ...(isRepeatingFieldKey(key) ? { repeating: true } : {}),
    ...(source ? { source } : {}),
    ...(fromApp ? { app: aiAppLabel(fromApp) } : {}),
    ...(confirmed.has(key) ? { difference: { current: null, undisclosed: true as const } } : {}),
    ...(issueDate ? { issueDate } : {}),
    ...(issueDate && isIssueDateKey(key) ? { ownIssueDate: true } : {}),
  };
}
