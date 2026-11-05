import type { MissionState } from '@visastack/core';
import {
  type getEvidenceCandidates,
  isFactStatusEligible,
  type listGeneratedOutputs,
} from '@visastack/services';
import type { ComponentProps, ReactNode } from 'react';
import { atLevel } from '../../../../components/depth';
import type { IconName } from '../../../../components/icons';
import { ActionRow, SectionCard, StatusPill } from '../../../../components/ui-lift';
import type { DepthLevel } from '../../../../lib/ccd/depth';
import { humanizeCode } from '../../../../lib/format-code';
import { formatTimestampDate } from '../../../../lib/format-date';
import { fieldLabel } from '../../../../lib/master-profile';
import { AttemptPanel } from './attempt-panel';
import { ATTEMPT_DOCUMENT_KINDS, CAPPED_LISTS, type CappedList, type OkValue } from './case-model';
import {
  AppointmentsPanel,
  EvidenceSelectionPanel,
  LettersPanel,
  TasksPanel,
} from './collaboration-panels';
import { ComplaintPanel, FeedbackPanel } from './complaint-feedback-panel';
import { ContributorRequestsPanel } from './contributor-requests-panel';
import type { EvidenceLifecycleLabels } from './evidence-lifecycle';
import { OutcomePanel } from './outcome-panel';
import { SubmissionReportPanel } from './submission-report-panel';

/** The evidence options the case can choose from, per checklist item. */
export type CaseEvidenceCandidates = OkValue<Awaited<ReturnType<typeof getEvidenceCandidates>>>;
/** The letters generated for the case, newest first. */
export type CaseLetters = OkValue<Awaited<ReturnType<typeof listGeneratedOutputs>>>;

/** One note an agency shared with the traveller. */
export interface CaseNoteRow {
  readonly id: string;
  readonly body: string;
  readonly authorEmail: string | null;
  readonly createdAt: string;
}

/**
 * The numbers the section rows show beside their names, when the page has the full totals (a
 * capped list shows only its first rows). Without a total a row counts what it was given.
 */
export interface CaseSecondaryTotals {
  /** Tasks that are still open or in progress, across the whole case. */
  readonly openTasks?: number | undefined;
  /** Notes an agency shared, across the whole case. */
  readonly notes?: number | undefined;
  /** Outcomes recorded, across the whole case. */
  readonly outcomes?: number | undefined;
  /** Complaints and feedback notes together, across the whole case. */
  readonly problems?: number | undefined;
}

/**
 * The five sections under the checklist, as one card, More for This Case: Select or Update
 * Evidence, Tasks and Letters, Contributors and Notes, Submission and Outcome, Problems and
 * Feedback. Each is a closed row (icon, name, a count, a chevron) at its own depth level; the
 * capped lists inside them open when someone asked to see more of them (`expanded`) and show the
 * page's Show More control (`more`).
 */
export interface CaseSecondaryProps {
  readonly missionId: string;
  readonly missionState: MissionState;
  readonly candidates: CaseEvidenceCandidates;
  readonly evidenceLifecycle: Pick<EvidenceLifecycleLabels, 'byDocument'>;
  readonly selectionIdsByCandidate: Readonly<Record<string, string>>;
  readonly tasks: ComponentProps<typeof TasksPanel>['tasks'];
  /** Tasks that are not open, counted across the whole case. */
  readonly finishedTaskTotal: number;
  readonly appointments: ComponentProps<typeof AppointmentsPanel>['appointments'];
  readonly letters: CaseLetters;
  readonly contributorRequests: ComponentProps<typeof ContributorRequestsPanel>['requests'];
  readonly notes: readonly CaseNoteRow[];
  readonly submissions: ComponentProps<typeof SubmissionReportPanel>['submissions'];
  readonly outcomes: ComponentProps<typeof OutcomePanel>['outcomes'];
  readonly evidenceOptions: ComponentProps<typeof OutcomePanel>['evidenceOptions'];
  /** The application attempts; null when they could not be read. */
  readonly outcomeAttempts: ComponentProps<typeof AttemptPanel>['view'] | null;
  /** The traveller's today, as a date, for the attempt form. */
  readonly attemptToday: string;
  readonly complaints: ComponentProps<typeof ComplaintPanel>['complaints'];
  readonly feedback: ComponentProps<typeof FeedbackPanel>['feedback'];
  readonly canSubmitFeedback: boolean;
  /** Which capped lists start open because someone asked for more rows. */
  readonly expanded: Readonly<Record<CappedList, boolean>>;
  /** The Show More control of each capped list; null when the list is short. */
  readonly more: Readonly<Record<CappedList, ReactNode>>;
  /** The full totals for the counts beside the section names; see `CaseSecondaryTotals`. */
  readonly totals?: CaseSecondaryTotals | undefined;
}

/** What a row says beside its name: a count in words, or a quiet "none yet". */
function countPill(count: number, one: string, other: string, none: string) {
  return (
    <StatusPill tone={count > 0 ? 'info' : 'neutral'}>
      {count === 0 ? none : `${count} ${count === 1 ? one : other}`}
    </StatusPill>
  );
}

/** One closed row of the More for This Case card; the section's panels are its body. */
function MoreItem({
  id,
  level,
  open,
  icon,
  title,
  pill,
  children,
}: {
  readonly id?: string;
  readonly level: DepthLevel;
  readonly open?: boolean | undefined;
  readonly icon: IconName;
  readonly title: string;
  readonly pill: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="lift-more-item" {...(id ? { id } : {})} {...atLevel(level)}>
      <details open={open}>
        <ActionRow asSummary icon={icon} title={title} pill={pill} />
        <div className="lift-more-body">{children}</div>
      </details>
    </div>
  );
}

export function CaseSecondary({
  missionId,
  missionState,
  candidates,
  evidenceLifecycle,
  selectionIdsByCandidate,
  tasks,
  finishedTaskTotal,
  appointments,
  letters,
  contributorRequests,
  notes,
  submissions,
  outcomes,
  evidenceOptions,
  outcomeAttempts,
  attemptToday,
  complaints,
  feedback,
  canSubmitFeedback,
  expanded,
  more,
  totals,
}: CaseSecondaryProps) {
  const openTasks =
    totals?.openTasks ??
    tasks.filter((t) => t.status === 'OPEN' || t.status === 'IN_PROGRESS').length;
  const noteCount = totals?.notes ?? notes.length;
  const outcomeCount = totals?.outcomes ?? outcomes.length;
  const problemCount = totals?.problems ?? complaints.length + feedback.length;
  return (
    <div className="lift-more-slot" {...atLevel('browse')}>
      <SectionCard heading="More for This Case">
        <div className="lift-more-list">
          <MoreItem
            level="everything"
            icon="folder"
            title="Select or Update Evidence"
            pill={countPill(candidates.length, 'Checklist Item', 'Checklist Items', 'No Items Yet')}
          >
            <div className="grid" id="evidence">
              <EvidenceSelectionPanel
                missionId={missionId}
                candidates={candidates.map((c) => ({
                  packRequirementId: c.packRequirementId,
                  kind: c.kind,
                  label:
                    c.kind === 'FIELD'
                      ? (fieldLabel(c.key) ?? humanizeCode(c.key))
                      : humanizeCode(c.key),
                  citation: c.citation,
                  factCandidates: c.factCandidates.map((f) => ({
                    factId: f.factId,
                    value: f.value,
                    repeatingRecordKey: f.repeatingRecordKey,
                    eligible: isFactStatusEligible(f.status),
                  })),
                  documentCandidates: c.documentCandidates.map((d) => ({
                    documentId: d.documentId,
                    displayName: d.displayName,
                    eligible: d.eligible,
                    staleness: d.staleness.status,
                    lifecycleLabel: evidenceLifecycle.byDocument[d.documentId] ?? null,
                  })),
                  selectedFactIds: c.selectedFactIds,
                  selectedDocumentIds: c.selectedDocumentIds,
                  selectionIdsByCandidate,
                }))}
              />
            </div>
          </MoreItem>

          <MoreItem
            level="browse"
            icon="clipboard"
            title="Tasks, Appointments and Letters"
            pill={countPill(openTasks, 'Open Task', 'Open Tasks', 'No Open Tasks')}
            open={expanded.tasks}
          >
            <div className="grid" id="work">
              <TasksPanel
                missionId={missionId}
                tasks={tasks}
                rowIdPrefix={CAPPED_LISTS.tasks.rowId}
                more={more.tasks}
                finishedTotal={finishedTaskTotal}
                finishedOpen={expanded.tasks}
              />
              <AppointmentsPanel missionId={missionId} appointments={appointments} />
              <LettersPanel
                missionId={missionId}
                letters={letters.map((l) => ({
                  id: l.id,
                  version: l.version,
                  content: l.content,
                  createdAt: l.createdAt.toISOString(),
                }))}
                canGenerate={candidates.some(
                  (c) =>
                    c.factCandidates.some((f) => isFactStatusEligible(f.status)) ||
                    c.documentCandidates.some((d) => d.eligible),
                )}
              />
            </div>
          </MoreItem>

          <MoreItem
            id="notes"
            level="browse"
            icon="users"
            title="Contributors and Notes from Your Agency"
            pill={countPill(noteCount, 'Note', 'Notes', 'No Notes Yet')}
            open={expanded.notes}
          >
            <div className="grid">
              <article className="card">
                <p className="card-kicker">Delegate</p>
                <h2 className="card-title">Ask a Contributor</h2>
                <p className="card-body u-mb-125">
                  Ask a sponsor or family member - who never gets a wallet, profile, or case view of
                  any kind - for exactly one named document. They see only what you type below
                  before deciding whether to upload.
                </p>
                <ContributorRequestsPanel missionId={missionId} requests={contributorRequests} />
              </article>

              <article className="card">
                <p className="card-kicker">Collaboration</p>
                <h2 className="card-title">Notes from Your Agency</h2>
                <p className="card-body u-mb-125">
                  Notes an agency working this case has chosen to share with you. An agency's own
                  internal notes are never shown here.
                </p>
                {notes.length === 0 ? (
                  <p className="muted u-fs-085">No notes shared with you yet.</p>
                ) : (
                  <div className="rows">
                    {notes.map((n, index) => (
                      <div
                        className="row lift-row-start"
                        key={n.id}
                        id={`${CAPPED_LISTS.notes.rowId}-${index}`}
                      >
                        <span className="u-fs-085">{n.body}</span>
                        <span className="muted lift-caption-mt-020">
                          {n.authorEmail ?? 'Unknown'}, {formatTimestampDate(n.createdAt)}
                        </span>
                      </div>
                    ))}
                    {more.notes}
                  </div>
                )}
              </article>
            </div>
          </MoreItem>

          <MoreItem
            level="everything"
            icon="upload"
            title="Submission and Outcome"
            pill={countPill(outcomeCount, 'Outcome', 'Outcomes', 'No Outcome Yet')}
            open={expanded.outcomes}
          >
            <div className="grid" id="outcome">
              <SubmissionReportPanel
                missionId={missionId}
                submissions={submissions}
                eligible={missionState === 'SUBMISSION_READY'}
              />
              <OutcomePanel
                missionId={missionId}
                outcomes={outcomes}
                evidenceOptions={evidenceOptions}
                rowIdPrefix={CAPPED_LISTS.outcomes.rowId}
                more={more.outcomes}
              />
              {outcomeAttempts ? (
                <AttemptPanel
                  missionId={missionId}
                  view={outcomeAttempts}
                  today={attemptToday}
                  documentKinds={ATTEMPT_DOCUMENT_KINDS}
                />
              ) : null}
            </div>
          </MoreItem>

          <MoreItem
            level="everything"
            icon="mail"
            title="Problems and Feedback"
            pill={countPill(problemCount, 'Raised', 'Raised', 'None Raised')}
            open={expanded.complaints || expanded.feedback}
          >
            <div className="grid">
              <ComplaintPanel
                missionId={missionId}
                complaints={complaints}
                rowIdPrefix={CAPPED_LISTS.complaints.rowId}
                more={more.complaints}
              />
              <FeedbackPanel
                missionId={missionId}
                feedback={feedback}
                canSubmit={canSubmitFeedback}
                rowIdPrefix={CAPPED_LISTS.feedback.rowId}
                more={more.feedback}
              />
            </div>
          </MoreItem>
        </div>
      </SectionCard>
    </div>
  );
}
