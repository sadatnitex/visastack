import type { AiConnectionList, AiConnectionSummary } from '@visastack/services';
import {
  AI_CONNECTION_DURATIONS,
  AI_CONNECTION_LAYERS,
  AI_KEEP_END,
  type AiChangeDuration,
  type ConsentInitial,
} from '../../../../../lib/ai-consent-choices';
import {
  AI_DURATION_LABELS,
  AI_FULL_NUMBERS_LABEL,
  AI_SUGGEST_CHANGES_LABEL,
  aiAccessLabels,
  aiAllowsSuggestions,
} from '../../../../../lib/ai-consent-labels';
import { formatTimestamp, formatTimestampDate } from '../../../../../lib/format-date';
import { ChangeAccessForm } from './ai-connection-change';
import { AiConnectionTurnOff } from './ai-connection-turn-off';

type CaseOption = { readonly id: string; readonly title: string };
type AccessChoices = Omit<ConsentInitial, 'duration'>;

/** The person's own Change Access choices, carried back after a fresh sign-in check. */
export interface AiChangeReturn {
  readonly connectionId: string;
  readonly choices: AccessChoices;
  readonly duration: AiChangeDuration;
}

function storedCase(item: AiConnectionSummary): string {
  if (item.caseMode === 'ALL_CURRENT') return 'all';
  return item.caseMode === 'ONE' && item.missionId ? item.missionId : 'none';
}

/** What Change Access starts with: what the app can read now. */
export function storedChoices(item: AiConnectionSummary): AccessChoices {
  return {
    layers: AI_CONNECTION_LAYERS.filter((layer) => item.scopes.includes(layer)),
    cases: storedCase(item),
    documentList: item.scopes.includes('document_list'),
    documentText: item.scopes.includes('document_text'),
    revealIdentifiers: item.revealIdentifiers,
    suggestChanges: aiAllowsSuggestions(item.scopes),
  };
}

/** The record's current cases, plus the connection's own case even when it has since closed. */
export function caseOptionsFor(
  item: AiConnectionSummary,
  current: readonly CaseOption[],
): CaseOption[] {
  const own =
    item.caseMode === 'ONE' && item.missionId && item.caseTitle
      ? { id: item.missionId, title: item.caseTitle }
      : null;
  return own && !current.some((option) => option.id === own.id) ? [...current, own] : [...current];
}

/** "How Long" on Change Access: keep the end, or count a new one from now. */
export function changeDurations(item: AiConnectionSummary) {
  return [
    {
      value: AI_KEEP_END,
      label: item.expiresAt
        ? `Keep the Current End (${formatTimestamp(item.expiresAt)})`
        : 'Keep Until I Turn It Off',
    },
    ...AI_CONNECTION_DURATIONS.map((duration) => ({
      value: duration,
      label:
        duration === 'until_off'
          ? AI_DURATION_LABELS[duration]
          : `${AI_DURATION_LABELS[duration]} from Now`,
    })),
  ];
}

function ChangeAccess({
  applicantId,
  item,
  cases,
  returning,
  suggestionsAvailable,
}: {
  readonly applicantId: string;
  readonly item: AiConnectionSummary;
  readonly cases: readonly CaseOption[];
  readonly returning: AiChangeReturn | undefined;
  readonly suggestionsAvailable: boolean;
}) {
  const options = caseOptionsFor(item, cases);
  const back = returning?.connectionId === item.id ? returning : undefined;
  const chosen = back ? back.choices : storedChoices(item);
  const valid =
    chosen.cases === 'all' ||
    chosen.cases === 'none' ||
    options.some((option) => option.id === chosen.cases);
  return (
    <details className="ai-connection-change" open={back !== undefined}>
      <summary className="btn btn-secondary" aria-label={`Change Access for ${item.clientName}`}>
        Change Access
      </summary>
      <ChangeAccessForm
        applicantId={applicantId}
        connectionId={item.id}
        appName={item.clientName}
        cases={options}
        initial={{ ...chosen, cases: valid ? chosen.cases : storedCase(item) }}
        durations={changeDurations(item)}
        defaultDuration={back ? back.duration : AI_KEEP_END}
        suggestionsAvailable={suggestionsAvailable}
      />
    </details>
  );
}

/** Which cases a connection covers, in the consent screen's words. */
export function aiCaseLine(item: Pick<AiConnectionSummary, 'caseMode' | 'caseTitle'>): string {
  if (item.caseMode === 'ALL_CURRENT') return 'All Current Cases';
  if (item.caseMode === 'NONE') return 'No Cases';
  return item.caseTitle ? `Only ${item.caseTitle}` : 'No Cases. The chosen case was removed.';
}

function Details({
  item,
  suggestionsAvailable,
}: {
  readonly item: AiConnectionSummary;
  readonly suggestionsAvailable: boolean;
}) {
  const access = aiAccessLabels(item.scopes);
  return (
    <dl className="ai-connection-facts">
      <div>
        <dt>Connected</dt>
        <dd>{formatTimestampDate(item.connectedAt)}</dd>
      </div>
      <div>
        <dt>Can Read</dt>
        <dd>{access.length > 0 ? access.join(', ') : 'Nothing from this record'}</dd>
      </div>
      <div>
        <dt>Cases</dt>
        <dd>{aiCaseLine(item)}</dd>
      </div>
      <div>
        <dt>{AI_FULL_NUMBERS_LABEL}</dt>
        <dd>{item.revealIdentifiers ? 'Yes' : 'No'}</dd>
      </div>
      {aiAllowsSuggestions(item.scopes) ? (
        <div>
          <dt>{AI_SUGGEST_CHANGES_LABEL}</dt>
          <dd>{suggestionsAvailable ? 'Yes' : 'Yes, but turned off right now'}</dd>
        </div>
      ) : null}
      <div>
        <dt>Ends</dt>
        <dd>{item.expiresAt ? formatTimestamp(item.expiresAt) : 'Until You Turn It Off'}</dd>
      </div>
      <div>
        <dt>Last Used</dt>
        <dd>{item.lastUsedAt ? formatTimestamp(item.lastUsedAt) : 'Not Used Yet'}</dd>
      </div>
    </dl>
  );
}

function endedLine(item: AiConnectionSummary): string {
  const when = item.endedAt ? formatTimestamp(item.endedAt) : '';
  if (item.endedBy === 'time') return `Time ran out ${when}`;
  if (item.endedBy === 'owner') return `You turned it off ${when}`;
  return `Ended ${when}`;
}

/**
 * "AI Connections" on the Sharing page (ADR 0021 section 3, S15): every AI app connected to this
 * record, what it can read, and the owner's controls. Shown while connecting AI apps is on, and
 * always while any connection is live, so the owner can still turn one off.
 */
export function AiConnectionsSection({
  applicantId,
  list,
  connectorOn,
  notice,
  cases = [],
  returning,
  suggestionsAvailable = false,
}: {
  readonly applicantId: string;
  readonly list: AiConnectionList;
  readonly connectorOn: boolean;
  /** The record's current cases, for Change Access. */
  readonly cases?: readonly CaseOption[];
  /** Change Access choices coming back from a fresh sign-in check: that form opens with them. */
  readonly returning?: AiChangeReturn;
  /** What just happened, after the page reloaded. */
  readonly notice?: 'off' | 'changed';
  /** Whether AI App Suggestions works right now (S21). */
  readonly suggestionsAvailable?: boolean;
}) {
  // While connecting is off the card shows only what can still be acted on, or what just happened.
  if (!connectorOn && list.active.length === 0 && !notice) return null;
  const onlyNotice = !connectorOn && list.active.length === 0;
  return (
    <article
      className="card ai-connections"
      id="ai-connections"
      aria-labelledby="ai-connections-title"
    >
      <p className="card-kicker">AI Apps</p>
      <h2 className="card-title" id="ai-connections-title">
        AI Connections
      </h2>
      {list.active.some((item) => aiAllowsSuggestions(item.scopes)) ? (
        <p className="card-body">
          AI apps you connected to this record. Each one can read only what you chose. An app you
          let suggest changes can leave suggestions, drafts and reminders for you, and nothing
          changes until you approve it. Turning one off stops it straight away.
        </p>
      ) : (
        <p className="card-body">
          AI apps you connected to this record. Each one can read only what you chose and cannot
          change anything in VisaStack. Turning one off stops it straight away.
        </p>
      )}
      {notice ? (
        <output className="notice ai-connections-notice">
          {notice === 'off'
            ? 'Turned off. That app can no longer read this record.'
            : 'Access changed. The app gets the new access on its next request.'}
        </output>
      ) : null}
      {onlyNotice ? null : !list.available ? (
        <p className="card-body muted">
          AI connections cannot be shown right now. Try again later.
        </p>
      ) : list.active.length === 0 ? (
        <p className="card-body muted">
          No AI apps are connected to this record. When you connect one from your AI app, it appears
          here with what it can read.
        </p>
      ) : (
        <ul className="ai-connection-list">
          {list.active.map((item) => (
            <li key={item.id} className="ai-connection">
              <h3 className="ai-connection-name">
                {item.clientName} <span className="ai-consent-host">{item.clientHost}</span>
              </h3>
              <Details item={item} suggestionsAvailable={suggestionsAvailable} />
              {connectorOn ? (
                <ChangeAccess
                  applicantId={applicantId}
                  item={item}
                  cases={cases}
                  returning={returning}
                  suggestionsAvailable={suggestionsAvailable}
                />
              ) : null}
              <div className="page-actions ai-connection-actions">
                <AiConnectionTurnOff
                  applicantId={applicantId}
                  connectionId={item.id}
                  appName={item.clientName}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {list.activeTotal > list.active.length ? (
        <p className="card-body muted">
          And {list.activeTotal - list.active.length} more connected AI{' '}
          {list.activeTotal - list.active.length === 1 ? 'app' : 'apps'}, not shown here. Turn off
          ones you no longer use to see the rest.
        </p>
      ) : null}
      {connectorOn && list.recentlyEnded.length > 0 ? (
        <details className="ai-connections-ended">
          <summary>Recently Turned Off ({list.recentlyEnded.length})</summary>
          <ul className="ai-connection-list">
            {list.recentlyEnded.map((item) => (
              <li key={item.id} className="ai-connection">
                <p className="ai-connection-name">
                  {item.clientName} <span className="ai-consent-host">{item.clientHost}</span>
                </p>
                <p className="muted u-m-0">{endedLine(item)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
