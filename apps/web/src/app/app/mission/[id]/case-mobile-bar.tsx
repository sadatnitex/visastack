import { StickyActionBar } from '../../../../components/sticky-action-bar';
import { ProgressMeter } from '../../../../components/ui-lift';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { getServerT } from '../../../../lib/i18n-server';
import { type CaseAttentionItem, NEXT_STEP_COPY } from './case-model';

/** How far the checklist is: required items on file out of all required items. */
export interface CaseMobileBarProgress {
  readonly done: number;
  readonly total: number;
}

export interface CaseMobileBarProps {
  /** The attention item shown as the Next Step; null when the case changed or nothing needs doing. */
  readonly nextStep: CaseAttentionItem | null;
  /** The checklist's progress, shown as "6 of 12" with a small bar; left out when there is none. */
  readonly progress?: CaseMobileBarProgress | null | undefined;
}

/**
 * WP-SB2: on a phone the next step stays in reach while the person scrolls the case. The note
 * says how far the checklist is ("6 of 12") with a small bar, then the step in plain words; the
 * one button is secondary, because the Next Step panel at the top holds the page's filled button.
 */
export function CaseMobileBar({ nextStep, progress }: CaseMobileBarProps) {
  const t = getServerT(appMissionCatalog);
  if (!nextStep || nextStep.kind === 'changed') return null;
  const copy = NEXT_STEP_COPY[nextStep.kind];
  // Short on purpose: the Next Step panel above already says it in full.
  const title = copy.short(nextStep.count);
  const hasProgress = Boolean(progress && progress.total > 0);
  return (
    <div className="case-sticky-next">
      <StickyActionBar
        label={t('appMission.appMissionIdCaseMobileBar.nextStep')}
        note={
          hasProgress && progress ? (
            <>
              <span className="lift-bar-progress">
                <ProgressMeter
                  value={progress.done}
                  max={progress.total}
                  label={t('appMission.appMissionIdCaseMobileBar.requiredItemsOnFile')}
                  size={6}
                  valueText={null}
                />
                {/* The bar's own name already says these numbers, so they are for the eyes only. */}
                <span className="lift-bar-count" aria-hidden="true">
                  {t.node('appMission.appMissionIdCaseMobileBar.doneOfTotal', {
                    done: progress.done,
                    total: progress.total,
                  })}
                </span>
                <span className="lift-bar-sep" aria-hidden="true">
                  {' · '}
                </span>
              </span>
              <span className="lift-bar-title">{title}</span>
            </>
          ) : (
            title
          )
        }
      >
        <a className="btn btn-secondary" href={nextStep.href} data-open-group={nextStep.opens}>
          {copy.action}
        </a>
      </StickyActionBar>
    </div>
  );
}
