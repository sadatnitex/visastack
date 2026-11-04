import type { MissionState } from '@visastack/core';
import type { Translator } from '@visastack/i18n';
import type { ChangesSinceConfirmed, Readiness } from '@visastack/services';
import {
  CasePreparationSummary,
  CaseStageTracker,
} from '../../../../components/case-preparation-summary';
import { CaseReadinessRing } from '../../../../components/case-readiness-ring';
import { atLevel } from '../../../../components/depth';
import { StatusBadge } from '../../../../components/ui';
import { type CaseAttentionItem, NEXT_STEP_COPY, OVERALL_STATE_META } from './case-model';
import { ChangesSinceConfirmedList } from './changes-since-confirmed';
import { SnapshotButton } from './mission-buttons';

/**
 * The part of the case page next to the header: the stage line, the changed-case alert, the next
 * step, the journey reminder and the "what needs attention" list. One server component with plain
 * props; the page decides what to pass and this decides how it reads.
 */
export interface CaseStatusPanelProps {
  readonly missionId: string;
  readonly missionTitle: string;
  readonly applicantId: string;
  /** The case's current stage. */
  readonly state: MissionState;
  /** Stage names by stage (`CASE_STATE_LABELS`). */
  readonly stateLabels: Readonly<Record<string, string>>;
  /** The stages the page offers as buttons (cancelling is not one of them). */
  readonly nextStageStates: readonly MissionState[];
  /** Cancelling is offered from the More menu, so the stage line says so. */
  readonly cancelInMore: boolean;
  /** The case changed after the traveller confirmed it. */
  readonly isDirty: boolean;
  /** What changed since the confirmation, names only; null when it could not be read. */
  readonly changesSinceConfirmed: ChangesSinceConfirmed | null;
  /** The attention list, most urgent first (`buildCaseAttention`). */
  readonly attention: readonly CaseAttentionItem[];
  /** The attention item shown as the Next Step; null when the case changed or nothing needs doing. */
  readonly nextStep: CaseAttentionItem | null;
  /** The name of the first item to fix, or to replace for an expiring document; null when none. */
  readonly nextStepFirstItem: string | null;
  /** The route has no automated checklist, so completeness is not an official assessment. */
  readonly manualMode: boolean;
}

export function CaseStatusPanel({
  missionId,
  missionTitle,
  applicantId,
  state,
  stateLabels,
  nextStageStates,
  cancelInMore,
  isDirty,
  changesSinceConfirmed,
  attention,
  nextStep,
  nextStepFirstItem,
  manualMode,
}: CaseStatusPanelProps) {
  const nextStepCopy =
    nextStep && nextStep.kind !== 'changed' ? NEXT_STEP_COPY[nextStep.kind] : null;
  return (
    <>
      <div {...atLevel('browse')}>
        <CaseStageTracker
          state={state}
          labels={stateLabels}
          nextStates={nextStageStates}
          cancelInMore={cancelInMore}
        />
      </div>

      {isDirty ? (
        <div className="case-alert">
          <p className="case-alert-title">This case has changed since it was last acknowledged.</p>
          <p className="case-alert-body">
            A material edit invalidated the previous sign-off. Capture a new snapshot and
            acknowledge it again before relying on this case as submission-ready.
          </p>
          {/* WP-V3 part 3: the list of changed details. */}
          <ChangesSinceConfirmedList applicantId={applicantId} changes={changesSinceConfirmed} />
          <SnapshotButton missionId={missionId} label="Take a New Snapshot" primary align="start" />
          <p className="case-alert-body">
            <a href="#snapshots">Open Snapshots</a> to confirm the new one.
          </p>
        </div>
      ) : null}

      {nextStep && nextStepCopy ? (
        <section className="case-next-step" aria-labelledby="case-next-step-heading">
          <h2 className="case-next-step-kicker" id="case-next-step-heading">
            Next Step
          </h2>
          <p className="case-next-step-title">{nextStepCopy.title(nextStep.count, missionTitle)}</p>
          <p className="case-next-step-body">{nextStepCopy.body(nextStepFirstItem)}</p>
          <a className="btn btn-primary" href={nextStep.href} data-open-group={nextStep.opens}>
            {nextStepCopy.action}
          </a>
        </section>
      ) : null}
      {/* Owner-approved wording, 25 Oct 2026. */}
      <p className="case-journey-reminder">
        Preparing a file is not the same as submitting it. VisaStack does not submit applications or
        predict decisions.
      </p>
      {/* WP-V4 places the request triage summary directly under the next step. */}

      <div className="case-context-strip">
        {manualMode ? (
          <details className="case-manual-notice">
            <summary>Manual assessment: this route has no automated requirement pack</summary>
            <p>
              You are responsible for confirming what this case needs. Completeness is not an
              official readiness assessment, on this page or in an exported snapshot.
            </p>
          </details>
        ) : null}

        <ul
          className="case-attention"
          aria-label="What needs attention on this case"
          {...atLevel('browse')}
        >
          {attention.length === 0 ? (
            <li>
              <span className="case-attention-ok">
                <StatusBadge tone="success">Nothing needs attention right now</StatusBadge>
              </span>
            </li>
          ) : (
            attention.map((item) => (
              <li key={item.label}>
                <a href={item.href} data-open-group={item.opens}>
                  <StatusBadge tone={item.tone}>{item.count}</StatusBadge>
                  {item.label}
                </a>
              </li>
            ))
          )}
        </ul>
      </div>
    </>
  );
}

/** The note that no agency has access, so the traveller is the only one assessing the case. */
export function CaseSelfReviewedNote() {
  return (
    <p {...atLevel('browse')} className="muted lift-small-mb-075">
      <span className="badge badge-neutral">Self-reviewed</span> No agency currently has access to
      this case, so you are the only one assessing it.
    </p>
  );
}

export interface CaseProgressSummaryProps {
  /** The case's readiness; the case has a checklist. */
  readonly readiness: Readiness;
  /** The traveller confirmed the case and nothing changed since. */
  readonly acknowledged: boolean;
  readonly requiredUnverifiedCount: number;
  readonly requiredHardGapCount: number;
  /** The page's translator, so the sentence follows the person's language. */
  readonly t: Translator;
}

/** How far the checklist is: the count summary, the overall state and its one sentence. */
export function CaseProgressSummary({
  readiness,
  acknowledged,
  requiredUnverifiedCount,
  requiredHardGapCount,
  t,
}: CaseProgressSummaryProps) {
  return (
    <>
      <CasePreparationSummary readiness={readiness} acknowledged={acknowledged} />
      <p className={`badge ${OVERALL_STATE_META[readiness.overallState].tone}`}>
        {OVERALL_STATE_META[readiness.overallState].label}
      </p>
      {readiness.overallState !== 'MANUAL_ONLY' ? (
        <p className="muted lift-small-mb-100">
          {readiness.overallState === 'READY_FOR_APPLICANT_REVIEW'
            ? t('mission.readiness.ready')
            : readiness.overallState === 'NEEDS_REVIEW'
              ? t('mission.readiness.needsReview', { count: requiredUnverifiedCount })
              : t('mission.readiness.missing', { count: requiredHardGapCount })}
        </p>
      ) : null}
    </>
  );
}

/** The empty summary of a case with no checklist yet: an empty ring and what a checklist is. */
export function CaseNoChecklistSummary() {
  return (
    <>
      <CaseReadinessRing readiness={null} pickHref="#pack" size="lg" />
      <p className="card-body">
        A checklist lists the papers this visa route asks for and shows which ones you already have
        on file.
      </p>
    </>
  );
}
