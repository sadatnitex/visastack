import {
  accountPrincipal,
  getApplicant,
  listApplicantProfile,
  listAskingAgencies,
  listDocumentsDetailed,
  listEvidenceRequestsForApplicant,
  listRequestItemExtras,
  referenceCodesFor,
  requireAccess,
} from '@visastack/services';
import type { AskingAgency, RequestItemExtras } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { ListWithPane } from '../../../../../components/list-pattern';
import { ShowMore } from '../../../../../components/show-more';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { AboutDisclosure, AlertBanner } from '../../../../../components/ui-lift';
import { applicantEvidenceCatalog } from '../../../../../i18n/applicant-evidence';
import { depthCopyFor } from '../../../../../lib/ccd/depth-copy';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import {
  TRAVELLER_LIST_STEP,
  firstParam,
  nextShow,
  pagingHref,
  parseShow,
} from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { AnswerFromRecordsCard } from './answer-from-records-card';
import { choiceBasisFor } from './choice-basis';
import { AWAITING_SUBMISSION } from './due-label';
import { OpenRequestFromHash } from './open-request-from-hash';
import { requestItemView } from './request-item';
import { requestBucket, respondingDocumentState } from './request-model';
import { type RequestEntry, requestPanes } from './request-panes';
import { loadRequestHistories } from './request-thread-data';
import { RequestsList } from './requests-list';

export const metadata: Metadata = { title: 'Requests from Agencies' };

export const dynamic = 'force-dynamic';

/** The address parameter for how many requests show. */
const SHOW_KEY = 'show';
/** Every request stays reachable (each may need a reply), so the list may grow this far. */
const REQUEST_SHOW_MAX = 500;
const REQUEST_NOUN = { one: 'request', other: 'requests' } as const;
/** The address parameter that names the request whose panel is open. */
const ITEM_KEY = 'item';
/** `done=answered` with `item=<request>` draws the receipt for that request after an answer (F2). */
const DONE_KEY = 'done';

/** Every agency that has asked this traveller for anything, or none when they cannot be read. */
async function readAskingAgencies(
  db: Parameters<typeof getApplicant>[0],
  accountId: string,
  applicantId: string,
): Promise<readonly AskingAgency[]> {
  try {
    const manage = await requireAccess(
      db,
      accountPrincipal(accountId),
      'MANAGE',
      { applicantId },
      { purpose: 'self' },
    );
    if (!manage.ok) return [];
    const asking = await listAskingAgencies(manage.value);
    return asking.ok ? asking.value : [];
  } catch {
    return [];
  }
}

export default async function EvidencePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  /** `show`: how many requests to list (WP-SB3: 10, then 10 more with each Show More). */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await primeLocale();
  const t = getServerT(applicantEvidenceCatalog);
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const requestsShown = parseShow(search[SHOW_KEY], {
    step: TRAVELLER_LIST_STEP,
    max: REQUEST_SHOW_MAX,
  });

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [requests, profile, documents] = await Promise.all([
      listEvidenceRequestsForApplicant(db, accountId, id, { limit: requestsShown }),
      listApplicantProfile(db, id),
      listDocumentsDetailed(db, accountId, id),
    ]);
    const requestList = requests.ok ? requests.value.items : [];
    // What was said on each request so far: its decisions and, for a document, every send with its
    // time, read as the owner. It runs beside the reads below; a read that fails is shown as such,
    // never as "nothing happened".
    const historiesRead = loadRequestHistories({
      db,
      accountId,
      applicantId: id,
      requests: requestList,
    });
    // Visible request codes (ADR 0018), so the traveller and the agency can name the same request.
    const referenceCodes = await referenceCodesFor(
      db,
      'R',
      requestList.map((req) => req.id),
    );
    // What each checklist item says about its evidence, and the person's own questions. Read through
    // the central gate as the owner; if that fails the page simply shows neither.
    const access = await requireAccess(
      db,
      accountPrincipal(accountId),
      'VIEW_METADATA',
      { applicantId: id },
      { purpose: 'self' },
    );
    const listedExtras = access.ok
      ? await listRequestItemExtras(access.value, referenceCodes)
      : null;
    const extras: RequestItemExtras = listedExtras?.ok
      ? listedExtras.value
      : { rules: new Map(), questions: new Map() };
    // The copies that can be sent for a document request still waiting on the person: only the
    // everyday copy of each document (not archived, removed or replaced), each with how its own
    // file was checked. If any of it cannot be read, no copy is offered and the person is told.
    const choiceBasis = await choiceBasisFor({
      db,
      access: access.ok ? access.value : null,
      documents: documents.ok ? documents.value : [],
      docTypes: new Set(
        requestList.flatMap((req) =>
          req.kind === 'DOCUMENT' && AWAITING_SUBMISSION.has(req.status) && req.docType
            ? [req.docType]
            : [],
        ),
      ),
    });
    // Who is waiting, for the card above the list and the "Asked by" line in each request. It needs
    // the owner's full proof; if that cannot be had, or the read fails, the page simply shows
    // neither: a card that cannot be drawn must never take the requests down with it.
    const askingAgencies = await readAskingAgencies(db, accountId, id);
    const histories = await historiesRead;
    return {
      askingAgencies,
      applicant,
      referenceCodes,
      requests: requestList,
      requestsRead: requests.ok,
      requestCounts: requests.ok ? requests.value.counts : { total: 0, awaiting: 0 },
      moreRequests: requests.ok && requests.value.more,
      profile,
      documents: documents.ok ? documents.value : [],
      documentsRead: documents.ok,
      histories,
      extras,
      choiceBasis,
    };
  });

  if (!data) notFound();

  const sorted = [...data.requests].sort((x, y) => {
    const waiting = (r: { status: string }) => (AWAITING_SUBMISSION.has(r.status) ? 0 : 1);
    if (waiting(x) !== waiting(y)) return waiting(x) - waiting(y);
    // Soonest deadline first; no deadline last.
    const dx = x.dueDate ? new Date(x.dueDate).getTime() : Number.POSITIVE_INFINITY;
    const dy = y.dueDate ? new Date(y.dueDate).getTime() : Number.POSITIVE_INFINITY;
    return dx - dy;
  });
  // Counted over every request, not only the ones on this page.
  const awaitingCount = data.requestCounts.awaiting;
  const requestsNext = data.moreRequests
    ? nextShow(data.requests.length, { step: TRAVELLER_LIST_STEP, max: REQUEST_SHOW_MAX })
    : null;
  // The card appears only for an agency that waits on a document: the one thing it can answer.
  const answerable = data.askingAgencies.filter((agency) => agency.waitingDocuments >= 1);
  const timeZone = data.applicant.timezone;
  const depth = await readDepth('evidence-requests');
  const entries: RequestEntry[] = sorted.map((req) => ({
    req,
    item: requestItemView({
      request: req,
      document: respondingDocumentState(req, data.documents, data.documentsRead),
      rule: data.extras.rules.get(req.id),
    }),
  }));
  // Waiting first, then being checked, then finished, each keeping the order above.
  const order = ['waiting', 'checking', 'finished'] as const;
  const ordered = [...entries].sort(
    (x, y) =>
      order.indexOf(requestBucket(x.req, x.item)) - order.indexOf(requestBucket(y.req, y.item)),
  );
  const positions = new Map(sorted.map((req, index) => [req.id, index + 1] as const));
  // Glance is what needs the person: a request waiting on a reply, and a sent file that could
  // not be used (they ask the agency about it). Everything else starts at Browse.
  const needsPerson = (entry: RequestEntry) => requestBucket(entry.req, entry.item) === 'waiting';
  // While more requests exist than this page shows, the page never claims nothing is waiting.
  const nothingWaiting =
    data.requestCounts.total > 0 &&
    awaitingCount === 0 &&
    !data.moreRequests &&
    !entries.some(needsPerson);
  const openItem = firstParam(search[ITEM_KEY]);
  const answeredId = firstParam(search[DONE_KEY]) === 'answered' ? openItem : undefined;
  // Links the page draws keep the other parameters but not `done`: the receipt is for this visit.
  const { [DONE_KEY]: _receipt, ...linkSearch } = search;
  // After Show More, the first request it added: its folder opens so the landing is on screen.
  const landPosition =
    requestsShown > TRAVELLER_LIST_STEP ? requestsShown - TRAVELLER_LIST_STEP + 1 : undefined;
  // The same address with this request chosen, every other parameter kept (a list that was
  // expanded stays expanded); the anchor is the one emails and notices use.
  const itemHref = (requestId: string) =>
    pagingHref(
      `/app/applicant/${id}/evidence`,
      linkSearch,
      { [ITEM_KEY]: requestId },
      `request-${requestId}`,
    );
  const panes = requestPanes({
    applicantId: id,
    timeZone,
    entries: ordered,
    referenceCodes: data.referenceCodes,
    profile: data.profile,
    documents: data.documents,
    documentsRead: data.documentsRead,
    extras: data.extras,
    choiceBasis: data.choiceBasis,
    histories: data.histories,
    askingAgencies: new Map(
      data.askingAgencies.map(
        (agency) => [agency.organizationId, agency.organizationName] as const,
      ),
    ),
    ...(answeredId ? { answeredId } : {}),
  });

  return (
    <>
      <PageHeader
        eyebrow={data.applicant.displayName}
        title={t('applicantEvidence.appApplicantIdEvidencePage.requestsFromAgencies')}
      />
      {/* Owner, 10 Nov 2026: the page says who is asking, and that it is not a government rule. */}
      <p className="muted">
        {t.node('applicantEvidence.appApplicantIdEvidencePage.anAgencyIsAskingYouFor')}
      </p>
      {/* Owner, 5 Nov 2026: no page should have more than 30 words. The rest is one tap away. */}
      <AboutDisclosure summary={t('applicantEvidence.appApplicantIdEvidencePage.aboutRequests')}>
        <p>
          {t.node('applicantEvidence.appApplicantIdEvidencePage.anAgencyRequestIsThatOrganisation')}
        </p>
      </AboutDisclosure>

      <DepthScope family="evidence-requests" depth={depth}>
        <DepthSwitch family="evidence-requests" initial={depth} copy={depthCopyFor('evidence')} />

        {nothingWaiting ? (
          <p className="muted" data-only="glance">
            {t.node('applicantEvidence.appApplicantIdEvidencePage.nothingIsWaitingForYou')}
          </p>
        ) : null}

        {awaitingCount > 0 ? (
          <div className="request-waiting-notice">
            <AlertBanner
              tone="warning"
              title={
                awaitingCount === 1
                  ? t('applicantEvidence.appApplicantIdEvidencePage.1RequestIsWaitingForYou')
                  : t(
                      'applicantEvidence.appApplicantIdEvidencePage.awaitingcountRequestsAreWaitingForYou',
                      { awaitingCount },
                    )
              }
            />
          </div>
        ) : null}

        {answerable.length > 0 ? (
          <AnswerFromRecordsCard applicantId={id} agencies={answerable} />
        ) : null}

        {!data.requestsRead ? (
          // A failed read never claims there are no requests: one may be waiting.
          <article className="card lc-empty-host">
            <p className="notice notice-warn u-m-0" role="alert">
              {t.node('applicantEvidence.appApplicantIdEvidencePage.yourRequestsCouldNotBeLoaded')}
            </p>
          </article>
        ) : data.requestCounts.total === 0 ? (
          <article className="card lc-empty-host">
            <EmptyState
              icon="clipboard"
              title={t('applicantEvidence.appApplicantIdEvidencePage.noEvidenceRequests')}
              fold
              why="You reply from your saved documents in one step, and you decide what to send."
              action={{ href: `/app/applicant/${id}/documents`, label: 'Open Documents' }}
            >
              {t.node('applicantEvidence.appApplicantIdEvidencePage.thisIsWhereAnAgencyAsks')}
            </EmptyState>
          </article>
        ) : (
          <div className="req-grid" {...(nothingWaiting ? atLevel('browse') : {})}>
            <ListWithPane
              panes={panes}
              initial={openItem}
              param={ITEM_KEY}
              paneLabel="Request Details"
              backLabel="Back to Requests"
              backHref={`/app/applicant/${id}/evidence`}
            >
              <div className="req-list lc-empty-host">
                <RequestsList
                  entries={ordered}
                  itemHref={itemHref}
                  openItem={openItem}
                  positions={positions}
                  landPosition={landPosition}
                />
                <ShowMore
                  id="evidence-requests-more"
                  pathname={`/app/applicant/${id}/evidence`}
                  searchParams={linkSearch}
                  next={requestsNext === null ? null : { [SHOW_KEY]: requestsNext }}
                  shown={data.requests.length}
                  total={data.requestCounts.total}
                  noun={REQUEST_NOUN}
                  landOn={`evidence-row-${data.requests.length + 1}`}
                />
              </div>
            </ListWithPane>
            {/* After the list, so its click handling is already in place when this opens a panel. */}
            <OpenRequestFromHash />
          </div>
        )}
      </DepthScope>
    </>
  );
}
