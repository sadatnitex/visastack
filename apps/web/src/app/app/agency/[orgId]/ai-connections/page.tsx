import { listAgencyAiConnections } from '@visastack/services';
import type { Metadata } from 'next';
import { EmptyState } from '../../../../../components/ui';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import { AGENCY_AI_ADMINS_ONLY, AGENCY_AI_NOT_YET } from '../../../../../lib/agency-ai';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { withSession } from '../../../../../lib/session';
import { loadOrgAccess } from '../console-data';
import { AgencyConnectionTile } from './agency-connection-tile';

export const metadata: Metadata = { title: 'Agency AI Connections' };

export const dynamic = 'force-dynamic';

/**
 * The agency's AI connections (S22, ADR 0021 S22 amendment): every app an owner or admin
 * connected for the agency, who connected it, when it ends and when it last read, each with Turn
 * Off. Owners and admins see all of them (decision D1); anyone else gets a plain line.
 */
export default async function AgencyAiConnectionsPage({
  params,
}: {
  readonly params: Promise<{ orgId: string }>;
}) {
  await primeLocale();
  const t = getServerT(appAgencyCatalog);
  const { orgId } = await params;
  const data = await withSession(async ({ db, accountId }) => {
    const access = await loadOrgAccess(db, accountId, orgId);
    if (!access?.member) return null;
    const listed = await listAgencyAiConnections(db, { organizationId: orgId, accountId });
    return listed.ok ? { allowed: true as const, list: listed.value } : { allowed: false as const };
  });
  if (!data) return null;
  const now = new Date();

  return (
    <article className="card" aria-labelledby="agency-ai-connections-title">
      <p className="card-kicker">{t.node('appAgency.appAgencyOrgidAiConnectionsPage.aiTools')}</p>
      <h2 className="card-title" id="agency-ai-connections-title">
        {t.node('appAgency.appAgencyOrgidAiConnectionsPage.aiConnections')}
      </h2>
      <p className="card-body">
        {t.node('appAgency.appAgencyOrgidAiConnectionsPage.eachAppReadsForEachCase')}
      </p>
      {!data.allowed ? (
        <p className="muted">{AGENCY_AI_ADMINS_ONLY}</p>
      ) : !data.list.available ? (
        <p className="muted">{AGENCY_AI_NOT_YET}</p>
      ) : data.list.connections.length === 0 ? (
        <EmptyState
          icon="shield"
          title={t('appAgency.appAgencyOrgidAiConnectionsPage.noAiAppsConnected')}
          action={{
            href: `/app/agency/${orgId}/settings`,
            label: t('appAgency.appAgencyOrgidU8.openSettings'),
          }}
        >
          {t.node('appAgency.appAgencyOrgidAiConnectionsPage.anOwnerOrAdminCanConnect')}
        </EmptyState>
      ) : (
        <ul className="ai-connection-list">
          {data.list.connections.map((connection) => (
            <li className="ai-connection" key={connection.id}>
              <AgencyConnectionTile organizationId={orgId} connection={connection} now={now} />
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
