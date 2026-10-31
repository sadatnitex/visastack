import { AI_DAY_BOUNDARY_NOTE } from '@visastack/core/ai-features';
import {
  type AiUsageToday,
  getTravellerPlanSummary,
  loadUploadQuotaConfig,
  mbLabel,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { readAiUsage, usageLine } from '../../../../lib/ai-usage';
import { withSession } from '../../../../lib/session';
import { UsageMeter } from '../../applicant/[id]/usage-meter';

export const metadata: Metadata = { title: 'Plan & Usage' };

export const dynamic = 'force-dynamic';

/** What the plan gives for one AI feature today, in the traveller's words. */
function featureStatus(feature: AiUsageToday): { readonly label: string; readonly tone: string } {
  if (feature.available) return { label: 'Included', tone: 'badge-success' };
  switch (feature.reason) {
    case 'daily_limit':
      return { label: 'Limit Reached Today', tone: 'badge-warning' };
    case 'not_in_plan':
      return { label: 'Not in Your Plan', tone: 'badge-neutral' };
    default:
      return { label: 'Off for Now', tone: 'badge-neutral' };
  }
}

/** "No daily limit" or "Up to 15 a day", for a feature the plan includes. */
function limitWords(feature: AiUsageToday): string | null {
  if (feature.reason === 'not_in_plan') return null;
  return feature.dailyLimit === null ? 'No daily limit' : `Up to ${feature.dailyLimit} a day`;
}

/**
 * Plan & Usage for a traveller (owner request 2026-10-31): the plan every traveller is on, what it
 * includes, and how much of it is used. Read-only. Travellers have one plan (Traveller Free;
 * Founding Access is complimentary, PRODUCT-CONTRACT) and no paid plans, so there is nothing to
 * choose here. The AI rules and today's use come from the same reader as Privacy & Consent; the
 * storage limits are the upload limits that apply to every traveller. The plan's capacity limits
 * (seats, cases) are agency limits and are not enforced on travellers, so none are shown.
 */
export default async function TravellerPlanPage() {
  const data = await withSession(async ({ db, accountId }) => {
    const [summary, aiUsage] = await Promise.all([
      getTravellerPlanSummary(db, { actorAccountId: accountId }),
      readAiUsage(db, accountId),
    ]);
    return { summary, aiUsage };
  });
  const quota = loadUploadQuotaConfig();
  const { summary, aiUsage } = data;

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
            {summary.plan?.name ?? 'Founding Access'}
          </h2>
          <p className="card-body">
            Complimentary during public beta. No payment method is required. Fair-use safeguards and
            your privacy permissions still apply.
          </p>
          <p className="card-body u-mt-100">
            There are no paid plans for travellers, so there is nothing to choose or upgrade.
          </p>
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
              usedBytes={summary.usedBytes}
              limitBytes={quota.maxAccountEvidenceBytes}
            />
            {summary.profiles.map((profile) => (
              <UsageMeter
                key={profile.applicantId}
                label={profile.displayName}
                usedBytes={profile.usedBytes}
                limitBytes={quota.maxApplicantEvidenceBytes}
              />
            ))}
          </div>
          {summary.profiles.length === 0 ? (
            <p className="muted u-fs-085">Nothing stored yet.</p>
          ) : (
            <p className="muted u-fs-085">
              Each person you keep a record for can hold up to{' '}
              {mbLabel(quota.maxApplicantEvidenceBytes)}.
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
            Each feature, whether your plan includes it, and how much you used it today. Only the
            number is kept, never what was read. Everything in VisaStack works without these
            features.
          </p>
          <div className="rows rows-grid u-mt-050">
            {aiUsage.map((feature) => {
              const status = featureStatus(feature);
              const limit = limitWords(feature);
              return (
                <div className="row" key={feature.feature}>
                  <span className="row-key">{feature.name}</span>
                  <span className="row-val">
                    <span className={`badge ${status.tone}`}>{status.label}</span>
                  </span>
                  <span className="muted u-fs-085">
                    {limit ? `${limit}. ` : ''}
                    {usageLine(feature)}.
                  </span>
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
