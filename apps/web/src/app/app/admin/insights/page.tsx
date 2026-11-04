import { documentTypeName } from '@visastack/core/catalogue';
import {
  type FieldInsightsReport,
  INSIGHT_PERIODS,
  type InsightCell,
  getFieldInsights,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../lib/admin';
import { formatDateOnly } from '../../../../lib/format-date';
import { type SearchParamsRecord, firstParam } from '../../../../lib/paging';
import { withSession } from '../../../../lib/session';
import { AdminNotForRole } from '../admin-restricted';
import {
  CORRECTION_LABELS,
  FUNNEL_LABELS,
  PERIOD_LABELS,
  SOURCE_LABELS,
  UNIT_LABELS,
  cellText,
  hiddenSummary,
} from './insight-labels';

export const metadata: Metadata = { title: 'Field Insights' };

export const dynamic = 'force-dynamic';

/**
 * UMPE P12: Field Insights, the internal quality and coverage report (QUALITY_ADMIN, through the
 * existing FEEDBACK_VIEW permission). Counts only, each with its unit, with small groups and
 * one-agency groups hidden. Every pattern is labelled Observed in VisaStack Cases. There is no
 * approval rate, no chance and no reason for any decision here, by design.
 */

const PATH = '/app/admin/insights';

function Count({ cell }: { readonly cell: InsightCell }) {
  return <span className={cell.shown ? undefined : 'muted'}>{cellText(cell)}</span>;
}

function docName(key: string): string {
  return documentTypeName(key) ?? 'Other Document';
}

function Observed() {
  return <p className="card-kicker">Observed in VisaStack Cases</p>;
}

function Report({ report }: { readonly report: FieldInsightsReport }) {
  const t = report.thresholds;
  const summary = hiddenSummary(report);
  return (
    <>
      <output className="notice u-mb-150">
        Observed in VisaStack Cases from {formatDateOnly(report.from)}. These are counts of what
        people recorded, not official requirements, approval rates or predictions. Deleted cases,
        people and documents are left out.
      </output>

      <article className="card u-mb-150" aria-labelledby="hidden-title">
        <h2 className="card-title" id="hidden-title">
          Hidden Numbers
        </h2>
        <p className="card-body">
          {summary.hidden === 0
            ? 'No number on this page is hidden.'
            : `${summary.hidden} of ${summary.total} numbers on this page are hidden.`}
        </p>
        <p className="card-body">
          To protect people, a number is hidden when it is under {t.minCell}, from fewer than{' '}
          {t.minPeople} people, or more than {Math.round(t.maxShare * 100)} percent from one agency.
          A larger number can also be hidden so a hidden one cannot be worked out from the rest.
        </p>
        {summary.nothingShownYet ? (
          <p className="card-body">
            Nothing can be shown yet because every group is still small. This is expected while the
            pilot is small. Numbers appear as more people use VisaStack.
          </p>
        ) : null}
      </article>

      <article className="card u-mb-150" aria-labelledby="funnel-title">
        <Observed />
        <h2 className="card-title" id="funnel-title">
          Case Journey
        </h2>
        <p className="card-body">
          Each stage is counted on its own, in its own unit. A prepared package is not a submission,
          an answer to an agency is not a submission to an authority, and an agency&apos;s
          acceptance is not a visa decision.
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Stage</th>
              <th scope="col">Counted As</th>
              <th scope="col">Count</th>
            </tr>
          </thead>
          <tbody>
            {report.funnel.map((row) => (
              <tr key={row.key}>
                <th scope="row">{FUNNEL_LABELS[row.key]}</th>
                <td>{UNIT_LABELS[row.unit]}</td>
                <td>
                  <Count cell={row.cell} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <article className="card u-mb-150" aria-labelledby="missing-title">
        <Observed />
        <h2 className="card-title" id="missing-title">
          Decisions Not Yet Recorded
        </h2>
        <dl className="rows">
          <div className="row">
            <dt className="row-key">Reported as Submitted to Authority</dt>
            <dd>
              <Count cell={report.missingOutcome.reported} />
            </dd>
          </div>
          <div className="row">
            <dt className="row-key">No Decision Recorded (Unknown)</dt>
            <dd>
              <Count cell={report.missingOutcome.unknown} />
            </dd>
          </div>
          <div className="row">
            <dt className="row-key">Reported as Still Waiting</dt>
            <dd>
              <Count cell={report.missingOutcome.pending} />
            </dd>
          </div>
        </dl>
      </article>

      <article className="card u-mb-150" aria-labelledby="route-title">
        <Observed />
        <h2 className="card-title" id="route-title">
          Attempts by Route and Quarter
        </h2>
        <p className="card-body">
          Routes and quarters with too few attempts are not listed, so a rare route stays private.
        </p>
        {report.byRouteAndPeriod.length === 0 ? (
          <p className="card-body">No route and quarter has enough attempts to show.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Route</th>
                <th scope="col">Quarter</th>
                <th scope="col">Attempts</th>
              </tr>
            </thead>
            <tbody>
              {report.byRouteAndPeriod.map((row) => (
                <tr key={`${row.route ?? ''}-${row.period}`}>
                  <th scope="row">{row.route ?? 'No Checklist Record'}</th>
                  <td>{row.period}</td>
                  <td>
                    <Count cell={row.attempts} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>

      <article className="card u-mb-150" aria-labelledby="requests-title">
        <Observed />
        <h2 className="card-title" id="requests-title">
          What Authorities Asked For
        </h2>
        <p className="card-body">
          Requests for more that people recorded after an attempt. An agency&apos;s correction
          request is never counted here.
        </p>
        <dl className="rows u-mb-100">
          <div className="row">
            <dt className="row-key">Requests Recorded</dt>
            <dd>
              <Count cell={report.authorityRequests.total} />
            </dd>
          </div>
          {report.authorityRequests.bySource.map((row) => (
            <div className="row" key={row.source}>
              <dt className="row-key">{SOURCE_LABELS[row.source] ?? 'Other Official Office'}</dt>
              <dd>
                <Count cell={row.cell} />
              </dd>
            </div>
          ))}
        </dl>
        <h3 className="card-title">Most Requested Documents</h3>
        {report.authorityRequests.byDocType.length === 0 ? (
          <p className="card-body">None recorded in this period.</p>
        ) : (
          <dl className="rows">
            {report.authorityRequests.byDocType.map((row) => (
              <div className="row" key={row.docType}>
                <dt className="row-key">{docName(row.docType)}</dt>
                <dd>
                  <Count cell={row.cell} />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </article>

      <article className="card u-mb-150" aria-labelledby="gaps-title">
        <Observed />
        <h2 className="card-title" id="gaps-title">
          Checklist Coverage Gaps
        </h2>
        <p className="card-body">
          Documents an authority asked for that were not on the checklist the attempt used. This is
          a reason to check the official source, never a rule: a checklist changes only through a
          reviewed official source.
        </p>
        <dl className="rows u-mb-100">
          <div className="row">
            <dt className="row-key">Requests Compared with a Checklist</dt>
            <dd>
              <Count cell={report.coverageGaps.requestsCompared} />
            </dd>
          </div>
          <div className="row">
            <dt className="row-key">Requests with No Checklist Record</dt>
            <dd>
              <Count cell={report.coverageGaps.requestsWithoutChecklist} />
            </dd>
          </div>
          {report.coverageGaps.byDocType.map((row) => (
            <div className="row" key={row.docType}>
              <dt className="row-key">{docName(row.docType)}</dt>
              <dd>
                <Count cell={row.cell} />
              </dd>
            </div>
          ))}
        </dl>
      </article>

      <article className="card u-mb-150" aria-labelledby="corrections-title">
        <Observed />
        <h2 className="card-title" id="corrections-title">
          Correction Causes
        </h2>
        <dl className="rows">
          {report.correctionCauses.checklistSuggestions.map((row) => (
            <div className="row" key={row.category}>
              <dt className="row-key">
                Checklist Suggestion: {CORRECTION_LABELS[row.category] ?? 'Other Reason'}
              </dt>
              <dd>
                <Count cell={row.cell} />
              </dd>
            </div>
          ))}
          <div className="row">
            <dt className="row-key">Agency Asked for a Correction</dt>
            <dd>
              <Count cell={report.correctionCauses.agencyCorrectionRequests} />
            </dd>
          </div>
        </dl>
      </article>

      <article className="card u-mb-150" aria-labelledby="quality-title">
        <h2 className="card-title" id="quality-title">
          Data Quality
        </h2>
        <dl className="rows u-mb-100">
          <div className="row">
            <dt className="row-key">Older Submission Reports Not Tracked as Attempts</dt>
            <dd>
              <Count cell={report.dataQuality.olderReportsNotAttempts} />
            </dd>
          </div>
          <div className="row">
            <dt className="row-key">Attempts Without a Package Record</dt>
            <dd>
              <Count cell={report.dataQuality.attemptsWithoutPackageRecord} />
            </dd>
          </div>
          <div className="row">
            <dt className="row-key">Case Decisions Not Tied to an Attempt</dt>
            <dd>
              <Count cell={report.dataQuality.caseDecisionsNotTiedToAttempt} />
            </dd>
          </div>
        </dl>
        <p className="card-body">
          People choose what to record, so these counts lean toward cases whose owners came back.
          Decisions are what people reported; a decision document means one was attached, not that
          anyone checked it. Older reports count as Unknown and are never given a made-up decision.
        </p>
      </article>
    </>
  );
}

export default async function FieldInsightsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  const params = await searchParams;
  const { period: periodParam } = params;
  const asked = Number(firstParam(periodParam) ?? '12');
  const period = (INSIGHT_PERIODS as readonly number[]).includes(asked) ? asked : 12;
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'FEEDBACK_VIEW',
    );
    if (!staff.ok) return { kind: 'restricted' as const };
    const report = await getFieldInsights(db, staff.value, { periodMonths: period });
    if (!report.ok) return { kind: 'restricted' as const };
    return { kind: 'ready' as const, report: report.value };
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin', label: 'Platform' }}
        eyebrow="Quality"
        title="Field Insights"
        description="What happened in VisaStack cases, counted with care: for finding confusing steps and checklist gaps, never for predicting a decision."
      />
      {data.kind === 'restricted' ? (
        <AdminNotForRole needs="a Quality Admin or a platform owner" />
      ) : (
        <>
          <nav aria-label="Period" className="u-mb-150">
            <ul className="insights-periods">
              {INSIGHT_PERIODS.map((p) => (
                <li key={p}>
                  <Link
                    href={`${PATH}?period=${p}`}
                    className={
                      p === period ? 'btn btn-primary btn-compact' : 'btn btn-secondary btn-compact'
                    }
                    aria-current={p === period ? 'page' : undefined}
                  >
                    {PERIOD_LABELS[p]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <Report report={data.report} />
        </>
      )}
    </section>
  );
}
