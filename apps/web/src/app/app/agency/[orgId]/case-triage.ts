/**
 * The E02 triage summary for one case, turned into words for the Cases screen (Programme X
 * WP-V4). The grouping itself comes from `summarizeCaseTriage` in the services package; this file
 * only names things. Runs on the server: the screen gets plain text and numbers.
 */

import {
  type CaseTriageState,
  type CaseTriageSummary,
  TRIAGE_GROUPS,
  type TriageGroup,
} from '@visastack/services';
import { formatDateOnly } from '../../../../lib/format-date';
import {
  CASE_TRIAGE_STATE_LABELS,
  TRIAGE_GROUP_LABELS,
  TRIAGE_INDICATOR_LABELS,
} from '../../../../lib/labels';
import { requestItemLabel } from './do-next';

export interface CaseTriageViewItem {
  readonly key: string;
  readonly label: string;
  /** Short notes such as "Optional" or "Sent Back for a Fix", already in words. */
  readonly notes: readonly string[];
  /** The due date in words, only when the agency set one. */
  readonly due: string | null;
}

export interface CaseTriageView {
  readonly state: CaseTriageState;
  readonly stateLabel: string;
  /** Only the groups that hold something, in the programme's order. */
  readonly groups: readonly {
    readonly group: TriageGroup;
    readonly label: string;
    readonly items: readonly CaseTriageViewItem[];
  }[];
  /** True when the viewer cannot read requests, so they are not part of this summary. */
  readonly requestsLeftOut: boolean;
}

export function caseTriageView(
  summary: CaseTriageSummary,
  options: {
    /** Checklist item names by requirement id, as the case already shows them. */
    readonly requirementLabels: ReadonlyMap<string, string>;
    readonly requestsIncluded: boolean;
  },
): CaseTriageView {
  const groups = TRIAGE_GROUPS.map((group) => ({
    group,
    label: TRIAGE_GROUP_LABELS[group],
    items: summary.items
      .filter((item) => item.group === group)
      .map(
        (item): CaseTriageViewItem => ({
          key: item.key,
          label:
            (item.packRequirementId
              ? options.requirementLabels.get(item.packRequirementId)
              : undefined) ||
            requestItemLabel({ kind: item.kind, fieldKey: item.subject, docType: item.subject }),
          notes: item.indicators.map((indicator) => TRIAGE_INDICATOR_LABELS[indicator]),
          due: item.dueDate ? formatDateOnly(item.dueDate) : null,
        }),
      ),
  })).filter((entry) => entry.items.length > 0);
  return {
    state: summary.state,
    stateLabel: CASE_TRIAGE_STATE_LABELS[summary.state],
    groups,
    requestsLeftOut: !options.requestsIncluded,
  };
}
