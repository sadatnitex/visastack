import { CONSENT_TYPES, type ConsentType } from '@visastack/core';
import { type MessageKey, createTranslator } from '@visastack/i18n';
import {
  type AttentionItem,
  type Db,
  type DeadlineEntry,
  type NeedsAttention,
  type PackageNoticeTables,
  type TidyUpCounts,
  computeReadiness,
  getConsents,
  listApplicants,
  listAuditEventsForApplicant,
  listDocuments,
  listGrantsForRecipientAccount,
  listMembershipsForAccount,
  listNeedsAttention,
  rankAttentionItems,
  rankDeadlines,
  tidyUpCounts,
} from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { CaseReadinessBar, type ReadinessCounts } from '../../../components/case-readiness-ring';
import { CountryFlag } from '../../../components/country-flag';
import { DeadlineClock } from '../../../components/deadline-clock';
import { DepthScope, atLevel } from '../../../components/depth';
import { DepthSwitch } from '../../../components/depth-switch';
import { destinationFlagCode } from '../../../components/destination-label';
import { Icon, type IconName } from '../../../components/icons';
import { PROGRESS_IN_CASE_LINE } from '../../../components/progress-ring';
import {
  Checklist,
  Disclosure,
  EmptyState,
  NextStepCard,
  PageHeader,
  StatusBadge,
} from '../../../components/ui';
import { AboutDisclosure } from '../../../components/ui-lift';
import { holdsPlatformRole } from '../../../lib/admin';
import { depthCopyFor } from '../../../lib/ccd/depth-copy';
import { readDepth } from '../../../lib/ccd/depth.server';
import { countryNameOf, countryStartData, parseCountryParam } from '../../../lib/country-start';
import { COUNTRY_STEP_DONE } from '../../../lib/country-start-links';
import {
  ATTENTION_TIER_LABELS,
  CONSENT_PLAIN,
  CONSENT_SHORT,
  attentionActionLabel,
} from '../../../lib/labels';
import { getLocale } from '../../../lib/locale';
import { safeReturnPath } from '../../../lib/neon-recency';
import { openOwnerGate } from '../../../lib/owner-gate';
import {
  PACKAGE_NOTICE_TIER_LABEL,
  noticesByCase,
  noticesToRank,
  readPackageNoticeTables,
  readPackageNotices,
} from '../../../lib/package-notices';
import { plural } from '../../../lib/plural';
import {
  RECENT_ACTIVITY_LIMIT,
  type RecentActivityEntry,
  activityPerson,
  recentActivityEntries,
  seeAllActivityHref,
} from '../../../lib/recent-activity';
import { reportServerError } from '../../../lib/server-error';
import { withSession } from '../../../lib/session';
import { attentionContext, attentionHeading, attentionWhen } from '../attention-display';
import { ConsentButton } from '../consent-button';
import { confirmFirstRunCountryAction } from '../country-actions';
import {
  CLOCK_HOME_LIMIT,
  deadlineLines,
  readDeadlineEntries,
  validUntilLine,
} from '../deadline-clock-data';
import {
  FirstRunConsent,
  FirstRunCountry,
  FirstRunName,
  FirstRunTask,
  SETUP_LATER_HREF,
} from '../first-run';
import { HeldFilesLine, readHeldFileCount } from '../held-files-line';
import { CaseCard, PersonCard, StartCaseTile } from './home-cards';
import { RecentActivity } from './recent-activity';
import { TidyUpCard, tidyUpLine, tidyUpShortLine } from './tidy-up';

export const metadata: Metadata = { title: 'Account Overview' };

/** The picture for each Start Here task, so the three are told apart at a glance. */
const ENTRY_ICONS: Readonly<Record<string, IconName>> = {
  documents: 'folder',
  trips: 'globe',
  requests: 'share',
};

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
  noticeTables: PackageNoticeTables | null,
): Promise<{
  readonly attention: NeedsAttention | null;
  readonly deadlines: readonly DeadlineEntry[] | null;
  readonly tidy: TidyUpCounts | null;
  /** Package changes and checklist updates that need this person (UMPE P13); empty on failure. */
  readonly notices: readonly AttentionItem[];
}> {
  const access = await openOwnerGate(db, accountId, applicantId);
  if (!access) return { attention: null, deadlines: null, tidy: null, notices: [] };
  const [listed, deadlines, tidy, notices] = await Promise.all([
    listNeedsAttention(access, { now }),
    readDeadlineEntries(access, now, CLOCK_HOME_LIMIT),
    // Tidy Up (LC-C): any failure, even one thrown before the read starts, hides the card
    // rather than failing Home.
    Promise.resolve()
      .then(() => tidyUpCounts(db, applicantId, access, { now }))
      .catch(() => null),
    // A failed read leaves the notices out; Home never fails for them.
    readPackageNotices(access, noticeTables).then((read) => read ?? []),
  ]);
  return { attention: listed.ok ? listed.value : null, deadlines, tidy, notices };
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

/**
 * Tidy Up across the people Home reads: the first record with something to tidy, its own counts
 * (so the line matches what its one button opens) and how many other records have some too.
 */
function tidyUpSummary(
  rows: readonly {
    readonly applicant: { readonly id: string };
    readonly tidy: TidyUpCounts | null;
  }[],
): { readonly line: string; readonly short: string; readonly href: string } | null {
  const withItems = rows.filter(
    (row) => row.tidy && row.tidy.duplicates + row.tidy.expired + row.tidy.replaced > 0,
  );
  const first = withItems[0];
  if (!first?.tidy) return null;
  return {
    line: tidyUpLine(first.tidy, withItems.length - 1),
    short: tidyUpShortLine(first.tidy, withItems.length - 1),
    href: `/app/applicant/${first.applicant.id}/documents`,
  };
}

/**
 * The newest few events of ONE person's Access Log for Home's Recent Activity: the person's own
 * record when there is one, else the first person Home reads. One bounded read (the same owner
 * check and newest-first order as the Sharing page's log); a failure leaves the card out, so Home
 * never fails for it.
 */
async function loadRecentActivity(
  db: Db,
  accountId: string,
  email: string,
  people: readonly Basics['applicants'][number][],
  coreGranted: boolean,
): Promise<{
  readonly seeAllHref: string;
  readonly entries: readonly RecentActivityEntry[];
} | null> {
  // The card is part of the record's own section, shown only while core processing is on.
  const person = coreGranted ? activityPerson(people) : undefined;
  if (!person) return null;
  try {
    const events = await listAuditEventsForApplicant(
      db,
      accountId,
      person.id,
      RECENT_ACTIVITY_LIMIT,
    );
    return {
      seeAllHref: seeAllActivityHref(person.id),
      entries: recentActivityEntries(events, email),
    };
  } catch (error) {
    reportServerError('home.recentActivity', error);
    return null;
  }
}

async function loadDashboard(db: Db, accountId: string, email: string, basics: Basics) {
  const { consents, incomingGrants, applicants } = basics;
  const now = new Date();
  // Which package tables exist, asked once for every person Home reads (UMPE P13).
  const noticeTables = await readPackageNoticeTables(db);
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
        const [docs, { attention, deadlines, tidy, notices }] = await Promise.all([
          listDocuments(db, accountId, applicant.id),
          loadPersonReads(db, accountId, applicant.id, now, noticeTables),
        ]);
        return {
          applicant,
          documentCount: docs.ok ? docs.value.length : 0,
          attention,
          deadlines,
          tidy,
          notices,
          itemCount: (attention?.items.length ?? 0) + notices.length,
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
  const notices = perApplicant.flatMap((row) => row.notices);
  const listed = perApplicant.flatMap((row) => row.attention?.items ?? []);
  // UMPE P13: package changes and checklist updates, ranked beside "changed since confirmed"; a
  // case already listed as changed keeps that one item.
  const ranked = noticesToRank(listed, notices);
  const attention = rankAttentionItems([...listed, ...ranked, ...(sharing ? [sharing] : [])]);

  // The next dates across every person, soonest first (Growth G5). A person whose dates could not
  // be read is left out of the merge and said so; if nobody's could be read, none are shown.
  const readable = perApplicant.flatMap((row) => (row.deadlines === null ? [] : [row.deadlines]));
  const clock = {
    entries: rankDeadlines(readable.flat(), CLOCK_HOME_LIMIT),
    unreadablePeople: perApplicant.length - readable.length,
    readable: perApplicant.length === 0 || readable.length > 0,
  };

  const [heldFiles, recentActivity] = await Promise.all([
    readHeldFileCount(db, accountId, perApplicant[0]?.applicant.id),
    loadRecentActivity(
      db,
      accountId,
      email,
      perApplicant.map((row) => row.applicant),
      Boolean(consents.CORE_PROCESSING),
    ),
  ]);

  return {
    email,
    consents,
    applicants,
    perApplicant,
    tidyUp: tidyUpSummary(perApplicant),
    // UMPE G4: family files waiting for Which Person? (never throws; a failed read counts none).
    heldFiles,
    recentActivity,
    clock,
    readinessByCase,
    unreadableCases,
    attention,
    // Which listed cases have a change waiting, so Home can say so beside the case itself.
    caseNotices: noticesByCase(notices),
    noticeKeys: new Set(ranked.map((notice) => notice.key)),
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

interface SearchParams {
  readonly next?: string | string[];
  readonly setup?: string | string[];
  readonly welcome?: string | string[];
  /** P1: `1` right after the email confirmation link signed the person in. Shown once, as a line. */
  readonly confirmed?: string | string[];
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
        confirmed={params.confirmed === '1'}
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
        documentsHref={first ? `/app/applicant/${first.applicant.id}/documents/add` : null}
        tripHref="/app/mission/start"
      />
    );
  }

  const firstApplicant = data.perApplicant[0];
  const setupSteps = [
    {
      key: 'consent',
      label: 'Let VisaStack Process My Details',
      hint: 'Needed before anything can be saved. You can turn it off at any time.',
      done: coreGranted,
      href: '#permissions',
    },
    {
      key: 'applicant',
      label: 'Add a Traveller',
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
        ? `/app/applicant/${firstApplicant.applicant.id}/missions#start-case`
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
        title: 'Let VisaStack Process My Details',
        why: 'VisaStack cannot create traveller or profile records until you allow this. You can turn it off again at any time.',
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
            action: firstTodo.key === 'applicant' ? 'Add a Traveller' : 'Continue',
          }
        : peopleLeftOut
          ? {
              // Home reads only the first people, so it cannot say nothing is waiting at all.
              title: 'Up to Date for the People Shown',
              why: `Nothing is waiting for the first ${data.perApplicant.length} of ${data.applicants.length} people. Open the full list to check the others.`,
              href: '/app/applicants',
              action: 'See All Travellers',
              tone: 'ok' as const,
            }
          : {
              title: 'You Are Up to Date',
              // A calm all-clear with one real fact, never an invented task (CCD section 6).
              why: [
                'Nothing is waiting for you.',
                // Whose date it is only when there is more than one person, as the clock card.
                validUntilLine(data.clock.entries, { showPerson: data.perApplicant.length > 1 }),
                'Open a traveller to add documents or start a case.',
              ]
                .filter(Boolean)
                .join(' '),
              href: '/app/applicants',
              action: 'View Travellers',
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
      destination: entry.destination,
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

  // The person's own first name, from the record they keep for themselves, when there is one.
  const ownName = data.applicants.find((a) => a.relationship === 'SELF')?.displayName;
  const firstName = ownName?.trim().split(/\s+/)[0];
  // A greeting is a sentence, so it keeps sentence case (decision D3), not the Title Case of labels.
  const greeting = firstName ? `Welcome back, ${firstName}` : 'Welcome back';
  const depth = await readDepth('home');
  const depthWords = depthCopyFor('home');
  // UMPE P13: the three entry points as tasks, so a first file or an agency request never waits
  // for a profile to be filled in. Each opens an existing page.
  const waitingRow = data.perApplicant.find((row) => row.waitingRequests > 0);
  const entryPoints = firstApplicant
    ? [
        {
          key: 'documents',
          label: 'Add Documents',
          hint: 'My Documents: upload a passport page or any file, and sort it out later.',
          href: `/app/applicant/${firstApplicant.applicant.id}/documents/add`,
        },
        {
          key: 'trips',
          label: 'Start a Trip',
          hint: 'My Trips: say where and why, and see what to prepare for each traveller.',
          href: '/app/mission/start',
        },
        waitingRow
          ? {
              key: 'requests',
              label: 'Answer a Request',
              hint: `Sharing & Requests: an agency is waiting for ${waitingRow.applicant.displayName}.`,
              href: `/app/applicant/${waitingRow.applicant.id}/evidence`,
            }
          : {
              key: 'requests',
              label: 'See Sharing & Requests',
              hint: 'Who can see what, agency requests and the answers you sent.',
              href: `/app/applicant/${firstApplicant.applicant.id}/sharing`,
            },
      ]
    : [];

  return (
    <section className="section container">
      {/* The account-wide page, kept distinct from each traveller's own page (named after them):
          this one gathers every traveller, agency work and the permissions on the account. */}
      <PageHeader
        eyebrow="Account Overview"
        title={greeting}
        description={
          <>
            Signed in as{' '}
            <span className="depth-email" data-value>
              {data.email}
            </span>
          </>
        }
      />

      {/* Owner, 5 Nov 2026: no page should have more than 30 words. What this page gathers is one tap away. */}
      <AboutDisclosure summary="About This">
        <p>
          What needs you across every traveller on this account, with your agency work and the
          permissions you control.
        </p>
      </AboutDisclosure>

      <DepthScope family="home" depth={depth}>
        <DepthSwitch family="home" initial={depth} copy={depthWords} notesBehindInfo />

        <NextStepCard {...nextStep} />

        {coreGranted && entryPoints.length > 0 ? (
          <section className="home-entry" aria-labelledby="home-entry-heading">
            <h2 className="card-kicker home-entry-heading" id="home-entry-heading">
              Start Here
            </h2>
            <ul className="first-run-tasks home-entry-points">
              {entryPoints.map((entry) => (
                <li key={entry.key}>
                  <Link className="home-entry-link" href={entry.href}>
                    <Icon name={ENTRY_ICONS[entry.key] ?? 'file'} size={22} />
                    <b>{entry.label}</b>
                    <span>{entry.hint}</span>
                    <Icon name="arrow" size={18} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {coreGranted && rest.length > 0 ? (
          <p className="muted do-next-more" data-only="glance">
            {rest.length} more {rest.length === 1 ? 'thing is' : 'things are'} waiting.{' '}
            <a href="#home-attention-heading">See what is waiting</a>
          </p>
        ) : null}

        {coreGranted && data.tidyUp ? <TidyUpCard {...data.tidyUp} /> : null}
        {/* UMPE G4: family files waiting for Which Person? (one line, nothing when none). */}
        {coreGranted ? (
          <HeldFilesLine applicantId={data.perApplicant[0]?.applicant.id} count={data.heldFiles} />
        ) : null}

        {coreGranted && rest.length > 0 ? (
          <section
            className="card u-mb-150"
            aria-labelledby="home-attention-heading"
            {...atLevel('browse')}
          >
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
                      <span className="do-next-tier">
                        {data.noticeKeys.has(item.key)
                          ? PACKAGE_NOTICE_TIER_LABEL
                          : ATTENTION_TIER_LABELS[item.tier]}
                      </span>
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
                Showing {restShown.length} of {rest.length}. The rest are on each person&apos;s
                pages. <Link href="/app/applicants">See All Travellers</Link>
              </p>
            ) : null}
            {peopleLeftOut ? (
              <p className="muted do-next-more">
                This list covers the first {data.perApplicant.length} of {data.applicants.length}{' '}
                people. <Link href="/app/applicants">See All Travellers</Link>
              </p>
            ) : null}
          </section>
        ) : null}

        {coreGranted && firstApplicant ? (
          <div className="u-mb-150" {...atLevel('browse')}>
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
          <section
            className="home-block u-mb-150"
            aria-labelledby="home-records-heading"
            {...atLevel('browse')}
          >
            <h2 className="home-block-title" id="home-records-heading">
              People
            </h2>
            {data.perApplicant.length === 0 ? (
              <EmptyState
                icon="users"
                title="No Travellers Yet"
                why="Add each person once, and every visa case reuses the same details."
                action={{ href: '/app/applicants', label: 'Add a Traveller' }}
              >
                A traveller is one person whose passport details and documents you keep here and
                reuse for each visa application.
              </EmptyState>
            ) : (
              <ul className="home-people">
                {data.perApplicant.map((row) => (
                  <PersonCard
                    key={row.applicant.id}
                    href={`/app/applicant/${row.applicant.id}`}
                    name={row.applicant.displayName}
                    documents={row.documentCount}
                    cases={row.activeMissions}
                    requests={row.waitingRequests}
                    actionNeeded={row.itemCount > 0}
                  />
                ))}
              </ul>
            )}
            <CalendarLinks people={data.perApplicant.map((row) => row.applicant)} />
            {data.applicants.length > data.perApplicant.length ? (
              <p className="muted do-next-more">
                Home shows the first {data.perApplicant.length} of {data.applicants.length} people.{' '}
                <Link href="/app/applicants">See All Travellers</Link>
              </p>
            ) : null}
          </section>
        ) : null}

        {coreGranted && data.perApplicant.length > 0 ? (
          <section
            className="home-block u-mb-150"
            aria-labelledby="home-work-heading"
            {...atLevel('browse')}
          >
            <h2 className="home-block-title" id="home-work-heading">
              Cases
            </h2>
            <div className="home-cases-area">
              {requestRows.length > 0 || activeCases.length > 0 ? (
                <ul className="home-cases">
                  {requestRows.map((row) => (
                    <CaseCard
                      key={`requests-${row.applicant.id}`}
                      href={`/app/applicant/${row.applicant.id}/evidence`}
                      title="Requests from an Agency"
                      person={
                        <>
                          {row.applicant.displayName}
                          {row.waitingRequests > 0
                            ? ` \u00b7 ${row.waitingRequests} waiting for you`
                            : ''}
                          {row.requestsWithAgency > 0
                            ? ` \u00b7 ${row.requestsWithAgency} with the agency`
                            : ''}
                        </>
                      }
                      {...(row.waitingRequests > 0
                        ? { badge: <StatusBadge tone="warning">Action Needed</StatusBadge> }
                        : {})}
                    />
                  ))}
                  {activeCases.slice(0, HOME_CASES_VISIBLE).map((entry) => (
                    <CaseCard
                      key={`case-${entry.id}`}
                      href={data.caseNotices.get(entry.id)?.href ?? `/app/mission/${entry.id}`}
                      title={entry.title}
                      person={entry.person}
                      {...(destinationFlagCode(entry.destination)
                        ? {
                            flag: (
                              <CountryFlag
                                iso2={destinationFlagCode(entry.destination)}
                                name={entry.destination}
                                size="md"
                              />
                            ),
                          }
                        : {})}
                      {...(data.caseNotices.has(entry.id)
                        ? {
                            // Beside the trip it concerns (UMPE P13): what changed, in two words.
                            badge: (
                              <StatusBadge tone="warning">
                                {data.caseNotices.get(entry.id)?.title}
                              </StatusBadge>
                            ),
                          }
                        : {})}
                    >
                      <CaseReadinessBar
                        readiness={data.readinessByCase.get(entry.id) ?? null}
                        {...(data.unreadableCases.has(entry.id)
                          ? { emptyLine: PROGRESS_IN_CASE_LINE }
                          : {})}
                      />
                    </CaseCard>
                  ))}
                </ul>
              ) : (
                <p className="card-body home-attention-why home-cases-empty">
                  Nothing is open right now. When an agency asks you for something, or you start a
                  case, it appears here with the next step.
                </p>
              )}
              {!setupIncomplete && firstApplicant ? (
                <StartCaseTile
                  href={`/app/applicant/${firstApplicant.applicant.id}/missions#start-case`}
                />
              ) : null}
            </div>
            {activeCases
              .slice(0, HOME_CASES_VISIBLE)
              .some((entry) => data.caseNotices.has(entry.id)) ? (
              <p className="muted do-next-more">
                Only changes that need you are shown here. Every earlier change is kept in{' '}
                <Link href="/app/notifications">Notifications</Link>.
              </p>
            ) : null}
            {activeCases.length > HOME_CASES_VISIBLE ? (
              <p className="muted do-next-more">
                Showing {HOME_CASES_VISIBLE} of {activeCases.length} active cases. Open a person to
                see all of theirs.
              </p>
            ) : null}
          </section>
        ) : null}

        {coreGranted && data.recentActivity ? (
          <RecentActivity
            entries={data.recentActivity.entries}
            seeAllHref={data.recentActivity.seeAllHref}
          />
        ) : null}

        {/* Supporting content, after the actionable sections: the get-started checklist while it is
            unfinished. Once it is done the next case is the open slot at the end of Cases. */}
        {setupIncomplete ? (
          <section
            id="home-journey"
            className="home-journey u-mb-150"
            aria-label="My Next Journey"
            {...atLevel('everything')}
          >
            <Checklist title="My Next Journey" items={setupSteps} />
          </section>
        ) : null}

        {/*
         * Always rendered, independent of `coreGranted` - the sole place any
         * consent type (including CORE_PROCESSING) is granted or revoked, so
         * AI/sharing/marketing consent stay independently controllable even
         * while core processing is absent or revoked
         * (docs/audits/post-programme-defect-register.md finding #22).
         * While core processing is off it is the next step: it stays at every level and opens by
         * itself, so the one required choice is never behind the switch.
         */}
        <div id="permissions" {...(coreGranted ? atLevel('everything') : {})}>
          <Disclosure
            title="Permissions You Control"
            hint={`${grantedCount} of ${CONSENT_TYPES.length} on`}
            open={!coreGranted}
          >
            {/* Owner, 5 Nov 2026: no page should have more than 30 words. A permission that sends
                something out keeps one short line on its row; the full wording of every permission
                is one tap away. */}
            <AboutDisclosure summary="About Permissions">
              <p>
                {locale === 'en'
                  ? 'Each one is on or off, and you can change it at any time. Turning one off never requires turning another back on. "Let VisaStack Process My Details" is needed before any traveller or profile can be created; the others are optional.'
                  : 'Each purpose is granted and revoked independently, at any time. Turning one off never requires turning another back on. Core processing is required before any traveller or profile records can be created; the others are optional.'}
              </p>
              {locale === 'en' ? (
                <ul>
                  {CONSENT_TYPES.map((type) => {
                    const plain = CONSENT_PLAIN[type];
                    return plain ? (
                      <li key={type}>
                        {plain.name}: {plain.meaning}
                      </li>
                    ) : null;
                  })}
                </ul>
              ) : null}
            </AboutDisclosure>
            <div className="rows">
              {CONSENT_TYPES.map((type) => {
                const plain = locale === 'en' ? CONSENT_PLAIN[type] : undefined;
                const name = plain?.name ?? t(CONSENT_MESSAGE_KEYS[type]);
                const on = Boolean(data.consents[type]);
                const short = locale === 'en' ? CONSENT_SHORT[type] : undefined;
                return (
                  <div className="row consent-row" key={type}>
                    <span className="row-key consent-text">
                      <span className="consent-name" data-value>
                        {name}
                      </span>
                      {short?.line ? (
                        <>
                          {' '}
                          <span className="consent-meaning">{short.line}</span>
                        </>
                      ) : null}
                    </span>
                    {plain ? (
                      <>
                        {short?.chip ? (
                          <span className="badge badge-neutral">{short.chip}</span>
                        ) : null}
                        <span className={`badge ${on ? 'badge-success' : 'badge-neutral'}`}>
                          {on ? 'On' : 'Off'}
                        </span>
                      </>
                    ) : null}
                    <ConsentButton type={type} granted={on} locale={locale} label={name} />
                  </div>
                );
              })}
            </div>
          </Disclosure>
        </div>
      </DepthScope>
    </section>
  );
}
