import type { MissionState } from '@visastack/core';
import {
  type getEvidenceCandidates,
  isFactStatusEligible,
  type listGeneratedOutputs,
} from '@visastack/services';
import type { ComponentProps, ReactNode } from 'react';
import { atLevel } from '../../../../components/depth';
import { Disclosure } from '../../../../components/ui';
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
 * The five sections under the checklist: Select or Update Evidence, Tasks and Letters,
 * Contributors and Notes, Submission and Outcome, Problems and Feedback. Each is a closed
 * disclosure at its own depth level; the capped lists inside them open when someone asked to see
 * more of them (`expanded`) and show the page's Show More control (`more`).
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
}: CaseSecondaryProps) {
  return (
    <>
      <div className="depth-item" {...atLevel('everything')}>
        <Disclosure title="Select or Update Evidence" hint="Open when you need to make a change">
          <div className="grid u-mt-150" id="evidence">
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
        </Disclosure>
      </div>

      <div className="depth-item" {...atLevel('browse')}>
        <Disclosure
          title="Tasks, Appointments and Letters"
          hint="Open when you need to make a change"
          open={expanded.tasks}
        >
          <div className="grid u-mt-150" id="work">
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
        </Disclosure>
      </div>

      <div id="notes" {...atLevel('browse')}>
        <Disclosure
          title="Contributors and Notes from Your Agency"
          hint="Ask a sponsor for one document, read shared notes"
          open={expanded.notes}
        >
          <div className="grid">
            <article className="card">
              <p className="card-kicker">Delegate</p>
              <h2 className="card-title">Ask a Contributor</h2>
              <p className="card-body u-mb-125">
                Ask a sponsor or family member - who never gets a wallet, profile, or case view of
                any kind - for exactly one named document. They see only what you type below before
                deciding whether to upload.
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
        </Disclosure>
      </div>

      <div className="depth-item" {...atLevel('everything')}>
        <Disclosure
          title="Submission and Outcome"
          hint="Open when you need to make a change"
          open={expanded.outcomes}
        >
          <div className="grid u-mt-150" id="outcome">
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
        </Disclosure>
      </div>

      <div className="u-mt-150" {...atLevel('everything')}>
        <Disclosure
          title="Problems and Feedback"
          hint="Raise a complaint or give feedback on this case"
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
        </Disclosure>
      </div>
    </>
  );
}
