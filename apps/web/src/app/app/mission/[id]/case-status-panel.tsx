import type { MissionState } from '@visastack/core';
import type { Translator } from '@visastack/i18n';
import type { ChangesSinceConfirmed, Readiness } from '@visastack/services';
import {
  CasePreparationSummary,
  CaseStageTracker,
} from '../../../../components/case-preparation-summary';
import { atLevel } from '../../../../components/depth';
import { Icon } from '../../../../components/icons';
import { StatusBadge } from '../../../../components/ui';
import {
  AboutDisclosure,
  AlertBanner,
  EmptyPanel,
  NextStepPanel,
} from '../../../../components/ui-lift';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { getServerT } from '../../../../lib/i18n-server';
import {
  ATTENTION_ICON,
  type CaseAttentionItem,
  NEXT_STEP_COPY,
  OVERALL_STATE_META,
  plainRequirementCount,
} from './case-model';
import { ChangesSinceConfirmedList } from './changes-since-confirmed';
import { SnapshotButton } from './mission-buttons';

/**
 * The part of the case page under the header that says where the case stands, in one card: the
 * next step (or the changed-case alert) beside Evidence Progress, then what needs attention, then
 * the stage line, with the journey reminder under it. One server component with plain props; the
 * page decides what to pass and this decides how it reads. The numbers agree because they are
 * counted once: the Next Step, the attention list and the checklist all read the same counts.
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
  /** The case's readiness; null when it has no checklist yet. */
  readonly readiness: Readiness | null;
  /** The traveller confirmed the case and nothing changed since. */
  readonly acknowledged: boolean;
  readonly requiredUnverifiedCount: number;
  readonly requiredHardGapCount: number;
  /** The page's translator, so the sentence follows the person's language. */
  readonly t: Translator;
  /** No agency has access, so the traveller is the only one assessing the case. */
  readonly selfReviewed: boolean;
  /** How many checklists the person may pick from; 0 when none can be picked. */
  readonly packOptionCount: number;
  /** Why no checklist can be picked, the first plain line; null when there is none to give. */
  readonly noChecklistLine: string | null;
  /** The welcome note is on the page and already offers the way forward, so the panel does not. */
  readonly welcomeShown: boolean;
  /** The checklist is not on the page, so Evidence Progress is what the "Readiness" link opens. */
  readonly progressIsReadinessAnchor: boolean;
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
  readiness,
  acknowledged,
  requiredUnverifiedCount,
  requiredHardGapCount,
  t,
  selfReviewed,
  packOptionCount,
  noChecklistLine,
  welcomeShown,
  progressIsReadinessAnchor,
}: CaseStatusPanelProps) {
  const nextStepCopy =
    nextStep && nextStep.kind !== 'changed' ? NEXT_STEP_COPY[nextStep.kind] : null;
  return (
    <>
      <div className="lift-status">
        <div className="lift-status-main">
          {isDirty ? (
            <div className="case-alert">
              <AlertBanner
                tone="danger"
                title="Something changed after you confirmed this case."
                action={
                  <>
                    <SnapshotButton
                      missionId={missionId}
                      label="Take a New Snapshot"
                      primary
                      align="start"
                    />
                    <AboutDisclosure summary="What Changed">
                      <p>Take a new snapshot and confirm it again before you rely on this case.</p>
                      {/* WP-V3 part 3: the list of changed details. */}
                      <ChangesSinceConfirmedList
                        applicantId={applicantId}
                        changes={changesSinceConfirmed}
                      />
                      <p className="lift-small-m0">
                        <a href="#snapshots">Open Snapshots</a> to confirm the new one.
                      </p>
                    </AboutDisclosure>
                  </>
                }
              />
            </div>
          ) : null}

          {nextStep && nextStepCopy ? (
            <NextStepPanel
              kicker="Next Step"
              kickerId="case-next-step-heading"
              title={nextStepCopy.title(nextStep.count, missionTitle)}
              body={nextStepCopy.lead(nextStepFirstItem) ?? undefined}
              why={<p>{nextStepCopy.why}</p>}
              action={{
                label: nextStepCopy.action,
                href: nextStep.href,
                openGroup: nextStep.opens,
              }}
            />
          ) : null}

          <div
            className="lift-status-progress"
            {...(progressIsReadinessAnchor ? { id: 'readiness' } : {})}
          >
            {readiness ? (
              <CaseProgressSummary
                readiness={readiness}
                requiredUnverifiedCount={requiredUnverifiedCount}
                requiredHardGapCount={requiredHardGapCount}
                t={t}
                confirmation={acknowledged ? 'Current snapshot confirmed' : 'Awaiting confirmation'}
              />
            ) : (
              <CaseNoChecklistSummary
                packOptionCount={packOptionCount}
                noChecklistLine={noChecklistLine}
                welcomeShown={welcomeShown}
              />
            )}
            {selfReviewed ? (
              <div className="lift-status-notes">
                <CaseSelfReviewedNote />
              </div>
            ) : null}
          </div>
        </div>

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
                  {readiness ? (
                    <StatusBadge tone="success">Nothing needs attention right now</StatusBadge>
                  ) : (
                    <span className="lift-attn lift-attn-neutral">
                      Nothing is checked yet: this case has no checklist
                    </span>
                  )}
                </span>
              </li>
            ) : (
              attention.map((item) => (
                <li key={item.label}>
                  <a
                    className={`plain-link lift-attn lift-attn-${item.tone}`}
                    href={item.href}
                    data-open-group={item.opens}
                  >
                    <span className="lift-attn-icon" aria-hidden="true">
                      <Icon name={ATTENTION_ICON[item.tone]} size={16} />
                    </span>
                    <span className="lift-attn-count">{item.count}</span>
                    {item.label}
                  </a>
                </li>
              ))
            )}
          </ul>
        </div>

        {/* The seven stages are an agency's workflow; while no agency has access the traveller is
            the only reviewer, so they sit at Everything. With an agency on the case: Browse. */}
        <div className="lift-status-stages" {...atLevel(selfReviewed ? 'everything' : 'browse')}>
          <CaseStageTracker
            state={state}
            labels={stateLabels}
            nextStates={nextStageStates}
            cancelInMore={cancelInMore}
          />
        </div>
      </div>
      {/* Owner-approved wording, 25 Oct 2026; folded under its own name on 5 Nov 2026 (the 30-word rule). */}
      <AboutDisclosure summary="About This Case" className="case-journey-reminder">
        <p>
          Preparing a file is not the same as submitting it. VisaStack does not submit applications
          or predict decisions.
        </p>
      </AboutDisclosure>
      {/* WP-V4 places the request triage summary directly under the next step. */}
    </>
  );
}

/** The note that no agency has access, so the traveller is the only one assessing the case. */
export function CaseSelfReviewedNote() {
  return (
    <p {...atLevel('browse')} className="muted lift-self-note">
      <span className="badge badge-neutral">Self-reviewed</span> No agency currently has access to
      this case, so you are the only one assessing it.
    </p>
  );
}

export interface CaseProgressSummaryProps {
  /** The case's readiness; the case has a checklist. */
  readonly readiness: Readiness;
  readonly requiredUnverifiedCount: number;
  readonly requiredHardGapCount: number;
  /** The page's translator, so the sentence follows the person's language. */
  readonly t: Translator;
  /** Where the traveller's confirmation stands, in words; folded under "How This Is Counted". */
  readonly confirmation: string;
}

/** How far the checklist is: the big count and bar, the overall state and its one sentence. */
export function CaseProgressSummary({
  readiness,
  requiredUnverifiedCount,
  requiredHardGapCount,
  t,
  confirmation,
}: CaseProgressSummaryProps) {
  const meta = OVERALL_STATE_META[readiness.overallState];
  return (
    <CasePreparationSummary
      readiness={readiness}
      explain={
        <>
          {readiness.overallState !== 'MANUAL_ONLY' ? (
            <p className="lift-progress-sentence">
              {readiness.overallState === 'READY_FOR_APPLICANT_REVIEW'
                ? t('mission.readiness.ready')
                : readiness.overallState === 'NEEDS_REVIEW'
                  ? plainRequirementCount(
                      t('mission.readiness.needsReview', { count: requiredUnverifiedCount }),
                      requiredUnverifiedCount,
                    )
                  : plainRequirementCount(
                      t('mission.readiness.missing', { count: requiredHardGapCount }),
                      requiredHardGapCount,
                    )}
            </p>
          ) : null}
          <p className="case-confirmation-state">
            <strong>Your confirmation: </strong>
            {confirmation}
          </p>
        </>
      }
    >
      <div className="lift-progress-verdict">
        <p className={`badge ${meta.tone} lift-pill lift-pill-md`}>{meta.label}</p>
      </div>
    </CasePreparationSummary>
  );
}

/**
 * What the place of Evidence Progress says when the case has no checklist: what a checklist is and
 * the one honest way forward. A checklist can be picked only when one fits; otherwise the way
 * forward is to add evidence, and no pick is offered.
 */
export function CaseNoChecklistSummary({
  packOptionCount,
  noChecklistLine,
  welcomeShown,
}: {
  readonly packOptionCount: number;
  readonly noChecklistLine: string | null;
  readonly welcomeShown: boolean;
}) {
  const t = getServerT(appMissionCatalog);
  return (
    <EmptyPanel
      title={t('appMission.appMissionIdCaseStatusPanel.noChecklistYet')}
      // The welcome note offers the same way forward in its own words, so it is not offered twice.
      {...(welcomeShown
        ? {}
        : {
            secondary:
              packOptionCount > 0
                ? { label: 'Pick a Checklist', href: '#pack' }
                : { label: 'Add Evidence', href: '#evidence' },
          })}
    >
      <AboutDisclosure
        summary={
          !welcomeShown && packOptionCount === 0 && noChecklistLine
            ? t('appMission.appMissionIdCaseStatusPanel.whyIsThereNoChecklist')
            : t('appMission.appMissionIdCaseStatusPanel.whatIsAChecklist')
        }
      >
        <p>{t.node('appMission.appMissionIdCaseStatusPanel.aChecklistListsThePapersThis')}</p>
        {!welcomeShown && packOptionCount === 0 && noChecklistLine ? (
          <p>{noChecklistLine}</p>
        ) : null}
      </AboutDisclosure>
    </EmptyPanel>
  );
}
