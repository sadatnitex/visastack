import { ActivityLog, type ActivityLogEntry } from '../../src/components/activity-log';
import { CollapsibleGroups } from '../../src/components/collapsible-group';
import { ShowMore } from '../../src/components/show-more';
import { StickyActionBar } from '../../src/components/sticky-action-bar';

/**
 * WP-SB0 scroll budget fixture: the shared parts with worst-case, made-up data. Each `view` is one
 * part on an otherwise empty page, so its own height is what the guard measures.
 */
export interface Sb0FixtureProps {
  readonly view: 'log' | 'show-more' | 'sticky' | 'groups' | 'padded';
  /** How many log entries, list rows or form fields. */
  readonly count?: number;
  /** Extra height for the padded page that proves the guard can fail. */
  readonly padding?: number;
}

const WHATS = ['Document Viewed', 'Document Download', 'Grant Created', 'Profile Changed'];
const PEOPLE = ['agent@example.test', 'System', 'me@example.test'];

/** Stable made-up row ids, so lists never key by position. */
function rowIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, n) => `${prefix}-${n}`);
}

function logEntries(count: number): ActivityLogEntry[] {
  const start = Date.UTC(2026, 9, 31, 12, 0, 0);
  return Array.from({ length: count }, (_, n) => {
    const at = new Date(start - n * 37 * 60 * 1000);
    return {
      id: String(count - n),
      what: WHATS[n % WHATS.length] ?? 'Document Viewed',
      detail: `Made-up record ${n + 1} with a longer reason that wraps on a phone screen`,
      who: PEOPLE[n % PEOPLE.length] ?? 'System',
      outcome:
        n % 5 === 0
          ? { label: 'Blocked', tone: 'danger' as const }
          : { label: 'Allowed', tone: 'success' as const },
      at: at.toISOString(),
      when: at.toISOString().slice(0, 16).replace('T', ' '),
    };
  });
}

export default function Sb0Fixture({ view, count = 500, padding = 0 }: Sb0FixtureProps) {
  if (view === 'log') {
    return (
      <article className="card">
        <h1 className="card-title">Access Log</h1>
        <ActivityLog
          entries={logEntries(count)}
          label="Access Log Entries"
          id="access-log"
          olderHref="/app/x?before=eyJ2IjoxfQ#access-log"
          totalLabel={`${count * 3} entries in all.`}
        />
      </article>
    );
  }
  if (view === 'show-more') {
    const shown = Math.min(count, 10);
    return (
      <article className="card">
        <h1 className="card-title">Cases</h1>
        <ol className="rows">
          {rowIds('case-row', shown).map((rowId, n) => (
            <li className="row" id={rowId} key={rowId}>
              <span className="row-key">Made-up case {n + 1}</span>
            </li>
          ))}
        </ol>
        <ShowMore
          id="cases-more"
          landOn={`case-row-${shown}`}
          pathname="/app/x"
          searchParams={{ status: 'open' }}
          next={count > shown ? { show: shown + 10 } : null}
          shown={shown}
          total={count}
          noun={{ one: 'case', other: 'cases' }}
        />
      </article>
    );
  }
  if (view === 'sticky') {
    return (
      <form className="card" aria-label="Made-Up Long Form" onSubmit={(e) => e.preventDefault()}>
        <h1 className="card-title">Made-Up Long Form</h1>
        {rowIds('field', count).map((fieldId, n) => (
          <label className="field" key={fieldId} htmlFor={fieldId}>
            <span className="field-label">Answer {n + 1}</span>
            <input id={fieldId} className="input" />
          </label>
        ))}
        <StickyActionBar label="Save This Form" note="Not saved yet">
          <button type="button" className="btn btn-secondary">
            Back
          </button>
          <button type="submit" className="btn btn-primary">
            Save Changes
          </button>
        </StickyActionBar>
      </form>
    );
  }
  if (view === 'groups') {
    return (
      <article className="card">
        <h1 className="card-title">Documents</h1>
        <CollapsibleGroups
          idPrefix="docs"
          noun={{ one: 'document', other: 'documents' }}
          groups={Array.from({ length: 6 }, (_, g) => ({
            key: `group-${g}`,
            title: `Made-Up Group ${g + 1}`,
            count,
            content: (
              <ul className="rows">
                {rowIds(`doc-${g}`, count).map((docId, n) => (
                  <li className="row" key={docId}>
                    Made-up document {n + 1}
                  </li>
                ))}
              </ul>
            ),
          }))}
        />
      </article>
    );
  }
  return (
    <article className="card">
      <h1 className="card-title">Padded Page</h1>
      <div style={{ height: `${padding}px` }} />
    </article>
  );
}
