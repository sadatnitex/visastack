import { getOrganizationBrandingForDisplay } from '@visastack/services';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../lib/capabilities';
import { agencyTabs } from '../../../../lib/navigation';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import { SubNav } from '../../subnav';
import { loadOrgAccess } from './console-data';
import { ORG_STATUS } from './console-format';
import { OrgBrandingHeader } from './org-branding-header';

export const dynamic = 'force-dynamic';

/**
 * An agency's console (Commercial V1 Part 9 UX-01): one header and a bar of
 * sections, each a page of its own (Dashboard, Clients, Cases, Team, Usage &
 * billing, Settings). Clients, Team and Settings are administrator work and are
 * left out of the bar for a member who is not an administrator.
 *
 * This layout only decides what to show around the page. It is not what keeps an
 * outsider out: every page asks `loadOrgAccess` again, and the service functions
 * behind them refuse anyone who has no standing, exactly as before the console
 * was split.
 */
export default async function AgencyConsoleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const capabilities = getPlatformCapabilities();

  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access) return null;
    // Not member-gated: the name already renders for anyone who can reach this
    // page by URL, and branding (name, logo, accent colour) carries no more
    // sensitivity than that.
    const branding = await getOrganizationBrandingForDisplay(db, createStorage(db), orgId);
    return { ...access, branding };
  });
  if (!data) notFound();

  const badge = ORG_STATUS[data.org.status] ?? { label: data.org.status, tone: 'badge-neutral' };

  return (
    <section className="section container">
      <div style={{ marginBottom: '1.5rem' }}>
        <Link href="/app/agency" className="muted" style={{ fontSize: '0.9rem' }}>
          ← Organizations
        </Link>
      </div>
      <div className="toolbar" style={{ marginBottom: '1.5rem' }}>
        <div>
          <span className="eyebrow">Organization</span>
          <OrgBrandingHeader branding={data.branding} />
          <h1 className="section-title" style={{ margin: '0.25rem 0 0' }}>
            {data.org.name}
          </h1>
          <p className="muted" style={{ margin: '0.35rem 0 0' }}>
            Agency workspace
          </p>
        </div>
        <span className={`badge ${badge.tone}`}>{badge.label}</span>
      </div>

      {data.member ? (
        <>
          {capabilities.agencyCollaboration !== 'available' ? (
            <div className="notice notice-warn" style={{ marginBottom: '1.5rem' }}>
              {capabilityUnavailableMessage('agencyCollaboration')}
            </div>
          ) : null}
          <SubNav links={agencyTabs(orgId, { admin: data.admin })} label="Organization sections" />
          {children}
        </>
      ) : (
        <article className="card">
          <p className="card-body">
            You don't have a role in this organization. Ask an owner or admin to add you as a
            member.
          </p>
        </article>
      )}
    </section>
  );
}
