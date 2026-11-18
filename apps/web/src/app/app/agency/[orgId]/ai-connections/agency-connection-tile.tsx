import { aiAppLabel } from '@visastack/core/ai-features';
import type { AgencyAiConnectionSummary } from '@visastack/services';
import {
  AiConnectionTile,
  aiConnectionEndedOn,
  aiConnectionFacts,
} from '../../../../../components/ai-connection-tile';
import { appAgencyCatalog } from '../../../../../i18n/app-agency';
import { applicantSharingCatalog } from '../../../../../i18n/applicant-sharing';
import { aiConnectionTimeLeft } from '../../../../../lib/ai-connection-time-left';
import { getServerT } from '../../../../../lib/i18n-server';
import { AgencyAiTurnOff } from '../agency-ai-turn-off';

/**
 * One agency AI connection as a tile (WAL5). Agency connections read, for each case, only what
 * that case's traveller allowed, so the tile shows that one picture rather than a copied list of
 * scopes. The facts come from the same builder as the traveller tile, in the same words. Staff
 * have no stored time zone, so dates keep the shared formatters' behaviour (no zone given). An
 * agency connection is never renewed, so its period runs from when it was made. Turn Off is the
 * existing control, unchanged.
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
  const ts = getServerT(applicantSharingCatalog);
  const timeLeft = aiConnectionTimeLeft({
    start: connection.createdAt,
    end: connection.endsAt,
    live: connection.live,
    now,
  });
  return (
    <AiConnectionTile
      id={connection.id}
      appName={connection.clientName}
      appHost={connection.clientHost}
      groups={[
        {
          key: 'reads',
          term: ts.node('applicantSharing.appApplicantIdSharingAiConnections.canRead'),
          reads: [
            {
              key: 'each_case',
              icon: 'users',
              label: t.node('appAgency.appAgencyOrgidAiConnectionsPage.whatEachTravellerAllowed'),
              note: t.node(
                'appAgency.appAgencyOrgidAiConnectionsPage.whatEachTravellerAllowedNote',
              ),
            },
          ],
        },
      ]}
      facts={aiConnectionFacts({
        connectedAt: connection.createdAt,
        end: connection.endsAt,
        lastUsedAt: connection.lastUsedAt,
        timeLeft,
        timeZone: undefined,
        connectedBy: {
          key: 'connected_by',
          term: t.node('appAgency.appAgencyOrgidAiConnectionsPage.connectedBy'),
          value: connection.connectedBy,
        },
      })}
      timeLeft={timeLeft}
      endedOn={aiConnectionEndedOn(connection.endsAt, now, undefined)}
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
