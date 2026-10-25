import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type MessageKey, createTranslator } from '@visastack/i18n';
import {
  type Db,
  getConsents,
  listApplicants,
  listDocuments,
  listEvidenceRequestsForApplicant,
  listGrantsForRecipientAccount,
  listMembershipsForAccount,
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
import { isPlatformAdmin } from '../../lib/admin';
import { CONSENT_PLAIN } from '../../lib/labels';
import { getLocale } from '../../lib/locale';
import { safeReturnPath } from '../../lib/neon-recency';
import { plural } from '../../lib/plural';
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

/** What first run needs to decide, read before anything heavier. */
async function loadBasics(db: Db, accountId: string, email: string) {
  const [consents, incomingGrants, applicants, memberships, platformAdmin] = await Promise.all([
    getConsents(db, accountId),
    listGrantsForRecipientAccount(db, accountId),
    listApplicants(db, accountId),
    listMembershipsForAccount(db, accountId),
    isPlatformAdmin(db, { accountId, email }),
  ]);
  return { consents, incomingGrants, applicants, memberships, platformAdmin };
}

type Basics = Awaited<ReturnType<typeof loadBasics>>;

async function loadDashboard(db: Db, accountId: string, email: string, basics: Basics) {
  const { consents, incomingGrants, applicants } = basics;
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
        label: 'Evidence Requests Waiting for a Reply',
        why: 'An agency has asked for a document. Reply with a file from your documents.',
        action: 'Open Requests',
        count: row.openRequests,
      });
    }
    if (row.pendingProposals > 0) {
      attention.push({
        href: `/app/applicant/${row.applicant.id}/documents`,
        applicantName: row.applicant.displayName,
        label: 'Suggested Details Waiting for Your Decision',
        why: 'Details were read from a document. Nothing is added to the profile until you approve it.',
        action: 'Review Suggestions',
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
      label: 'Sharing Invitations Waiting for Your Answer',
      why: 'Someone wants to share their information with you. Nothing is shared until you accept.',
      action: 'See Invitations',
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
 * A task to return to after first run: a workspace page (such as an invitation's accept page),
 * never home itself and never anything else on the site, or null when there is none.
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
  // Workspace pages only: the public invitation page asks a signed-in person to sign in again.
  return url.pathname.startsWith('/app/') ? `${url.pathname}${url.search}` : null;
}

export default async function AppPage({
  searchParams,
}: { readonly searchParams?: Promise<SearchParams> }) {
  const params: SearchParams = (await searchParams) ?? {};
  const locale = await getLocale();
  const t = createTranslator(locale);
  const task = returnTask(params.next);
  const later = params.setup === 'later';
  const decided = await withSession(async ({ db, accountId, email }) => {
    const basics = await loadBasics(db, accountId, email);
    const coreGranted = Boolean(basics.consents.CORE_PROCESSING);
    const grantedCount = CONSENT_TYPES.filter((type) => Boolean(basics.consents[type])).length;
    // First run (WP-V3, D8) is only for someone new: no records, no agency or platform role and
    // nothing shared with them, so agency staff and people who only receive shared access are
    // never sent through it. Someone who turned core processing off later, with another consent
    // still on, gets the ordinary home so every consent control stays in reach.
    const newcomer =
      basics.applicants.length === 0 &&
      basics.memberships.every((membership) => !membership.active) &&
      !basics.platformAdmin &&
      basics.incomingGrants.length === 0;
    if (!later && newcomer && !coreGranted && grantedCount === 0) {
      return { screen: 'consent' as const };
    }
    if (!later && newcomer && coreGranted) return { screen: 'name' as const };
    // Set up: the task someone came for comes first, before any heavier reading.
    if (coreGranted && basics.applicants.length > 0 && task) return { screen: 'task' as const };
    return {
      screen: 'home' as const,
      coreGranted,
      grantedCount,
      data: await loadDashboard(db, accountId, email, basics),
    };
  });

  // "Not now" with a task goes to that task (it has its own checks); otherwise to the ordinary home.
  const laterHref = task ?? SETUP_LATER_HREF;
  if (decided.screen === 'consent')
    return <FirstRunConsent locale={locale} laterHref={laterHref} />;
  if (decided.screen === 'name') {
    // Ask the name on the page that comes next, so once the applicant is saved the refreshed page
    // is already "what do you want to do?" (or, with a task, goes straight to it).
    if (!task && params.welcome !== '1') redirect('/app?welcome=1');
    return <FirstRunName laterHref={laterHref} />;
  }
  if (decided.screen === 'task' && task) redirect(task);
  if (decided.screen !== 'home') redirect('/app');
  const { coreGranted, grantedCount, data } = decided;
  if (coreGranted && data.applicants.length > 0 && params.welcome === '1') {
    // Ask what they want to do once, offering only destinations that exist.
    const waiting = data.perApplicant.find((row) => row.openRequests > 0);
    const shared = data.attention.find((item) => item.href === '/app/shared');
    const first = data.perApplicant[0];
    return (
      <FirstRunTask
        requestHref={
          waiting
            ? `/app/applicant/${waiting.applicant.id}/evidence`
            : shared
              ? '/app/shared'
              : null
        }
        recordsHref={first ? `/app/applicant/${first.applicant.id}` : '/app/applicants'}
      />
    );
  }

  const firstApplicant = data.perApplicant[0];
  const setupSteps = [
    {
      key: 'consent',
      label: 'Allow Core Processing',
      hint: 'Needed before anything can be saved. You can turn it off at any time.',
      done: coreGranted,
      href: '#permissions',
    },
    {
      key: 'applicant',
      label: 'Add an Applicant',
      hint: 'Start with yourself, or someone you manage records for.',
      done: data.applicants.length > 0,
      href: '/app/applicants',
    },
    {
      key: 'document',
      label: 'Add a First Document',
      hint: 'A passport page is the usual start.',
      done: data.perApplicant.some((row) => row.documentCount > 0),
      href: firstApplicant
        ? `/app/applicant/${firstApplicant.applicant.id}/documents`
        : '/app/applicants',
    },
    {
      key: 'case',
      label: 'Start a Case',
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
        title: 'Turn On Core Processing to Begin',
        why: 'VisaStack cannot create applicant or profile records until you allow this. You can turn it off again at any time.',
        href: '#permissions',
        action: 'Choose Permissions',
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
            action: firstTodo.key === 'applicant' ? 'Add an Applicant' : 'Continue',
          }
        : {
            title: 'You Are Up to Date',
            why: 'Nothing is waiting for you. Open an applicant to add documents or start a case.',
            href: '/app/applicants',
            action: 'View Applicants',
            tone: 'ok' as const,
          };

  return (
    <section className="section container">
      <div className="u-mb-150">
        <span className="eyebrow">Home</span>
        <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
          Welcome Back
        </h1>
        <p className="muted" style={{ margin: '0.35rem 0 0', overflowWrap: 'anywhere' }}>
          Signed in as {data.email}
        </p>
      </div>

      <NextStepCard {...nextStep} />

      {setupSteps.some((step) => !step.done) ? (
        <Checklist title="Set Up Your Account" items={setupSteps} />
      ) : null}

      {coreGranted && data.attention.length > 1 ? (
        <article className="card u-mb-150">
          <p className="card-kicker">Also Waiting</p>
          <h2 className="card-title">Needs Your Attention</h2>
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
          <p className="card-kicker">People and Cases</p>
          <h2 className="card-title">Your Applicants</h2>
          {data.perApplicant.length === 0 ? (
            <EmptyState
              icon="users"
              title="No Applicants Yet"
              action={{ href: '/app/applicants', label: 'Add an Applicant' }}
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
                        <StatusBadge tone="warning">Action Needed</StatusBadge>
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
          title="Permissions You Control"
          hint={`${grantedCount} of ${CONSENT_TYPES.length} on`}
          open={!coreGranted}
        >
          <p className="card-body u-mb-100">
            {locale === 'en'
              ? 'Each one is on or off, and you can change it at any time. Turning one off never requires turning another back on. "Let VisaStack Process My Details" is needed before any applicant or profile can be created; the others are optional.'
              : 'Each purpose is granted and revoked independently, at any time. Turning one off never requires turning another back on. Core processing is required before any applicant or profile records can be created; the others are optional.'}
          </p>
          <div className="rows">
            {CONSENT_TYPES.map((type) => {
              const plain = locale === 'en' ? CONSENT_PLAIN[type] : undefined;
              const name = plain?.name ?? t(CONSENT_MESSAGE_KEYS[type]);
              const on = Boolean(data.consents[type]);
              return (
                <div className="row consent-row" key={type}>
                  <span className="row-key consent-text">
                    <span className="consent-name">{name}</span>
                    {plain ? (
                      <>
                        {' '}
                        <span className="consent-meaning">{plain.meaning}</span>
                      </>
                    ) : null}
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
