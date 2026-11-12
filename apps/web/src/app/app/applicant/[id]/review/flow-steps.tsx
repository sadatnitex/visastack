import { appApplicantCatalog } from '../../../../../i18n/app-applicant';
import { getServerT } from '../../../../../lib/i18n-server';
import type { FlowStep } from '../../../../../lib/upload-batch';

const STEPS: readonly { readonly key: FlowStep; readonly label: string }[] = [
  { key: 'add', label: 'Add' },
  { key: 'check', label: 'Check' },
  { key: 'review', label: 'Review' },
];

/**
 * The three steps after files are added: Add (done), Check (we scan and read them), Review (you
 * approve what was found). `done` marks all three complete. A line of words, not colour alone, so
 * it reads the same to a screen reader.
 */
export function FlowSteps({ current }: { readonly current: FlowStep | 'done' }) {
  const t = getServerT(appApplicantCatalog);
  const at = current === 'done' ? STEPS.length : STEPS.findIndex((step) => step.key === current);
  return (
    <ol
      className="flow-steps"
      aria-label={t('appApplicant.appApplicantIdReviewFlowSteps.whereYouAre')}
    >
      {STEPS.map((step, index) => {
        const state = index < at ? 'done' : index === at ? 'current' : 'todo';
        return (
          <li
            key={step.key}
            className="flow-step"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="flow-step-mark" aria-hidden="true">
              {state === 'done' ? '\u2713' : index + 1}
            </span>
            <span className="flow-step-label">
              {step.label}
              <span className="sr-only">
                {state === 'done'
                  ? t('appApplicant.appApplicantIdReviewFlowSteps.done')
                  : state === 'current'
                    ? t('appApplicant.appApplicantIdReviewFlowSteps.now')
                    : t('appApplicant.appApplicantIdReviewFlowSteps.next')}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
