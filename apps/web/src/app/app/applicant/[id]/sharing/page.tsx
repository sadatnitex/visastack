import { aiAppLabel } from '@visastack/core/ai-features';
import { createTranslator } from '@visastack/i18n';
import {
  accountPrincipal,
  aiAssistAvailable,
  documentCategory,
  getAiFeatureStates,
  getApplicant,
  listAccessForApplicantDetailed,
  listAiConnectionFiles,
  listAiConnections,
  listAiDrafts,
  listAiFileCandidates,
  listApplicantProfile,
  listAuditEventsForApplicant,
  listDocumentsDetailed,
  listInvitationCaseExceptions,
  listMissions,
  listSharingInvitations,
  previewScopeExpansion,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { ActivityLog } from '../../../../../components/activity-log';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import {
  GroupedList,
  ListRow,
  ListWithPane,
  type PaneEntry,
} from '../../../../../components/list-pattern';
import { ShowMore } from '../../../../../components/show-more';
import { EmptyState, PageHeader } from '../../../../../components/ui';
import { AboutDisclosure } from '../../../../../components/ui-lift';
import { accessLogEventLabel } from '../../../../../lib/access-log-labels';
import { agencyAiAccessLine } from '../../../../../lib/agency-ai';
import { aiConnectorEnabled } from '../../../../../lib/ai-connector';
import {
  type AiFileChoice,
  consentChoicesFromQuery,
  isAiChangeDuration,
} from '../../../../../lib/ai-consent-choices';
import { aiAllowsSuggestions } from '../../../../../lib/ai-consent-labels';
import { decodeAiFilePicks, rememberedAiFilePicks } from '../../../../../lib/ai-file-picks-retry';
import { depthCopy } from '../../../../../lib/ccd/depth-copy';
import { depthWord } from '../../../../../lib/ccd/depth-words';
import { readDepth } from '../../../../../lib/ccd/depth.server';
import { formatTimestamp, formatTimestampDate } from '../../../../../lib/format-date';
import { grantRowLine } from '../../../../../lib/grant-row-line';
import { grantStatusBadge } from '../../../../../lib/grant-status';
import { primeLocale } from '../../../../../lib/i18n-server';
import { getLocale } from '../../../../../lib/locale';
import { newCategoriesWithData } from '../../../../../lib/master-profile';
import { nextShow, pagingHref, parseCursor, parseShow } from '../../../../../lib/paging';
import { plural } from '../../../../../lib/plural';
import { withSession } from '../../../../../lib/session';
import { GRANT_STATUS, INVITATION_STATUS } from '../../../../../lib/status-words';
import { accessDoneLine } from '../../../../../lib/success-lines';
import { CollectionAnswersSharingLine } from '../../../../collect/account/sharing-line';
import { revokeSharingInvitationAction } from './actions';
import {
  type AiChangeReturn,
  type AiConnectionFiles,
  AiConnectionsSection,
} from './ai-connections';
import { type AiDraftItem, AiDraftsSection } from './ai-drafts';
import { DoneNotice } from './done-notice';
import { GrantForm } from './grant-form';
import { GrantPane, REVOKE_SENTENCE } from './grant-pane';
import { OpenComposerFromHash } from './open-composer-from-hash';

const sharingInvitationFlag = 'PERSONAL_SHARING_INVITATIONS_ENABLED';

export const metadata: Metadata = { title: 'Sharing' };

export const dynamic = 'force-dynamic';

/** How many access log entries the page reads at once, newest first (WP-SB3: then older pages). */
const ACCESS_LOG_LIMIT = 50;
/** The address parameter holding the access log's older-page cursor. */
const LOG_KEY = 'log';
/** Where Show Older Entries lands: the access log itself. */
const LOG_ANCHOR = 'access-log';

/** WP-SB3: grants shown at first, and how many more each Show More adds. */
const GRANT_STEP = 5;
/** Every grant stays reachable (each has its own Pause and Revoke), so the list may grow this far. */
const GRANT_SHOW_MAX = 500;
/**
 * Address parameters that report a one-time result or carry a sign-in return. A Show More or
 * older-entries link drops them, so loading more never replays a notice or a returning choice.
 */
const ONE_TIME_PARAMS = ['done', 'ai', 'ai_change', 'document', 'item'];
/** The address parameter for how many grants show. */
const SHOW_KEY = 'show';
/** The word and tone on a grant's row; a state with no word of its own is shown as it is. */
const grantRowStatus = (status: string) =>
  GRANT_STATUS[status] ?? { word: status, tone: 'neutral' as const };
const invitationStatus = (status: string) =>
  INVITATION_STATUS[status] ?? { word: status, tone: 'neutral' as const };
const GRANT_NOUN = { one: 'grant', other: 'grants' } as const;

export default async function SharingPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  /**
   * `document`: one document to start the new sharing request with, from Share on the Record.
   * `ai`: what just happened to an AI connection (`off` or `changed`), after the page reloaded.
   * `ai_change` with `choice_*`: Change Access choices coming back from a fresh sign-in check.
   */
  readonly searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await primeLocale();
  const { id } = await params;
  const search = (await searchParams) ?? {};
  const one = (name: string) => {
    const value = search[name];
    return Array.isArray(value) ? value[0] : value;
  };
  const documentKey = 'document';
  const documentParam = search[documentKey];
  const aiParam = one('ai');
  const aiNotice = aiParam === 'off' || aiParam === 'changed' ? aiParam : undefined;
  // What the last change to access did, after the reload that shows the new list (fixed words only).
  const doneLine = accessDoneLine(one('done'));
  const connectorOn = aiConnectorEnabled();
  const aiChangeId = one('ai_change');
  const aiChangeDuration = one('choice_duration');
  const aiReturning: AiChangeReturn | undefined =
    aiChangeId && one('choice_layers') !== undefined
      ? {
          connectionId: aiChangeId,
          choices: consentChoicesFromQuery(one),
          duration: isAiChangeDuration(aiChangeDuration) ? aiChangeDuration : 'keep',
        }
      : undefined;
  const t = createTranslator(await getLocale());
  // WP-SB3: only the first grants are read in full; Show More asks for more (`?show=`).
  const grantsShown = parseShow(search[SHOW_KEY], { step: GRANT_STEP, max: GRANT_SHOW_MAX });
  // What paging links keep of this address: filters and other pages, never one-time results.
  const pagingSearch = Object.fromEntries(
    Object.entries(search).filter(
      ([key]) => !ONE_TIME_PARAMS.includes(key) && !key.startsWith('choice_'),
    ),
  );
  // The access log's older page, if one was asked for; the service checks it belongs to this log.
  const logBefore = parseCursor(search[LOG_KEY]);

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    // AI connections of this record, through the central access gate (owner only). Read even
    // while connecting AI apps is off, so a live connection can still be turned off.
    const listAiConnectionsOfRecord = async () => {
      const aiGate = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: id },
        { purpose: 'ai_connection' },
      );
      const listed = aiGate.ok ? await listAiConnections(aiGate.value) : null;
      const list = listed?.ok
        ? listed.value
        : { available: false, active: [], activeTotal: 0, recentlyEnded: [] };
      return { aiGate, list };
    };
    const readAiConnections = async (listing: ReturnType<typeof listAiConnectionsOfRecord>) => {
      const { aiGate, list } = await listing;
      if (!aiGate.ok || list.active.length === 0) {
        return { list, files: undefined, returningFiles: null, access: null };
      }
      // AI App Access and Original Files (S28, S20), read together and only with a live
      // connection to show them for, beside the files that may be ticked.
      const [states, candidates] = await Promise.all([
        getAiFeatureStates(db, ['ai_app_access', 'ai_app_original_files'], {
          proof: aiGate.value,
        }),
        listAiFileCandidates(aiGate.value),
      ]);
      // AI App Access (S28): while it is off, apps read nothing; the connections stay listed.
      const access = states.ai_app_access;
      // "Original Files" (S20): what may be ticked, and what each live connection has ticked.
      let files: AiConnectionFiles | undefined;
      if (candidates.ok && candidates.value.available) {
        const ticked = await listAiConnectionFiles(
          aiGate.value,
          list.active.map((item) => item.id),
        );
        files = {
          view: {
            available: states.ai_app_original_files.available,
            candidates: candidates.value.documents.map((document) => ({
              documentId: document.documentId,
              referenceCode: document.referenceCode,
              kind: document.kind,
              group: document.group,
              safeCopyReady: document.safeCopyReady,
            })),
          },
          byConnection: Object.fromEntries(
            [...ticked].map(([connectionId, choices]) => [
              connectionId,
              choices.map(
                (choice): AiFileChoice => ({
                  documentId: choice.documentId,
                  variant: choice.variant === 'ORIGINAL' ? 'ORIGINAL' : 'SAFE_COPY',
                }),
              ),
            ]),
          ),
        };
      }
      // The files the person ticked before a fresh sign-in check: a signed cookie, never a link.
      const returningFiles =
        aiChangeId && files
          ? decodeAiFilePicks(await rememberedAiFilePicks(), {
              accountId,
              applicantId: id,
              target: aiChangeId,
            })
          : null;
      return { list, files, returningFiles, access };
    };
    // What AI apps left for the person (S21): their drafts, and whether suggestions work now, read
    // through this read's own proof. Drafts stay readable and removable whether or not the
    // feature is on; its state is read only when there are drafts or connections to show it for.
    const readAiSuggestions = async (listing: ReturnType<typeof listAiConnectionsOfRecord>) => {
      const gate = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: id },
        { purpose: 'ai_drafts' },
      );
      if (!gate.ok) return { available: false, drafts: [] as AiDraftItem[], more: 0 };
      const drafts = await listAiDrafts(gate.value);
      // Waits only for the list of connections, never for their files.
      const shown = drafts.drafts.length > 0 || (await listing).list.active.length > 0;
      const states = shown
        ? await getAiFeatureStates(db, ['ai_app_suggestions'], { proof: gate.value })
        : null;
      return {
        available: states?.ai_app_suggestions.available ?? false,
        drafts: drafts.drafts.map(
          (draft): AiDraftItem => ({
            id: draft.id,
            title: draft.title,
            body: draft.body,
            caseTitle: draft.caseTitle,
            app: aiAppLabel({ name: draft.appName, host: draft.appHost }),
            savedOn: formatTimestampDate(draft.createdAt),
          }),
        ),
        more: drafts.more,
      };
    };
    const aiListing = listAiConnectionsOfRecord();
    const [access, documents, auditEvents, profileEntries, aiRead, aiSuggestions] =
      await Promise.all([
        listAccessForApplicantDetailed(db, accountId, id, { limit: grantsShown }),
        listDocumentsDetailed(db, accountId, id),
        // A longer history than the old list showed: it now scrolls in its own box and filters.
        listAuditEventsForApplicant(db, accountId, id, {
          limit: ACCESS_LOG_LIMIT,
          ...(logBefore ? { before: logBefore } : {}),
        }),
        listApplicantProfile(db, id),
        readAiConnections(aiListing),
        readAiSuggestions(aiListing),
      ]);
    const grants = access.ok ? access.value.items : [];
    const grantCounts = access.ok
      ? access.value.counts
      : { total: 0, active: 0, holdingAccess: 0, holdingAccessShown: 0 };

    // PRD SHR-01: for every still-live category grant, find whatever now
    // matches its categories but isn't in scope yet, so the page can show
    // the "displayed confirmation" before any of it becomes visible.
    const expandable = grants.filter(
      (g) =>
        g.categories && g.categories.length > 0 && g.status !== 'REVOKED' && g.status !== 'EXPIRED',
    );
    const scopeExpansionEntries = await Promise.all(
      expandable.map(async (g) => {
        const candidates = await previewScopeExpansion(db, {
          actorAccountId: accountId,
          grantId: g.id,
        });
        return [g.id, candidates.ok ? candidates.value : []] as const;
      }),
    );
    const scopeExpansions = new Map(scopeExpansionEntries);

    const invitations =
      process.env[sharingInvitationFlag] === 'true'
        ? await listSharingInvitations(db, accountId, id)
        : [];
    // Cases a pending all-cases invitation will not cover once accepted (ADR
    // 0017), read through the central access gate (owner only).
    let invitationExceptions: Awaited<ReturnType<typeof listInvitationCaseExceptions>> = {
      ok: true,
      value: [],
    };
    if (invitations.some((invite) => invite.status === 'PENDING' && invite.missionId === null)) {
      const gate = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: id },
        { purpose: 'owner_case_sharing' },
      );
      if (gate.ok) invitationExceptions = await listInvitationCaseExceptions(gate.value);
    }

    // The cases Change Access can offer: only needed when a connection can be changed.
    const aiCases =
      connectorOn && aiRead.list.active.length > 0
        ? await listMissions(db, accountId, id).then((missions) =>
            missions.ok
              ? missions.value
                  .filter((mission) => mission.state !== 'CANCELLED' && mission.state !== 'CLOSED')
                  .map((mission) => ({ id: mission.id, title: mission.title }))
              : [],
          )
        : [];

    // S22: the agency AI choice is offered only once the permission exists in the database.
    const aiAssistReady = await aiAssistAvailable(db);

    return {
      aiAssistReady,
      aiConnections: aiRead.list,
      aiAccess: aiRead.access,
      aiFiles: aiRead.files,
      aiReturningFiles: aiRead.returningFiles,
      aiCases,
      aiSuggestions,
      invitations,
      invitationExceptions: invitationExceptions.ok ? invitationExceptions.value : [],
      applicant,
      grants,
      grantCounts,
      accessAvailable: access.ok,
      documentsAvailable: documents.ok,
      documents: documents.ok ? documents.value : [],
      scopeExpansions,
      extraCategories: newCategoriesWithData(profileEntries),
      auditEvents: auditEvents.items.map((e) => ({
        ...e,
        occurredAt: e.occurredAt.toISOString(),
      })),
      auditOlderCursor: auditEvents.nextCursor,
    };
  });

  if (!data) notFound();

  const depth = await readDepth('sharing');
  const hasEnded = (grant: (typeof data.grants)[number]) =>
    grant.status === 'REVOKED' ||
    grant.status === 'EXPIRED' ||
    (grant.expiryAt !== null && new Date(grant.expiryAt).getTime() <= Date.now());
  // Glance is who can reach this record now (live or paused); access still waiting to be
  // accepted, and access that has ended, are at Browse.
  const holdsAccess = (grant: (typeof data.grants)[number]) =>
    !hasEnded(grant) && (grant.status === 'ACTIVE' || grant.status === 'PAUSED');
  // Invitations not yet accepted can still turn into access, so Glance counts them too.
  const pendingInvitations = data.invitations.filter(
    (invite) => invite.status === 'PENDING' && invite.expiresAt.getTime() > Date.now(),
  ).length;
  const notAtGlance = data.grantCounts.total - data.grantCounts.holdingAccess + pendingInvitations;
  // Show More adds nothing visible at Glance once every grant holding access is on the page.
  const grantsNext =
    data.grantCounts.total > data.grants.length
      ? nextShow(data.grants.length, { step: GRANT_STEP, max: GRANT_SHOW_MAX })
      : null;
  const moreAtGlance = data.grantCounts.holdingAccess > data.grantCounts.holdingAccessShown;

  const sharingPath = `/app/applicant/${id}/sharing`;
  const itemHref = (item: string) => pagingHref(sharingPath, pagingSearch, { item });
  // Started from Share on a document: the form is what the person came for, so its panel is open.
  const startsWithDocument =
    typeof documentParam === 'string' && data.documents.some((d) => d.id === documentParam);
  const composerId = 'new';
  const openPane = startsWithDocument ? composerId : one('item');
  // Access that has ended is kept out of the way, under its own heading with its count, so the
  // list above holds only what still matters. Nothing is removed: the rows are the same rows.
  const renderGrants = (rows: readonly { readonly ended: boolean; readonly node: ReactNode }[]) => {
    const endedRows = rows.filter((row) => row.ended);
    const endedHoldsChosen = data.grants.some((grant) => hasEnded(grant) && grant.id === openPane);
    return (
      <>
        {rows.filter((row) => !row.ended).map((row) => row.node)}
        {endedRows.length > 0 ? (
          <div {...atLevel('browse')}>
            <GroupedList
              groups={[
                {
                  id: 'sharing-ended-access',
                  heading: 'Ended Access',
                  headingLevel: 3,
                  count: endedRows.length,
                  tone: 'neutral',
                  open: search[SHOW_KEY] !== undefined || endedHoldsChosen,
                  children: endedRows.map((row) => row.node),
                },
              ]}
            />
          </div>
        ) : null}
      </>
    );
  };
  const grantName = (grant: (typeof data.grants)[number]) =>
    `${grant.recipient.label}${grant.recipient.kind === 'organization' ? ' (organization)' : ''}`;

  // One panel for each grant, and one for a new sharing request (the old Grant Access card).
  const panes: PaneEntry[] = [
    ...data.grants.map(
      (grant): PaneEntry => ({
        id: grant.id,
        title: grantName(grant),
        content: (
          <GrantPane
            applicantId={id}
            grant={grant}
            ended={hasEnded(grant)}
            badge={grantStatusBadge(grant.status, t)}
            documents={data.documents}
            aiAssistReady={data.aiAssistReady}
            expansions={data.scopeExpansions.get(grant.id) ?? []}
          />
        ),
      }),
    ),
    {
      id: composerId,
      title: 'New Sharing Request',
      content: (
        <div className="lp-pane-content sharing-composer-card" id="new-sharing-request">
          <p className="card-kicker">New Sharing Request</p>
          <h2 className="card-title">Grant Access</h2>
          <p className="card-body u-mb-125">
            {process.env[sharingInvitationFlag] === 'true'
              ? 'Invite someone by email, even if they do not have an account yet. They must sign in with that email and accept before access begins.'
              : 'Share with an existing VisaStack user by email. They must accept before any access begins.'}
          </p>
          {data.documentsAvailable ? (
            <GrantForm
              applicantId={id}
              documents={data.documents.map((d) => ({
                id: d.id,
                displayName: d.approvedName ?? d.originalName,
              }))}
              extraCategories={data.extraCategories}
              unsortedDocuments={data.documents.filter((d) => !documentCategory(d.docType)).length}
              {...(startsWithDocument ? { initialDocumentId: documentParam } : {})}
            />
          ) : (
            <p role="alert">
              Document records are unavailable. Reload to review the exact scope before sharing.
            </p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="sharing-shell">
      <ListWithPane
        panes={panes}
        initial={openPane}
        paneLabel="Sharing Details"
        backLabel="Back to Sharing"
        backHref={sharingPath}
      >
        <div className="sharing-main">
          <OpenComposerFromHash />
          <PageHeader
            eyebrow={data.applicant.displayName}
            title="Sharing"
            actions={
              <a
                className="btn btn-primary"
                href={itemHref(composerId)}
                data-pane-open={composerId}
              >
                New Sharing Request
              </a>
            }
          />

          {/* Owner, 5 Nov 2026: no page should have more than 30 words. What sharing means is one tap away. */}
          <AboutDisclosure summary="About Sharing">
            <p>
              They can only use it for the reason you gave. It starts when they accept. You can
              pause or stop it any time.
            </p>
            <p>Pending, paused and ended grants are labelled separately below.</p>
            <p>
              Pause stops access straight away and you can resume it later. Revoke ends this access.
            </p>
          </AboutDisclosure>

          <DepthScope family="sharing" depth={depth}>
            <DepthSwitch
              family="sharing"
              initial={depth}
              copy={depthCopy({
                glance: depthWord('depth.sharing.glance'),
                browse: depthWord('depth.sharing.browse'),
                everything: depthWord('depth.sharing.everything.nothingMore'),
              })}
              notesBehindInfo
            />
            <div className="sharing-workspace">
              <div className="sharing-access-column">
                <article className="card lc-empty-host" id="who-has-access">
                  <p className="card-kicker">Controlled Collaboration</p>
                  <h2 className="card-title">Who Has Access</h2>
                  {doneLine ? <DoneNotice line={doneLine} /> : null}
                  <CollectionAnswersSharingLine applicantId={id} />
                  <p className="card-body">
                    {data.accessAvailable
                      ? `${plural(data.grantCounts.active, 'active grant')}.`
                      : 'Access records are unavailable. Reload before making changes.'}
                  </p>
                  {notAtGlance > 0 ? (
                    <p className="card-body" data-only="glance">
                      {notAtGlance === 1
                        ? '1 more waiting or ended, under Browse.'
                        : `${notAtGlance} more waiting or ended, under Browse.`}
                    </p>
                  ) : null}
                  {data.grantCounts.total > 0 ? (
                    <div className="notice u-mb-100 lc-revoke-warning">
                      <p className="lc-revoke-short">{REVOKE_SENTENCE}</p>
                      <AboutDisclosure summary="About Revoking">
                        <p>
                          Pausing or revoking stops all <em>future</em> access immediately. It
                          cannot remotely erase copies the recipient already downloaded before that
                          point.
                        </p>
                      </AboutDisclosure>
                    </div>
                  ) : null}
                  {!data.accessAvailable ? (
                    <p role="alert">
                      We could not load sharing records. This does not mean nobody has access.
                    </p>
                  ) : data.grantCounts.total === 0 ? (
                    <EmptyState art="sharing" title="Nobody Has Access Yet" fold>
                      Your profile and documents are private. When you share with someone, they
                      appear here with what they can see and until when.
                    </EmptyState>
                  ) : (
                    <>
                      <div className="rows u-mt-050">
                        {renderGrants(
                          data.grants.map((grant, index) => {
                            const ended = hasEnded(grant);
                            return {
                              ended,
                              node: (
                                <div
                                  className="sharing-grant-item"
                                  key={grant.id}
                                  id={`sharing-grant-${index + 1}`}
                                  {...(holdsAccess(grant) ? {} : atLevel('browse'))}
                                >
                                  <ListRow
                                    id={grant.id}
                                    name={grantName(grant)}
                                    tone={grantRowStatus(grant.status).tone}
                                    status={grantRowStatus(grant.status).word}
                                    meta={grantRowLine({
                                      status: grant.status,
                                      actions: grant.actions,
                                      missionId: grant.missionId,
                                      categories: grant.categories,
                                      documentIds: grant.documentIds,
                                      expiryAt: grant.expiryAt,
                                      totalDocuments: data.documentsAvailable
                                        ? data.documents.length
                                        : null,
                                      ended,
                                    })}
                                    openHref={itemHref(grant.id)}
                                  />
                                </div>
                              ),
                            };
                          }),
                        )}
                      </div>
                      <div {...(moreAtGlance ? {} : atLevel('browse'))}>
                        <ShowMore
                          id="sharing-grants-more"
                          pathname={sharingPath}
                          searchParams={pagingSearch}
                          next={grantsNext === null ? null : { [SHOW_KEY]: grantsNext }}
                          shown={data.grants.length}
                          total={data.grantCounts.total}
                          noun={GRANT_NOUN}
                          landOn={`sharing-grant-${data.grants.length + 1}`}
                        />
                      </div>
                    </>
                  )}
                </article>

                <AiConnectionsSection
                  applicantId={id}
                  list={data.aiConnections}
                  connectorOn={connectorOn}
                  cases={data.aiCases}
                  suggestionsAvailable={data.aiSuggestions.available}
                  {...(data.aiAccess && !data.aiAccess.available
                    ? { accessOff: data.aiAccess.reason }
                    : {})}
                  {...(data.aiFiles ? { files: data.aiFiles } : {})}
                  {...(aiNotice ? { notice: aiNotice } : {})}
                  {...(aiReturning
                    ? {
                        returning: data.aiReturningFiles
                          ? { ...aiReturning, files: data.aiReturningFiles }
                          : aiReturning,
                      }
                    : {})}
                />

                {/* Kept while an app may save more, so the last deletion is still confirmed here. */}
                {data.aiSuggestions.drafts.length > 0 ||
                data.aiConnections.active.some((item) => aiAllowsSuggestions(item.scopes)) ? (
                  <AiDraftsSection
                    applicantId={id}
                    drafts={data.aiSuggestions.drafts}
                    more={data.aiSuggestions.more}
                  />
                ) : null}

                {data.invitations.length ? (
                  <details className="card sharing-invitation-history" {...atLevel('browse')}>
                    <summary>
                      Sharing invitations:{' '}
                      {
                        data.invitations.filter(
                          (invite) =>
                            invite.status === 'PENDING' && invite.expiresAt.getTime() > Date.now(),
                        ).length
                      }{' '}
                      pending
                    </summary>
                    <p>
                      No access starts until the recipient reviews and accepts. To resend, revoke a
                      pending invitation and create a new one.
                    </p>
                    <div className="rows">
                      {data.invitations.map((invitation) => {
                        const waiting =
                          invitation.status === 'PENDING' &&
                          invitation.expiresAt.getTime() > Date.now();
                        const invitationRowStatus = invitationStatus(
                          invitation.status === 'PENDING' && !waiting
                            ? 'EXPIRED'
                            : invitation.status,
                        );
                        return (
                          <div className="sharing-invitation-item" key={invitation.id}>
                            <ListRow
                              id={invitation.id}
                              name={invitation.email}
                              tone={invitationRowStatus.tone}
                              status={invitationRowStatus.word}
                              meta={invitation.purpose.replace(/[.!?]+$/, '')}
                            />
                            {waiting
                              ? data.invitationExceptions
                                  .filter((exception) => exception.invitationId === invitation.id)
                                  .map((exception) => (
                                    <p
                                      className="muted sharing-invitation-exception"
                                      key={exception.missionId}
                                    >
                                      Not Shared: {exception.missionTitle}
                                    </p>
                                  ))
                              : null}
                            {waiting ? (
                              <form action={revokeSharingInvitationAction}>
                                <input type="hidden" name="invitationId" value={invitation.id} />
                                <input type="hidden" name="applicantId" value={id} />
                                <button className="btn btn-secondary" type="submit">
                                  Revoke Invitation
                                </button>
                              </form>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                ) : null}
                <article className="card lc-empty-host" {...atLevel('browse')}>
                  <p className="card-kicker">Transparency</p>
                  <h2 className="card-title">Access Log</h2>
                  <p className="card-body u-mb-100">
                    What actually happened to your data, not just what a grant permits.
                  </p>
                  {data.auditEvents.length === 0 ? (
                    <EmptyState icon="activity" title="No Activity Yet">
                      Every time your information is opened, shared or changed, it is recorded here.
                    </EmptyState>
                  ) : (
                    <ActivityLog
                      filtersFolded="Filter the Log"
                      label="Access Log Entries"
                      id={LOG_ANCHOR}
                      {...(data.auditOlderCursor
                        ? {
                            olderHref: pagingHref(
                              `/app/applicant/${id}/sharing`,
                              pagingSearch,
                              { [LOG_KEY]: data.auditOlderCursor },
                              LOG_ANCHOR,
                            ),
                          }
                        : {})}
                      {...(logBefore
                        ? {
                            newestHref: pagingHref(
                              `/app/applicant/${id}/sharing`,
                              pagingSearch,
                              { [LOG_KEY]: null },
                              LOG_ANCHOR,
                            ),
                          }
                        : {})}
                      entries={data.auditEvents.map((e) => ({
                        id: String(e.seq),
                        what: e.agencyAi
                          ? agencyAiAccessLine(e.agencyAi.agencyName, e.agencyAi.appHost)
                          : accessLogEventLabel(e.eventType),
                        who: e.actorEmail ?? 'System',
                        ...(e.result
                          ? {
                              outcome:
                                e.result === 'ALLOWED'
                                  ? { label: 'Allowed', tone: 'success' as const }
                                  : { label: 'Blocked', tone: 'danger' as const },
                            }
                          : {}),
                        at: e.occurredAt,
                        when: formatTimestamp(e.occurredAt),
                      }))}
                    />
                  )}
                </article>
              </div>
            </div>
          </DepthScope>
        </div>
      </ListWithPane>
    </div>
  );
}
