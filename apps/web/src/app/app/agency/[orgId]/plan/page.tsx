import { formatBillingDate, formatMoney } from '@visastack/core';
import {
  getPendingDowngradeForOrganization,
  getUsageForOrganization,
  listPlans,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../../components/ui';
import { withSession } from '../../../../../lib/session';
import { formatMeterValue, meterFraction, meterTone } from '../../../../../lib/usage-format';
import { BillingStatusNotice, loadBillingNotice } from '../billing-status-notice';
import { loadOrgAccess } from '../console-data';

export const metadata: Metadata = { title: 'Agency Usage and Billing' };

export const dynamic = 'force-dynamic';

/**
 * COM-01 (PRD §12 / master directive Part 5 §6): "Show each meter and its
 * definition." Read-only -- this page never gates or alters anything
 * elsewhere in the app; it only displays the entitlement data
 * `getUsageForOrganization` already computes. Plan/subscription management
 * itself (creating plans, activating one for an org) is a platform-owner,
 * step-up-gated action -- see `/app/admin/organizations/[orgId]` (ADM-01).
 *
 * This is the "Usage & Billing" section of the agency console (Part 9 UX-01);
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
    if (!usage.ok) {
      return {
        usage: null,
        error: usage.error.message,
        admin: false,
        status: null,
        downgrade: null,
      };
    }
    // Only after the usage read has shown this person belongs to the agency.
    const [access, status, pending] = await Promise.all([
      loadOrgAccess(db, accountId, orgId),
      loadBillingNotice(db, accountId, orgId),
      getPendingDowngradeForOrganization(db, orgId),
    ]);
    const target = pending
      ? (await listPlans(db)).find((plan) => plan.id === pending.toPlanId)
      : undefined;
    return {
      usage: usage.value,
      error: null,
      admin: access?.admin === true,
      status,
      downgrade: pending ? { on: pending.effectiveAt, planName: target?.name ?? null } : null,
    };
  });

  return (
    <>
      <PageHeader
        eyebrow="Usage &amp; Billing"
        title={<>Plan &amp; Usage</>}
        description="Your agency's plan and how much of it is in use. Each limit comes from your plan."
        actions={
          <Link className="btn btn-secondary" href={`/app/agency/${orgId}/plan/invoices`}>
            Invoices
          </Link>
        }
        as="h2"
      />

      <BillingStatusNotice notice={data.status} admin={data.admin} organizationId={orgId} />

      {!data.usage ? (
        <article className="card">
          <p className="card-body">
            {data.error ?? "You don't have access to this organization's plan."}
          </p>
        </article>
      ) : (
        <>
          <article className="card u-mb-150">
            <p className="card-kicker">Current Plan</p>
            <h2 className="card-title">
              {data.usage.plan ? data.usage.plan.name : 'Access Offer Not Recorded'}
            </h2>
            {!data.usage.planAssigned || !data.usage.plan ? (
              <p className="card-body">
                An access offer has not been recorded for this organization. Your measured usage is
                shown below. Record permissions and safety checks still apply.
              </p>
            ) : data.usage.plan.key === 'agency_founding_access' &&
              data.usage.plan.priceMinorUnits === 0 ? (
              <p className="card-body">
                Complimentary during public beta. No payment method is required. Fair-use safeguards
                and private-record permissions still apply. Storage and processing remain subject to
                available capacity.
              </p>
            ) : (
              <p className="card-body">
                Billing period: {data.usage.plan.periodDays} days.{' '}
                {data.usage.plan.priceMinorUnits !== null && data.usage.plan.currency
                  ? `Price: ${formatMoney(data.usage.plan.priceMinorUnits, data.usage.plan.currency)}.`
                  : 'VisaStack has not set a price for this plan yet.'}
              </p>
            )}
            {data.downgrade ? (
              <p className="notice plan-change-notice">
                {data.downgrade.planName
                  ? `Your plan changes to ${data.downgrade.planName} on ${formatBillingDate(data.downgrade.on)}.`
                  : `Your plan changes on ${formatBillingDate(data.downgrade.on)}.`}{' '}
                The new limits apply from that day. Nothing is deleted.
              </p>
            ) : null}
          </article>

          <article className="card">
            <p className="card-kicker">What Your Plan Includes</p>
            <h2 className="card-title">Usage</h2>
            <div className="rows u-mt-100">
              {data.usage.meters.map((meter) => (
                <div key={meter.key} className="u-mb-125">
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
                  <p
                    className="muted"
                    style={{ fontSize: 'var(--text-small)', marginTop: '0.35rem' }}
                  >
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
