import { appAgencyCatalog } from '../../../../i18n/app-agency';
import { getServerT } from '../../../../lib/i18n-server';
import { STAGE_LABELS } from './stage-labels';
/**
 * CAS-02: "Search only authorised clients/cases using name, case reference,
 * stage, destination and assignee." A plain GET form -- no client JS, no
 * server action -- so results are bookmarkable/shareable URLs and work with
 * the browser's own back/forward. The page component does the actual
 * filtering, strictly over cases it already authorized for this viewer;
 * this component only renders the inputs and reflects back whatever the
 * URL already says.
 *
 * "Case reference" has no dedicated field anywhere in this product (no
 * case-numbering scheme exists yet) -- the one stable per-case identifier
 * that does exist is the mission's own id, so the free-text box below
 * matches against applicant name, case title, AND mission id together,
 * rather than forcing the user to pick which one they're typing.
 */

export function CaseSearchForm({
  orgId,
  members,
  query,
  stage,
  destination,
  assignee,
}: {
  readonly orgId: string;
  readonly members: readonly { readonly accountId: string; readonly email: string }[];
  readonly query: string;
  readonly stage: string;
  readonly destination: string;
  readonly assignee: string;
}) {
  const t = getServerT(appAgencyCatalog);
  const hasFilters =
    query.length > 0 || stage.length > 0 || destination.length > 0 || assignee.length > 0;
  return (
    <form action={`/app/agency/${orgId}`} method="get" className="field-list">
      <div className="form-grid">
        <div className="field-row">
          <label className="field-label" htmlFor="q">
            {t.node('appAgency.appAgencyOrgidCaseSearchForm.search')}
          </label>
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={query}
            className="input"
            placeholder={t('appAgency.appAgencyOrgidCaseSearchForm.clientNameCaseTitleOrCase')}
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="stage">
            {t.node('appAgency.appAgencyOrgidCaseSearchForm.stage')}
          </label>
          <select id="stage" name="stage" defaultValue={stage} className="input">
            <option {...t.lang('appAgency.appAgencyOrgidCaseSearchForm.anyStage')} value="">
              {t('appAgency.appAgencyOrgidCaseSearchForm.anyStage')}
            </option>
            {Object.entries(STAGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="destination">
            {t.node('appAgency.appAgencyOrgidCaseSearchForm.destination')}
          </label>
          <input
            id="destination"
            name="destination"
            type="text"
            defaultValue={destination}
            className="input"
          />
        </div>
        <div className="field-row">
          <label className="field-label" htmlFor="assignee">
            {t.node('appAgency.appAgencyOrgidCaseSearchForm.assignee')}
          </label>
          <select id="assignee" name="assignee" defaultValue={assignee} className="input">
            <option {...t.lang('appAgency.appAgencyOrgidCaseSearchForm.anyone')} value="">
              {t('appAgency.appAgencyOrgidCaseSearchForm.anyone')}
            </option>
            {members.map((m) => (
              <option key={m.accountId} value={m.accountId}>
                {m.email}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="page-actions">
        <button type="submit" className="btn btn-secondary">
          {t.node('appAgency.appAgencyOrgidCaseSearchForm.search')}
        </button>
        {hasFilters ? (
          <a href={`/app/agency/${orgId}`} className="muted u-fs-085">
            {t.node('appAgency.appAgencyOrgidCaseSearchForm.clear')}
          </a>
        ) : null}
      </div>
    </form>
  );
}
