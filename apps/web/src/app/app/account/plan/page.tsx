import { formatBillingDate } from '@visastack/core';
import { AI_DAY_BOUNDARY_NOTE } from '@visastack/core/ai-features';
import {
  BILLING_TIME_ZONE,
  getApplicantEvidenceBytes,
  getTravellerPlanSummary,
  listApplicants,
  loadUploadQuotaConfig,
  mbLabel,
  storageLimitsFrom,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { planFeatureView, readAiUsage } from '../../../../lib/ai-usage';
import { withSession } from '../../../../lib/session';
import { UsageMeter } from '../../applicant/[id]/usage-meter';

export const metadata: Metadata = { title: 'Plan & Usage' };

export const dynamic = 'force-dynamic';

/**
 * Plan & Usage for a traveller (owner request 2026-10-31): the plan this traveller is on (a paid
 * traveller plan while a paid period covers now, else Traveller Free, ADR 0025), what it includes,
 * and how much of it is used. Read-only: no paid plan is offered yet, so there is nothing to
 * choose here. The AI rules and today's use come from the same reader as Privacy & Consent; the
 * storage limits are the ones uploads are judged by (the plan's storage rules, else the upload
 * settings). The plan's capacity limits (seats, cases) are agency limits and are not enforced on
 * travellers, so none are shown.
 */
export default async function TravellerPlanPage() {
  const data = await withSession(async ({ db, accountId }) => {
    const [summary, aiUsage, owned] = await Promise.all([
      getTravellerPlanSummary(db, { actorAccountId: accountId }),
      readAiUsage(db, accountId),
      listApplicants(db, accountId),
    ]);
    // Only the profiles this account owns, counted exactly as the upload limits count them.
    const profiles = await Promise.all(
      owned.map(async (applicant) => ({
        applicantId: applicant.id,
        displayName: applicant.displayName,
        usedBytes: await getApplicantEvidenceBytes(db, applicant.id),
      })),
    );
    const quota = loadUploadQuotaConfig();
    // This account's limits: its plan's storage rules, else the upload settings (ADR 0025).
    const limits = storageLimitsFrom(summary.storage, quota);
    return { summary, aiUsage, profiles, quota, limits };
  });
  const { summary, aiUsage, profiles, quota, limits } = data;
  const usedBytes = profiles.reduce((total, profile) => total + profile.usedBytes, 0);

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Account"
        title={<>Plan &amp; Usage</>}
        description="Your plan, what it includes and how much of it you have used."
        actions={
          <Link className="btn btn-secondary" href="/app/account">
            Your Account
          </Link>
        }
      />

      <div className="grid">
        <article className="card" aria-labelledby="current-plan-title">
          <p className="card-kicker">Current Plan</p>
          <h2 className="card-title" id="current-plan-title">
            {summary.plan?.name ?? 'Your Plan'}
          </h2>
          {summary.paidUntil ? (
            <p className="card-body">
              Paid until {formatBillingDate(summary.paidUntil, BILLING_TIME_ZONE)}. Fair-use
              safeguards and your privacy permissions still apply.
            </p>
          ) : (
            <>
              <p className="card-body">
                Complimentary during public beta. No payment method is required. Fair-use safeguards
                and your privacy permissions still apply.
              </p>
              <p className="card-body u-mt-100">
                Paid plans for travellers are not offered yet, so there is nothing to choose or
                upgrade.
              </p>
            </>
          )}
        </article>

        <article className="card" aria-labelledby="storage-title">
          <p className="card-kicker">What Your Plan Includes</p>
          <h2 className="card-title" id="storage-title">
            Storage
          </h2>
          <p className="card-body u-mb-125">
            Every saved version of every document counts. Each file can be up to{' '}
            {mbLabel(quota.maxUploadBytes)}.
          </p>
          <div className="stack-sm u-mb-125">
            <UsageMeter
              label="Your Whole Account"
              usedBytes={usedBytes}
              limitBytes={limits.accountBytes}
            />
            {profiles.map((profile) => (
              <UsageMeter
                key={profile.applicantId}
                label={profile.displayName}
                usedBytes={profile.usedBytes}
                limitBytes={limits.personBytes}
              />
            ))}
          </div>
          {profiles.length === 0 ? (
            <p className="muted u-fs-085">Nothing stored yet.</p>
          ) : (
            <p className="muted u-fs-085">
              Each person you keep a record for can hold up to {mbLabel(limits.personBytes)}. When
              you share a record with an agency, that agency's own plan can also limit what more can
              be added to it.
            </p>
          )}
        </article>
      </div>

      {aiUsage ? (
        <article className="card u-mt-150" aria-labelledby="plan-ai-title">
          <p className="card-kicker">What Your Plan Includes</p>
          <h2 className="card-title" id="plan-ai-title">
            AI Features
          </h2>
          <p className="card-body">
            Whether your plan includes each feature, whether it works right now, and how much you
            used it today. Only the number is kept, never what was read. Everything in VisaStack
            works without these features.
          </p>
          <div className="rows rows-grid u-mt-050">
            {aiUsage.map((feature) => {
              const view = planFeatureView(feature, summary.features?.[feature.feature]);
              return (
                <div className="row" key={feature.feature}>
                  <span className="row-key">{feature.name}</span>
                  <span className="row-val">
                    <span className={`badge ${view.inPlan ? 'badge-success' : 'badge-neutral'}`}>
                      {view.inPlan ? 'In Your Plan' : 'Not in Your Plan'}
                    </span>{' '}
                    {view.now ? (
                      <span className={`badge ${view.now.tone}`}>
                        <span className="sr-only">Now: </span>
                        {view.now.label}
                      </span>
                    ) : null}
                  </span>
                  {view.detail ? <span className="muted u-fs-085">{view.detail}</span> : null}
                  {view.offSentence ? (
                    <span className="muted u-fs-085">{view.offSentence}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className="muted u-fs-085 u-mt-050">
            {AI_DAY_BOUNDARY_NOTE} Turn AI features on or off under{' '}
            <Link href="/app#permissions">Permissions You Control on Home</Link>.
          </p>
        </article>
      ) : null}
    </section>
  );
}
