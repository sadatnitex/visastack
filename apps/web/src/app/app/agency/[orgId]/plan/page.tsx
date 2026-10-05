import { getUsageForOrganization } from '@visastack/services';
import { withSession } from '../../../../../lib/session';
import {
  formatMeterValue,
  formatPrice,
  meterFraction,
  meterTone,
} from '../../../../../lib/usage-format';

export const dynamic = 'force-dynamic';

/**
 * COM-01 (PRD §12 / master directive Part 5 §6): "Show each meter and its
 * definition." Read-only -- this page never gates or alters anything
 * elsewhere in the app; it only displays the entitlement data
 * `getUsageForOrganization` already computes. Plan/subscription management
 * itself (creating plans, activating one for an org) is a platform-owner,
 * step-up-gated action -- see `/app/admin/organizations/[orgId]` (ADM-01).
 *
 * This is the "Usage & billing" section of the agency console (Part 9 UX-01);
 * the organization header and the section bar come from the console's layout,
 * which also answers for an organization that does not exist.
 */
export default async function OrgPlanPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId }) => {
    const usage = await getUsageForOrganization(db, {
      actorAccountId: accountId,
      organizationId: orgId,
    });
    return {
      usage: usage.ok ? usage.value : null,
      error: usage.ok ? null : usage.error.message,
    };
  });

  return (
    <>
      <div className="toolbar" style={{ marginBottom: '1.5rem' }}>
        <div>
          <span className="eyebrow">Usage &amp; billing</span>
          <h2 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            Plan &amp; usage
          </h2>
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
    </>
  );
}
