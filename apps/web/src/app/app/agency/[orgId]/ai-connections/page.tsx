import { aiAppLabel } from '@visastack/core/ai-features';
import { listAgencyAiConnections } from '@visastack/services';
import type { Metadata } from 'next';
import { AiConnectionTile } from '../../../../../components/ai-connection-tile';
import { EmptyState } from '../../../../../components/ui';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import { AGENCY_AI_ADMINS_ONLY, AGENCY_AI_NOT_YET } from '../../../../../lib/agency-ai';
import {
  aiConnectionTimeLeft,
  formatDayIn,
  formatMomentIn,
} from '../../../../../lib/ai-connection-time-left';
import { getServerT, primeLocale } from '../../../../../lib/i18n-server';
import { withSession } from '../../../../../lib/session';
import { AgencyAiTurnOff } from '../agency-ai-turn-off';
import { loadOrgAccess } from '../console-data';

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
        >
          {t.node('appAgency.appAgencyOrgidAiConnectionsPage.anOwnerOrAdminCanConnect')}
        </EmptyState>
      ) : (
        <ul className="ai-connection-list">
          {data.list.connections.map((connection) => {
            const label = aiAppLabel({ name: connection.clientName, host: connection.clientHost });
            return (
              <li className="ai-connection" key={connection.id}>
                <AiConnectionTile
                  id={connection.id}
                  appName={connection.clientName}
                  appHost={connection.clientHost}
                  readsTerm={t.node('appAgency.appAgencyOrgidAiConnectionsPage.canRead')}
                  reads={[
                    {
                      key: 'each_case',
                      icon: 'users',
                      label: t.node(
                        'appAgency.appAgencyOrgidAiConnectionsPage.whatEachTravellerAllowed',
                      ),
                      note: t.node(
                        'appAgency.appAgencyOrgidAiConnectionsPage.eachAppReadsForEachCase',
                      ),
                    },
                  ]}
                  facts={[
                    {
                      key: 'connected',
                      term: t.node('appAgency.appAgencyOrgidAiConnectionsPage.connected'),
                      value: formatDayIn(connection.createdAt, undefined),
                    },
                    {
                      key: 'connected_by',
                      term: t.node('appAgency.appAgencyOrgidAiConnectionsPage.connectedBy'),
                      value: connection.connectedBy,
                    },
                    {
                      key: 'ends',
                      term: t.node('appAgency.appAgencyOrgidAiConnectionsPage.ends'),
                      value: connection.live
                        ? formatMomentIn(connection.endsAt, undefined)
                        : t.node('appAgency.appAgencyOrgidAiConnectionsPage.ended'),
                    },
                    {
                      key: 'last_used',
                      term: t.node('appAgency.appAgencyOrgidAiConnectionsPage.lastUsed'),
                      value: connection.lastUsedAt
                        ? formatMomentIn(connection.lastUsedAt, undefined)
                        : t.node('appAgency.appAgencyOrgidAiConnectionsPage.notUsedYet'),
                    },
                  ]}
                  timeLeft={aiConnectionTimeLeft({
                    start: connection.createdAt,
                    end: connection.endsAt,
                    live: connection.live,
                    now,
                  })}
                  actions={
                    <AgencyAiTurnOff
                      organizationId={orgId}
                      connectionId={connection.id}
                      appLabel={label}
                      live={connection.live}
                    />
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
