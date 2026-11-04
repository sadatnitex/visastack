import {
  type PilotInvitation,
  type PlatformRoleHolder,
  listActivePlatformRoleHolders,
  listActivePlatformRoles,
  listInvitations,
  reportUnboundAccounts,
  staffFactorCoverage,
} from '@visastack/services';
import type { Metadata } from 'next';
import { PageHeader } from '../../../../components/ui';
import {
  bootstrapAdminEmails,
  isPlatformAdmin,
  isPlatformOwnerAccount,
} from '../../../../lib/admin';
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

/** An active grant; the holder's email is there only when the owner is the one reading. */
type RoleRow = Omit<PlatformRoleHolder, 'holderEmail'> & { readonly holderEmail?: string | null };

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
}) {
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
    // Addresses are personal data: only the owner reads them. Everyone else gets the counts.
    const owner = await isPlatformOwnerAccount(db, { accountId, email });
    const countsOnly = (list: InvitationList): InvitationList => ({ ...list, items: [] });
    const [roles, unbound, pendingRead, historyRead, coverage] = await Promise.all([
      t(
        'platform roles',
        async (): Promise<readonly RoleRow[]> => {
          if (!owner) return await listActivePlatformRoles(db);
          const holders = await listActivePlatformRoleHolders(db, {
            accountId,
            email,
            bootstrapEmails: bootstrapAdminEmails(),
          });
          if (!holders.ok) throw new Error(holders.error.message);
          return holders.value;
        },
        [],
      ),
      t('unbound accounts', () => reportUnboundAccounts(db), []),
      t('invitations', () => readInvitations('pending', pendingBefore), NO_INVITATIONS),
      t('invitation history', () => readInvitations('history', historyBefore), NO_INVITATIONS),
      t('authenticator coverage', () => staffFactorCoverage(db), null),
    ]);
    const pending = owner ? pendingRead : countsOnly(pendingRead);
    const history = owner ? historyRead : countsOnly(historyRead);
    const unboundAccounts = owner ? unbound : [];
    return {
      admin: true as const,
      roles,
      unboundAccounts,
      unboundCount: unbound.length,
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
                      <span className="muted u-fs-085">
                        {data.owner ? `${r.holderEmail ?? 'Removed Account'} · ` : ''}
                        {r.reason}
                      </span>
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
                VisaStack is invite-only during the pilot. Only invited email addresses can create
                an account. An invitation is never deleted, only revoked, so you can always see who
                was invited, by whom and why. Revoking stops a sign-up that has not happened yet; a
                person who already joined keeps their access.
              </p>
              {data.owner ? (
                <>
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
                </>
              ) : (
                <p className="card-body u-mb-125" data-testid="invitation-counts">
                  {data.pending.counts
                    ? `${data.pending.counts.pending} waiting to be used and ${data.pending.counts.history} accepted or revoked. Email addresses are shown to a platform owner only.`
                    : 'Invitation counts could not be read. Email addresses are shown to a platform owner only.'}
                </p>
              )}
              {data.owner ? (
                <InviteForm />
              ) : (
                <p className="muted u-fs-085">
                  Only a platform owner can invite or revoke pilot access.
                </p>
              )}
            </article>
          </div>

          {!data.owner && data.unboundCount > 0 ? (
            <p className="muted u-fs-085 u-mb-150" data-testid="unbound-count">
              {data.unboundCount} older sign-in{data.unboundCount === 1 ? '' : 's'} not yet linked.
              Addresses are shown to a platform owner only.
            </p>
          ) : null}
          {data.unboundAccounts.length > 0 ? (
            <article className="card u-mb-150">
              <p className="card-kicker">Identity</p>
              <h2 className="card-title">Older Sign-Ins Not Yet Linked</h2>
              <p className="card-body u-mb-100">
                These accounts were made before the current sign-in and are not linked to it yet. A
                person can still sign in while they appear here. This list does not give anyone
                access or move any records.
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
