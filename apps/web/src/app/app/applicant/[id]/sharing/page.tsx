import { aiAppLabel } from '@visastack/core/ai-features';
import { createTranslator } from '@visastack/i18n';
import {
  accountPrincipal,
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
import { ActivityLog } from '../../../../../components/activity-log';
import { DepthScope, atLevel } from '../../../../../components/depth';
import { DepthSwitch } from '../../../../../components/depth-switch';
import {
  SelectedScopeSummary,
  describeGrantScope,
} from '../../../../../components/selected-scope-summary';
import { EmptyState, PageHeader } from '../../../../../components/ui';
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
import { humanizeCode } from '../../../../../lib/format-code';
import { formatTimestamp, formatTimestampDate } from '../../../../../lib/format-date';
import { grantStatusBadge } from '../../../../../lib/grant-status';
import { permissionActionLabel } from '../../../../../lib/labels';
import { getLocale } from '../../../../../lib/locale';
import { categoryLabel, newCategoriesWithData } from '../../../../../lib/master-profile';
import { plural } from '../../../../../lib/plural';
import { withSession } from '../../../../../lib/session';
import { accessDoneLine } from '../../../../../lib/success-lines';
import { revokeSharingInvitationAction } from './actions';
import {
  type AiChangeReturn,
  type AiConnectionFiles,
  AiConnectionsSection,
} from './ai-connections';
import { type AiDraftItem, AiDraftsSection } from './ai-drafts';
import { CaseExceptions } from './case-exceptions';
import { DoneNotice } from './done-notice';
import { GrantForm } from './grant-form';
import { GrantOpButtons } from './grant-op-buttons';
import { ScopeExpansionForm } from './scope-expansion-form';

const sharingInvitationFlag = 'PERSONAL_SHARING_INVITATIONS_ENABLED';

export const metadata: Metadata = { title: 'Sharing' };

export const dynamic = 'force-dynamic';

/** How many access log entries the page reads, newest first. */
const ACCESS_LOG_LIMIT = 300;

/** The AI app features this page shows (S28), read together in one pass. */
const AI_APP_FEATURES = ['ai_app_access', 'ai_app_original_files', 'ai_app_suggestions'] as const;
type AiAppFeature = (typeof AI_APP_FEATURES)[number];
type RecordProof = Extract<Parameters<typeof getAiFeatureStates>[2], { proof: unknown }>['proof'];

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

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    // AI connections of this record, through the central access gate (owner only). Read even
    // while connecting AI apps is off, so a live connection can still be turned off.
    // The three AI app features, read once for the page (S28): any proof for this record and
    // person gives the same answer, so whichever read below comes first asks for all three.
    let aiStates: ReturnType<typeof getAiFeatureStates<AiAppFeature>> | undefined;
    const aiAppStates = (proof: RecordProof) => {
      aiStates ??= getAiFeatureStates(db, AI_APP_FEATURES, { proof });
      return aiStates;
    };
    const readAiConnections = async () => {
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
      // AI App Access (S28): while it is off, apps read nothing; the connections stay listed.
      const access =
        aiGate.ok && list.active.length > 0
          ? (await aiAppStates(aiGate.value)).ai_app_access
          : null;
      // "Original Files" (S20): what may be ticked, and what each live connection has ticked.
      let files: AiConnectionFiles | undefined;
      if (aiGate.ok && list.active.length > 0) {
        const candidates = await listAiFileCandidates(aiGate.value);
        if (candidates.ok && candidates.value.available) {
          const [feature, ticked] = await Promise.all([
            aiAppStates(aiGate.value).then((states) => states.ai_app_original_files),
            listAiConnectionFiles(
              aiGate.value,
              list.active.map((item) => item.id),
            ),
          ]);
          files = {
            view: {
              available: feature.available,
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
    // What AI apps left for the person (S21): their drafts, and whether suggestions work now.
    // Drafts stay readable and removable whether or not the feature is on.
    const readAiSuggestions = async () => {
      const gate = await requireAccess(
        db,
        accountPrincipal(accountId),
        'VIEW_METADATA',
        { applicantId: id },
        { purpose: 'ai_drafts' },
      );
      if (!gate.ok) return { available: false, drafts: [] as AiDraftItem[], more: 0 };
      const [feature, drafts] = await Promise.all([
        aiAppStates(gate.value).then((states) => states.ai_app_suggestions),
        listAiDrafts(gate.value),
      ]);
      return {
        available: feature.available,
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
    const [access, documents, auditEvents, profileEntries, aiRead, aiSuggestions] =
      await Promise.all([
        listAccessForApplicantDetailed(db, accountId, id),
        listDocumentsDetailed(db, accountId, id),
        // A longer history than the old list showed: it now scrolls in its own box and filters.
        listAuditEventsForApplicant(db, accountId, id, ACCESS_LOG_LIMIT),
        listApplicantProfile(db, id),
        readAiConnections(),
        readAiSuggestions(),
      ]);
    const grants = access.ok ? access.value : [];

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

    return {
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
      accessAvailable: access.ok,
      documentsAvailable: documents.ok,
      documents: documents.ok ? documents.value : [],
      scopeExpansions,
      extraCategories: newCategoriesWithData(profileEntries),
      auditEvents: auditEvents.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
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
  const notAtGlance =
    data.grants.filter((grant) => !holdsAccess(grant)).length + pendingInvitations;
  // Started from Share on a document: the form is what the person came for.
  const startsWithDocument =
    typeof documentParam === 'string' && data.documents.some((d) => d.id === documentParam);
  // Nobody has access yet: the form is the next step, so it opens one level earlier.
  const composerLevel = startsWithDocument
    ? null
    : data.accessAvailable && data.grants.length === 0
      ? 'browse'
      : 'everything';

  return (
    <>
      <PageHeader
        eyebrow={data.applicant.displayName}
        title="Sharing"
        description="You control every grant. Access is purpose-bound, takes effect only once accepted, and can be paused or revoked at any time."
        actions={
          <a className="btn btn-primary" href="#new-sharing-request">
            New Sharing Request
          </a>
        }
      />

      <DepthScope family="sharing" depth={depth}>
        <DepthSwitch
          family="sharing"
          initial={depth}
          copy={depthCopy({
            glance: depthWord(
              composerLevel === null ? 'depth.sharing.glance.withForm' : 'depth.sharing.glance',
            ),
            browse: depthWord(
              composerLevel === 'browse' ? 'depth.sharing.browse.withForm' : 'depth.sharing.browse',
            ),
            everything: depthWord(
              composerLevel === 'everything'
                ? 'depth.sharing.everything'
                : 'depth.sharing.everything.nothingMore',
            ),
          })}
        />
        <div className="sharing-workspace">
          <div className="sharing-access-column">
            <article className="card">
              <p className="card-kicker">Controlled Collaboration</p>
              <h2 className="card-title">Who Has Access</h2>
              {doneLine ? <DoneNotice line={doneLine} /> : null}
              <p className="card-body">
                {data.accessAvailable
                  ? `${plural(data.grants.filter((grant) => grant.status === 'ACTIVE').length, 'active grant')}. Pending, paused and ended grants are labelled separately below.`
                  : 'Access records are unavailable. Reload before making changes.'}
              </p>
              {notAtGlance > 0 ? (
                <p className="card-body" data-only="glance">
                  {notAtGlance === 1
                    ? '1 more is waiting to be accepted or has ended.'
                    : `${notAtGlance} more are waiting to be accepted or have ended.`}{' '}
                  Choose Browse to see them.
                </p>
              ) : null}
              {data.grants.length > 0 ? (
                <p className="notice u-mb-100">
                  Pausing or revoking stops all <em>future</em> access immediately. It cannot
                  remotely erase copies the recipient already downloaded before that point.
                </p>
              ) : null}
              {!data.accessAvailable ? (
                <p role="alert">
                  We could not load sharing records. This does not mean nobody has access.
                </p>
              ) : data.grants.length === 0 ? (
                <EmptyState icon="shield" title="Nobody Has Access Yet">
                  Your profile and documents are private. When you share with someone, they appear
                  here with what they can see and until when.
                </EmptyState>
              ) : (
                <div className="rows u-mt-050">
                  {data.grants.map((grant) => {
                    const badge = grantStatusBadge(grant.status, t);
                    const canPause = grant.status === 'ACTIVE';
                    const canResume = grant.status === 'PAUSED';
                    const canRevoke =
                      grant.status === 'ACTIVE' ||
                      grant.status === 'PAUSED' ||
                      grant.status === 'PENDING_ACCEPTANCE';
                    const ended = hasEnded(grant);
                    return (
                      <div
                        className="row sharing-grant"
                        key={grant.id}
                        {...(holdsAccess(grant) ? {} : atLevel('browse'))}
                        style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.5rem' }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: '0.75rem',
                          }}
                        >
                          <span className="row-key">
                            {grant.recipient.label}
                            {grant.recipient.kind === 'organization' ? ' (organization)' : ''}
                          </span>
                          <span className={`badge ${badge.tone}`}>{badge.label}</span>
                        </div>
                        <div className="depth-item" {...atLevel('browse')}>
                          <SelectedScopeSummary
                            purpose={grant.purpose}
                            permissions={grant.actions.map((a) =>
                              permissionActionLabel(a).toLowerCase(),
                            )}
                            {...describeGrantScope({
                              actions: grant.actions,
                              caseGrant: Boolean(grant.missionId),
                              partLabels: (grant.categories ?? []).map((c) => categoryLabel(c)),
                              documentNames: (grant.documentIds ?? []).map((documentId) => {
                                const document = data.documents.find(
                                  (record) => record.id === documentId,
                                );
                                return document
                                  ? (document.approvedName ?? document.originalName)
                                  : 'Document details unavailable';
                              }),
                              hasDocuments: true,
                              partsWhen: 'atSharing',
                            })}
                            tense={ended ? 'ended' : grant.status === 'ACTIVE' ? 'live' : 'notYet'}
                            revoked={grant.status === 'REVOKED'}
                            endsOn={grant.expiryAt ? formatTimestampDate(grant.expiryAt) : null}
                          />
                        </div>
                        {grant.acceptedAt ? (
                          <p
                            className="muted"
                            style={{ margin: 0, fontSize: 'var(--text-small)' }}
                            {...atLevel('browse')}
                          >
                            Accepted {formatTimestampDate(grant.acceptedAt)}
                          </p>
                        ) : null}
                        {canPause || canResume || canRevoke ? (
                          <p className="muted" style={{ margin: 0, fontSize: 'var(--text-small)' }}>
                            Pause stops access straight away and you can resume it later. Revoke
                            ends this access.
                          </p>
                        ) : null}
                        {canPause || canResume || canRevoke ? (
                          <GrantOpButtons
                            applicantId={id}
                            grantId={grant.id}
                            ops={[
                              ...(canPause
                                ? [
                                    {
                                      op: 'pause' as const,
                                      label: 'Pause',
                                      variant: 'btn-secondary',
                                    },
                                  ]
                                : []),
                              ...(canResume
                                ? [
                                    {
                                      op: 'resume' as const,
                                      label: 'Resume',
                                      variant: 'btn-secondary',
                                    },
                                  ]
                                : []),
                              ...(canRevoke
                                ? [
                                    {
                                      op: 'revoke' as const,
                                      label: 'Revoke',
                                      variant: 'btn-danger',
                                    },
                                  ]
                                : []),
                            ]}
                          />
                        ) : null}
                        {grant.missionId === null &&
                        canRevoke &&
                        grant.caseExceptions.length > 0 &&
                        (grant.expiryAt === null ||
                          new Date(grant.expiryAt).getTime() > Date.now()) ? (
                          <div className="depth-item" {...atLevel('browse')}>
                            <CaseExceptions
                              applicantId={id}
                              grantId={grant.id}
                              recipientLabel={grant.recipient.label}
                              exceptions={grant.caseExceptions.map((exception) => ({
                                missionId: exception.missionId,
                                title: exception.missionTitle,
                                sharedSeparately: exception.reachedByAnotherGrant,
                              }))}
                            />
                          </div>
                        ) : null}
                        {(() => {
                          const candidates = data.scopeExpansions.get(grant.id);
                          return candidates && candidates.length > 0 ? (
                            <div className="depth-item" {...atLevel('browse')}>
                              <ScopeExpansionForm
                                applicantId={id}
                                grantId={grant.id}
                                candidates={candidates}
                              />
                            </div>
                          ) : null;
                        })()}
                      </div>
                    );
                  })}
                </div>
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
                {data.invitations.map((invitation) => (
                  <div className="row" key={invitation.id}>
                    <span>
                      {invitation.email}
                      <br />
                      {invitation.status === 'PENDING' &&
                      invitation.expiresAt.getTime() <= Date.now()
                        ? 'Expired'
                        : invitation.status.toLowerCase()}{' '}
                      · {invitation.purpose}
                      {invitation.status === 'PENDING' &&
                      invitation.expiresAt.getTime() > Date.now()
                        ? data.invitationExceptions
                            .filter((exception) => exception.invitationId === invitation.id)
                            .map((exception) => (
                              <span
                                className="sharing-invitation-exception"
                                key={exception.missionId}
                              >
                                <br />
                                Not Shared: {exception.missionTitle}
                              </span>
                            ))
                        : null}
                    </span>
                    {invitation.status === 'PENDING' &&
                    invitation.expiresAt.getTime() > Date.now() ? (
                      <form action={revokeSharingInvitationAction}>
                        <input type="hidden" name="invitationId" value={invitation.id} />
                        <input type="hidden" name="applicantId" value={id} />
                        <button className="btn btn-secondary" type="submit">
                          Revoke Invitation
                        </button>
                      </form>
                    ) : null}
                  </div>
                ))}
              </details>
            ) : null}
            <article className="card" {...atLevel('browse')}>
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
                  label="Access Log Entries"
                  entries={data.auditEvents.map((e) => ({
                    id: String(e.seq),
                    what: humanizeCode(e.eventType),
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
          <article
            className="card sharing-composer-card"
            id="new-sharing-request"
            {...(composerLevel ? atLevel(composerLevel) : {})}
          >
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
                unsortedDocuments={
                  data.documents.filter((d) => !documentCategory(d.docType)).length
                }
                {...(startsWithDocument ? { initialDocumentId: documentParam } : {})}
              />
            ) : (
              <p role="alert">
                Document records are unavailable. Reload to review the exact scope before sharing.
              </p>
            )}
          </article>
        </div>
      </DepthScope>
    </>
  );
}
