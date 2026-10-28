import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type MessageKey, createTranslator } from '@visastack/i18n';
import {
  type AttentionItem,
  type Db,
  type DeadlineEntry,
  type NeedsAttention,
  accountPrincipal,
  computeReadiness,
  getConsents,
  listApplicants,
  listDocuments,
  listGrantsForRecipientAccount,
  listMembershipsForAccount,
  listNeedsAttention,
  rankAttentionItems,
  rankDeadlines,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CaseReadinessRing, type ReadinessCounts } from '../../../components/case-readiness-ring';
import { DeadlineClock } from '../../../components/deadline-clock';
import { PROGRESS_IN_CASE_LINE } from '../../../components/progress-ring';
import {
  Checklist,
  Disclosure,
  EmptyState,
  NextStepCard,
  StatusBadge,
} from '../../../components/ui';
import { holdsPlatformRole } from '../../../lib/admin';
import { countryNameOf, countryStartData, parseCountryParam } from '../../../lib/country-start';
import { COUNTRY_STEP_DONE } from '../../../lib/country-start-links';
import { formatDateOnly } from '../../../lib/format-date';
import {
  ATTENTION_TIER_LABELS,
  CONSENT_PLAIN,
  attentionActionLabel,
  documentTypeLabel,
} from '../../../lib/labels';
import { getLocale } from '../../../lib/locale';
import { safeReturnPath } from '../../../lib/neon-recency';
import { plural } from '../../../lib/plural';
import { withSession } from '../../../lib/session';
import { requestItemLabel } from '../agency/[orgId]/do-next';
import { ConsentButton } from '../consent-button';
import { confirmFirstRunCountryAction } from '../country-actions';
import { CLOCK_HOME_LIMIT, deadlineLines, readDeadlineEntries } from '../deadline-clock-data';
import {
  FirstRunConsent,
  FirstRunCountry,
  FirstRunName,
  FirstRunTask,
  SETUP_LATER_HREF,
} from '../first-run';

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

/**
 * Home reads Needs Attention for at most this many of the person's own applicants, so a very
 * large household or a bulk import never turns Home into hundreds of queries. The rest are one
 * click away on the applicants page, and Home says so.
 */
const HOME_APPLICANT_LIMIT = 25;

/** Needs Attention shows this many items under the next step; the rest are counted. */
const HOME_ATTENTION_VISIBLE = 8;

/** Active cases listed under "Active Requests and Work" before pointing to each person. */
const HOME_CASES_VISIBLE = 6;

/** What first run needs to decide, read before anything heavier. */
async function loadBasics(db: Db, accountId: string, email: string) {
  const [consents, incomingGrants, applicants, memberships, platformAdmin] = await Promise.all([
    getConsents(db, accountId),
    listGrantsForRecipientAccount(db, accountId),
    listApplicants(db, accountId),
    listMembershipsForAccount(db, accountId),
    holdsPlatformRole(db, { accountId, email }),
  ]);
  return { consents, incomingGrants, applicants, memberships, platformAdmin };
}

type Basics = Awaited<ReturnType<typeof loadBasics>>;

/**
 * What Home reads for one of the person's own applicants, through the central access gate as the
 * owner (`purpose: 'self'`), with one proof for both reads: Needs Attention and the deadline clock
 * (Growth G5). A refusal or a failed read gives null for that part: Home then shows that person
 * without attention items, or the clock as unavailable, rather than failing the whole page.
 */
async function loadPersonReads(
  db: Db,
  accountId: string,
  applicantId: string,
  now: Date,
): Promise<{
  readonly attention: NeedsAttention | null;
  readonly deadlines: readonly DeadlineEntry[] | null;
}> {
  const access = await requireAccess(
    db,
    accountPrincipal(accountId),
    'VIEW_METADATA',
    { applicantId },
    { purpose: 'self' },
  );
  if (!access.ok || access.value.actor.kind !== 'applicant_owner') {
    return { attention: null, deadlines: null };
  }
  const [listed, deadlines] = await Promise.all([
    listNeedsAttention(access.value, { now }),
    readDeadlineEntries(access.value, now, CLOCK_HOME_LIMIT),
  ]);
  return { attention: listed.ok ? listed.value : null, deadlines };
}

/** Sharing invitations waiting for an answer: one account-level item in the same shape. */
function sharingInvitationItem(grants: Basics['incomingGrants'], now: Date): AttentionItem | null {
  const waiting = grants.filter((g) => g.grant.status === 'PENDING_ACCEPTANCE');
  if (waiting.length === 0) return null;
  const sent = waiting
    .map((g) => g.grant.createdAt)
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());
  return {
    key: 'sharing_invitations:account',
    kind: 'sharing_invitations',
    tier: 7,
    title: 'Sharing Invitations Waiting for Your Answer',
    why: 'Someone wants to share their information with you. Nothing is shared until you accept.',
    applicantId: null,
    applicantName: null,
    caseId: null,
    caseTitle: null,
    dueDate: null,
    dueState: 'none',
    daysUntilDue: null,
    sentBack: false,
    count: waiting.length,
    subject: null,
    href: '/app/shared',
    createdAt: (sent[0] ?? now).toISOString(),
  };
}

async function loadDashboard(db: Db, accountId: string, email: string, basics: Basics) {
  const { consents, incomingGrants, applicants } = basics;
  const now = new Date();
  const perApplicant = await Promise.all(
    // A fixed order (oldest first, then id) so the same people are read on every visit:
    // `listApplicants` itself promises no order.
    [...applicants]
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      )
      .slice(0, HOME_APPLICANT_LIMIT)
      .map(async (applicant) => {
        const [docs, { attention, deadlines }] = await Promise.all([
          listDocuments(db, accountId, applicant.id),
          loadPersonReads(db, accountId, applicant.id, now),
        ]);
        return {
          applicant,
          documentCount: docs.ok ? docs.value.length : 0,
          attention,
          deadlines,
          itemCount: attention?.items.length ?? 0,
          activeMissions: attention?.activeCaseCount ?? 0,
          // Open or sent back for a fix (ADR 0015 section 5), so a replacement request counts.
          waitingRequests: attention?.requests.waitingOnYou ?? 0,
          requestsWithAgency: attention?.requests.withAgency ?? 0,
        };
      }),
  );

  // Readiness for the active cases Home lists, from the same source as the case page. The cases come
  // from the gated attention read above; one without a checklist simply has no entry (its ring is empty).
  const readinessByCase = new Map<string, ReadinessCounts>();
  const unreadableCases = new Set<string>();
  await Promise.all(
    perApplicant
      .flatMap((row) => row.attention?.activeCases ?? [])
      .slice(0, HOME_CASES_VISIBLE)
      .map(async (entry) => {
        const result = await computeReadiness(db, entry.id);
        if (result.ok) readinessByCase.set(entry.id, result.value);
        // "invalid" is a case with no checklist attached; any other refusal means the count could not be read now.
        else if (result.error.code !== 'invalid') unreadableCases.add(entry.id);
      }),
  );

  const sharing = sharingInvitationItem(incomingGrants, now);
  // One ranked list across every person and the account itself (ADR 0016).
  const attention = rankAttentionItems([
    ...perApplicant.flatMap((row) => row.attention?.items ?? []),
    ...(sharing ? [sharing] : []),
  ]);

  // The next dates across every person, soonest first (Growth G5). A person whose dates could not
  // be read is left out of the merge and said so; if nobody's could be read, none are shown.
  const readable = perApplicant.flatMap((row) => (row.deadlines === null ? [] : [row.deadlines]));
  const clock = {
    entries: rankDeadlines(readable.flat(), CLOCK_HOME_LIMIT),
    unreadablePeople: perApplicant.length - readable.length,
    readable: perApplicant.length === 0 || readable.length > 0,
  };

  return {
    email,
    consents,
    applicants,
    perApplicant,
    clock,
    readinessByCase,
    unreadableCases,
    attention,
    sharingWaiting: sharing !== null,
  };
}

/**
 * "Add Dates to My Calendar" (v1.2 B05 calendar export), at the foot of My Records so it is
 * there whatever is waiting. Each person's dates are their own file: with one person, one button
 * straight to that person's calendar page; with several, one sentence with each person's name as
 * a link, so a household of 25 is one line, not 25 buttons.
 */
function CalendarLinks({
  people,
}: {
  readonly people: readonly { readonly id: string; readonly displayName: string }[];
}) {
  const [only] = people;
  if (!only) return null;
  const href = (id: string) => `/app/applicant/${id}/calendar`;
  if (people.length === 1) {
    return (
      <div className="do-next-action">
        <Link href={href(only.id)} className="btn btn-secondary">
          Add Dates to My Calendar
        </Link>
      </div>
    );
  }
  return (
    <p className="muted do-next-more home-calendar-links">
      Add dates to my calendar for{' '}
      {people.map((person, index) => (
        <span key={person.id}>
          {index === 0 ? '' : index === people.length - 1 ? ' or ' : ', '}
          <Link href={href(person.id)}>{person.displayName}</Link>
        </span>
      ))}
      .
    </p>
  );
}

/**
 * The heading for one item: what a request asks for or which document is expiring, by its own
 * name, otherwise the plain heading the item came with. Server-only: the request label reads the
 * field catalogue, which never goes to the browser.
 */
function attentionHeading(item: AttentionItem): string {
  const subject = item.subject;
  if (subject?.kind === 'request') {
    return requestItemLabel({
      kind: subject.requestKind,
      fieldKey: subject.fieldKey,
      docType: subject.docType,
    });
  }
  if (subject?.kind === 'document' && subject.docType) return documentTypeLabel(subject.docType);
  return item.title;
}

/** Who and which case an item is about, in a short line. */
function attentionContext(item: AttentionItem): string {
  const parts = [item.applicantName, item.caseTitle].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  if (item.count !== null) {
    parts.push(
      item.kind === 'sharing_invitations'
        ? plural(item.count, 'invitation')
        : plural(item.count, 'suggested detail'),
    );
  }
  return parts.join(' \u00b7 ');
}

/** The date line for an item, or null when it has no date (an unknown date gets a badge). */
function attentionWhen(item: AttentionItem): string | null {
  if (item.dueDate === null) return null;
  const date = formatDateOnly(item.dueDate);
  if (item.kind === 'document_expiry') {
    return item.dueState === 'overdue' ? `Expired on ${date}` : `Expires on ${date}`;
  }
  if (item.daysUntilDue === 0) return `Due today, ${date}`;
  if (item.dueState === 'overdue') return `Was due on ${date}`;
  return `Due on ${date}`;
}

interface SearchParams {
  readonly next?: string | string[];
  readonly setup?: string | string[];
  readonly welcome?: string | string[];
  /** Growth G2: the country chosen on the home page or in first run (a two-letter code). */
  readonly country?: string | string[];
  /** Growth G2: `consent` means the country screen is done (confirmed or skipped). */
  readonly step?: string | string[];
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
  // The country they chose (checked against the data we hold), carried through first run.
  const country = parseCountryParam(params.country);
  const countryName = countryNameOf(country);
  // Someone who came for a task (an invitation) is not asked for a country first.
  const hasCountryStep = !task;
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
      // Growth G2: pick a country first, unless that screen is done (confirmed or skipped) or
      // the person came for a task.
      if (hasCountryStep && params.step !== COUNTRY_STEP_DONE) {
        return { screen: 'country' as const };
      }
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
  if (decided.screen === 'country') {
    return (
      <FirstRunCountry
        data={countryStartData()}
        iso2={country}
        action={confirmFirstRunCountryAction}
      />
    );
  }
  if (decided.screen === 'consent') {
    return (
      <FirstRunConsent
        locale={locale}
        laterHref={laterHref}
        hasCountryStep={hasCountryStep}
        countryName={countryName}
        countryIso2={country}
      />
    );
  }
  if (decided.screen === 'name') {
    // Ask the name on the page that comes next, so once the applicant is saved the refreshed page
    // is already "what do you want to do?" (or, with a task, goes straight to it).
    if (!task && params.welcome !== '1') {
      redirect(country ? `/app?welcome=1&country=${country}` : '/app?welcome=1');
    }
    return (
      <FirstRunName
        laterHref={laterHref}
        hasCountryStep={hasCountryStep}
        countryName={countryName}
      />
    );
  }
  if (decided.screen === 'task' && task) redirect(task);
  if (decided.screen !== 'home') redirect('/app');
  const { coreGranted, grantedCount, data } = decided;
  if (coreGranted && data.applicants.length > 0 && params.welcome === '1') {
    // Ask what they want to do once, offering only destinations that exist.
    const waiting = data.perApplicant.find((row) => row.waitingRequests > 0);
    const shared = data.sharingWaiting;
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
        briefHref={
          first ? `/app/applicant/${first.applicant.id}/outputs?output=agency_brief` : null
        }
        countryName={countryName}
        countryHref={country ? `/app/countries/${country.toLowerCase()}` : null}
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
  const setupIncomplete = firstTodo !== undefined;

  // One next step, chosen in priority order: the consent gate first, then the top of the ranked
  // Needs Attention list (ADR 0016), then the first setup step, then "all clear".
  const first = data.attention[0];
  // Home reads at most HOME_APPLICANT_LIMIT people (oldest first); say so wherever it matters.
  const peopleLeftOut = data.applicants.length > data.perApplicant.length;
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
          title: attentionHeading(first),
          why: attentionContext(first) ? `${attentionContext(first)}. ${first.why}` : first.why,
          href: first.href,
          action: attentionActionLabel(first),
          tone: 'warning' as const,
        }
      : firstTodo
        ? {
            title: firstTodo.label,
            why: firstTodo.hint,
            href: firstTodo.href,
            action: firstTodo.key === 'applicant' ? 'Add an Applicant' : 'Continue',
          }
        : peopleLeftOut
          ? {
              // Home reads only the first people, so it cannot say nothing is waiting at all.
              title: 'Up to Date for the People Shown',
              why: `Nothing is waiting for the first ${data.perApplicant.length} of ${data.applicants.length} people. Open the full list to check the others.`,
              href: '/app/applicants',
              action: 'See All Applicants',
              tone: 'ok' as const,
            }
          : {
              title: 'You Are Up to Date',
              why: 'Nothing is waiting for you. Open an applicant to add documents or start a case.',
              href: '/app/applicants',
              action: 'View Applicants',
              tone: 'ok' as const,
            };

  // Under the next step: everything else, ranked. The first item is already the next step.
  const rest = first ? data.attention.slice(1) : [];
  const restShown = rest.slice(0, HOME_ATTENTION_VISIBLE);
  const requestRows = data.perApplicant.filter(
    (row) => row.waitingRequests + row.requestsWithAgency > 0,
  );
  const activeCases = data.perApplicant.flatMap((row) =>
    (row.attention?.activeCases ?? []).map((entry) => ({
      id: entry.id,
      title: entry.title,
      person: row.applicant.displayName,
    })),
  );

  const comingUpNote = [
    data.clock.readable && data.clock.unreadablePeople > 0
      ? `Dates for ${plural(data.clock.unreadablePeople, 'person', 'people')} could not be read.`
      : null,
    peopleLeftOut
      ? `Shows the first ${data.perApplicant.length} of ${data.applicants.length} people.`
      : null,
  ]
    .filter((line): line is string => line !== null)
    .join(' ');

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

      {coreGranted && rest.length > 0 ? (
        <section className="card u-mb-150" aria-labelledby="home-attention-heading">
          <p className="card-kicker">Also Waiting</p>
          <h2 className="card-title" id="home-attention-heading">
            Needs Attention
          </h2>
          <ol className="do-next-list">
            {restShown.map((item) => {
              const heading = attentionHeading(item);
              const when = attentionWhen(item);
              const context = attentionContext(item);
              return (
                <li key={item.key} className={`do-next-item do-next-tier-${item.tier}`}>
                  <div className="do-next-item-head">
                    <span className="do-next-tier">{ATTENTION_TIER_LABELS[item.tier]}</span>
                    <h3 className="do-next-title">{heading}</h3>
                  </div>
                  {context ? <p className="do-next-context">{context}</p> : null}
                  <p className="home-attention-why">{item.why}</p>
                  {when ? (
                    <p className="home-attention-when">{when}</p>
                  ) : item.dueState === 'unknown' ? (
                    <p className="home-attention-when">
                      <StatusBadge tone="neutral">Date Unknown</StatusBadge>
                    </p>
                  ) : null}
                  <div className="do-next-action">
                    <Link href={item.href} className="btn btn-secondary do-next-link">
                      {attentionActionLabel(item)}
                      <span className="sr-only">: {heading}</span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ol>
          {rest.length > restShown.length ? (
            <p className="muted do-next-more">
              Showing {restShown.length} of {rest.length}. The rest are on each person&apos;s pages.{' '}
              <Link href="/app/applicants">See All Applicants</Link>
            </p>
          ) : null}
          {peopleLeftOut ? (
            <p className="muted do-next-more">
              This list covers the first {data.perApplicant.length} of {data.applicants.length}{' '}
              people. <Link href="/app/applicants">See All Applicants</Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {coreGranted && firstApplicant ? (
        <div className="u-mb-150">
          <DeadlineClock
            heading="Coming Up"
            headingId="home-coming-up-heading"
            lines={
              data.clock.readable
                ? deadlineLines(data.clock.entries, { showPerson: data.perApplicant.length > 1 })
                : null
            }
            note={comingUpNote}
            addAction={{
              href: `/app/applicant/${firstApplicant.applicant.id}/documents`,
              label: 'Add a Document',
            }}
            {...(data.perApplicant.length === 1
              ? {
                  more: {
                    href: `/app/applicant/${firstApplicant.applicant.id}/expiry`,
                    label: 'See All Dates',
                  },
                }
              : {})}
          />
        </div>
      ) : null}

      {coreGranted ? (
        <section className="card u-mb-150" aria-labelledby="home-records-heading">
          <p className="card-kicker">People</p>
          <h2 className="card-title" id="home-records-heading">
            My Records
          </h2>
          {data.perApplicant.length === 0 ? (
            <EmptyState
              icon="users"
              title="No Applicants Yet"
              why="Add each person once, and every visa case reuses the same details."
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
                        {row.waitingRequests > 0
                          ? ` \u00b7 ${plural(row.waitingRequests, 'open request')}`
                          : ''}
                      </span>
                    </span>
                    <span className="attention-end">
                      {row.itemCount > 0 ? (
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
          <CalendarLinks people={data.perApplicant.map((row) => row.applicant)} />
          {data.applicants.length > data.perApplicant.length ? (
            <p className="muted do-next-more">
              Home shows the first {data.perApplicant.length} of {data.applicants.length} people.{' '}
              <Link href="/app/applicants">See All Applicants</Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {coreGranted && data.perApplicant.length > 0 ? (
        <section className="card u-mb-150" aria-labelledby="home-work-heading">
          <p className="card-kicker">In Progress</p>
          <h2 className="card-title" id="home-work-heading">
            Active Requests and Work
          </h2>
          {requestRows.length === 0 && activeCases.length === 0 ? (
            <p className="card-body home-attention-why">
              Nothing is open right now. When an agency asks you for something, or you start a case,
              it appears here with the next step.
            </p>
          ) : (
            <ul className="attention-list">
              {requestRows.map((row) => (
                <li className="attention-item" key={`requests-${row.applicant.id}`}>
                  <Link
                    className="attention-link"
                    href={`/app/applicant/${row.applicant.id}/evidence`}
                  >
                    <span className="attention-text">
                      <span className="attention-label">Requests from an Agency</span>
                      <span className="attention-detail">
                        {row.applicant.displayName}
                        {row.waitingRequests > 0
                          ? ` \u00b7 ${row.waitingRequests} waiting for you`
                          : ''}
                        {row.requestsWithAgency > 0
                          ? ` \u00b7 ${row.requestsWithAgency} with the agency`
                          : ''}
                      </span>
                    </span>
                    <span className="attention-end">
                      {row.waitingRequests > 0 ? (
                        <StatusBadge tone="warning">Action Needed</StatusBadge>
                      ) : null}
                      <span className="attention-chevron" aria-hidden="true">
                        ›
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
              {activeCases.slice(0, HOME_CASES_VISIBLE).map((entry) => (
                <li className="attention-item" key={`case-${entry.id}`}>
                  <Link className="attention-link" href={`/app/mission/${entry.id}`}>
                    <span className="attention-text">
                      <span className="attention-label">{entry.title}</span>
                      <span className="attention-detail">
                        Active case{' \u00b7 '}
                        {entry.person}
                      </span>
                      <span className="progress-ring-row">
                        <CaseReadinessRing
                          size="sm"
                          readiness={data.readinessByCase.get(entry.id) ?? null}
                          {...(data.unreadableCases.has(entry.id)
                            ? { emptyLine: PROGRESS_IN_CASE_LINE }
                            : {})}
                        />
                      </span>
                    </span>
                    <span className="attention-end">
                      <span className="attention-chevron" aria-hidden="true">
                        ›
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {activeCases.length > HOME_CASES_VISIBLE ? (
            <p className="muted do-next-more">
              Showing {HOME_CASES_VISIBLE} of {activeCases.length} active cases. Open a person to
              see all of theirs.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Supporting content, after the actionable sections. One heading: the checklist's own, or the card's. */}
      {setupIncomplete || firstApplicant ? (
        <section id="home-journey" className="home-journey u-mb-150" aria-label="My Next Journey">
          {setupIncomplete ? (
            <Checklist title="My Next Journey" items={setupSteps} />
          ) : firstApplicant ? (
            <article className="card home-journey-card">
              <h2 className="card-title">My Next Journey</h2>
              <p className="card-body">
                Planning another trip? Start a case and check your saved documents against it.
              </p>
              <Link
                className="btn btn-secondary do-next-link"
                href={`/app/applicant/${firstApplicant.applicant.id}/missions`}
              >
                Start a Case
              </Link>
            </article>
          ) : null}
        </section>
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
