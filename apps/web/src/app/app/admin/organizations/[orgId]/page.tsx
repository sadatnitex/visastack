import {
  type BillingStatus,
  type Invoice,
  type InvoiceStatus,
  getBillingAccountForOrganization,
  getCurrentPlanForOrganization,
  getOrganization,
  getPendingDowngradeForOrganization,
  getUsageForOrganization,
  legalBillingTransitions,
  listBillingStatusHistory,
  listCommercialOverridesForOrganization,
  listInvoicesForOrganization,
  listPlans,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../components/ui';
import { bootstrapAdminEmails, isPlatformOwnerAccount } from '../../../../../lib/admin';
import { formatTimestamp, formatTimestampDate } from '../../../../../lib/format-date';
import { withSession } from '../../../../../lib/session';
import {
  formatMeterValue,
  formatPrice,
  meterFraction,
  meterTone,
} from '../../../../../lib/usage-format';
import {
  ActivatePlanForm,
  CancelDowngradeButton,
  CreateInvoiceForm,
  EndSubscriptionButton,
  GrantOverrideForm,
  OpenBillingAccountForm,
  RecordPaymentForm,
  RevokeOverrideButton,
  ScheduleDowngradeForm,
  TransitionBillingStatusForm,
  VoidInvoiceButton,
} from './forms';

export const metadata: Metadata = { title: 'Organization' };

export const dynamic = 'force-dynamic';

/**
 * Per-organization commercial administration (ADM-01, PRD §12 / master
 * directive Part 5 §11): plan assignment, billing status/invoices, and
 * commercial overrides for exactly one organization. Every capability here
 * -- read and write alike -- is platform-owner-exclusive, matching the
 * plan/billing/commercial-override service functions this page is purely a
 * UI on top of (they were built platform-owner-gated, not the broader
 * concern-scoped `hasPlatformPermission` roles, since commercial capacity is
 * a single-owner decision the same way `grantPlatformRole` already is).
 * Linked from the main admin page's Organizations section.
 */

const BILLING_STATUS_TONE: Record<BillingStatus, string> = {
  TRIAL: 'badge-neutral',
  ACTIVE: 'badge-success',
  GRACE: 'badge-warning',
  SUSPENDED: 'badge-danger',
  CLOSED: 'badge-neutral',
};

const INVOICE_STATUS_TONE: Record<InvoiceStatus, string> = {
  OPEN: 'badge-neutral',
  PARTIALLY_PAID: 'badge-warning',
  PAID: 'badge-success',
  VOID: 'badge-danger',
};

function invoiceAmount(invoice: Invoice): string {
  return `${formatPrice(invoice.invoicedAmountMinorUnits, invoice.currency)} invoiced, ${formatPrice(invoice.collectedAmountMinorUnits, invoice.currency)} collected`;
}

export default async function AdminOrganizationPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;

  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformOwnerAccount(db, { accountId, email }))) return { owner: false as const };
    const org = await getOrganization(db, orgId);
    if (!org) return { owner: true as const, org: undefined };

    const actorRead = {
      actorAccountId: accountId,
      organizationId: orgId,
      actorEmail: email,
      bootstrapEmails: bootstrapAdminEmails(),
    };
    const [
      allPlans,
      currentPlan,
      pendingDowngrade,
      usage,
      billing,
      billingHistory,
      invoices,
      overrides,
    ] = await Promise.all([
      listPlans(db),
      getCurrentPlanForOrganization(db, orgId),
      getPendingDowngradeForOrganization(db, orgId),
      getUsageForOrganization(db, actorRead),
      getBillingAccountForOrganization(db, actorRead),
      listBillingStatusHistory(db, actorRead),
      listInvoicesForOrganization(db, actorRead),
      listCommercialOverridesForOrganization(db, orgId),
    ]);

    return {
      owner: true as const,
      org,
      activePlans: allPlans.filter((p) => p.active),
      planById: new Map(allPlans.map((p) => [p.id, p])),
      currentPlan,
      pendingDowngrade,
      usage: usage.ok ? usage.value : undefined,
      billing: billing.ok ? billing.value : undefined,
      billingHistory: billingHistory.ok ? billingHistory.value : [],
      invoices: invoices.ok ? invoices.value : [],
      overrides,
    };
  });

  if (!data.owner) {
    return (
      <section className="section container">
        <article className="card">
          <p className="card-body">
            This area is restricted to platform owners. If you should have access, ask an existing
            platform owner to grant you the role.
          </p>
        </article>
      </section>
    );
  }
  if (!data.org) notFound();

  const now = Date.now();
  const activeOverrides = data.overrides.filter(
    (o) => o.revokedAt === null && o.expiryAt.getTime() > now,
  );

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app/admin/organizations" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Organizations
        </Link>
      </div>
      <PageHeader
        eyebrow="Organization admin"
        title={data.org.name}
        description={<>Status: {data.org.status}</>}
      />

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Plan &amp; subscription</h2>
        <p className="card-body" style={{ marginBottom: '1rem' }}>
          {data.currentPlan
            ? `Currently on ${data.currentPlan.name}.`
            : 'No plan has been manually activated for this organization -- there is no self-serve checkout.'}
        </p>

        {data.pendingDowngrade ? (
          <div
            className="rows"
            style={{
              marginBottom: '1.25rem',
              border: '1px solid var(--border, #ddd)',
              padding: '0.75rem',
              borderRadius: '0.4rem',
            }}
          >
            <div
              className="row"
              style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
            >
              <span className="row-key">
                Downgrade to{' '}
                {data.planById.get(data.pendingDowngrade.toPlanId)?.name ?? 'unknown plan'}{' '}
                scheduled for {data.pendingDowngrade.effectiveAt.toDateString()}
              </span>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                {data.pendingDowngrade.reason}
              </span>
              <div>
                <CancelDowngradeButton
                  organizationId={orgId}
                  downgradeId={data.pendingDowngrade.id}
                />
              </div>
            </div>
          </div>
        ) : null}

        {data.usage ? (
          <div className="rows" style={{ marginBottom: '1.25rem' }}>
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
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
          <div style={{ flex: '1 1 18rem' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Activate a plan</h3>
            <ActivatePlanForm organizationId={orgId} plans={data.activePlans} />
          </div>
          {data.currentPlan && !data.pendingDowngrade ? (
            <div style={{ flex: '1 1 18rem' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Schedule a downgrade</h3>
              <ScheduleDowngradeForm organizationId={orgId} plans={data.activePlans} />
            </div>
          ) : null}
        </div>
        {data.currentPlan ? (
          <div style={{ marginTop: '1rem' }}>
            <EndSubscriptionButton organizationId={orgId} />
          </div>
        ) : null}
      </article>

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Billing</h2>
        {!data.billing ? (
          <>
            <p className="card-body" style={{ marginBottom: '1rem' }}>
              No billing account has been opened for this organization yet.
            </p>
            <OpenBillingAccountForm organizationId={orgId} />
          </>
        ) : (
          <>
            <div className="toolbar" style={{ marginBottom: '1rem' }}>
              <span className={`badge ${BILLING_STATUS_TONE[data.billing.status]}`}>
                {data.billing.status}
              </span>
            </div>
            {data.billingHistory.length > 0 ? (
              <div className="rows" style={{ marginBottom: '1.25rem' }}>
                {data.billingHistory.map((h) => (
                  <div className="row" key={h.id}>
                    <span className="row-key">
                      {h.fromStatus ?? 'opened'} → {h.toStatus}
                    </span>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      {formatTimestampDate(h.createdAt)} · {h.reason}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            <TransitionBillingStatusForm
              organizationId={orgId}
              legalStatuses={legalBillingTransitions(data.billing.status)}
            />
          </>
        )}
      </article>

      <article className="card" style={{ marginBottom: '1.5rem' }}>
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Invoices</h2>
        {data.invoices.length === 0 ? (
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            No invoices issued yet.
          </p>
        ) : (
          <div className="rows" style={{ marginBottom: '1.25rem' }}>
            {data.invoices.map((invoice) => (
              <div
                className="row"
                key={invoice.id}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <span className="row-key">{invoice.invoiceRef}</span>
                  <span className={`badge ${INVOICE_STATUS_TONE[invoice.status]}`}>
                    {invoice.status}
                  </span>
                </div>
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  {invoiceAmount(invoice)} · due {invoice.dueDate.toDateString()}
                </span>
                {invoice.status === 'OPEN' || invoice.status === 'PARTIALLY_PAID' ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '1rem',
                      alignItems: 'flex-start',
                    }}
                  >
                    <RecordPaymentForm organizationId={orgId} invoiceId={invoice.id} />
                    <VoidInvoiceButton organizationId={orgId} invoiceId={invoice.id} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Create an invoice</h3>
        <CreateInvoiceForm organizationId={orgId} plans={data.activePlans} />
      </article>

      <article className="card">
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Commercial overrides</h2>
        <p className="card-body" style={{ marginBottom: '1rem' }}>
          A time-limited bypass of this organization's commercial capacity caps and any billing
          suspension. Never bypasses security, consent, or release gates.
        </p>
        {data.overrides.length === 0 ? (
          <p className="card-body" style={{ marginBottom: '1.25rem' }}>
            No overrides have ever been granted.
          </p>
        ) : (
          <div className="rows" style={{ marginBottom: '1.25rem' }}>
            {data.overrides.map((o) => {
              const active = activeOverrides.some((a) => a.id === o.id);
              const status = o.revokedAt ? 'Revoked' : active ? 'Active' : 'Expired';
              const tone = o.revokedAt
                ? 'badge-neutral'
                : active
                  ? 'badge-success'
                  : 'badge-neutral';
              return (
                <div
                  className="row"
                  key={o.id}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <span className="row-key">Until {formatTimestamp(o.expiryAt)}</span>
                    <span className="row-end">
                      <span className={`badge ${tone}`}>{status}</span>
                      {active ? (
                        <RevokeOverrideButton organizationId={orgId} overrideId={o.id} />
                      ) : null}
                    </span>
                  </div>
                  <span className="muted" style={{ fontSize: '0.8rem' }}>
                    {o.reason}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Grant an override</h3>
        <GrantOverrideForm organizationId={orgId} />
      </article>
    </section>
  );
}
