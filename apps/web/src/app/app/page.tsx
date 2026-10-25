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
import { redirect } from 'next/navigation';
import {
  AttentionList,
  Checklist,
  Disclosure,
  EmptyState,
  NextStepCard,
  StatusBadge,
} from '../../components/ui';
import { CONSENT_PLAIN } from '../../lib/labels';
import { getLocale } from '../../lib/locale';
import { safeReturnPath } from '../../lib/neon-recency';
import { withSession } from '../../lib/session';
import { ConsentButton } from './consent-button';
import { FirstRunConsent, FirstRunName, FirstRunTask, SETUP_LATER_HREF } from './first-run';

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

interface SearchParams {
  readonly next?: string | string[];
  readonly setup?: string | string[];
  readonly welcome?: string | string[];
}

/**
 * A task to return to after first run: a workspace page or an invitation, never home itself and
 * never anything else on the site (an API route, a sign-in page), or null when there is none.
 */
function returnTask(value: string | string[] | undefined): string | null {
  // Encoded dots or slashes have no place in a task link; refusing them closes "%2e%2e" tricks.
  if (typeof value !== 'string' || /%2e|%2f|%5c/i.test(value)) return null;
  const safe = safeReturnPath(value);
  if (safe === '/app') return null;
  // Resolve "." and ".." the way a browser will, then check the path that would actually load.
  let url: URL;
  try {
    url = new URL(safe, 'https://visastack.invalid');
  } catch {
    return null;
  }
  if (url.origin !== 'https://visastack.invalid') return null;
  const allowed = url.pathname.startsWith('/app/') || url.pathname === '/invitation';
  return allowed ? `${url.pathname}${url.search}` : null;
}

export default async function AppPage({
  searchParams,
}: { readonly searchParams?: Promise<SearchParams> } = {}) {
  const params: SearchParams = (await searchParams) ?? {};
  const locale = await getLocale();
  const t = createTranslator(locale);
  const data = await withSession(({ db, accountId, email }) => loadDashboard(db, accountId, email));
  const coreGranted = Boolean(data.consents.CORE_PROCESSING);
  const grantedCount = CONSENT_TYPES.filter((type) => Boolean(data.consents[type])).length;

  // First run (WP-V3, D8) is for someone new: core processing off and no other consent on, or no
  // applicant yet. Someone who turned core processing off later, with another consent still on,
  // gets the ordinary home so every consent control stays in reach. "Not now" also leads there.
  const task = returnTask(params.next);
  const later = params.setup === 'later';
  const newcomer = !coreGranted && grantedCount === 0 && data.applicants.length === 0;
  // "Not now" with a task goes to that task (it has its own checks); otherwise to the ordinary home.
  const laterHref = task ?? SETUP_LATER_HREF;
  if (!later && newcomer) return <FirstRunConsent locale={locale} laterHref={laterHref} />;
  if (!later && coreGranted && data.applicants.length === 0) {
    // Ask the name on the page that comes next, so once the applicant is saved the refreshed page
    // is already "what do you want to do?" (or, with a task, goes straight to it).
    if (!task && params.welcome !== '1') redirect('/app?welcome=1');
    return <FirstRunName laterHref={laterHref} />;
  }
  if (coreGranted && data.applicants.length > 0) {
    // Set up: go straight to the task someone came for, or ask what they want to do once.
    if (task) redirect(task);
    if (params.welcome === '1') {
      const waiting = data.perApplicant.find((row) => row.openRequests > 0);
      const first = data.perApplicant[0];
      return (
        <FirstRunTask
          requestHref={waiting ? `/app/applicant/${waiting.applicant.id}/evidence` : null}
          recordsHref={first ? `/app/applicant/${first.applicant.id}` : '/app/applicants'}
        />
      );
    }
  }

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
            {locale === 'en'
              ? 'Each one is on or off, and you can change it at any time. Turning one off never requires turning another back on. "Let VisaStack process my details" is needed before any applicant or profile can be created; the others are optional.'
              : 'Each purpose is granted and revoked independently, at any time. Turning one off never requires turning another back on. Core processing is required before any applicant or profile records can be created; the others are optional.'}
          </p>
          <div className="rows">
            {CONSENT_TYPES.map((type) => {
              const plain = locale === 'en' ? CONSENT_PLAIN[type] : undefined;
              const name = plain?.name ?? t(CONSENT_MESSAGE_KEYS[type]);
              const on = Boolean(data.consents[type]);
              return (
                <div className="row" key={type}>
                  <span className="row-key">
                    {name}
                    {plain ? <span className="cell-sub">{plain.meaning}</span> : null}
                  </span>
                  {plain ? (
                    <span className={`badge ${on ? 'badge-success' : 'badge-neutral'}`}>
                      {on ? 'On' : 'Off'}
                    </span>
                  ) : null}
                  <ConsentButton type={type} granted={on} locale={locale} label={name} />
                </div>
              );
            })}
          </div>
        </Disclosure>
      </div>
    </section>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
