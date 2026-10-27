import {
  type EvidenceRequest,
  type RequestItemRule,
  type TriageDocumentState,
  type TriageGroup,
  evidenceRequestTriageGroup,
} from '@visastack/services';
import type { Tone } from '../../../../../components/ui';
import {
  CLOSED_REQUEST_LABELS,
  REQUEST_ITEM_STATUS_LABELS,
  TRIAGE_GROUP_TONES,
} from '../../../../../lib/labels';
import { plural } from '../../../../../lib/plural';

/**
 * One agency request as the traveller reads it (spec B09, "Request UX"): where it stands in the
 * five groups the agency's own summary uses, and what the person can do about it, in plain words.
 * The group comes from the same pure rule the agency sees (`evidenceRequestTriageGroup`), so the
 * two screens cannot disagree about whether an item is Received or Reviewed.
 *
 * Guidance states what the item needs and what to do next. It never invents an official rule, never
 * promises an outcome, and never tells anyone to alter a document: the only date or age it names is
 * the one the agency's own checklist item holds.
 */
export interface RequestItemView {
  /** `null` when the request is closed (cancelled, or an older value that is not a review). */
  readonly group: TriageGroup | null;
  readonly statusLabel: string;
  readonly tone: Tone;
  /** What happens next, or what to do. Always present. */
  readonly guidance: string;
  /** What the checklist item says about the evidence, when the request came from one. */
  readonly rule: string | null;
}

function guidanceFor(
  request: Pick<EvidenceRequest, 'status' | 'kind'>,
  group: TriageGroup | null,
): string {
  switch (group) {
    case 'MISSING':
      return request.kind === 'FIELD'
        ? 'Next: send the detail from your profile, or add it there first.'
        : 'Next: send a document from your wallet, or add a new one first. Only documents that have finished their safety checks can be sent.';
    case 'PROCESSING':
      return 'The file you sent is still being checked. Nothing to do yet. This page shows the result when the check is done.';
    case 'RECEIVED':
      return request.status === 'UNDER_REVIEW'
        ? 'The agency has started reviewing what you sent. Nothing more is needed from you yet.'
        : 'The agency has it and will review it. Nothing more is needed from you yet. Received does not mean accepted.';
    case 'NEEDS_CORRECTION':
      return request.status === 'NEEDS_REPLACEMENT'
        ? 'Next: send a replacement. The reason is shown below.'
        : 'The file you sent could not be used. Ask the agency below and they can request a replacement.';
    case 'REVIEWED':
      return 'The agency reviewed what you sent and accepted it. Nothing more is needed.';
    case null:
      return request.status === 'CANCELLED'
        ? 'The agency cancelled this request. Nothing is needed.'
        : 'This request is closed. Nothing is needed.';
  }
}

/** How the checklist item describes its evidence. Only facts the checklist itself holds. */
export function requestRuleText(rule: RequestItemRule | undefined): string | null {
  if (!rule) return null;
  const parts: string[] = [];
  if (rule.maxAgeDays !== null) {
    parts.push(
      `The checklist asks for something dated within the last ${plural(rule.maxAgeDays, 'day')}.`,
    );
  }
  if (rule.optional) parts.push('This item is optional on the checklist.');
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * `document` is the responding document's latest state when it is known: leave it out when the
 * documents could not be read, pass `null` when the request names none or it no longer exists.
 */
export function requestItemView(input: {
  readonly request: Pick<EvidenceRequest, 'status' | 'kind'>;
  readonly document?: TriageDocumentState | null | undefined;
  readonly rule?: RequestItemRule | undefined;
}): RequestItemView {
  const { request } = input;
  const group = evidenceRequestTriageGroup(request, input.document);
  return {
    group,
    statusLabel: group
      ? REQUEST_ITEM_STATUS_LABELS[group]
      : (CLOSED_REQUEST_LABELS[request.status] ?? 'Closed'),
    tone: group ? TRIAGE_GROUP_TONES[group] : 'neutral',
    guidance: guidanceFor(request, group),
    rule: requestRuleText(input.rule),
  };
}
