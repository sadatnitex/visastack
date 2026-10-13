import { createTranslator } from '@visastack/i18n';
import {
  getApplicant,
  listAccessForApplicantDetailed,
  listAuditEventsForApplicant,
  listDocumentsDetailed,
  listSharingInvitations,
  previewScopeExpansion,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EmptyState, PageHeader, StatusBadge } from '../../../../../components/ui';
import { humanizeCode } from '../../../../../lib/format-code';
import { formatTimestamp, formatTimestampDate } from '../../../../../lib/format-date';
import { grantStatusBadge } from '../../../../../lib/grant-status';
import { getLocale } from '../../../../../lib/locale';
import { PACK_LABELS } from '../../../../../lib/profile-fields';
import { withSession } from '../../../../../lib/session';
import { revokeSharingInvitationAction } from './actions';
import { GrantForm } from './grant-form';
import { GrantOpButtons } from './grant-op-buttons';
import { ScopeExpansionForm } from './scope-expansion-form';

const sharingInvitationFlag = 'PERSONAL_SHARING_INVITATIONS_ENABLED';

export const metadata: Metadata = { title: 'Sharing' };

export const dynamic = 'force-dynamic';

/** Every PermissionAction this platform defines (@visastack/core), in plain language -- SHR-03's "show... scope," covering every grant regardless of which flow created it, not just this page's own curated share form. */
const ACTION_LABELS: Record<string, string> = {
  VIEW_METADATA: 'See document details',
  PREVIEW: 'Preview documents',
  COMMENT: 'Comment',
  PROPOSE_EDIT: 'Propose edits',
  APPROVE_EDIT: 'Approve edits',
  DOWNLOAD_ORIGINAL: 'Download originals',
  DOWNLOAD_REDACTED: 'Download redacted copies',
  DOWNLOAD_PACK: 'Download the application pack',
  EXPORT_PROFILE: 'Export the full profile',
  SHARE: 'Re-share access',
  MANAGE: 'Manage the case',
};

export default async function SharingPage({
  params,
}: {
  readonly params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = createTranslator(await getLocale());

  const data = await withSession(async ({ db, accountId }) => {
    const applicant = await getApplicant(db, id);
    if (!applicant || applicant.ownerAccountId !== accountId) return null;
    const [access, documents, auditEvents] = await Promise.all([
      listAccessForApplicantDetailed(db, accountId, id),
      listDocumentsDetailed(db, accountId, id),
      listAuditEventsForApplicant(db, accountId, id),
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

    return {
      invitations:
        process.env[sharingInvitationFlag] === 'true'
          ? await listSharingInvitations(db, accountId, id)
          : [],
      applicant,
      grants,
      accessAvailable: access.ok,
      documentsAvailable: documents.ok,
      documents: documents.ok ? documents.value : [],
      scopeExpansions,
      auditEvents: auditEvents.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() })),
    };
  });

  if (!data) notFound();

  return (
    <>
      <PageHeader
        eyebrow="Sharing"
        title={<>Sharing &amp; access</>}
        description="You control every grant. Access is purpose-bound, takes effect only once accepted, and can be paused or revoked at any time."
        as="h2"
        actions={
          <a className="btn btn-primary" href="#new-sharing-request">
            New sharing request
          </a>
        }
      />

      <div className="sharing-workspace">
        <div className="sharing-access-column">
          <article className="card">
            <p className="card-kicker">Controlled collaboration</p>
            <h2 className="card-title">Who has access</h2>
            <p className="card-body">
              {data.accessAvailable
                ? `${data.grants.filter((grant) => grant.status === 'ACTIVE').length} active grants. Pending, paused and ended grants are labelled separately below.`
                : 'Access records are unavailable. Reload before making changes.'}
            </p>
            {data.grants.length > 0 ? (
              <p className="notice u-mb-100">
                Pausing or revoking stops all <em>future</em> access immediately. It cannot remotely
                erase copies the recipient already downloaded before that point.
              </p>
            ) : null}
            {!data.accessAvailable ? (
              <p role="alert">
                We could not load sharing records. This does not mean nobody has access.
              </p>
            ) : data.grants.length === 0 ? (
              <EmptyState icon="shield" title="Nobody has access yet">
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
                  return (
                    <div
                      className="row sharing-grant"
                      key={grant.id}
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
                      <p style={{ margin: 0, fontSize: '0.9rem' }}>
                        {grant.recipient.label}{' '}
                        {grant.status === 'ACTIVE' ? 'can' : 'would be able to'}{' '}
                        {grant.actions.map((a) => (ACTION_LABELS[a] ?? a).toLowerCase()).join(', ')}{' '}
                        {grant.missionId
                          ? 'for one specific case'
                          : grant.categories && grant.categories.length > 0
                            ? `in ${grant.categories
                                .map((c) => PACK_LABELS[c as keyof typeof PACK_LABELS] ?? c)
                                .join(', ')}`
                            : 'across your whole profile'}
                        {grant.documentIds && grant.documentIds.length > 0
                          ? `, limited to ${grant.documentIds.length} specific document${grant.documentIds.length === 1 ? '' : 's'}`
                          : ''}
                        {grant.expiryAt ? `, until ${formatTimestampDate(grant.expiryAt)}` : ''}.
                      </p>
                      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                        Purpose: {grant.purpose}
                        {grant.acceptedAt
                          ? ` · accepted ${formatTimestampDate(grant.acceptedAt)}`
                          : ''}
                      </p>
                      {grant.documentIds && grant.documentIds.length > 0 ? (
                        <ul
                          className="sharing-document-scope"
                          aria-label="Documents included in this grant"
                        >
                          {grant.documentIds.map((documentId) => {
                            const document = data.documents.find(
                              (record) => record.id === documentId,
                            );
                            return (
                              <li key={documentId}>
                                {document
                                  ? (document.approvedName ?? document.originalName)
                                  : 'Document details unavailable'}
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                      {canPause || canResume || canRevoke ? (
                        <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                          Pause stops access straight away and you can resume it later. Revoke ends
                          this access.
                        </p>
                      ) : null}
                      {canPause || canResume || canRevoke ? (
                        <GrantOpButtons
                          applicantId={id}
                          grantId={grant.id}
                          ops={[
                            ...(canPause
                              ? [{ op: 'pause' as const, label: 'Pause', variant: 'btn-secondary' }]
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
                              ? [{ op: 'revoke' as const, label: 'Revoke', variant: 'btn-danger' }]
                              : []),
                          ]}
                        />
                      ) : null}
                      {(() => {
                        const candidates = data.scopeExpansions.get(grant.id);
                        return candidates && candidates.length > 0 ? (
                          <ScopeExpansionForm
                            applicantId={id}
                            grantId={grant.id}
                            candidates={candidates}
                          />
                        ) : null;
                      })()}
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          {data.invitations.length ? (
            <details className="card sharing-invitation-history">
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
                    {invitation.status === 'PENDING' && invitation.expiresAt.getTime() <= Date.now()
                      ? 'Expired'
                      : invitation.status.toLowerCase()}{' '}
                    · {invitation.purpose}
                  </span>
                  {invitation.status === 'PENDING' &&
                  invitation.expiresAt.getTime() > Date.now() ? (
                    <form action={revokeSharingInvitationAction}>
                      <input type="hidden" name="invitationId" value={invitation.id} />
                      <input type="hidden" name="applicantId" value={id} />
                      <button className="btn btn-secondary" type="submit">
                        Revoke invitation
                      </button>
                    </form>
                  ) : null}
                </div>
              ))}
            </details>
          ) : null}
          <article className="card">
            <p className="card-kicker">Transparency</p>
            <h2 className="card-title">Access log</h2>
            <p className="card-body u-mb-100">
              What actually happened to your data, not just what a grant permits - the most recent{' '}
              {data.auditEvents.length} event{data.auditEvents.length === 1 ? '' : 's'}.
            </p>
            {data.auditEvents.length === 0 ? (
              <EmptyState icon="activity" title="No activity yet">
                Every time your information is opened, shared or changed, it is recorded here.
              </EmptyState>
            ) : (
              <div className="rows u-mt-050">
                {data.auditEvents.map((e) => (
                  <div className="row" key={e.seq}>
                    <span className="row-key">
                      {humanizeCode(e.eventType)}
                      <span className="muted" style={{ fontSize: '0.8rem', marginLeft: '0.5rem' }}>
                        {e.actorEmail ?? 'System'}
                      </span>
                    </span>
                    <span className="row-end">
                      {e.result ? (
                        <StatusBadge tone={e.result === 'ALLOWED' ? 'success' : 'danger'}>
                          {e.result === 'ALLOWED' ? 'Allowed' : 'Blocked'}
                        </StatusBadge>
                      ) : null}
                      <span className="muted u-fs-080">{formatTimestamp(e.occurredAt)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </div>
        <article className="card sharing-composer-card" id="new-sharing-request">
          <p className="card-kicker">New sharing request</p>
          <h2 className="card-title">Grant access</h2>
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
            />
          ) : (
            <p role="alert">
              Document records are unavailable. Reload to review the exact scope before sharing.
            </p>
          )}
        </article>
      </div>
    </>
  );
}
