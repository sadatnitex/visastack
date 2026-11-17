import type { Readiness } from '@visastack/services';
import type { CaseAttentionItem } from '../../src/app/app/mission/[id]/case-model';
import { CaseStatusPanel } from '../../src/app/app/mission/[id]/case-status-panel';
import { DepthScope } from '../../src/components/depth';
import { createTranslator } from '@visastack/i18n';
import { CASE_STATE_LABELS } from '../../src/lib/case-stages';

/**
 * WALD3 fixture: the real CaseStatusPanel with made-up Example data. `managed` picks who assesses
 * the case (the traveller alone, or with an agency on it), `depth` the level the screen is at, and
 * `longTitle` swaps in a 120-character case title with no spaces, the worst case for the Next Step.
 */
export interface Wald3FixtureProps {
  readonly managed: 'traveller' | 'agency';
  readonly depth: 'glance' | 'browse' | 'everything';
  readonly longTitle?: boolean;
  readonly state?: 'DRAFT' | 'IN_REVIEW' | 'AWAITING_APPLICANT';
}

const LONG_TITLE = `Example${'Longcasetitle'.repeat(8)}Case`.slice(0, 120);

const FIX: CaseAttentionItem = {
  kind: 'missing',
  tone: 'danger',
  count: 1,
  label: 'required item to fix',
  href: '#readiness',
};
const REVIEW: CaseAttentionItem = {
  kind: 'unconfirmed',
  tone: 'warning',
  count: 1,
  label: 'needs a check',
  href: '#readiness',
};

const readiness: Readiness = {
  total: 3,
  requiredCount: 3,
  satisfiedRequired: 1,
  missing: [],
  ready: false,
  overallState: 'NEEDS_ACTION',
  requirementResults: [
    { packRequirementId: 'a', kind: 'DOCUMENT', key: 'passport', optional: false, state: 'SATISFIED' },
    { packRequirementId: 'b', kind: 'DOCUMENT', key: 'photo', optional: false, state: 'CRITICAL_GAP' },
    { packRequirementId: 'c', kind: 'DOCUMENT', key: 'bank_statement', optional: false, state: 'UNVERIFIED' },
  ],
};

export default function Wald3Fixture({
  managed,
  depth,
  longTitle = false,
  state = 'IN_REVIEW',
}: Wald3FixtureProps) {
  const t = createTranslator('en');
  return (
    <DepthScope family="case" depth={depth}>
      <CaseStatusPanel
        missionId="example-case"
        missionTitle={longTitle ? LONG_TITLE : 'Example Case'}
        applicantId="example-applicant"
        state={state}
        stateLabels={CASE_STATE_LABELS}
        nextStageStates={['AWAITING_APPLICANT']}
        cancelInMore
        isDirty={false}
        changesSinceConfirmed={null}
        attention={[FIX, REVIEW]}
        nextStep={FIX}
        nextStepFirstItem="Photo"
        manualMode={false}
        readiness={readiness}
        acknowledged={false}
        requiredUnverifiedCount={1}
        requiredHardGapCount={1}
        t={t}
        selfReviewed={managed === 'traveller'}
        packOptionCount={0}
        noChecklistLine={null}
        welcomeShown={false}
        progressIsReadinessAnchor={false}
      />
    </DepthScope>
  );
}
