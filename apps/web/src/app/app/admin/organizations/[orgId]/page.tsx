import { randomUUID } from 'node:crypto';
import { formatBillingDate, formatBillingDateTime, formatMoney } from '@visastack/core';
import {
  type BillingStatus,
  type Invoice,
  type InvoiceStatus,
  type ManualClaimView,
  getBillingAccountForOrganization,
  getCurrentPlanForOrganization,
  getOrganization,
  getOrganizationRefundWork,
  getPendingDowngradeForOrganization,
  getUsageForOrganization,
  legalBillingTransitions,
  listBillingStatusHistory,
  listCommercialOverridesForOrganization,
  listInvoicesForOrganization,
  listManualClaims,
  listPlans,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader } from '../../../../../components/ui';
import {
  bootstrapAdminEmails,
  isPlatformOwnerAccount,
  staffPrincipal,
} from '../../../../../lib/admin';
import {
  billingHistoryMove,
  billingHistoryReason,
} from '../../../../../lib/billing-history-labels';
import { CLAIM_METHOD_LABELS, CLAIM_STATUS_LABELS } from '../../../../../lib/invoice-labels';
import {
  billingStatusLabel,
  invoiceStatusLabel,
  organizationStatusLabel,
} from '../../../../../lib/labels';
import { refundPorts } from '../../../../../lib/refund-gateway';
import { withSession } from '../../../../../lib/session';
import { formatMeterValue, meterFraction, meterTone } from '../../../../../lib/usage-format';
import {
  ActivatePlanForm,
  ApproveClaimButton,
  CancelDowngradeButton,
  CreateInvoiceForm,
  EndSubscriptionButton,
  GrantOverrideForm,
  OpenBillingAccountForm,
  RecordPaymentForm,
  RejectClaimButton,
  RevokeOverrideButton,
  ScheduleDowngradeForm,
  TransitionBillingStatusForm,
  VoidInvoiceButton,
} from './forms';
import { RefundsCard } from './refund-panel';

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

/** The agency's payment reports: waiting ones first, with the tools to decide, then the last few decisions. */
function ClaimQueue({
  organizationId,
  claims,
}: {
  readonly organizationId: string;
  readonly claims: readonly ManualClaimView[];
}) {
  const waiting = claims.filter((claim) => claim.status === 'SUBMITTED');
  const decided = claims.filter((claim) => claim.status !== 'SUBMITTED').slice(0, 10);
  if (claims.length === 0) return <p className="card-body">No payment reports yet.</p>;
  return (
    <>
      <h3 className="invoice-subhead">Waiting for You</h3>
      {waiting.length === 0 ? (
        <p className="card-body u-mb-100">Nothing is waiting.</p>
      ) : (
        <ul className="invoice-list u-mb-100">
          {waiting.map((claim) => (
            <li key={claim.id} className="invoice-list-item invoice-list-item-block">
              <span className="row-key">{claim.invoiceRef}</span>
              <span>
                {CLAIM_METHOD_LABELS[claim.method]},{' '}
                {formatMoney(claim.amountMinorUnits, claim.currency)}, paid{' '}
                {formatBillingDate(claim.paidOn)}. Reference {claim.reference}.
              </span>
              <span className="muted u-fs-085">
                The invoice still owes{' '}
                {formatMoney(claim.invoiceOutstandingMinorUnits, claim.currency)}.
                {claim.note ? ` Note: ${claim.note}` : ''}
              </span>
              {claim.hasProofFile ? (
                <a
                  className="invoice-link"
                  href={`/api/billing/proof/${organizationId}/${claim.id}`}
                  download
                >
                  Download Proof
                </a>
              ) : null}
              <div className="invoice-action-row">
                <ApproveClaimButton organizationId={organizationId} claimId={claim.id} />
                <RejectClaimButton organizationId={organizationId} claimId={claim.id} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 ? (
        <>
          <h3 className="invoice-subhead">Decided Lately</h3>
          <ul className="invoice-list">
            {decided.map((claim) => (
              <li key={claim.id} className="invoice-list-item">
                <span>
                  {claim.invoiceRef}, {formatMoney(claim.amountMinorUnits, claim.currency)}:{' '}
                  {CLAIM_STATUS_LABELS[claim.status]}
                  {claim.decidedAt ? ` on ${formatBillingDate(claim.decidedAt)}` : ''}
                  {claim.decisionReason ? `. Reason: ${claim.decisionReason}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function invoiceAmount(invoice: Invoice): string {
  return `${formatMoney(invoice.invoicedAmountMinorUnits, invoice.currency)} invoiced, ${formatMoney(invoice.collectedAmountMinorUnits, invoice.currency)} collected`;
}

export default async function AdminOrganizationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams?: Promise<{ refundPage?: string; refundInvoice?: string }>;
}) {
  const { orgId } = await params;
  const asked = (await searchParams) ?? {};
  const refundPage = Number.parseInt(asked.refundPage ?? '1', 10);

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
      claims,
      overrides,
    ] = await Promise.all([
      listPlans(db),
      getCurrentPlanForOrganization(db, orgId),
      getPendingDowngradeForOrganization(db, orgId),
      getUsageForOrganization(db, actorRead),
      getBillingAccountForOrganization(db, actorRead),
      listBillingStatusHistory(db, actorRead),
      listInvoicesForOrganization(db, actorRead),
      listManualClaims(db, actorRead),
      listCommercialOverridesForOrganization(db, orgId),
    ]);

    // S18: refunds and credits, under the platform owner's own refund scope. The payment port is
    // never made unguarded: an incomplete configuration means "no gateway", never a broken page.
    const { send: sendPort, check: checkPort } = refundPorts();
    const gatewayProvider = sendPort?.provider ?? null;
    const refundScope = await staffPrincipal(
      db,
      { accountId, email, bootstrapEmails: bootstrapAdminEmails() },
      'BILLING_REFUND_MANAGE',
    );
    const refundWork = refundScope.ok
      ? await getOrganizationRefundWork(db, refundScope.value, {
          organizationId: orgId,
          gatewayProvider,
          gatewayMode: sendPort?.mode ?? null,
          page: Number.isFinite(refundPage) ? refundPage : 1,
          invoiceRef: asked.refundInvoice ?? null,
        })
      : undefined;

    return {
      owner: true as const,
      org,
      // S29: only offered agency plans can be given to an agency (Traveller Free never).
      activePlans: allPlans.filter((p) => p.active && p.audience === 'AGENCY'),
      planById: new Map(allPlans.map((p) => [p.id, p])),
      currentPlan,
      pendingDowngrade,
      usage: usage.ok ? usage.value : undefined,
      billing: billing.ok ? billing.value : undefined,
      billingHistory: billingHistory.ok ? billingHistory.value : [],
      invoices: invoices.ok ? invoices.value : [],
      claims: claims.ok ? claims.value : [],
      overrides,
      refundWork: refundWork?.ok ? refundWork.value : undefined,
      // The page is the platform owner's already, so the refund scope fails only while this
      // sign-in has not entered its authenticator code.
      refundProblem: refundScope.ok
        ? undefined
        : 'Refunds and credits need your authenticator code first. Enter it, then open this page again.',
      gatewayAvailable: sendPort !== null,
      checkAvailable: checkPort !== null,
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
      <div className="u-mb-150">
        <Link href="/app/admin/organizations" className="muted u-fs-085">
          ← Organizations
        </Link>
      </div>
      <PageHeader
        eyebrow="Organization Admin"
        title={data.org.name}
        description={<>Status: {organizationStatusLabel(data.org.status)}</>}
      />

      <article className="card u-mb-150">
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Plan &amp; Subscription</h2>
        <p className="card-body u-mb-100">
          {data.currentPlan
            ? `Currently on ${data.currentPlan.name}.`
            : 'No plan is active for this organization yet. Agencies cannot choose a plan themselves: activate one below.'}
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
                {data.planById.get(data.pendingDowngrade.toPlanId)?.name ??
                  'a plan that is no longer listed'}{' '}
                scheduled for {formatBillingDate(data.pendingDowngrade.effectiveAt)}
              </span>
              <span className="muted u-fs-085">{data.pendingDowngrade.reason}</span>
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
          <div className="rows u-mb-125">
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
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem' }}>
          <div style={{ flex: '1 1 18rem' }}>
            <h3 style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
              Activate a Plan
            </h3>
            <ActivatePlanForm organizationId={orgId} plans={data.activePlans} />
          </div>
          {data.currentPlan && !data.pendingDowngrade ? (
            <div style={{ flex: '1 1 18rem' }}>
              <h3 style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>
                Schedule a Downgrade
              </h3>
              <ScheduleDowngradeForm organizationId={orgId} plans={data.activePlans} />
            </div>
          ) : null}
        </div>
        {data.currentPlan ? (
          <div className="u-mt-100">
            <EndSubscriptionButton organizationId={orgId} />
          </div>
        ) : null}
      </article>

      <article className="card u-mb-150">
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Billing</h2>
        {!data.billing ? (
          <>
            <p className="card-body u-mb-100">
              No billing account has been opened for this organization yet.
            </p>
            <OpenBillingAccountForm organizationId={orgId} />
          </>
        ) : (
          <>
            <div className="toolbar u-mb-100">
              <span className={`badge ${BILLING_STATUS_TONE[data.billing.status]}`}>
                {billingStatusLabel(data.billing.status)}
              </span>
            </div>
            {data.billingHistory.length > 0 ? (
              <div className="rows u-mb-125">
                {data.billingHistory.map((h) => (
                  <div className="row" key={h.id}>
                    <span className="row-key">{billingHistoryMove(h.fromStatus, h.toStatus)}</span>
                    <span className="muted u-fs-085">
                      {formatBillingDate(h.createdAt)} ·{' '}
                      {h.actorAccountId === null ? 'VisaStack (automatic)' : 'By a person'} ·{' '}
                      {billingHistoryReason(h.reason)}
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

      <article className="card u-mb-150">
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Invoices</h2>
        {data.invoices.length === 0 ? (
          <p className="card-body u-mb-125">No invoices issued yet.</p>
        ) : (
          <div className="rows u-mb-125">
            {data.invoices.map((invoice) => (
              <div
                className="row"
                key={invoice.id}
                style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
                  <span className="row-key">{invoice.invoiceRef}</span>
                  <span className={`badge ${INVOICE_STATUS_TONE[invoice.status]}`}>
                    {invoiceStatusLabel(invoice.status)}
                  </span>
                </div>
                <span className="muted u-fs-085">
                  {invoiceAmount(invoice)} · due {formatBillingDate(invoice.dueDate)}
                </span>
                <a
                  className="invoice-link"
                  href={`/app/admin/organizations/${orgId}/invoices/${invoice.id}/pdf`}
                >
                  Download Invoice (PDF)
                  <span className="sr-only"> {invoice.invoiceRef}</span>
                </a>
                {invoice.status === 'OPEN' || invoice.status === 'PARTIALLY_PAID' ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '1rem',
                      alignItems: 'flex-start',
                    }}
                  >
                    <RecordPaymentForm
                      organizationId={orgId}
                      invoiceId={invoice.id}
                      currency={invoice.currency}
                      idempotencyKey={randomUUID()}
                    />
                    <VoidInvoiceButton organizationId={orgId} invoiceId={invoice.id} />
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        <h3 style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>Create an Invoice</h3>
        <CreateInvoiceForm organizationId={orgId} plans={data.activePlans} />
      </article>

      <article className="card u-mb-150">
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Payment Reports</h2>
        <p className="card-body u-mb-100">
          Payments the agency says it made another way. Nothing is counted until you confirm it,
          with a fresh sign-in check. A rejection needs a reason the agency will read.
        </p>
        <ClaimQueue organizationId={orgId} claims={data.claims} />
      </article>

      <RefundsCard
        organizationId={orgId}
        work={data.refundWork}
        gatewayAvailable={data.gatewayAvailable}
        checkAvailable={data.checkAvailable}
        latestDate={new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Dhaka',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date())}
        {...(data.refundProblem ? { problem: data.refundProblem } : {})}
      />

      <article className="card">
        <p className="card-kicker">Commerce</p>
        <h2 className="card-title">Commercial Overrides</h2>
        <p className="card-body u-mb-100">
          A time-limited bypass of this organization's commercial capacity caps and any billing
          suspension. Never bypasses security, consent, or release gates.
        </p>
        {data.overrides.length === 0 ? (
          <p className="card-body u-mb-125">No overrides have ever been granted.</p>
        ) : (
          <div className="rows u-mb-125">
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
                    <span className="row-key">Until {formatBillingDateTime(o.expiryAt)}</span>
                    <span className="row-end">
                      <span className={`badge ${tone}`}>{status}</span>
                      {active ? (
                        <RevokeOverrideButton organizationId={orgId} overrideId={o.id} />
                      ) : null}
                    </span>
                  </div>
                  <span className="muted u-fs-085">{o.reason}</span>
                </div>
              );
            })}
          </div>
        )}
        <h3 style={{ fontSize: 'var(--text-small)', marginBottom: '0.5rem' }}>Grant an Override</h3>
        <GrantOverrideForm organizationId={orgId} />
      </article>
    </section>
  );
}
