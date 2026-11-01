import { isUuid, summarizeCaseTriage } from '@visastack/services';
import type { Metadata } from 'next';
import Link from 'next/link';
import { DepthScope } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import { EmptyState } from '../../../../../components/ui';
import { depthCopy } from '../../../../../lib/ccd/depth-copy';
import { depthWord } from '../../../../../lib/ccd/depth-words';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { formatDateOnly } from '../../../../../lib/format-date';
import {
  SHOW_MAX,
  type SearchParamsRecord,
  firstParam,
  pagingHref,
} from '../../../../../lib/paging';
import { withSession } from '../../../../../lib/session';
import { caseNeedsYou } from '../case-needs';
import { STAGE_LABELS } from '../case-search-form';
import { caseTriageView } from '../case-triage';
import {
  AGENCY_LIST_SIZES,
  CASE_NOTES_STEP,
  type OpenCase,
  loadCaseListPage,
  loadEvidenceRequests,
  loadMembers,
  loadOpenCase,
  loadOrgAccess,
} from '../console-data';
import { MissionCollaboration } from '../mission-collaboration';
import { ListPager } from './list-pager';
import { type ListKeys, type ListWindow, listWindow } from './list-window';
import { CASE_ANCHOR, OpenCaseFromLink } from './open-case-from-link';

export const metadata: Metadata = { title: 'Agency Cases' };

export const dynamic = 'force-dynamic';

/** The address parameters this page reads. */
const CASE_KEY = 'case';
const LIST_KEYS: ListKeys = { show: 'show', before: 'before', from: 'from' };
const NOTES_KEYS: ListKeys = { show: 'notes', before: 'notesBefore', from: 'notesFrom' };
const NOTES_SIZES = { step: CASE_NOTES_STEP, max: SHOW_MAX } as const;

/** Where a case's workspace opens on this page; the list and every other screen link here. */
function caseHref(pathname: string, query: SearchParamsRecord, missionId: string): string {
  return pagingHref(
    pathname,
    query,
    {
      [CASE_KEY]: missionId,
      [NOTES_KEYS.show]: null,
      [NOTES_KEYS.before]: null,
      [NOTES_KEYS.from]: null,
    },
    `${CASE_ANCHOR}${missionId}`,
  );
}

/**
 * Cases: the cases this person can see, 15 at a time, and the workspace of the one case that is
 * open (`?case=<id>`) with its team, notes, tasks, appointments, requirements, reviewer decisions
 * and issuer confirmations (Commercial V1 Part 9 UX-01, Scroll Budget WP-SB5). Only the open case
 * is read in full, and its notes 10 at a time; the list reads nothing per case. The open workspace
 * has the anchor `#mission-<id>`, and an older link that carries only that anchor still opens it.
 *
 * Levels (CCD-6, screen 15): the case list and the open case with what needs this person at
 * Glance; where it stands and who is assigned at Browse; the working sections at Everything. A
 * link to a case opens the whole case.
 */
export default async function AgencyCasesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ orgId: string }>;
  readonly searchParams?: Promise<SearchParamsRecord>;
}) {
  const { orgId } = await params;
  const query: SearchParamsRecord = (await searchParams) ?? {};
  const pathname = `/app/agency/${orgId}/cases`;
  const listPage = listWindow(query, LIST_KEYS, AGENCY_LIST_SIZES);
  const requested = firstParam(query[CASE_KEY]);
  // A case id or nothing: anything else opens nothing and reads nothing.
  const openId = requested && isUuid(requested) ? requested.toLowerCase() : undefined;
  const notesPage = listWindow(query, NOTES_KEYS, NOTES_SIZES);

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    // The layout explains the "no role" case; there is nothing to load for it.
    if (!access?.member) return null;
    const members = await loadMembers(db, accountId, orgId, access);
    const [list, open] = await Promise.all([
      loadCaseListPage(db, accountId, orgId, {
        limit: listPage.limit,
        before: listPage.before,
      }),
      openId
        ? loadOpenCase(db, accountId, orgId, members, openId, {
            notesLimit: notesPage.limit,
            notesBefore: notesPage.before,
          })
        : Promise.resolve(null),
    ]);
    // Requests are administrator data (none for anyone else), read only for the open case.
    const requests = open
      ? await loadEvidenceRequests(db, accountId, orgId, access, {
          withFileStates: true,
          forCase: { missionId: open.missionId, applicantId: open.applicantId },
        })
      : [];
    return { admin: access.admin, members, list, open, requests, viewerAccountId: accountId };
  });
  if (!data) return null;

  const empty = data.list.total === 0;
  const depth = await readDepth('agency-cases');
  const depthWords = depthCopy({
    glance: depthWord(empty ? 'depth.agency-cases.glance.empty' : 'depth.agency-cases.glance'),
    browse: depthWord(empty ? 'depth.agency-cases.browse.empty' : 'depth.agency-cases.browse'),
    everything: depthWord(
      empty ? 'depth.agency-cases.everything.empty' : 'depth.agency-cases.everything',
    ),
  });

  const open = data.open;

  return (
    <DepthScope family="agency-cases" depth={depth}>
      <OpenCaseFromLink />
      <DepthSwitch family="agency-cases" initial={depth} copy={depthWords} />
      <article className="card">
        <p className="card-kicker">Collaborate</p>
        <h2 className="card-title">Cases</h2>
        <p className="card-body u-mb-125">
          {data.admin
            ? 'Assign a team member and leave case notes on any case this organization has a grant for.'
            : "Leave case notes and record decisions on cases you're assigned to."}
        </p>
        {empty ? (
          <EmptyState
            title="No Cases Yet"
            icon="briefcase"
            why="Once a client accepts, their cases appear here with how many checklist items are ready."
            {...(data.admin
              ? { action: { href: `/app/agency/${orgId}/clients`, label: 'Invite a Client' } }
              : {})}
          >
            {data.admin
              ? 'No cases are reachable yet - a traveller must grant this organization access to a specific case.'
              : "You aren't assigned to any cases yet - ask an admin to assign you to one."}
          </EmptyState>
        ) : (
          <>
            <ul className="agency-case-list" id="agency-case-list" aria-label="Cases">
              {data.list.cases.map((row) => {
                const isOpen = open?.missionId === row.missionId;
                return (
                  <li key={row.missionId} className="agency-case-list-row">
                    <Link
                      href={caseHref(pathname, query, row.missionId)}
                      className={`agency-case-list-link${isOpen ? ' agency-case-list-open' : ''}`}
                      aria-current={isOpen ? 'true' : undefined}
                    >
                      <span className="agency-case-list-title">
                        {row.applicantName} · {row.title}
                      </span>
                      <span className="agency-case-list-meta muted">
                        {STAGE_LABELS[row.state] ?? row.state}
                        {row.destination ? ` · ${row.destination}` : ''}
                        {row.targetDeadline
                          ? ` · deadline ${formatDateOnly(row.targetDeadline)}`
                          : ''}
                        {row.referenceCode ? (
                          <>
                            {' · '}
                            <span translate="no">{row.referenceCode}</span>
                          </>
                        ) : null}
                      </span>
                      <span className="agency-case-list-action">
                        {isOpen ? 'Open Now' : 'Open Case'}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <ListPager
              id="agency-case-list-more"
              landOn="agency-case-list"
              pathname={pathname}
              query={query}
              keys={LIST_KEYS}
              sizes={AGENCY_LIST_SIZES}
              window={listPage}
              shown={data.list.cases.length}
              total={data.list.total}
              nextCursor={data.list.nextCursor}
              noun={{ one: 'case', other: 'cases' }}
              newestLabel="Back to the Newest Cases"
            />
          </>
        )}
      </article>

      {openId && !open ? (
        <article className="card u-mt-150" id="agency-open-case">
          <p className="card-body">
            That case is not open to you. It may no longer be shared with this organization, or you
            may not be assigned to it. Choose a case from the list.
          </p>
        </article>
      ) : null}

      {open ? (
        <article className="card u-mt-150" id="agency-open-case" aria-label="Open case">
          <OpenCaseWorkspace
            orgId={orgId}
            pathname={pathname}
            query={query}
            admin={data.admin}
            viewerAccountId={data.viewerAccountId}
            members={data.members}
            open={open}
            requests={data.requests}
            notesPage={notesPage}
          />
        </article>
      ) : !empty && !openId ? (
        <p className="card-body u-mt-100 muted">
          Choose a case to open its workspace: its team, notes, tasks and appointments.
        </p>
      ) : null}
    </DepthScope>
  );
}

function OpenCaseWorkspace({
  orgId,
  pathname,
  query,
  admin,
  viewerAccountId,
  members,
  open,
  requests,
  notesPage,
}: {
  readonly orgId: string;
  readonly pathname: string;
  readonly query: SearchParamsRecord;
  readonly admin: boolean;
  readonly viewerAccountId: string;
  readonly members: readonly { readonly accountId: string; readonly email: string }[];
  readonly open: OpenCase;
  readonly requests: Awaited<ReturnType<typeof loadEvidenceRequests>>;
  readonly notesPage: ListWindow;
}) {
  const summary = summarizeCaseTriage({
    missionId: open.missionId,
    manualMode: open.manualMode,
    readiness: open.readiness,
    decisions: open.decisions,
    // Belt and braces: only an administrator's requests ever reach the summary.
    requests: admin ? requests : [],
    documentStates: new Map(
      requests.flatMap((r) =>
        admin && r.respondingDocumentState !== undefined
          ? [[r.id, r.respondingDocumentState] as const]
          : [],
      ),
    ),
  });
  const triage = caseTriageView(summary, {
    requirementLabels: new Map(open.requirements.map((r) => [r.id, r.label])),
    requestsIncluded: admin,
    // Lane Z: an answered file that is archived, replaced or removed says so (never its name).
    requestDocumentLabels: new Map(
      requests.flatMap((r) =>
        admin && r.respondingDocumentLabel ? [[r.id, r.respondingDocumentLabel] as const] : [],
      ),
    ),
  });
  return (
    <>
      <MissionCollaboration
        organizationId={orgId}
        missionId={open.missionId}
        applicantId={open.applicantId}
        title={open.title}
        {...(open.referenceCode ? { referenceCode: open.referenceCode } : {})}
        applicantName={open.applicantName}
        members={members.map((m) => ({ accountId: m.accountId, email: m.email }))}
        assignments={open.assignments}
        notes={open.notes}
        // Only the fields the workspace shows: a task's own time zone is used on the
        // server for due days and is not sent to the browser.
        tasks={open.tasks.map((task) => ({
          id: task.id,
          description: task.description,
          status: task.status,
          priority: task.priority,
          assigneeAccountId: task.assigneeAccountId,
          dueDate: task.dueDate,
        }))}
        appointments={open.appointments}
        requirements={open.requirements}
        decisions={open.decisions}
        issuerVerifications={open.issuerVerifications}
        viewerAssigned={open.viewerAssigned}
        triage={triage}
        // Right under the notes: how many show, and Show More 10 at a time.
        notesMore={
          <ListPager
            id={`notes-more-${open.missionId}`}
            landOn={`notes-${open.missionId}`}
            pathname={pathname}
            query={query}
            keys={NOTES_KEYS}
            sizes={NOTES_SIZES}
            window={notesPage}
            shown={open.notes.length}
            total={open.notesTotal}
            nextCursor={open.notesNextCursor}
            noun={{ one: 'note', other: 'notes' }}
            newestLabel="Back to the Newest Notes"
          />
        }
        needsYou={caseNeedsYou({
          viewerAccountId,
          admin,
          state: open.state,
          viewerAssigned: open.viewerAssigned,
          assignmentCount: open.assignments.length,
          tasks: open.tasks,
          triage: summary,
        })}
      />
    </>
  );
}
