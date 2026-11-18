import type { AiConnectionList, AiConnectionSummary } from '@visastack/services';
import { AgencyAiTurnOff } from '../../src/app/app/agency/[orgId]/agency-ai-turn-off';
import { AiConnectionsSection } from '../../src/app/app/applicant/[id]/sharing/ai-connections';
import { AiConnectionTile } from '../../src/components/ai-connection-tile';
import { aiConnectionTimeLeft } from '../../src/lib/ai-connection-time-left';

/**
 * WAL5: one tile per AI connection, on the real stylesheet. The traveller list is the real
 * Sharing section (with its real Change Access and Turn Off; their server ends are stand-ins
 * that change nothing); the agency tiles are drawn exactly as the agency page draws them. The
 * clock is fixed, so the time left never depends on the day the test runs. Names are made up and
 * some are long, so wrapping is tested. Used by e2e/wallet/u5-connection-tiles.spec.ts.
 */
export interface Wal5FixtureProps {
  /** Open every Change Access form. */
  readonly open?: boolean;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date(Date.UTC(2030, 0, 15, 12, 0));
const at = (ms: number) => new Date(NOW.getTime() + ms);

function connection(overrides: Partial<AiConnectionSummary>): AiConnectionSummary {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    clientName: 'Claude',
    clientHost: 'claude.ai',
    connectedAt: at(-DAY),
    scopes: ['identity', 'travel_documents', 'document_list'],
    caseMode: 'ALL_CURRENT',
    missionId: null,
    caseTitle: null,
    revealIdentifiers: false,
    expiresAt: at(29 * DAY),
    lastUsedAt: at(-2 * HOUR),
    endedAt: null,
    endedBy: null,
    ...overrides,
  };
}

const ACTIVE: AiConnectionSummary[] = [
  connection({}),
  connection({
    id: '33333333-3333-4333-8333-333333333333',
    clientName: 'A Very Long Example Assistant Name That Wraps on a Phone',
    clientHost: 'assistant.example-with-a-long-address.test',
    scopes: [
      'identity',
      'travel_documents',
      'timelines',
      'money',
      'people',
      'qualifications',
      'declarations',
      'health',
      'document_list',
      'document_text',
      'suggest_changes',
    ],
    caseMode: 'ONE',
    missionId: '44444444-4444-4444-8444-444444444444',
    caseTitle: 'Example Visit to a Country With a Long Name',
    revealIdentifiers: true,
    connectedAt: at(-20 * HOUR),
    expiresAt: at(4 * HOUR),
    lastUsedAt: null,
  }),
  connection({
    id: '55555555-5555-4555-8555-555555555555',
    clientName: 'ChatGPT',
    clientHost: 'chatgpt.com',
    scopes: [],
    caseMode: 'NONE',
    expiresAt: null,
  }),
];

const LIST: AiConnectionList = {
  available: true,
  active: ACTIVE,
  recentlyEnded: [],
  activeTotal: ACTIVE.length,
};

const AGENCY = [
  {
    id: 'agency-live',
    name: 'Claude',
    host: 'claude.ai',
    live: true,
    end: at(6 * DAY),
    used: null,
  },
  {
    id: 'agency-ended',
    name: 'ChatGPT',
    host: 'chatgpt.com',
    live: false,
    end: at(20 * DAY),
    used: at(-DAY),
  },
] as const;

export default function Wal5ConnectionTilesFixture({ open = false }: Wal5FixtureProps) {
  return (
    <div className="wal5-fixture" id="top">
      <h1>AI Connections</h1>
      <div className="wal5-traveller">
        <AiConnectionsSection
          applicantId="11111111-1111-4111-8111-111111111111"
          list={LIST}
          connectorOn
          suggestionsAvailable
          timeZone="Asia/Dhaka"
          now={NOW}
          cases={[{ id: '44444444-4444-4444-8444-444444444444', title: 'Example Visit' }]}
          {...(open
            ? {
                returning: {
                  connectionId: ACTIVE[0]?.id ?? '',
                  choices: {
                    layers: ['identity'],
                    cases: 'all',
                    documentList: true,
                    documentText: false,
                    revealIdentifiers: false,
                    suggestChanges: false,
                  },
                  duration: 'keep',
                },
              }
            : {})}
        />
      </div>
      <article className="card wal5-agency" aria-labelledby="wal5-agency-title">
        <h2 className="card-title" id="wal5-agency-title">
          Agency AI Connections
        </h2>
        <ul className="ai-connection-list">
          {AGENCY.map((item) => (
            <li className="ai-connection" key={item.id}>
              <AiConnectionTile
                id={item.id}
                appName={item.name}
                appHost={item.host}
                readsTerm="Can Read"
                reads={[
                  {
                    key: 'each_case',
                    icon: 'users',
                    label: 'What Each Traveller Allowed',
                    note: 'Each app reads, for each case its owner or admin can see, only what that case’s traveller allowed this agency’s AI tools to read. It works for at most 30 days.',
                  },
                ]}
                facts={[
                  { key: 'connected', term: 'Connected', value: '14 Jan 2030' },
                  { key: 'connected_by', term: 'Connected By', value: 'admin@example.com' },
                  { key: 'ends', term: 'Ends', value: item.live ? '21 Jan 2030, 12:00' : 'Ended' },
                  {
                    key: 'last_used',
                    term: 'Last Used',
                    value: item.used ? '14 Jan 2030, 12:00' : 'Not Used Yet',
                  },
                ]}
                timeLeft={aiConnectionTimeLeft({
                  start: at(-DAY),
                  end: item.end,
                  live: item.live,
                  now: NOW,
                  timeZone: 'UTC',
                })}
                actions={
                  <AgencyAiTurnOff
                    organizationId="o1"
                    connectionId={item.id}
                    appLabel={`${item.name} (${item.host})`}
                    live={item.live}
                  />
                }
              />
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
