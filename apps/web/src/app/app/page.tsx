import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type MessageKey, createTranslator } from '@visastack/i18n';
import {
  type Db,
  getConsents,
  listApplicants,
  listDocuments,
  listEvidenceRequestsForApplicant,
  listGrantsForRecipientAccount,
  listMissions,
  listPendingProposals,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AttentionList,
  Checklist,
  Disclosure,
  EmptyState,
  NextStepCard,
  StatusBadge,
} from '../../components/ui';
import { getLocale } from '../../lib/locale';
import { withSession } from '../../lib/session';
import { ConsentButton } from './consent-button';

export const metadata: Metadata = { title: 'Overview' };

export const dynamic = 'force-dynamic';

const CONSENT_MESSAGE_KEYS: Record<ConsentType, MessageKey> = {
  CORE_PROCESSING: 'consent.core.title',
  AI_EXTRACTION: 'consent.ai.title',
  AI_OCR: 'consent.ocr.title',
  SHARING: 'consent.sharing.title',
  MARKETING: 'consent.marketing.title',
  ISSUER_CONTACT: 'consent.issuerContact.title',
};

/** Terminal mission states never count toward "active". */
const TERMINAL_MISSION_STATES = new Set(['CLOSED', 'CANCELLED']);

interface AttentionItem {
  readonly href: string;
  readonly applicantName: string;
  readonly label: string;
  readonly why: string;
  readonly action: string;
  readonly count: number;
}

async function loadDashboard(db: Db, accountId: string, email: string) {
  const [consents, incomingGrants, applicants] = await Promise.all([
    getConsents(db, accountId),
    listGrantsForRecipientAccount(db, accountId),
    listApplicants(db, accountId),
  ]);

  const perApplicant = await Promise.all(
    applicants.map(async (applicant) => {
      const [docs, proposals, missions, evidenceRequests] = await Promise.all([
        listDocuments(db, accountId, applicant.id),
        listPendingProposals(db, applicant.id),
        listMissions(db, accountId, applicant.id),
        listEvidenceRequestsForApplicant(db, accountId, applicant.id),
      ]);
      const activeMissions = missions.ok
        ? missions.value.filter((m) => !TERMINAL_MISSION_STATES.has(m.state)).length
        : 0;
      const openRequests = evidenceRequests.ok
        ? evidenceRequests.value.filter((r) => r.status === 'OPEN').length
        : 0;
      return {
        applicant,
        documentCount: docs.ok ? docs.value.length : 0,
        pendingProposals: proposals.length,
        activeMissions,
        openRequests,
      };
    }),
  );

  const attention: AttentionItem[] = [];
  for (const row of perApplicant) {
    if (row.openRequests > 0) {
      attention.push({
        href: `/app/applicant/${row.applicant.id}/evidence`,
        applicantName: row.applicant.displayName,
        label: 'Evidence requests waiting for a reply',
        why: 'An agency has asked for a document. Reply with a file from your documents.',
        action: 'Open requests',
        count: row.openRequests,
      });
    }
    if (row.pendingProposals > 0) {
      attention.push({
        href: `/app/applicant/${row.applicant.id}/documents`,
        applicantName: row.applicant.displayName,
        label: 'Suggested details waiting for your decision',
        why: 'Details were read from a document. Nothing is added to the profile until you approve it.',
        action: 'Review suggestions',
        count: row.pendingProposals,
      });
    }
  }
  const pendingGrants = incomingGrants.filter(
    (g) => g.grant.status === 'PENDING_ACCEPTANCE',
  ).length;
  if (pendingGrants > 0) {
    attention.push({
      href: '/app/shared',
      applicantName: '',
      label: 'Sharing invitations waiting for your answer',
      why: 'Someone wants to share their information with you. Nothing is shared until you accept.',
      action: 'See invitations',
      count: pendingGrants,
    });
  }

  return {
    email,
    consents,
    applicants,
    perApplicant,
    attention,
  };
}

export default async function AppPage() {
  const locale = await getLocale();
  const t = createTranslator(locale);
  const data = await withSession(({ db, accountId, email }) => loadDashboard(db, accountId, email));
  const coreGranted = Boolean(data.consents.CORE_PROCESSING);
  const grantedCount = CONSENT_TYPES.filter((type) => Boolean(data.consents[type])).length;

  const firstApplicant = data.perApplicant[0];
  const setupSteps = [
    {
      key: 'consent',
      label: 'Allow core processing',
      hint: 'Needed before anything can be saved. You can turn it off at any time.',
      done: coreGranted,
      href: '#permissions',
    },
    {
      key: 'applicant',
      label: 'Add an applicant',
      hint: 'Start with yourself, or someone you manage records for.',
      done: data.applicants.length > 0,
      href: '/app/applicants',
    },
    {
      key: 'document',
      label: 'Add a first document',
      hint: 'A passport page is the usual start.',
      done: data.perApplicant.some((row) => row.documentCount > 0),
      href: firstApplicant
        ? `/app/applicant/${firstApplicant.applicant.id}/documents`
        : '/app/applicants',
    },
    {
      key: 'case',
      label: 'Start a case',
      hint: 'Check your documents against one visa route.',
      done: data.perApplicant.some((row) => row.activeMissions > 0),
      href: firstApplicant
        ? `/app/applicant/${firstApplicant.applicant.id}/missions`
        : '/app/applicants',
    },
  ];

  const firstTodo = setupSteps.find((step) => !step.done);

  // One next step, chosen in priority order: the consent gate first, then whatever
  // someone is waiting on, then the first applicant, then "all clear".
  const first = data.attention[0];
  const nextStep = !coreGranted
    ? {
        title: 'Turn on core processing to begin',
        why: 'VisaStack cannot create applicant or profile records until you allow this. You can turn it off again at any time.',
        href: '#permissions',
        action: 'Choose permissions',
        tone: 'warning' as const,
      }
    : first
      ? {
          title: first.label,
          why: first.applicantName ? `${first.applicantName}. ${first.why}` : first.why,
          href: first.href,
          action: first.action,
          tone: 'warning' as const,
        }
      : firstTodo
        ? {
            title: firstTodo.label,
            why: firstTodo.hint,
            href: firstTodo.href,
            action: firstTodo.key === 'applicant' ? 'Add an applicant' : 'Continue',
          }
        : {
            title: 'You are up to date',
            why: 'Nothing is waiting for you. Open an applicant to add documents or start a case.',
            href: '/app/applicants',
            action: 'View applicants',
            tone: 'ok' as const,
          };

  return (
    <section className="section container">
      <div className="u-mb-150">
        <span className="eyebrow">Home</span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          Welcome back
        </h1>
        <p className="muted" style={{ margin: '0.35rem 0 0', overflowWrap: 'anywhere' }}>
          Signed in as {data.email}
        </p>
      </div>

      <NextStepCard {...nextStep} />

      {setupSteps.some((step) => !step.done) ? (
        <Checklist title="Set up your account" items={setupSteps} />
      ) : null}

      {coreGranted && data.attention.length > 1 ? (
        <article className="card u-mb-150">
          <p className="card-kicker">Also waiting</p>
          <h2 className="card-title">Needs your attention</h2>
          <AttentionList
            items={data.attention.slice(1).map((item, i) => ({
              key: `${item.href}-${i}`,
              href: item.href,
              label: item.label,
              ...(item.applicantName ? { detail: item.applicantName } : {}),
              count: item.count,
            }))}
          />
        </article>
      ) : null}

      {coreGranted ? (
        <article className="card u-mb-150">
          <p className="card-kicker">People and cases</p>
          <h2 className="card-title">Your applicants</h2>
          {data.perApplicant.length === 0 ? (
            <EmptyState
              icon="users"
              title="No applicants yet"
              action={{ href: '/app/applicants', label: 'Add an applicant' }}
            >
              An applicant is one person whose passport details and documents you keep here and
              reuse for each visa application.
            </EmptyState>
          ) : (
            <ul className="attention-list">
              {data.perApplicant.map((row) => (
                <li className="attention-item" key={row.applicant.id}>
                  <Link className="attention-link" href={`/app/applicant/${row.applicant.id}`}>
                    <span className="attention-text">
                      <span className="attention-label">{row.applicant.displayName}</span>
                      <span className="attention-detail">
                        {plural(row.documentCount, 'document')}
                        {' \u00b7 '}
                        {plural(row.activeMissions, 'active case')}
                        {row.openRequests > 0
                          ? ` \u00b7 ${plural(row.openRequests, 'open request')}`
                          : ''}
                      </span>
                    </span>
                    <span className="attention-end">
                      {row.openRequests + row.pendingProposals > 0 ? (
                        <StatusBadge tone="warning">Action needed</StatusBadge>
                      ) : null}
                      <span className="attention-chevron" aria-hidden="true">
                        ›
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>
      ) : null}

      {/*
       * Always rendered, independent of `coreGranted` - the sole place any
       * consent type (including CORE_PROCESSING) is granted or revoked, so
       * AI/sharing/marketing consent stay independently controllable even
       * while core processing is absent or revoked
       * (docs/audits/post-programme-defect-register.md finding #22).
       * It opens by itself while core processing is off, because that is the next step.
       */}
      <div id="permissions">
        <Disclosure
          title="Permissions you control"
          hint={`${grantedCount} of ${CONSENT_TYPES.length} on`}
          open={!coreGranted}
        >
          <p className="card-body u-mb-100">
            Each purpose is granted and revoked independently, at any time. Turning one off never
            requires turning another back on. Core processing is required before any applicant or
            profile records can be created; the others are optional.
          </p>
          <div className="rows">
            {CONSENT_TYPES.map((type) => (
              <div className="row" key={type}>
                <span className="row-key">{t(CONSENT_MESSAGE_KEYS[type])}</span>
                <ConsentButton
                  type={type}
                  granted={Boolean(data.consents[type])}
                  locale={locale}
                  label={t(CONSENT_MESSAGE_KEYS[type])}
                />
              </div>
            ))}
          </div>
        </Disclosure>
      </div>
    </section>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
