import { CORRECTION_CATEGORIES, CORRECTION_CATEGORY_LABELS } from '@visastack/services';
import { ChecklistCorrectionForm } from '../../../../components/checklist-correction-form';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { getServerT } from '../../../../lib/i18n-server';
import { suggestCaseCorrectionAction } from './suggest-correction-actions';

const CATEGORIES = CORRECTION_CATEGORIES.map((value) => ({
  value,
  label: CORRECTION_CATEGORY_LABELS[value],
}));

/**
 * UMPE P11: Suggest a Correction on one line of the case checklist, folded away until asked for.
 * It goes to pack editors; the checklist and the case stay as they are.
 */
export function SuggestCorrection({
  missionId,
  packRequirementId,
  itemName,
}: {
  readonly missionId: string;
  readonly packRequirementId: string;
  readonly itemName: string;
}) {
  const t = getServerT(appMissionCatalog);
  return (
    <details className="correction-suggest">
      <summary>
        Suggest a Correction<span className="sr-only"> for {itemName}</span>
      </summary>
      <p className="muted u-fs-085 u-m-0">
        {t('appMission.appMissionIdSuggestCorrection.tellUsIfThisItemLooks')}
      </p>
      <ChecklistCorrectionForm
        action={suggestCaseCorrectionAction}
        hidden={{ missionId, packRequirementId }}
        categories={CATEGORIES}
        itemName={itemName}
      />
    </details>
  );
}
