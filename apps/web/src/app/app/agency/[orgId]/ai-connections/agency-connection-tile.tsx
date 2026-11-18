import { aiAppLabel } from '@visastack/core/ai-features';
import type { AgencyAiConnectionSummary } from '@visastack/services';
import { AiConnectionTile } from '../../../../../components/ai-connection-tile';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import {
  aiConnectionTimeLeft,
  formatDayIn,
  formatMomentIn,
} from '../../../../../lib/ai-connection-time-left';
import { getServerT } from '../../../../../lib/i18n-server';
import { AgencyAiTurnOff } from '../agency-ai-turn-off';

/**
 * One agency AI connection as a tile (WAL5). Agency connections read, for each case, only what
 * that case's traveller allowed, so the tile shows that one picture with the page's own sentence
 * rather than a copied list of scopes. Staff have no stored time zone, so dates keep the shared
 * formatters' behaviour (no zone given). Turn Off is the existing control, unchanged.
 */
export function AgencyConnectionTile({
  organizationId,
  connection,
  now,
}: {
  readonly organizationId: string;
  readonly connection: AgencyAiConnectionSummary;
  readonly now: Date;
}) {
  const t = getServerT(appAgencyCatalog);
  return (
    <AiConnectionTile
      id={connection.id}
      appName={connection.clientName}
      appHost={connection.clientHost}
      readsTerm={t.node('appAgency.appAgencyOrgidAiConnectionsPage.canRead')}
      reads={[
        {
          key: 'each_case',
          icon: 'users',
          label: t.node('appAgency.appAgencyOrgidAiConnectionsPage.whatEachTravellerAllowed'),
          note: t.node('appAgency.appAgencyOrgidAiConnectionsPage.whatEachTravellerAllowedNote'),
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
        // Once ended, the clock already says Ended; the stored end is not when it stopped.
        ...(connection.live
          ? [
              {
                key: 'ends',
                term: t.node('appAgency.appAgencyOrgidAiConnectionsPage.ends'),
                value: formatMomentIn(connection.endsAt, undefined),
              },
            ]
          : []),
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
          organizationId={organizationId}
          connectionId={connection.id}
          appLabel={aiAppLabel({ name: connection.clientName, host: connection.clientHost })}
          live={connection.live}
        />
      }
    />
  );
}
