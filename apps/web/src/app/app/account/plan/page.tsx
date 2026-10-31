import { formatBillingDate, formatMoney } from '@visastack/core';
import {
  AI_DAY_BOUNDARY_NOTE,
  AI_FEATURES,
  AI_TRAVELLER_FEATURE_KEYS,
  type AiFeatureEntitlement,
} from '@visastack/core/ai-features';
import {
  BILLING_TIME_ZONE,
  type OwnRenewal,
  type PersonPurchase,
  type TravellerPlanCatalogue,
  getApplicantEvidenceBytes,
  getOwnPurchase,
  getOwnRenewal,
  getTravellerPlanSummary,
  hasOwnBilling,
  listApplicants,
  listTravellerPlansForSale,
  loadUploadQuotaConfig,
  mbLabel,
  storageLimitsFrom,
  travellerPlansEnabled,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '../../../../components/ui';
import { planFeatureView, readAiUsage } from '../../../../lib/ai-usage';
import { withSession } from '../../../../lib/session';
import { UsageMeter } from '../../applicant/[id]/usage-meter';
import { BuyPlanForm, PayPurchaseForm, RenewalForm } from './plan-forms';

export const metadata: Metadata = { title: 'Plan & Usage' };

export const dynamic = 'force-dynamic';

/** The address parameter that names a purchase to confirm (set by the Get action). */
const PURCHASE_PARAM = 'purchase';
const PLAN_PATH = '/app/account/plan';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One AI feature's rule as a comparison cell. */
function featureWords(rule: AiFeatureEntitlement | undefined): string {
  if (!rule?.included) return 'Not included';
  return rule.dailyLimit === null ? 'No daily limit' : `Up to ${rule.dailyLimit} a day`;
}

/** "30 days", "1 day". */
function days(n: number): string {
  return n === 1 ? '1 day' : `${n} days`;
}

/** The last day a period ending at `end` (exclusive) covers, as people read dates here. */
function lastDay(end: Date): string {
  return formatBillingDate(new Date(end.getTime() - 1), BILLING_TIME_ZONE);
}

/**
 * Traveller Free next to every paid traveller plan on sale (ADR 0025 section 8), as a real table:
 * the price, both storage rules and each AI feature's daily limit, then a Get button per paid plan
 * unless a paid period already covers today.
 */
function ComparePlans({
  catalogue,
  settings,
  buyNote,
}: {
  readonly catalogue: TravellerPlanCatalogue;
  readonly settings: { readonly accountBytes: number; readonly personBytes: number };
  /** Said in place of the Get buttons when buying is not the next step (covered, or renewing). */
  readonly buyNote: string | null;
}) {
  const free = catalogue.free;
  const columns = [
    ...(free
      ? [
          {
            id: 'free',
            name: free.name,
            price: 'Free',
            features: free.features,
            storage: free.storage,
          },
        ]
      : []),
    ...catalogue.offers.map((offer) => ({
      id: offer.id,
      name: offer.name,
      price: `${formatMoney(offer.price.amountMinorUnits, offer.price.currency)} for ${days(offer.periodDays)}`,
      features: offer.features,
      storage: offer.storage,
    })),
  ];
  return (
    <article className="card u-mt-150" aria-labelledby="compare-plans-title">
      <p className="card-kicker">More Room</p>
      <h2 className="card-title" id="compare-plans-title">
        Compare Plans
      </h2>
      <p className="card-body">
        Everything in VisaStack stays free during the beta. A paid plan gives you more room: more
        storage and higher daily limits, for you and everyone you keep a record for. It is paid in
        advance and never charges you again by itself.
      </p>
      <div className="u-mt-100">
        <table className="data-table">
          <caption className="sr-only">Traveller Free and the Paid Plans Side by Side</caption>
          <thead>
            <tr>
              <th scope="col">What You Get</th>
              {columns.map((column) => (
                <th scope="col" key={column.id}>
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Price</th>
              {columns.map((column) => (
                <td key={column.id} data-label={column.name}>
                  {column.price}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Storage for the Whole Account</th>
              {columns.map((column) => (
                <td key={column.id} data-label={column.name}>
                  {mbLabel(column.storage.accountBytes ?? settings.accountBytes)}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row">Storage per Person</th>
              {columns.map((column) => (
                <td key={column.id} data-label={column.name}>
                  {mbLabel(column.storage.personBytes ?? settings.personBytes)}
                </td>
              ))}
            </tr>
            {AI_TRAVELLER_FEATURE_KEYS.map((feature) => (
              <tr key={feature}>
                <th scope="row">{AI_FEATURES[feature].name}</th>
                {columns.map((column) => (
                  <td key={column.id} data-label={column.name}>
                    {featureWords(column.features[feature])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {buyNote ? (
        <p className="card-body u-mt-100">{buyNote}</p>
      ) : (
        <div className="page-actions u-mt-100">
          {catalogue.offers.map((offer) => (
            <BuyPlanForm key={offer.id} planId={offer.id} planName={offer.name} />
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * Renewing the paid plan (ADR 0025 T4): renewed by paying a link each time, never charged by
 * itself. Renew Now opens the renewal to confirm; Stop Renewing cancels it and its reminders.
 */
function RenewalControls({ renewal, now }: { readonly renewal: OwnRenewal; readonly now: Date }) {
  const ended = renewal.paidUntil.getTime() <= now.getTime();
  const until = lastDay(renewal.paidUntil);
  const open = renewal.renews ? renewal.openRenewal : null;
  let words: string;
  if (!renewal.renewable) {
    words = ended
      ? `${renewal.planName} covered you until ${until} and is no longer offered. You can choose another plan below.`
      : `${renewal.planName} is no longer offered, so it ends after ${until}. Nothing is charged, and you can choose another plan then.`;
  } else if (ended && open) {
    words = `${renewal.planName} covered you until ${until}. You can still renew it until ${lastDay(renewal.payableUntil)} and keep it.`;
  } else if (ended && renewal.renews) {
    words = `${renewal.planName} covered you until ${until}. You can get it again below.`;
  } else if (ended) {
    words = `${renewal.planName} covered you until ${until}. Choose Keep Renewing by ${lastDay(renewal.payableUntil)} if you want it back without starting again.`;
  } else if (!renewal.renews) {
    words = `Renewing is off, so ${renewal.planName} ends after ${until}. Nothing is charged.`;
  } else if (open) {
    words = `Your renewal is ready: ${formatMoney(open.amountMinorUnits, open.currency)} for the next period. Pay it before ${until} ends to keep ${renewal.planName} without a break.`;
  } else {
    words = `We remind you 7 days before ${renewal.planName} ends. Nothing is charged unless you pay.`;
  }
  return (
    <div className="u-mt-100">
      <p className="card-body">{words}</p>
      <div className="page-actions u-mt-100">
        {open ? (
          <Link
            className="btn btn-primary"
            href={`${PLAN_PATH}?${PURCHASE_PARAM}=${open.invoiceId}#confirm-purchase-title`}
          >
            Renew Now
          </Link>
        ) : null}
        {renewal.renewable ? <RenewalForm renews={renewal.renews} /> : null}
      </div>
    </div>
  );
}

/** The purchase made with Get, to check before the payment page opens. */
function ConfirmPurchase({
  purchase,
  canBuy,
}: {
  readonly purchase: PersonPurchase | null;
  /** Whether a Get button is shown below (a plan on sale, none covering today). */
  readonly canBuy: boolean;
}) {
  return (
    <article
      className="card u-mt-150"
      aria-labelledby="confirm-purchase-title"
      id="confirm-purchase"
    >
      <p className="card-kicker">Before You Pay</p>
      <h2 className="card-title" id="confirm-purchase-title" tabIndex={-1}>
        Confirm Your Purchase
      </h2>
      {purchase ? (
        <>
          <div className="rows rows-grid u-mt-050">
            <div className="row">
              <span className="row-key">Plan</span>
              <span className="row-val">{purchase.planName}</span>
            </div>
            <div className="row">
              <span className="row-key">Price</span>
              <span className="row-val">
                {formatMoney(purchase.amountMinorUnits, purchase.currency)}
              </span>
            </div>
            <div className="row">
              <span className="row-key">Covers You From</span>
              <span className="row-val">
                {formatBillingDate(purchase.periodStart, BILLING_TIME_ZONE)}
              </span>
            </div>
            <div className="row">
              <span className="row-key">Covers You Until</span>
              <span className="row-val">{lastDay(purchase.periodEnd)}</span>
            </div>
            <div className="row">
              <span className="row-key">Reference</span>
              <span className="row-val">{purchase.invoiceRef}</span>
            </div>
          </div>
          <p className="card-body u-mt-100">
            No automatic charge. We remind you before it ends, and you decide then whether to pay
            again.
          </p>
          <div className="u-mt-100">
            <PayPurchaseForm invoiceId={purchase.invoiceId} />
          </div>
        </>
      ) : (
        <p className="card-body">
          This purchase can no longer be paid. It may already be paid, or its time to pay may be
          over.
          {canBuy ? ' You can start it again below.' : ''}
        </p>
      )}
    </article>
  );
}

/**
 * Plan & Usage for a traveller (owner request 2026-10-31): the plan this traveller is on (a paid
 * traveller plan while a paid period covers now, else Traveller Free, ADR 0025), what it includes,
 * and how much of it is used. While selling is switched on (T3c) it also compares the paid plans on
 * sale with Traveller Free and lets the person buy one for themselves: Get, then confirm, then the
 * payment page. While it is off the page reads as before: there is nothing to choose. The AI rules and today's use come from the same reader as Privacy & Consent; the
 * storage limits are the ones uploads are judged by (the plan's storage rules, else the upload
 * settings). The plan's capacity limits (seats, cases) are agency limits and are not enforced on
 * travellers, so none are shown.
 */
export default async function TravellerPlanPage({
  searchParams,
}: {
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = (await searchParams) ?? {};
  const purchaseValue = query[PURCHASE_PARAM];
  const purchaseParam = typeof purchaseValue === 'string' ? purchaseValue : null;
  const selling = travellerPlansEnabled();
  const data = await withSession(async ({ db, accountId, self }) => {
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
    // Selling (ADR 0025 T3c): only while switched on, and only plans on sale now.
    // Renewing (T4): the person's current paid plan and its renewal, while selling is on.
    // Billing History (T5): linked once there is something of theirs to show, switch or not.
    const [catalogue, purchase, renewal, billing] = await Promise.all([
      selling ? listTravellerPlansForSale(db) : null,
      selling && purchaseParam !== null && ID.test(purchaseParam)
        ? getOwnPurchase(db, self, { invoiceId: purchaseParam })
        : null,
      selling ? getOwnRenewal(db, self) : null,
      hasOwnBilling(db, self),
    ]);
    return { summary, aiUsage, profiles, quota, limits, catalogue, purchase, renewal, billing };
  });
  const { summary, aiUsage, profiles, quota, limits, catalogue, purchase, renewal, billing } = data;
  const now = new Date();
  // Inside the grace week after a paid period, renewing it is the next step, not a new purchase.
  const waitingPlan =
    renewal?.renews && renewal.openRenewal !== null && renewal.paidUntil.getTime() <= now.getTime()
      ? renewal.planName
      : null;
  const renewalWaiting = waitingPlan !== null;
  const usedBytes = profiles.reduce((total, profile) => total + profile.usedBytes, 0);
  const offered = catalogue !== null && catalogue.offers.length > 0;
  // ADR 0025 section 12.2: offered at the moment of need, once, never nagged: when a daily AI limit
  // is reached or storage is mostly used, and only while a plan is on sale and none covers today.
  // Each line only when a plan on sale really gives more of what ran short: its own limit, or the
  // upload setting it follows, above the one this person has now.
  const canUpgrade = offered && summary.paidUntil === null && !renewalWaiting;
  const offers = catalogue?.offers ?? [];
  const moreAccountRoom = offers.some(
    (offer) => (offer.storage.accountBytes ?? quota.maxAccountEvidenceBytes) > limits.accountBytes,
  );
  const morePersonRoom = offers.some(
    (offer) => (offer.storage.personBytes ?? quota.maxApplicantEvidenceBytes) > limits.personBytes,
  );
  const storageTight =
    (moreAccountRoom && usedBytes >= limits.accountBytes * 0.8) ||
    (morePersonRoom && profiles.some((profile) => profile.usedBytes >= limits.personBytes * 0.8));
  const aiLimitReached =
    aiUsage?.some((feature) => {
      if (feature.reason !== 'daily_limit') return false;
      const now = summary.features?.[feature.feature]?.dailyLimit ?? feature.dailyLimit;
      return offers.some((offer) => {
        const rule = offer.features[feature.feature];
        return (
          rule?.included === true &&
          (rule.dailyLimit === null || (now !== null && rule.dailyLimit > now))
        );
      });
    }) ?? false;

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Account"
        title={<>Plan &amp; Usage</>}
        description="Your plan, what it includes and how much of it you have used."
        actions={
          <>
            {billing ? (
              <Link className="btn btn-secondary" href={`${PLAN_PATH}/billing`}>
                Billing History
              </Link>
            ) : null}
            <Link className="btn btn-secondary" href="/app/account">
              Your Account
            </Link>
          </>
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
                {offered
                  ? 'You can compare it with the paid plans below.'
                  : 'Paid plans for travellers are not offered yet, so there is nothing to choose or upgrade.'}
              </p>
            </>
          )}
          {renewal ? <RenewalControls renewal={renewal} now={now} /> : null}
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
          {canUpgrade && storageTight ? (
            <p className="card-body u-mt-100">
              Running out of room? A paid plan gives you more storage.{' '}
              <a href="#compare-plans-title">Compare Plans</a>
            </p>
          ) : null}
        </article>
      </div>

      {selling && purchaseParam !== null ? (
        <ConfirmPurchase purchase={purchase} canBuy={canUpgrade} />
      ) : null}
      {offered && catalogue ? (
        <ComparePlans
          catalogue={catalogue}
          settings={{
            accountBytes: quota.maxAccountEvidenceBytes,
            personBytes: quota.maxApplicantEvidenceBytes,
          }}
          buyNote={
            summary.paidUntil !== null
              ? 'Your paid plan covers today. You can buy again when it ends.'
              : renewalWaiting
                ? `You can still renew ${waitingPlan} above and keep it.`
                : null
          }
        />
      ) : null}

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
          {canUpgrade && aiLimitReached ? (
            <p className="card-body u-mt-050">
              Reached a daily limit? A paid plan gives you higher daily limits.{' '}
              <a href="#compare-plans-title">Compare Plans</a>
            </p>
          ) : null}
        </article>
      ) : null}
    </section>
  );
}
