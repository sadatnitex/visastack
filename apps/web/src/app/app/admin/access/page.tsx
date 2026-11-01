import {
  type PilotInvitation,
  listActivePlatformRoles,
  listInvitations,
  reportUnboundAccounts,
  staffFactorCoverage,
} from '@visastack/services';
import type { Metadata } from 'next';
import { ShowMore } from '../../../../components/show-more';
import { PageHeader } from '../../../../components/ui';
import { isPlatformAdmin, isPlatformOwnerAccount } from '../../../../lib/admin';
import { formatTimestampDate } from '../../../../lib/format-date';
import { neonSessionRef } from '../../../../lib/neon-recency';
import {
  type SearchParamsRecord,
  TEAM_LIST_STEP,
  pagingHref,
  parseCursor,
} from '../../../../lib/paging';
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

type InvitationRow = PilotInvitation;

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
      listInvitations(db, { view, limit: TEAM_LIST_STEP, ...(before ? { before } : {}) });
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
              {data.pending.items.length === 0 ? (
                <p className="card-body u-mb-125">
                  {pendingBefore ? (
                    <>
                      No older invitations waiting.{' '}
                      <a
                        href={pagingHref(
                          ACCESS_PATH,
                          search,
                          { pendingBefore: null },
                          PENDING_LIST,
                        )}
                      >
                        Show Newest Entries
                      </a>
                    </>
                  ) : (
                    'No invitations are waiting to be used.'
                  )}
                </p>
              ) : (
                <>
                  <section
                    className="activity-log-scroll staff-queue-panel"
                    id={PENDING_LIST}
                    aria-label="Invitations Waiting to Be Used"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
                    tabIndex={0}
                  >
                    <ul className="rows">
                      {data.pending.items.map((inv) => (
                        <InvitationItem key={inv.id} inv={inv} owner={data.owner} />
                      ))}
                    </ul>
                  </section>
                  <InvitationPaging
                    id="pilot-pending-more"
                    landOn={PENDING_LIST}
                    search={search}
                    param="pendingBefore"
                    cursor={data.pending.nextCursor}
                    paged={pendingBefore !== undefined}
                    shown={data.pending.items.length}
                    total={data.pending.counts?.pending}
                  />
                </>
              )}
              <h3 className="pilot-list-title u-mt-125">Accepted and Revoked</h3>
              {data.history.items.length === 0 ? (
                <p className="card-body u-mb-125">
                  {historyBefore ? (
                    <>
                      No older invitations.{' '}
                      <a
                        href={pagingHref(
                          ACCESS_PATH,
                          search,
                          { historyBefore: null },
                          HISTORY_PANEL,
                        )}
                      >
                        Show Newest Entries
                      </a>
                    </>
                  ) : (
                    'No invitation has been accepted or revoked yet.'
                  )}
                </p>
              ) : (
                <>
                  <section
                    className="activity-log-scroll staff-queue-panel"
                    id={HISTORY_PANEL}
                    aria-label="Accepted and Revoked Invitations"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling box must take focus so the keyboard can scroll it
                    tabIndex={0}
                  >
                    <ul className="rows">
                      {data.history.items.map((inv) => (
                        <InvitationItem key={inv.id} inv={inv} owner={data.owner} />
                      ))}
                    </ul>
                  </section>
                  <InvitationPaging
                    id="pilot-history-more"
                    landOn={HISTORY_PANEL}
                    search={search}
                    param="historyBefore"
                    cursor={data.history.nextCursor}
                    paged={historyBefore !== undefined}
                    shown={data.history.items.length}
                    total={data.history.counts?.history}
                  />
                </>
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
function InvitationItem({ inv, owner }: { readonly inv: InvitationRow; readonly owner: boolean }) {
  const status = inv.revokedAt
    ? { label: 'Revoked', tone: 'badge-danger' }
    : inv.acceptedAt
      ? { label: 'Accepted', tone: 'badge-success' }
      : { label: 'Pending', tone: 'badge-neutral' };
  return (
    <li className="row invitation-row">
      <div className="invitation-row-head">
        <span className="row-key invitation-email">{inv.email}</span>
        <span className="row-end">
          <span className={`badge ${status.tone}`}>{status.label}</span>
          {owner && !inv.revokedAt ? <RevokeInvitationButton invitationId={inv.id} /> : null}
        </span>
      </div>
      <span className="muted u-fs-085">
        {inv.reason ?? 'No reason given'} · invited {formatTimestampDate(inv.invitedAt)}
      </span>
    </li>
  );
}

/** The end of one invitation list: the count, the next 25 from the server, and the way back. */
function InvitationPaging({
  id,
  landOn,
  search,
  param,
  cursor,
  paged,
  shown,
  total,
}: {
  readonly id: string;
  readonly landOn: string;
  readonly search: SearchParamsRecord;
  readonly param: 'pendingBefore' | 'historyBefore';
  readonly cursor: string | null;
  readonly paged: boolean;
  readonly shown: number;
  readonly total: number | undefined;
}) {
  return (
    <div className="staff-queue-paging u-mb-125">
      <ShowMore
        id={id}
        landOn={landOn}
        pathname={ACCESS_PATH}
        searchParams={search}
        next={cursor ? { [param]: cursor } : null}
        shown={shown}
        {...(total !== undefined ? { total } : {})}
        noun={INVITATION_NOUN}
        label="Show Older Entries"
      />
      {paged ? (
        <a
          className="btn btn-secondary u-btn-sm"
          href={pagingHref(ACCESS_PATH, search, { [param]: null }, landOn)}
        >
          Show Newest Entries
        </a>
      ) : null}
    </div>
  );
}
