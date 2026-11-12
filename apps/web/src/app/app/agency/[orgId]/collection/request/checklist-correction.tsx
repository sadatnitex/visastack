import {
  CORRECTION_CATEGORIES,
  CORRECTION_CATEGORY_LABELS,
  type CollectionRuleImpact,
} from '@visastack/services';
import { ChecklistCorrectionForm } from '../../../../../../components/checklist-correction-form';
import { appAgencyCatalog } from '../../../../../../i18n/app-agency';
import { getServerT } from '../../../../../../lib/i18n-server';
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
  if (item.changeKind === 'NONE' || !impact.itemName) {
    return 'It asks for the same items; only its source details were updated.';
  }
  const name = impact.itemName;
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
  open,
  officialItems,
}: {
  readonly organizationId: string;
  readonly requestId: string;
  /** A newer version, null when none applies, undefined when it could not be checked now. */
  readonly impact: CollectionRuleImpact | null | undefined;
  /** The request is still a draft or sent (not revoked or closed). */
  readonly open: boolean;
  /** The official items of the request's checklist (pack requirement id and its plain name). */
  readonly officialItems: readonly { readonly value: string; readonly label: string }[];
}) {
  const t = getServerT(appAgencyCatalog);
  return (
    <section className="card" aria-labelledby="collection-correction">
      <div className="card-body">
        <h2 id="collection-correction">
          {t.node(
            'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.officialChecklistUpdates',
          )}
        </h2>
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
        ) : open && impact === null ? (
          <p className="muted">
            {t.node(
              'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.thisRequestFollowsTheNewestPublished',
            )}
          </p>
        ) : null}
        <h3>
          {t.node(
            'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.suggestAChecklistCorrection',
          )}
        </h3>
        <p className="muted">
          {t.node(
            'appAgency.appAgencyOrgidCollectionRequestChecklistCorrection.ifAnOfficialItemLooksMissing',
          )}
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
