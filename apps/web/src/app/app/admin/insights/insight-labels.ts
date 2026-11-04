import type {
  FieldInsightsReport,
  FunnelStageKey,
  FunnelUnit,
  InsightCell,
} from '@visastack/services';

/**
 * UMPE P12: plain names for Field Insights. Every stage says exactly what was counted, so nobody
 * reads a prepared package as a submission, an agency's acceptance as a visa decision, or a
 * person's own report as a checked fact.
 */

export const FUNNEL_LABELS: Readonly<Record<FunnelStageKey, string>> = {
  INVITED: 'Invited',
  UPLOAD_STARTED: 'Started Uploading',
  CASES_STARTED: 'Cases Started',
  PREPARED: 'Package Prepared',
  SHARED: 'Shared with Someone',
  SUBMITTED_TO_AGENCY: 'Submitted to Agency',
  ACCEPTED_BY_AGENCY: 'Accepted by Agency (Not a Visa Decision)',
  REPORTED_TO_AUTHORITY: 'Reported as Submitted to Authority',
  RECEIPT_DOCUMENT_SUPPLIED: 'Authority Receipt with Document',
  PENDING: 'Reported as Still Waiting',
  APPROVAL_RECORDED: 'Approval Recorded',
  APPROVAL_DOCUMENT_SUPPLIED: 'Approval with Decision Document',
  REFUSAL_RECORDED: 'Refusal Recorded',
  REFUSAL_DOCUMENT_SUPPLIED: 'Refusal with Decision Document',
  WITHDRAWN: 'Withdrawn',
  CANCELLED: 'Cancelled',
  OTHER_DECISION: 'Other Decision Recorded',
  UNKNOWN: 'No Decision Recorded (Unknown)',
};

export const UNIT_LABELS: Readonly<Record<FunnelUnit, string>> = {
  INVITATIONS: 'Invitations and Request Links',
  PEOPLE: 'People',
  CASES: 'Cases',
  AGENCY_SUBMISSIONS: 'Answers to Agencies',
  ATTEMPTS: 'Attempts',
};

export const SOURCE_LABELS: Readonly<Record<string, string>> = {
  EMBASSY_OR_CONSULATE: 'Embassy or Consulate',
  VISA_APPLICATION_CENTER: 'Visa Application Centre',
  IMMIGRATION_AUTHORITY: 'Immigration Office',
  OTHER_AUTHORITY: 'Other Official Office',
};

export const CORRECTION_LABELS: Readonly<Record<string, string>> = {
  MISSING: 'Item Looks Missing',
  OUTDATED: 'Out of Date',
  WRONG: 'Looks Wrong',
  WRONG_NECESSITY: 'Wrong Requirement Level',
  ALTERNATIVE_ACCEPTED: 'Alternative Accepted',
  SOURCE_DISCREPANCY: 'Differs from Official Source',
  OTHER: 'Other Reason',
};

export const PERIOD_LABELS: Readonly<Record<number, string>> = {
  3: 'Last 3 Months',
  6: 'Last 6 Months',
  12: 'Last 12 Months',
  24: 'Last 24 Months',
};

/**
 * A count, or "Hidden". The reason is never shown: naming it (one agency, a protected neighbour)
 * would narrow the hidden number down.
 */
export function cellText(cell: InsightCell): string {
  return cell.shown ? String(cell.value) : 'Hidden';
}

/** Every number on the report, in one list, so the page can say how many are hidden. */
function allCells(report: FieldInsightsReport): readonly InsightCell[] {
  return [
    ...report.funnel.map((row) => row.cell),
    report.missingOutcome.reported,
    report.missingOutcome.unknown,
    report.missingOutcome.pending,
    ...report.byRouteAndPeriod.map((row) => row.attempts),
    report.authorityRequests.total,
    ...report.authorityRequests.bySource.map((row) => row.cell),
    ...report.authorityRequests.byDocType.map((row) => row.cell),
    ...report.correctionCauses.checklistSuggestions.map((row) => row.cell),
    report.correctionCauses.agencyCorrectionRequests,
    report.coverageGaps.requestsCompared,
    report.coverageGaps.requestsWithoutChecklist,
    ...report.coverageGaps.byDocType.map((row) => row.cell),
    report.dataQuality.olderReportsNotAttempts,
    report.dataQuality.attemptsWithoutPackageRecord,
    report.dataQuality.caseDecisionsNotTiedToAttempt,
  ];
}

/**
 * How many numbers the page shows and how many it hides, and whether nothing but zeros is visible.
 * Only totals: never which number is hidden or why, so a hidden count cannot be narrowed down.
 */
export function hiddenSummary(report: FieldInsightsReport): {
  readonly total: number;
  readonly hidden: number;
  readonly nothingShownYet: boolean;
} {
  const cells = allCells(report);
  const hidden = cells.filter((cell) => !cell.shown).length;
  const anyNumber = cells.some((cell) => cell.shown && cell.value > 0);
  return { total: cells.length, hidden, nothingShownYet: hidden > 0 && !anyNumber };
}
