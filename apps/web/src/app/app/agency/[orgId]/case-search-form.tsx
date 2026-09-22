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

export const STAGE_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  IN_PROGRESS: 'In progress',
  READY_FOR_REVIEW: 'Ready for review',
  UNDER_REVIEW: 'Under review',
  READY_TO_EXPORT: 'Ready to export',
  LOCKED: 'Locked',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

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
  const hasFilters =
    query.length > 0 || stage.length > 0 || destination.length > 0 || assignee.length > 0;
  return (
    <form
      action={`/app/agency/${orgId}`}
      method="get"
      style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'flex-end' }}
    >
      <div className="field-row" style={{ flex: '1 1 14rem' }}>
        <label className="field-label" htmlFor="q">
          Search
        </label>
        <input
          id="q"
          name="q"
          type="text"
          defaultValue={query}
          className="input"
          placeholder="Client name, case title, or case ID"
        />
      </div>
      <div className="field-row" style={{ flex: '1 1 10rem' }}>
        <label className="field-label" htmlFor="stage">
          Stage
        </label>
        <select id="stage" name="stage" defaultValue={stage} className="input">
          <option value="">Any stage</option>
          {Object.entries(STAGE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row" style={{ flex: '1 1 10rem' }}>
        <label className="field-label" htmlFor="destination">
          Destination
        </label>
        <input
          id="destination"
          name="destination"
          type="text"
          defaultValue={destination}
          className="input"
        />
      </div>
      <div className="field-row" style={{ flex: '1 1 10rem' }}>
        <label className="field-label" htmlFor="assignee">
          Assignee
        </label>
        <select id="assignee" name="assignee" defaultValue={assignee} className="input">
          <option value="">Anyone</option>
          {members.map((m) => (
            <option key={m.accountId} value={m.accountId}>
              {m.email}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
        {hasFilters ? (
          <a href={`/app/agency/${orgId}`} className="muted" style={{ fontSize: '0.85rem' }}>
            Clear
          </a>
        ) : null}
      </div>
    </form>
  );
}
