import { CORRECTION_CATEGORIES, CORRECTION_CATEGORY_LABELS } from '@visastack/services';
import { ChecklistCorrectionForm } from '../../../../components/checklist-correction-form';
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
  return (
    <details className="correction-suggest">
      <summary>
        Suggest a Correction<span className="sr-only"> for {itemName}</span>
      </summary>
      <p className="muted u-fs-085 u-m-0">
        Tell us if this item looks wrong. Pack editors check it against the official source; your
        checklist does not change until a corrected version is published.
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
