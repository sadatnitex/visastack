import { GroupedList, ListRow, ListWithPane } from '../../src/components/list-pattern';
import { SectionCard } from '../../src/components/ui-lift';

/**
 * The one list pattern as the case page lays it out: a grid with the checklist on the left and the
 * rail on the right, folders of rows, and a panel per row. The real kit and the real stylesheet;
 * the rows and panels hold made-up words. Used by e2e/pattern/pattern-screens.spec.ts.
 */
export interface PatternListFixtureProps {
  /** How many rows the list holds. */
  readonly rows?: number;
  /** The row whose panel is open when the page is drawn (the address named it). */
  readonly initial?: string;
}

const LONG =
  'A passport that is valid for at least six months after the day you plan to arrive, with at least two blank pages in it for stamps and visas.';

export default function PatternListFixture({ rows = 19, initial }: PatternListFixtureProps) {
  const ids = Array.from({ length: rows }, (_, i) => `item-${i + 1}`);
  const name = (i: number) => (i === 0 ? LONG : `Document number ${i + 1}`);
  const needs = ids.slice(0, 3);
  const optional = ids.slice(3, rows - 1);
  const onFile = ids.slice(rows - 1);
  const row = (
    id: string,
    tone: 'danger' | 'neutral' | 'success',
    status: string,
    add: boolean,
  ) => (
    <ListRow
      key={id}
      id={id}
      name={name(ids.indexOf(id))}
      tone={tone}
      status={status}
      tag={tone === 'danger' ? 'Mandatory' : undefined}
      action={add ? { label: 'Add', href: '/app/applicant/x/documents/add' } : undefined}
      openHref={`?item=${id}#readiness`}
    />
  );
  return (
    <section className="section container lift-case">
      <h1>Japan visitor visa</h1>
      <div className="lift-case-grid case-working-area">
        <ListWithPane
          panes={ids.map((id, i) => ({
            id,
            title: name(i),
            content: (
              <div className="lp-pane-content">
                <h3 className="lp-pane-title">{name(i)}</h3>
                <a className="btn btn-secondary" href="#evidence">
                  Provide Evidence
                </a>
                <label className="label" htmlFor={`note-${id}`}>
                  Your note
                </label>
                <input id={`note-${id}`} className="input" />
              </div>
            ),
          }))}
          initial={initial}
          paneLabel="Item Details"
          backLabel="Back to the Checklist"
          backHref="/#readiness"
        >
          <div className="lift-case-checklist">
            <div id="readiness">
              <SectionCard heading="Evidence Checklist" level={3}>
                <GroupedList
                  groups={[
                    {
                      id: 'case-checklist-needs-you',
                      heading: 'Needs You',
                      count: needs.length,
                      tone: 'danger',
                      open: true,
                      children: needs.map((id) => row(id, 'danger', 'Missing', true)),
                    },
                    {
                      id: 'case-checklist-optional',
                      heading: 'Optional',
                      count: optional.length,
                      tone: 'neutral',
                      open: false,
                      children: optional
                        .slice(0, 3)
                        .map((id) => row(id, 'neutral', 'Optional', false)),
                      ...(optional.length > 3
                        ? {
                            rest: optional
                              .slice(3)
                              .map((id) => row(id, 'neutral', 'Optional', false)),
                            restLabel: `${optional.length - 3} More Items`,
                          }
                        : {}),
                    },
                    {
                      id: 'case-checklist-on-file',
                      heading: 'On File',
                      count: onFile.length,
                      tone: 'success',
                      open: false,
                      children: onFile.map((id) => row(id, 'success', 'On File', false)),
                    },
                  ]}
                />
              </SectionCard>
            </div>
          </div>
        </ListWithPane>
        <aside className="split-rail lift-rail" aria-label="About this case">
          <section className="lift-card">
            <h2 className="lift-card-title">Case Details</h2>
            <p>Japan, 14 to 28 March 2027</p>
          </section>
        </aside>
      </div>
    </section>
  );
}
