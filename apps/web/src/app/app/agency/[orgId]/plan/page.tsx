import {
  getOrganization,
  getOrganizationBrandingForDisplay,
  getUsageForOrganization,
} from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { withSession } from '../../../../../lib/session';
import { createStorage } from '../../../../../lib/storage';
import {
  formatMeterValue,
  formatPrice,
  meterFraction,
  meterTone,
} from '../../../../../lib/usage-format';
import { OrgBrandingHeader } from '../org-branding-header';

export const dynamic = 'force-dynamic';

/**
 * COM-01 (PRD §12 / master directive Part 5 §6): "Show each meter and its
 * definition." Read-only -- this page never gates or alters anything
 * elsewhere in the app; it only displays the entitlement data
 * `getUsageForOrganization` already computes. Plan/subscription management
 * itself (creating plans, activating one for an org) is a platform-owner,
 * step-up-gated action -- see `/app/admin/organizations/[orgId]` (ADM-01).
 */

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
