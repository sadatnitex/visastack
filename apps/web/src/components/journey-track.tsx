import type { MissionState } from '@visastack/core';
import { ExplainTip } from './explain-tip';
import { Icon, type IconName } from './icons';

/** One picture per stage, from the shared icon set. */
const STAGE_ICONS: Readonly<Record<MissionState, IconName>> = {
  DRAFT: 'file',
  INTAKE: 'clipboard',
  IN_REVIEW: 'eye',
  AWAITING_APPLICANT: 'user',
  SUBMISSION_READY: 'shield',
  SUBMITTED: 'plane',
  IN_PROGRESS: 'activity',
  READY_FOR_REVIEW: 'search',
  UNDER_REVIEW: 'eye',
  READY_TO_EXPORT: 'upload',
  LOCKED: 'lock',
  CLOSED: 'folder',
  CANCELLED: 'circle',
};

const STAGE_SENTENCES: Readonly<Record<MissionState, string>> = {
  DRAFT: 'You are starting the case and can still change anything.',
  INTAKE: 'The details of your trip and your documents are being gathered.',
  IN_REVIEW: 'Someone is checking your case before it goes further.',
  AWAITING_APPLICANT: 'The case is waiting for you to answer or confirm something.',
  SUBMISSION_READY: 'Everything is in place and the case can be sent.',
  SUBMITTED: 'The case was sent and is waiting for a result.',
  IN_PROGRESS: 'The case is being worked on now.',
  READY_FOR_REVIEW: 'The case is ready for someone to check.',
  UNDER_REVIEW: 'Someone is checking the case now.',
  READY_TO_EXPORT: 'The case can be downloaded as a pack.',
  LOCKED: 'The case is locked so nothing changes.',
  CLOSED: 'The case is finished and no more work is needed.',
  CANCELLED: 'The case was stopped.',
};

const KIND_WORDS = { before: 'Before', later: 'Later' } as const;

/** The one sentence that says what happens in a stage. */
export function journeyStageSentence(stage: MissionState): string {
  return STAGE_SENTENCES[stage];
}

/**
 * The case's stages as small pictures along a line. The current stage is marked with its word and
 * "Now:" for screen readers, read before the stage (the step bar already carries `aria-current`); stages before it are plain "Before" markers and later ones plain "Later" ones.
 * Nothing is ticked or called done: the page keeps no stage history and real moves skip stages, so
 * a stage before the current one may never have been entered. Submitted gets no special claim.
 * `stages` is the same ordered path the step bar shows, so order and words never differ. A case
 * that is not on the path (for example a cancelled one) draws nothing, so the step bar alone
 * stays. The track wraps onto more rows on a narrow screen, so the explain popup is never clipped.
 */
export function JourneyTrack({
  state,
  labels,
  stages,
  ariaLabel,
}: {
  readonly state: MissionState;
  readonly labels: Readonly<Record<string, string>>;
  readonly stages: readonly MissionState[];
  readonly ariaLabel: string;
}) {
  const at = stages.indexOf(state);
  if (at < 0) return null;
  return (
    <section className="journey-track" aria-label={ariaLabel}>
      {/* biome-ignore lint/a11y/noRedundantRoles lint/a11y/useSemanticElements: the list has list-style none, which makes Safari drop the list semantics unless the role is stated. */}
      <ol className="journey-track-list" role="list">
        {stages.map((stage, index) => {
          // There is no stage history, so nothing before the current stage is claimed as finished:
          // real moves skip stages. Earlier stages are plain "Before" markers, Submitted included.
          const kind = index === at ? 'current' : index < at ? 'before' : 'later';
          const label = labels[stage] ?? stage;
          const picture = <Icon name={STAGE_ICONS[stage]} size={22} />;
          return (
            <li key={stage} className={`journey-stage journey-stage-${kind}`}>
              {kind === 'current' ? <span className="sr-only">Now: </span> : null}
              {kind === 'current' ? (
                <ExplainTip label={label} text={journeyStageSentence(stage)}>
                  {picture}
                </ExplainTip>
              ) : (
                <span className="journey-stage-picture" aria-hidden="true">
                  {picture}
                </span>
              )}
              {kind === 'current' ? null : (
                <span className="sr-only">
                  {label}: {KIND_WORDS[kind]}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
