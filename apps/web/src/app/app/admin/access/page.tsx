import {
  type PilotInvitation,
  listActivePlatformRoles,
  listInvitations,
  reportUnboundAccounts,
  staffFactorCoverage,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin, isPlatformOwnerAccount } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { neonSessionRef } from '../../../../lib/neon-recency';
import { type SearchParamsRecord, TEAM_LIST_STEP, parseCursor } from '../../../../lib/paging';
import { createKeyManagementPort } from '../../../../lib/providers';
import { withSession } from '../../../../lib/session';
import { staffFactorMode } from '../../../../lib/staff-factor';
import { tolerantReader } from '../../../../lib/tolerate';
import {
  ResetAuthenticatorButton,
  RevokeInvitationButton,
  RevokeRoleButton,
} from '../action-buttons';
import { GrantRoleForm, InviteForm } from '../admin-forms';
import { AdminRestricted } from '../admin-restricted';
import { QueuePaging, QueuePastEnd } from '../email/queue-paging';
import { type QueueItem, QueuePanel } from '../email/queue-panel';
import { FailedSectionsBanner } from '../failed-sections-banner';

export const metadata: Metadata = { title: 'Platform Access' };

export const dynamic = 'force-dynamic';

const PLATFORM_ROLE_LABELS: Record<string, string> = {
  PLATFORM_OWNER: 'Platform Owner',
  SECURITY_ADMIN: 'Security Admin',
  COMPLIANCE_ADMIN: 'Compliance Admin',
  SUPPORT_ADMIN: 'Support Admin',
  QUALITY_ADMIN: 'Quality Admin',
};

const ACCESS_PATH = '/app/admin/access';
const PENDING_LIST = 'pilot-pending-list';
const HISTORY_PANEL = 'pilot-history-panel';
const INVITATION_NOUN = { one: 'invitation', other: 'invitations' } as const;

/** One page of invitations as this page uses it; counts are null when the list could not be read. */
interface InvitationList {
  readonly items: readonly PilotInvitation[];
  readonly nextCursor: string | null;
  readonly counts: { readonly pending: number; readonly history: number } | null;
}

const NO_INVITATIONS: InvitationList = { items: [], nextCursor: null, counts: null };

/**
 * Platform roles, pilot sign-in invitations, and accounts still waiting to be tied to a sign-in
 * identity. WP-SB6: invitations still waiting come first, 25 at a time; accepted and revoked ones
 * sit in their own box below that scrolls inside, also read 25 at a time from the server.
 */
export default async function AdminAccessPage({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const search = (await searchParams) ?? {};
  const param = (name: string) => search[name];
  const pendingBefore = parseCursor(param('pendingBefore'));
  const historyBefore = parseCursor(param('historyBefore'));
  const data = await withSession(async ({ db, accountId, email }) => {
    if (!(await isPlatformAdmin(db, { accountId, email }))) return { admin: false as const };
    const { read: t, failed: failedSections } = tolerantReader();
    const readInvitations = async (
      view: 'pending' | 'history',
      before: string | undefined,
    ): Promise<InvitationList> =>
      listInvitations(db, {
        view,
        limit: TEAM_LIST_STEP,
        // One count covers both lists: the pending read counts, the history read does not.
        ...(view === 'history' ? { withCounts: false } : {}),
        ...(before ? { before } : {}),
      });
    const [roles, unboundAccounts, pending, history, owner, coverage] = await Promise.all([
      t('platform roles', () => listActivePlatformRoles(db), []),
      t('unbound accounts', () => reportUnboundAccounts(db), []),
      t('invitations', () => readInvitations('pending', pendingBefore), NO_INVITATIONS),
      t('invitation history', () => readInvitations('history', historyBefore), NO_INVITATIONS),
      isPlatformOwnerAccount(db, { accountId, email }),
      t('authenticator coverage', () => staffFactorCoverage(db), null),
    ]);
    return {
      admin: true as const,
      roles,
      unboundAccounts,
      pending,
      history,
      owner,
      coverage,
      self: accountId,
      // Both are needed to check a code: a readable sign-in and the key service that opens the secret.
      canCheckCodes: (await neonSessionRef()) !== null && createKeyManagementPort() !== undefined,
      failedSections,
    };
  });

  return (
    <section className="section container">
      <PageHeader
        eyebrow="Platform"
        title="Access"
        description="Who holds a platform role, and who may sign in during the controlled pilot."
      />

      {!data.admin ? (
        <AdminRestricted />
      ) : (
        <>
          <FailedSectionsBanner sections={data.failedSections} />

          {/* Roles and pilot access side by side on wide screens, so neither list or form runs the
              full page width. */}
          <div className="grid u-mb-150">
            <article className="card" id="admin-security">
              <p className="card-kicker">Identity</p>
              <h2 className="card-title">Platform Roles</h2>
              <p className="card-body u-mb-100">
                Platform roles determine who can manage the service. Role history is retained when
                access is revoked.
              </p>
              <p className="card-body u-mb-100">
                {staffFactorMode() === 'off'
                  ? 'Authenticator codes are not required for staff yet.'
                  : 'Staff confirm sensitive actions with an authenticator code.'}
                {data.coverage
                  ? ` ${data.coverage.enrolled} of ${data.coverage.staff} staff have set one up.`
                  : ''}
                {data.canCheckCodes
                  ? ' Codes can be checked here.'
                  : ' Codes cannot be checked here yet, so do not require them.'}
              </p>
              {data.roles.length === 0 ? (
                <p className="card-body u-mb-125">No active grants.</p>
              ) : (
                <div className="rows u-mb-125">
                  {data.roles.map((r) => (
                    <div
                      className="row"
                      key={r.id}
                      style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.4rem' }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '0.75rem',
                        }}
                      >
                        <span className="row-key">{PLATFORM_ROLE_LABELS[r.role] ?? r.role}</span>
                        <span className="row-end">
                          <span className="muted u-fs-085">
                            {formatTimestampDate(r.assignedAt)}
                          </span>
                          {data.owner && r.accountId && r.accountId !== data.self ? (
                            <ResetAuthenticatorButton targetAccountId={r.accountId} />
                          ) : null}
                          {data.owner ? <RevokeRoleButton grantId={r.id} /> : null}
                        </span>
                      </div>
                      <span className="muted u-fs-085">{r.reason}</span>
                    </div>
                  ))}
                </div>
              )}
              {data.owner ? (
                <GrantRoleForm />
              ) : (
                <p className="muted u-fs-085">Only a platform owner can grant or revoke roles.</p>
              )}
            </article>

            <article className="card" id="admin-pilot-access">
              <p className="card-kicker">Controlled Pilot</p>
              <h2 className="card-title">Pilot Access</h2>
              <p className="card-body u-mb-100">
                This is an invite-only controlled pilot: an authenticated identity that isn't
                invited or allowlisted is denied a local account. An invitation is never deleted,
                only revoked - the full history of who was invited, by whom, and why is always
                reconstructable. Revoking only blocks a future, not-yet-provisioned sign-in; an
                account already provisioned from this invitation keeps its access.
              </p>
              <h3 className="pilot-list-title">Waiting to Be Used</h3>
              <InvitationQueue
                id={PENDING_LIST}
                label="Invitations Waiting to Be Used"
                list={data.pending}
                total={data.pending.counts?.pending}
                owner={data.owner}
                search={search}
                param="pendingBefore"
                before={pendingBefore}
                none="No invitations are waiting to be used."
                pastEnd="No older invitations waiting."
              />
              <h3 className="pilot-list-title u-mt-125">Accepted and Revoked</h3>
              <InvitationQueue
                id={HISTORY_PANEL}
                label="Accepted and Revoked Invitations"
                list={data.history}
                total={data.pending.counts?.history}
                owner={data.owner}
                search={search}
                param="historyBefore"
                before={historyBefore}
                none="No invitation has been accepted or revoked yet."
                pastEnd="No older invitations."
              />
              {data.owner ? (
                <InviteForm />
              ) : (
                <p className="muted u-fs-085">
                  Only a platform owner can invite or revoke pilot access.
                </p>
              )}
            </article>
          </div>

          {data.unboundAccounts.length > 0 ? (
            <article className="card u-mb-150">
              <p className="card-kicker">Identity</p>
              <h2 className="card-title">Legacy Sign-In References</h2>
              <p className="card-body u-mb-100">
                This report tracks the older sign-in system. A Neon Auth account can appear here
                even when its current sign-in works. This list does not grant access or transfer
                account records.
              </p>
              <div className="rows rows-grid">
                {data.unboundAccounts.map((a) => (
                  <div className="row" key={a.id}>
                    <span className="row-key" style={{ wordBreak: 'break-word' }}>
                      {a.email}
                    </span>
                    <span className="row-end">
                      <span className="muted u-fs-085">
                        since {formatTimestampDate(a.createdAt)}
                      </span>
                      <span
                        className={`badge ${a.applicantCount > 0 ? 'badge-warning' : 'badge-neutral'}`}
                      >
                        {a.applicantCount} applicant{a.applicantCount === 1 ? '' : 's'}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </article>
          ) : null}
        </>
      )}
    </section>
  );
}

/** One invitation: who, its state, why and when, and Revoke for a platform owner. */
function invitationItem(inv: PilotInvitation, owner: boolean): QueueItem {
  const status = inv.revokedAt
    ? { label: 'Revoked', tone: 'badge-danger' }
    : inv.acceptedAt
      ? { label: 'Accepted', tone: 'badge-success' }
      : { label: 'Pending', tone: 'badge-neutral' };
  const why = inv.reason ?? 'No reason given';
  return {
    id: inv.id,
    className: 'invitation-row',
    kind: status.label,
    find: `${inv.email} ${why}`,
    node: (
      <>
        <div className="invitation-row-head">
          <span className="row-key invitation-email">{inv.email}</span>
          <span className="row-end">
            <span className={`badge ${status.tone}`}>{status.label}</span>
            {owner && !inv.revokedAt ? <RevokeInvitationButton invitationId={inv.id} /> : null}
          </span>
        </div>
        <span className="muted u-fs-085">
          {why} · invited {formatTimestampDate(inv.invitedAt)}
        </span>
      </>
    ),
  };
}

/** One invitation list in its fixed box, 25 a load from the server, with its paging. */
function InvitationQueue({
  id,
  label,
  list,
  total,
  owner,
  search,
  param,
  before,
  none,
  pastEnd,
}: {
  readonly id: string;
  readonly label: string;
  readonly list: InvitationList;
  readonly total: number | undefined;
  readonly owner: boolean;
  readonly search: SearchParamsRecord;
  readonly param: 'pendingBefore' | 'historyBefore';
  readonly before: string | undefined;
  readonly none: string;
  readonly pastEnd: string;
}) {
  if (list.items.length === 0) {
    return before ? (
      <QueuePastEnd
        pathname={ACCESS_PATH}
        search={search}
        param={param}
        landOn={id}
        what={pastEnd}
      />
    ) : (
      <p className="card-body u-mb-125">{none}</p>
    );
  }
  return (
    <div className="u-mb-125">
      <QueuePanel
        id={id}
        label={label}
        kindLabel="State"
        pageKey={before ?? 'first'}
        items={list.items.map((inv) => invitationItem(inv, owner))}
      />
      <QueuePaging
        pathname={ACCESS_PATH}
        search={search}
        param={param}
        cursor={list.nextCursor}
        later={before !== undefined}
        landOn={id}
        shown={list.items.length}
        total={total ?? list.items.length}
        noun={INVITATION_NOUN}
      />
    </div>
  );
}
