import type { ReactNode } from 'react';
import { CaseStageTracker } from '../../src/components/case-preparation-summary';
import { CollapsibleGroups } from '../../src/components/collapsible-group';
import { Icon } from '../../src/components/icons';
import { ShowMore } from '../../src/components/show-more';
import { StickyActionBar } from '../../src/components/sticky-action-bar';
import { Disclosure, PageHeader } from '../../src/components/ui';
import { NextStepPanel, ProgressMeter } from '../../src/components/ui-lift';
import { CASE_STATE_LABELS } from '../../src/lib/case-stages';

/**
 * WP-SB2 scroll budget fixture: the case workspace and a snapshot, built from the same shared parts
 * and class names as the real pages, with worst-case made-up data. The real pages read the
 * database and run server actions, so they cannot be bundled here; this keeps their layout.
 *
 * Views:
 * - `case`: the case at the Browse level (the plan's 3-screen budget): a 60-item checklist in
 *   groups (missing items open, 3 rows then the rest folded), the task and note lists capped at 10
 *   rows with Show More inside their closed sections, and the phone next-step bar. Snapshots,
 *   complaints and feedback show only at the Everything level, so they are not part of it.
 * - `case-uncapped`: the same case laid out as before WP-SB2 (every group open, every row listed),
 *   which proves the budget check fails on it.
 * - `snapshot`: a snapshot with 60 requirements, 40 facts and 30 documents in groups, 8 rows a
 *   group then Show All inside it (WP-SB11).
 * - `snapshot-uncapped`: the same snapshot with every row of a group drawn, which proves the open
 *   snapshot's budget check fails without the cap.
 */
export interface Sb2FixtureProps {
  readonly view: 'case' | 'case-uncapped' | 'snapshot' | 'snapshot-uncapped';
}

const ids = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, n) => `${prefix}-${n}`);

function Row({
  id,
  title,
  note,
}: { readonly id: string; readonly title: string; readonly note?: string }) {
  return (
    <div
      className="row"
      id={id}
      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.3rem' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
        <span className="row-key">{title}</span>
        <span className="badge badge-neutral">On File</span>
      </div>
      {note ? <span className="muted u-fs-085">{note}</span> : null}
    </div>
  );
}

function checklist(capped: boolean) {
  const group = (key: string, title: string, count: number, open: boolean) => ({
    key,
    title,
    count,
    open,
    rows: ids(`${key}-row`, count).map((id, n) => (
      <Row
        key={id}
        id={id}
        title={`Made-up requirement ${n + 1} with a longer name`}
        note="Add this to move the case forward. Cite: made-up source, as of 1 Oct 2026."
      />
    )),
  });
  const groups = [
    group('needs-you', 'Needs You', 20, true),
    group('needs-a-check', 'Needs a Check', 10, !capped),
    group('done', 'Done', 30, !capped),
  ];
  if (capped) {
    return (
      <div className="collapsible-groups">
        {groups.map((g, index) => (
          <details
            className="collapsible-group"
            id={`case-checklist-${g.key}`}
            key={g.key}
            open={index === 0}
          >
            <summary className="collapsible-group-summary">
              <h4 className="case-group-heading collapsible-group-title">
                {g.title} <span className="muted">{g.count}</span>
              </h4>
            </summary>
            <div className="collapsible-group-body">
              <div className="rows">{g.rows.slice(0, 3)}</div>
              {g.rows.length > 3 ? (
                <details className="case-checklist-rest">
                  <summary>{g.rows.length - 3} More Items</summary>
                  <div className="rows">{g.rows.slice(3)}</div>
                </details>
              ) : null}
            </div>
          </details>
        ))}
      </div>
    );
  }
  return groups.map((g) => (
    <div key={g.key}>
      <h4 className="case-group-heading">
        {g.title} <span className="muted">{g.count}</span>
      </h4>
      <div className="rows">{g.rows}</div>
    </div>
  ));
}

function cappedList(name: string, total: number, capped: boolean): ReactNode {
  const shown = capped ? Math.min(10, total) : total;
  return (
    <article className="card">
      <h2 className="card-title">{name}</h2>
      <div className="rows">
        {ids(`case-${name.toLowerCase()}`, shown).map((id, n) => (
          <Row key={id} id={id} title={`Made-up ${name.toLowerCase()} entry ${n + 1}`} />
        ))}
      </div>
      {capped && total > shown ? (
        <ShowMore
          id={`case-${name.toLowerCase()}-more`}
          pathname="/app/mission/synthetic-case"
          next={{ [name.toLowerCase()]: 20 }}
          shown={shown}
          total={total}
          noun={{ one: 'entry', other: 'entries' }}
        />
      ) : null}
    </article>
  );
}

function CaseView({ capped }: { readonly capped: boolean }) {
  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/applicant/synthetic/missions', label: 'Made-up traveller · Cases' }}
        eyebrow="Case"
        title="Made-up visitor visa case"
        actions={
          <>
            <div className="case-header-wide">
              <a className="btn btn-secondary" href="#evidence">
                Add Evidence
              </a>
              <a
                className="btn btn-secondary"
                href="/app/applicant/synthetic/missions/prepare-again"
              >
                Start a New Case from This One
              </a>
              <button type="button" className="btn btn-secondary">
                Snapshot
              </button>
            </div>
            <div className="case-more">
              <details className="case-more-menu">
                <summary className="btn btn-secondary">More</summary>
              </details>
            </div>
          </>
        }
      />
      {/* The Case Status Panel: the next step and Evidence Progress, what needs attention, the stages. */}
      <div className="lift-status">
        <div className="lift-status-main">
          <NextStepPanel
            kicker="Next Step"
            kickerId="case-next-step-heading"
            title="Fix 20 required items for Made-up visitor visa case"
            edge="danger"
            action={{ label: 'See What Needs Fixing', href: '#readiness' }}
          />
          <div className="lift-status-progress">
            <section className="lift-progress" aria-label="Evidence preparation completeness">
              <h2 className="lift-progress-kicker">Evidence Progress</h2>
              <p className="lift-progress-figure">
                <span className="lift-progress-numeral">40 of 60</span>
                <span className="lift-progress-unit">required items on file</span>
              </p>
              <ProgressMeter value={40} max={60} label="required items on file" valueText="67%" />
            </section>
          </div>
        </div>
        <div className="case-context-strip">
          <ul className="case-attention" aria-label="What needs attention on this case">
            {(
              [
                ['#readiness', 'danger', 20, 'required items to fix'],
                ['#readiness', 'warning', 10, 'need a check'],
                ['#work', 'warning', 40, 'open tasks'],
              ] as const
            ).map(([href, tone, count, label]) => (
              <li key={label}>
                <a className={`plain-link lift-attn lift-attn-${tone}`} href={href}>
                  <span className="lift-attn-icon" aria-hidden="true">
                    <Icon name={tone === 'danger' ? 'close' : 'alert'} size={16} />
                  </span>
                  <span className="lift-attn-count">{count}</span>
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="lift-status-stages">
          <CaseStageTracker
            state="IN_PROGRESS"
            labels={CASE_STATE_LABELS}
            nextStates={['READY_FOR_REVIEW']}
            cancelInMore
          />
        </div>
      </div>
      <p className="case-journey-reminder">
        Preparing a file is not the same as submitting it. VisaStack does not submit applications or
        predict decisions.
      </p>
      <nav className="jump-nav" aria-label="Sections of this case">
        <a href="#readiness">Readiness</a>
        <a href="#work">Tasks and Letters</a>
        <a href="#snapshots">Snapshots</a>
      </nav>
      <div className="lift-case-grid case-working-area">
        <div className="lift-case-checklist">
          <div className="lift-card" id="readiness">
            <h3 className="lift-card-title">Evidence Checklist</h3>
            {checklist(capped)}
          </div>
        </div>
        <aside className="split-rail" aria-label="About this case">
          <article className="card">
            <p className="card-kicker">Case</p>
            <h2 className="card-title">Case Details</h2>
            <p className="card-body">Made-up country · Visitor</p>
            <p className="muted">1 Dec 2026 to 20 Dec 2026</p>
          </article>
          <article className="card">
            <p className="card-kicker">Requirements</p>
            <h2 className="card-title">Requirement Pack</h2>
            <p className="card-body">Made-up visitor checklist</p>
          </article>
          <article className="card">
            <p className="card-kicker">Workflow</p>
            <h2 className="card-title">Advance the Case</h2>
            <button type="button" className="btn btn-secondary">
              Move to Ready for Review
            </button>
          </article>
          {capped ? null : (
            <article className="card" id="snapshots">
              <h2 className="card-title">Snapshots</h2>
              <div className="rows">
                {ids('snapshot', capped ? 5 : 60).map((id, n) => (
                  <Row key={id} id={id} title={`Version ${60 - n}`} />
                ))}
              </div>
              {capped ? (
                <p className="card-body">
                  <a href="/app/mission/synthetic-case/snapshots">See All Snapshots</a>
                </p>
              ) : null}
            </article>
          )}
        </aside>
        <div className="lift-case-secondary">
          {capped ? (
            <>
              <Disclosure
                title="Tasks, Appointments and Letters"
                hint="Open when you need to make a change"
              >
                {cappedList('Tasks', 120, capped)}
              </Disclosure>
              <Disclosure title="Contributors and Notes from Your Agency">
                {cappedList('Notes', 80, capped)}
              </Disclosure>
            </>
          ) : (
            <>
              {cappedList('Tasks', 120, capped)}
              {cappedList('Notes', 80, capped)}
              {cappedList('Complaints', 60, capped)}
              {cappedList('Feedback', 60, capped)}
            </>
          )}
        </div>
      </div>
      {capped ? (
        <div className="case-sticky-next">
          <StickyActionBar
            label="Next Step"
            note="Fix 20 required items for Made-up visitor visa case"
          >
            <a className="btn btn-secondary" href="#readiness">
              See What Needs Fixing
            </a>
          </StickyActionBar>
        </div>
      ) : null}
    </section>
  );
}

function SnapshotView({ capped }: { readonly capped: boolean }) {
  // WP-SB11: as on the real page, an open part draws 8 rows and folds the rest behind Show All.
  const row = (key: string, id: string, n: number) => (
    <Row
      key={id}
      id={id}
      title={`Made-up ${key} ${n + 1} with a longer name`}
      note="Made-up citation text from the requirement pack, as of this snapshot"
    />
  );
  const group = (key: string, title: string, label: string, count: number) => {
    const all = ids(`snapshot-${key}-row`, count).map((id, n) => row(key, id, n));
    const first = capped ? 8 : count;
    return {
      key,
      title,
      count,
      content: (
        <>
          <div className="rows u-mt-050">{all.slice(0, first)}</div>
          {count > first ? (
            <details className="snapshot-rows-more">
              <summary className="btn btn-secondary u-btn-sm">
                <span className="snapshot-rows-more-closed">
                  Show All {count} {label}
                </span>
                <span className="snapshot-rows-more-open">Show Fewer {label}</span>
              </summary>
              <div className="rows">{all.slice(first)}</div>
            </details>
          ) : null}
        </>
      ),
    };
  };
  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/mission/synthetic-case', label: 'Made-up visitor visa case' }}
        eyebrow="Working Snapshot"
        title="Version 60"
        description="Captured while IN_PROGRESS · checksum 4f1c0a9e5b7d2c3e8a6f1b0d9c4e7a2f"
      />
      <CollapsibleGroups
        idPrefix="snapshot"
        groups={[
          group('requirements', 'What Satisfies Each Requirement', 'Requirements', 60),
          group('facts', 'Facts at This Snapshot', 'Facts', 40),
          group('documents', 'Documents at This Snapshot', 'Documents', 30),
        ]}
      />
    </section>
  );
}

export default function Sb2Fixture({ view }: Sb2FixtureProps) {
  if (view === 'snapshot' || view === 'snapshot-uncapped') {
    return <SnapshotView capped={view === 'snapshot'} />;
  }
  return <CaseView capped={view === 'case'} />;
}
