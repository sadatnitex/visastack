import { randomBytes } from 'node:crypto';
import {
  type AnswerAgencyGroup,
  type EvidenceAnswerPlan,
  type EvidenceAnswerReceipt,
  accountPrincipal,
  getApplicant,
  planEvidenceAnswers,
  readEvidenceAnswerReceipt,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader } from '../../../../../../components/ui';
import { evidenceAnswerCatalog } from '../../../../../../i18n/evidence-answer';
import { getServerT, primeLocale } from '../../../../../../lib/i18n-server';
import { firstParam } from '../../../../../../lib/paging';
import { withSession } from '../../../../../../lib/session';
import { AnswerSetForm } from './answer-set-form';
import { answerPlanKey, buildAnswerReview } from './answer-view';
import { AnswersSent } from './answers-sent';

export const metadata: Metadata = { title: 'Answer from Your Records' };

export const dynamic = 'force-dynamic';

/** The address parameters: the agency being answered, and the confirmation whose receipt to show. */
const AGENCY_KEY = 'agency';
const DONE_KEY = 'done';

/** What the page read: the plan and, when the address asks for one, the receipt. */
type Read = {
  readonly applicant: { readonly displayName: string; readonly timezone: string };
  /** Null when the plan could not be read: the page says so, never "nothing is waiting". */
  readonly plan: EvidenceAnswerPlan | null;
  readonly receipt: EvidenceAnswerReceipt | null;
};

/**
 * The agency being answered: the one the address names, or, when the address names none, the only
 * one that is waiting. Never a guess: an address that names an agency with nothing waiting (for
 * example right after everything it asked for was sent) is never answered with another agency.
 */
function chooseAgency(
  plan: EvidenceAnswerPlan,
  requested: string | undefined,
): AnswerAgencyGroup | undefined {
  if (requested) {
    return plan.agencies.find(
      (group) => group.organizationId.toLowerCase() === requested.toLowerCase(),
    );
  }
  return plan.agencies.length === 1 ? plan.agencies[0] : undefined;
}

export default async function AnswerFromRecordsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  /** `agency`: the organization to answer. `done`: the confirmation key whose receipt to show. */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await primeLocale();
  const t = getServerT(evidenceAnswerCatalog);
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const requestedAgency = firstParam(search[AGENCY_KEY]);
  const doneKey = firstParam(search[DONE_KEY]);

  const data = await withSession(async ({ db, accountId }): Promise<Read | null> => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const who = { displayName: applicant.displayName, timezone: applicant.timezone };
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId: id },
      { purpose: 'self' },
    );
    if (!access.ok) return { applicant: who, plan: null, receipt: null };
    const planned = await planEvidenceAnswers(access.value);
    if (!planned.ok) return { applicant: who, plan: null, receipt: null };
    const plan = planned.value;
    // A receipt is for the agency the address names, which may have nothing left waiting after
    // the answers went; with no agency in the address, for the only one that waits.
    const organizationId = requestedAgency ?? chooseAgency(plan, undefined)?.organizationId;
    const receipt =
      doneKey && organizationId
        ? await readEvidenceAnswerReceipt(access.value, {
            organizationId,
            confirmationKey: doneKey,
          })
        : null;
    return { applicant: who, plan, receipt: receipt?.ok ? receipt.value : null };
  });
  if (!data) notFound();

  const base = `/app/applicant/${id}/evidence`;
  const header = (backToList: boolean) => (
    <PageHeader
      eyebrow={data.applicant.displayName}
      title={t('evidenceAnswer.page.title')}
      back={{
        href: backToList ? `${base}/answer` : base,
        label: backToList ? t('evidenceAnswer.page.allAgencies') : t('evidenceAnswer.page.back'),
      }}
    />
  );

  if (!data.plan) {
    // A failed read never claims nothing is waiting: something may be.
    return (
      <>
        {header(false)}
        <article className="card lc-empty-host">
          <p className="notice notice-warn u-m-0" role="alert">
            {t.node('evidenceAnswer.page.unreadable')}
          </p>
        </article>
      </>
    );
  }
  const { plan, receipt } = data;
  if (!plan.available) {
    return (
      <>
        {header(false)}
        <article className="card lc-empty-host">
          <p className="notice notice-warn u-m-0">{t.node('evidenceAnswer.page.unavailable')}</p>
          <p className="u-m-0">
            <Link className="btn btn-secondary" href={base}>
              {t.node('evidenceAnswer.page.requestsLink')}
            </Link>
          </p>
        </article>
      </>
    );
  }

  const selected = chooseAgency(plan, requestedAgency);
  const received = receipt ? (
    <AnswersSent receipt={receipt} timeZone={data.applicant.timezone} />
  ) : null;
  const more = plan.more ? (
    <p className="muted">
      {t.node('evidenceAnswer.page.more')}{' '}
      <Link href={base}>{t.node('evidenceAnswer.page.requestsLink')}</Link>
    </p>
  ) : null;

  if (plan.agencies.length === 0) {
    return (
      <>
        {header(false)}
        {received}
        <article className="card lc-empty-host">
          <EmptyState
            icon="clipboard"
            title={t('evidenceAnswer.page.emptyTitle')}
            fold
            action={{ href: base, label: t('evidenceAnswer.page.requestsLink') }}
          >
            {t.node('evidenceAnswer.page.emptyBody')}
          </EmptyState>
        </article>
      </>
    );
  }

  if (!selected) {
    return (
      <>
        {header(false)}
        {received}
        <article className="card">
          <h2 className="card-title">{t.node('evidenceAnswer.page.pickTitle')}</h2>
          <div className="rows">
            {plan.agencies.map((group) => {
              const ready = group.items.filter((item) => item.readiness === 'READY').length;
              return (
                <div key={group.organizationId} className="row">
                  <div className="answer-other-text">
                    <span className="row-key" data-value>
                      {group.organizationName}
                    </span>
                    <span className="evidence-pick-meta" data-value>
                      {t.node('evidenceAnswer.page.pickSummary', {
                        waiting: group.items.length,
                        ready,
                      })}
                    </span>
                  </div>
                  <Link
                    className="btn btn-secondary"
                    href={`${base}/answer?${AGENCY_KEY}=${encodeURIComponent(group.organizationId)}`}
                  >
                    {t.node('evidenceAnswer.page.reviewAnswers')}
                    <span className="sr-only">: {group.organizationName}</span>
                  </Link>
                </div>
              );
            })}
          </div>
        </article>
        {more}
      </>
    );
  }

  const review = buildAnswerReview(selected, { timeZone: data.applicant.timezone, locale });
  return (
    <>
      {header(plan.agencies.length > 1)}
      {received}
      <article className="card">
        <h2 className="card-title">
          {t.node('evidenceAnswer.page.agencyHeading', {
            agency: selected.organizationName,
            count: selected.items.length,
          })}
        </h2>
        <AnswerSetForm
          // A changed plan starts the form afresh, with a new confirmation key.
          key={answerPlanKey(selected)}
          applicantId={id}
          organizationId={selected.organizationId}
          agencyName={selected.organizationName}
          confirmationKey={randomBytes(18).toString('base64url')}
          review={review}
          timeZone={data.applicant.timezone}
        />
      </article>
      {more}
    </>
  );
}
