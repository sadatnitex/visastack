import { StatusBadge, type Tone } from '../../../../components/ui';
import type { CaseTriageView } from './case-triage';

const STATE_TONE: Readonly<Record<CaseTriageView['state'], Tone>> = {
  READY_FOR_REVIEW: 'success',
  NOT_READY: 'neutral',
  CHECKED_BY_HAND: 'warning',
  NO_CHECKLIST: 'neutral',
};

/**
 * Where a case stands, in the E02 groups: one group per item, with short notes beside it. It
 * only names what the case already holds; it never estimates a chance of approval. No state and
 * no data fetching, so the client case workspace can show it from plain props.
 */
export function CaseTriageSummary({
  view,
  headingId,
}: {
  readonly view: CaseTriageView;
  readonly headingId: string;
}) {
  return (
    <section className="case-triage" aria-labelledby={headingId}>
      <div className="case-triage-head">
        <h3 className="case-triage-title" id={headingId}>
          Where Things Stand
        </h3>
        <StatusBadge tone={STATE_TONE[view.state]}>{view.stateLabel}</StatusBadge>
      </div>
      {view.groups.length === 0 ? (
        <p className="muted case-triage-empty">Nothing has been asked for or checked yet.</p>
      ) : (
        <ul className="case-triage-groups">
          {view.groups.map((group) => (
            <li key={group.group} className="case-triage-group">
              <p className="case-triage-group-name">
                {group.label} <span className="case-triage-count">{group.items.length}</span>
              </p>
              <ul className="case-triage-items">
                {group.items.map((item) => (
                  <li key={item.key}>
                    <span>{item.label}</span>
                    {item.notes.length > 0 ? (
                      <span className="case-triage-notes">{item.notes.join(', ')}</span>
                    ) : null}
                    {item.due ? <span className="case-triage-notes">Due {item.due}</span> : null}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {view.requestsLeftOut ? (
        <p className="muted case-triage-empty">
          Items asked of the traveller are shown to agency administrators.
        </p>
      ) : null}
    </section>
  );
}
