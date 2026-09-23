import {
  type UsageMeter as UsageMeterData,
  getOrganization,
  getOrganizationBrandingForDisplay,
  getUsageForOrganization,
  mbLabel,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';
import { OrgBrandingHeader } from '../org-branding-header';

export const dynamic = 'force-dynamic';

/**
 * COM-01 (PRD §12 / master directive Part 5 §6): "Show each meter and its
 * definition." Read-only -- this page never gates or alters anything
 * elsewhere in the app; it only displays the entitlement data
 * `getUsageForOrganization` already computes. Plan/subscription management
 * itself (creating plans, activating one for an org) is a platform-owner,
 * step-up-gated action with no UI yet -- deferred to ADM-01, the same
 * "service layer now, admin UI deferred" split already used for NTF-02's
 * `listNotificationsNeedingAttention`/`retryNotification`.
 */

/** Correctly converts an integer count of a currency's smallest unit to a display string, without assuming 2 decimal places (JPY has 0, BHD has 3). */
function formatPrice(priceMinorUnits: number, currency: string): string {
  const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  // `maximumFractionDigits` is typed optional (it's unset when significant-digit
  // rounding is used instead), but 'currency' style always resolves it in
  // practice; 2 is the correct fallback for the common case if it's ever absent.
  const divisor = 10 ** (formatter.resolvedOptions().maximumFractionDigits ?? 2);
  return formatter.format(priceMinorUnits / divisor);
}

function formatMeterValue(meter: UsageMeterData): string {
  const used = meter.key === 'storageBytes' ? mbLabel(meter.used) : `${meter.used}`;
  if (meter.allowed === null) return `${used} used (unlimited)`;
  const allowed = meter.key === 'storageBytes' ? mbLabel(meter.allowed) : `${meter.allowed}`;
  return `${used} of ${allowed} used`;
}

function meterFraction(meter: UsageMeterData): number {
  if (meter.allowed === null || meter.allowed <= 0) return 0;
  return Math.min(1, meter.used / meter.allowed);
}

function meterTone(meter: UsageMeterData): string {
  if (meter.allowed === null) return '';
  if (meter.used >= meter.allowed) return 'meter-full';
  if (meterFraction(meter) >= 0.85) return 'meter-warn';
  return '';
}

export default async function OrgPlanPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const org = await getOrganization(db, orgId);
    if (!org) return null;

    const [usage, branding] = await Promise.all([
      getUsageForOrganization(db, { actorAccountId: accountId, organizationId: orgId }),
      getOrganizationBrandingForDisplay(db, createStorage(db), orgId),
    ]);
    return {
      org,
      branding,
      usage: usage.ok ? usage.value : null,
      error: usage.ok ? null : usage.error.message,
    };
  });

  if (!data) notFound();

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href={`/app/agency/${orgId}`} className="muted" style={{ fontSize: '0.9rem' }}>
          ← {data.org.name}
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '2rem' }}>
        <div>
          <span className="eyebrow">Plan &amp; usage</span>
          <OrgBrandingHeader branding={data.branding} />
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.org.name}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Every entitlement below is plan configuration, not a hardcoded limit -- each meter names
            its own definition and what it currently counts.
          </p>
        </div>
      </div>

      {!data.usage ? (
        <article className="card">
          <p className="card-body">
            {data.error ?? "You don't have access to this organization's plan."}
          </p>
        </article>
      ) : (
        <>
          <article className="card" style={{ marginBottom: '1.5rem' }}>
            <p className="card-kicker">Current plan</p>
            <h2 className="card-title">
              {data.usage.plan ? data.usage.plan.name : 'No plan assigned'}
            </h2>
            {!data.usage.planAssigned || !data.usage.plan ? (
              <p className="card-body">
                No plan has been manually activated for this organization yet -- there is no
                self-serve checkout. Usage below is still real; there is simply no allowance yet to
                compare it against.
              </p>
            ) : (
              <p className="card-body">
                Billing period: {data.usage.plan.periodDays} days.{' '}
                {data.usage.plan.priceMinorUnits !== null && data.usage.plan.currency
                  ? `Price: ${formatPrice(data.usage.plan.priceMinorUnits, data.usage.plan.currency)}.`
                  : 'Price not yet configured by a platform owner.'}
              </p>
            )}
          </article>

          <article className="card">
            <p className="card-kicker">Entitlements</p>
            <h2 className="card-title">Meters</h2>
            <div className="rows" style={{ marginTop: '1rem' }}>
              {data.usage.meters.map((meter) => (
                <div key={meter.key} style={{ marginBottom: '1.25rem' }}>
                  <div className="meter-label">
                    <span>{meter.label}</span>
                    <span>{formatMeterValue(meter)}</span>
                  </div>
                  <div className="meter">
                    <div
                      className={`meter-fill ${meterTone(meter)}`.trim()}
                      style={{ width: `${Math.round(meterFraction(meter) * 100)}%` }}
                    />
                  </div>
                  <p className="muted" style={{ fontSize: '0.8rem', marginTop: '0.35rem' }}>
                    {meter.definition}
                  </p>
                </div>
              ))}
            </div>
          </article>
        </>
      )}
    </section>
  );
}
