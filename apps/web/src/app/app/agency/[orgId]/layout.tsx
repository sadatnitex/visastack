import { getOrganizationBrandingForDisplay } from '@visastack/services';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { StatusBadge, type Tone } from '../../../../components/ui';
import {
  capabilityUnavailableMessage,
  getPlatformCapabilities,
} from '../../../../lib/capabilities';
import { withSession } from '../../../../lib/session';
import { createStorage } from '../../../../lib/storage';
import { loadOrgAccess } from './console-data';
import { ORG_STATUS } from './console-format';
import { OrgBrandingHeader } from './org-branding-header';
import { AgencyWorkspaceHeading } from './workspace-heading';

export const dynamic = 'force-dynamic';

/**
 * Retains current organization/member checks, branding and status.
 * The shared shell supplies the agency sidebar without a duplicate section bar.
 * Individual pages and services still authorize every read and action.
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
  const badgeTone = badge.tone.replace('badge-', '') as Tone;

  return (
    <section className="section container">
      <AgencyWorkspaceHeading
        organizationId={orgId}
        name={data.org.name}
        admin={data.member && data.admin}
        lead={<OrgBrandingHeader branding={data.branding} />}
        status={<StatusBadge tone={badgeTone}>{badge.label}</StatusBadge>}
      />

      {data.member ? (
        <>
          {capabilities.agencyCollaboration !== 'available' ? (
            <div className="notice notice-warn u-mb-150">
              {capabilityUnavailableMessage('agencyCollaboration')}
            </div>
          ) : null}
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
