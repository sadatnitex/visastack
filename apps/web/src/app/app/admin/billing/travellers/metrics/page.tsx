import { formatBillingDate } from '@visastack/core';
import {
  TRAVELLER_HEALTH_UNAVAILABLE,
  type TravellerHealth,
  type TravellerHealthThresholds,
  type TravellerPlanDay,
  type TravellerPlanMetrics,
  travellerPlanHealth,
  travellerPlanMetrics,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader, StatusBadge } from '../../../../../../components/ui';
import { bootstrapAdminEmails, staffPrincipal } from '../../../../../../lib/admin';
import { withSession } from '../../../../../../lib/session';
import { AdminRestricted } from '../../../admin-restricted';
import { TravellerThresholdsForm } from './forms';
import {
  SIGNAL_MEANINGS,
  SIGNAL_NAMES,
  SIGNAL_STATUS_LABELS,
  SIGNAL_STATUS_TONES,
  rateWords,
  signalThreshold,
  signalValue,
  testPaymentsSentence,
} from './labels';

/**
 * Traveller Plan Metrics (ADR 0025 section 12.6, T6): the platform owner's daily counts of the
 * paid traveller plans, the three rates worked out from them, the four health signals of
 * traveller payments, and the thresholds those signals are checked against. Platform owner only
 * (`PLANS_MANAGE`).
 *
 * Counts and dates only: the services return no id, name or email, and this page shows none.
 */

export const metadata: Metadata = { title: 'Traveller Plan Metrics' };

export const dynamic = 'force-dynamic';

const DAYS = 14;

const COUNTS_UNAVAILABLE =
  'Plan & Usage views and Get taps are counted once the database is updated. Until then they show as 0.';

/** The counted columns, in the order the table shows them. */
const COLUMNS: readonly {
  readonly key: keyof Omit<TravellerPlanDay, 'day'>;
  readonly label: string;
}[] = [
  { key: 'views', label: 'Plan & Usage Views' },
  { key: 'getTaps', label: 'Get Taps' },
  { key: 'checkouts', label: 'Checkouts' },
  { key: 'payments', label: 'Payments' },
  { key: 'renewalsMade', label: 'Renewals Made' },
  { key: 'renewalsPaid', label: 'Renewals Paid' },
  { key: 'lapses', label: 'Lapses' },
  { key: 'stops', label: 'Stops' },
  { key: 'refunds', label: 'Refunds' },
];

function DailyCounts({ metrics }: { readonly metrics: TravellerPlanMetrics }) {
  return (
    <table className="data-table u-mb-100">
      <caption className="muted u-fs-085">Traveller Plans by Bangladesh Day, Newest First</caption>
      <thead>
        <tr>
          <th scope="col">Day</th>
          {COLUMNS.map((column) => (
            <th scope="col" key={column.key}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {metrics.days.map((day) => (
          <tr key={day.day}>
            <th scope="row" className="cell-main">
              {formatBillingDate(day.day)}
            </th>
            {COLUMNS.map((column) => (
              <td data-label={column.label} key={column.key}>
                {day[column.key]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="cell-main">
            Total
          </th>
          {COLUMNS.map((column) => (
            <td data-label={column.label} key={column.key}>
              {metrics.totals[column.key]}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

function Rates({ metrics }: { readonly metrics: TravellerPlanMetrics }) {
  const rates = [
    {
      name: 'Conversion',
      rate: metrics.rates.conversion,
      meaning: 'Of the checkouts started, the share that was paid.',
    },
    {
      name: 'Renewal',
      rate: metrics.rates.renewal,
      meaning: 'Of the renewals made, the share that was paid.',
    },
    {
      name: 'Refund',
      rate: metrics.rates.refund,
      meaning: 'Of the payments, the share that was refunded.',
    },
  ];
  return (
    <ul className="rows u-mb-100">
      {rates.map((item) => (
        <li className="row" key={item.name}>
          <span>
            <strong>
              {item.name}: {rateWords(item.rate)}
            </strong>
          </span>
          <span className="muted u-fs-085">{item.meaning}</span>
        </li>
      ))}
    </ul>
  );
}

function Health({ health }: { readonly health: TravellerHealth }) {
  return (
    <article className="card u-mb-150" aria-labelledby="health-title">
      <h2 className="card-title" id="health-title">
        Health
      </h2>
      <p className="card-body u-mb-100">
        Traveller payments now, each checked against its alert threshold. Real money only.
      </p>
      <table className="data-table">
        <caption className="sr-only">Health Signals of Traveller Payments</caption>
        <thead>
          <tr>
            <th scope="col">Signal</th>
            <th scope="col">What It Counts</th>
            <th scope="col">Now</th>
            <th scope="col">Needs Attention When</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {health.signals.map((signal) => (
            <tr key={signal.key}>
              <th scope="row" className="cell-main">
                {SIGNAL_NAMES[signal.key]}
              </th>
              <td data-label="What It Counts">{SIGNAL_MEANINGS[signal.key]}</td>
              <td data-label="Now">{signalValue(signal)}</td>
              <td data-label="Needs Attention When">{signalThreshold(signal)}</td>
              <td data-label="Status">
                <StatusBadge tone={SIGNAL_STATUS_TONES[signal.status]}>
                  {SIGNAL_STATUS_LABELS[signal.status]}
                </StatusBadge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  );
}

/** The platform owner's traveller plan counts, rates, health signals and alert thresholds. */
/** Thresholds typed before a sign-in check, back in the address: used only when all four are whole numbers. */
function typedThresholds(
  query: Record<string, string | string[] | undefined>,
): TravellerHealthThresholds | null {
  const read = (name: string) => {
    const value = query[name];
    return typeof value === 'string' && /^\d{1,4}$/.test(value) ? Number(value) : null;
  };
  const typed = {
    checkoutSuccessMinPercent: read('success'),
    confirmationMaxMinutes: read('minutes'),
    stuckConfirmingMax: read('stuck'),
    needsCheckMax: read('check'),
  };
  return Object.values(typed).every((n) => n !== null)
    ? (typed as unknown as TravellerHealthThresholds)
    : null;
}

export default async function TravellerPlanMetricsPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const typed = typedThresholds((await searchParams) ?? {});
  const now = new Date();
  const data = await withSession(async ({ db, accountId, email }) => {
    const staff = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'PLANS_MANAGE',
    );
    if (!staff.ok) return { kind: 'restricted' as const };
    const [metrics, health] = await Promise.all([
      travellerPlanMetrics(db, staff.value, { days: DAYS, now }),
      travellerPlanHealth(db, staff.value, { now }),
    ]);
    if (!metrics.ok || !health.ok) return { kind: 'restricted' as const };
    return { kind: 'ready' as const, metrics: metrics.value, health: health.value };
  });

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/admin/billing/travellers', label: 'Traveller Billing' }}
        eyebrow="Platform Settings"
        title="Traveller Plan Metrics"
        description="How travellers find, buy, renew and stop their paid plans, day by day, and whether their payments are going through. Only counts are shown, never who."
      />
      {data.kind === 'restricted' ? (
        <AdminRestricted />
      ) : (
        <>
          <article className="card u-mb-150" aria-labelledby="counts-title">
            <h2 className="card-title" id="counts-title">
              Last {DAYS} Days
            </h2>
            {data.metrics.countsAvailable ? null : (
              <output className="notice notice-warn u-mb-100">{COUNTS_UNAVAILABLE}</output>
            )}
            <DailyCounts metrics={data.metrics} />
            <h3 className="card-title">Rates</h3>
            <Rates metrics={data.metrics} />
            <p className="card-body">{testPaymentsSentence(data.metrics.testPayments, DAYS)}</p>
          </article>

          <Health health={data.health} />

          <article className="card u-mb-150" aria-labelledby="thresholds-title">
            <h2 className="card-title" id="thresholds-title">
              Alert Thresholds
            </h2>
            <p className="card-body u-mb-100">
              A health signal shows Needs Attention when it passes its threshold. Saving asks you to
              confirm it is you.
            </p>
            <TravellerThresholdsForm
              thresholds={
                typed ?? {
                  checkoutSuccessMinPercent: data.health.thresholds.checkoutSuccessMinPercent,
                  confirmationMaxMinutes: data.health.thresholds.confirmationMaxMinutes,
                  stuckConfirmingMax: data.health.thresholds.stuckConfirmingMax,
                  needsCheckMax: data.health.thresholds.needsCheckMax,
                }
              }
              available={data.health.thresholds.available}
              unavailableMessage={TRAVELLER_HEALTH_UNAVAILABLE}
            />
          </article>
        </>
      )}
    </section>
  );
}
