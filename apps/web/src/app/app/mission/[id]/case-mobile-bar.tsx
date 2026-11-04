import { StickyActionBar } from '../../../../components/sticky-action-bar';
import { type CaseAttentionItem, NEXT_STEP_COPY } from './case-model';

export interface CaseMobileBarProps {
  readonly missionTitle: string;
  /** The attention item shown as the Next Step; null when the case changed or nothing needs doing. */
  readonly nextStep: CaseAttentionItem | null;
}

/** WP-SB2: on a phone the next step stays in reach while the person scrolls the case. */
export function CaseMobileBar({ missionTitle, nextStep }: CaseMobileBarProps) {
  if (!nextStep || nextStep.kind === 'changed') return null;
  const copy = NEXT_STEP_COPY[nextStep.kind];
  return (
    <div className="case-sticky-next">
      <StickyActionBar label="Next Step" note={copy.title(nextStep.count, missionTitle)}>
        <a className="btn btn-secondary" href={nextStep.href} data-open-group={nextStep.opens}>
          {copy.action}
        </a>
      </StickyActionBar>
    </div>
  );
}
