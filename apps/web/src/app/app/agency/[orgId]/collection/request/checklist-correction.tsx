import {
  CORRECTION_CATEGORIES,
  CORRECTION_CATEGORY_LABELS,
  type CollectionRuleImpact,
} from '@visastack/services';
import { ChecklistCorrectionForm } from '../../../../../../components/checklist-correction-form';
import { humanizeCode } from '../../../../../../lib/format-code';
import { suggestAgencyCorrectionAction } from './checklist-correction-actions';

const CATEGORIES = CORRECTION_CATEGORIES.map((value) => ({
  value,
  label: CORRECTION_CATEGORY_LABELS[value],
}));

/** The newer version's one precise item, in plain words. */
function changeLine(impact: CollectionRuleImpact): string {
  const { item } = impact;
  const others = item.changedCount - 1;
  const more = others > 0 ? `, and ${others} other ${others === 1 ? 'change' : 'changes'}` : '';
  if (item.changeKind === 'NONE' || !item.itemKey) return 'Its items are the same.';
  const name = humanizeCode(item.itemKey);
  const verb =
    item.changeKind === 'ADDED'
      ? 'was added'
      : item.changeKind === 'REMOVED'
        ? 'was removed'
        : 'changed';
  return `${name} ${verb}${more}.`;
}

/**
 * UMPE P11 on an agency document request: a newer published official checklist, if there is one
 * (issued revisions stay exactly as issued; reissuing is the agency's choice), and Suggest a
 * Checklist Correction for pack editors.
 */
export function ChecklistCorrectionCard({
  organizationId,
  requestId,
  impact,
  officialItems,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  readonly impact: CollectionRuleImpact | null;
  /** The official items of the request's checklist (pack requirement id and its plain name). */
  readonly officialItems: readonly { readonly value: string; readonly label: string }[];
}) {
  return (
    <section className="card" aria-labelledby="collection-correction">
      <div className="card-body">
        <h2 id="collection-correction">Official Checklist Updates</h2>
        {impact ? (
          <div className="notice notice-warn correction-impact">
            <p className="u-m-0">
              <strong>
                A newer version of {impact.packName} was published (Version {impact.newerVersion}
                ).
              </strong>{' '}
              This request follows Version {impact.pinnedVersion}. {changeLine(impact)}
            </p>
            <p className="u-m-0">
              {impact.issuedPinned ? 'What you already issued stays exactly as it was. ' : ''}
              To use the newer version, choose it under Official Checklists That Fit and issue
              again.
            </p>
          </div>
        ) : (
          <p className="muted">This request follows the newest published official checklist.</p>
        )}
        <h3>Suggest a Checklist Correction</h3>
        <p className="muted">
          If an official item looks missing, out of date or wrong, tell VisaStack. Pack editors
          check it against the official source; nothing changes until a corrected version is
          published.
        </p>
        <ChecklistCorrectionForm
          action={suggestAgencyCorrectionAction}
          hidden={{ organizationId, requestId }}
          categories={CATEGORIES}
          items={officialItems}
        />
      </div>
    </section>
  );
}
