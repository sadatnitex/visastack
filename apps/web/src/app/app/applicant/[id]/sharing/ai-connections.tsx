import { type AiFeatureOffReason, aiFeatureOffHint } from '@visastack/core/ai-features';
import type { AiConnectionList, AiConnectionSummary } from '@visastack/services';
import { applicantSharingCatalog } from '../../../../../i18n/applicant-sharing';
import {
  AI_CONNECTION_DURATIONS,
  AI_CONNECTION_LAYERS,
  AI_KEEP_END,
  type AiChangeDuration,
  type AiFileChoice,
  type AiFilesView,
  type ConsentInitial,
} from '../../../../../lib/ai-consent-choices';
import {
  AI_DURATION_LABELS,
  AI_FULL_NUMBERS_LABEL,
  AI_ORIGINAL_FILES_LABEL,
  AI_SUGGEST_CHANGES_LABEL,
  aiAccessLabels,
  aiAllowsSuggestions,
  aiFilesLine,
} from '../../../../../lib/ai-consent-labels';
import { formatTimestamp, formatTimestampDate } from '../../../../../lib/format-date';
import { getServerT } from '../../../../../lib/i18n-server';
import { ChangeAccessForm } from './ai-connection-change';
import { AiConnectionTurnOff } from './ai-connection-turn-off';

type CaseOption = { readonly id: string; readonly title: string };
type AccessChoices = Omit<ConsentInitial, 'duration'>;

/** The person's own Change Access choices, carried back after a fresh sign-in check. */
export interface AiChangeReturn {
  readonly connectionId: string;
  readonly choices: AccessChoices;
  readonly duration: AiChangeDuration;
  /** The files the person ticked, from a signed cookie for this connection (never a link). */
  readonly files?: readonly AiFileChoice[];
}

/** "Original Files" on the Sharing page (S20): what may be ticked, and what each connection has. */
export interface AiConnectionFiles {
  readonly view: AiFilesView;
  readonly byConnection: Readonly<Record<string, readonly AiFileChoice[]>>;
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
  files,
}: {
  readonly applicantId: string;
  readonly item: AiConnectionSummary;
  readonly cases: readonly CaseOption[];
  readonly returning: AiChangeReturn | undefined;
  readonly suggestionsAvailable: boolean;
  readonly files: AiConnectionFiles | undefined;
}) {
  const t = getServerT(applicantSharingCatalog);
  const options = caseOptionsFor(item, cases);
  const back = returning?.connectionId === item.id ? returning : undefined;
  const stored = storedChoices(item);
  // Suggest Changes always starts from what the connection has stored, never from a link.
  const chosen = back ? { ...back.choices, suggestChanges: stored.suggestChanges } : stored;
  const valid =
    chosen.cases === 'all' ||
    chosen.cases === 'none' ||
    options.some((option) => option.id === chosen.cases);
  return (
    <details className="ai-connection-change" open={back !== undefined}>
      <summary
        className="btn btn-secondary"
        aria-label={t(
          'applicantSharing.appApplicantIdSharingAiConnections.changeAccessForClientname',
          { clientName: item.clientName },
        )}
      >
        {t.node('applicantSharing.appApplicantIdSharingAiConnections.changeAccess')}
      </summary>
      <ChangeAccessForm
        applicantId={applicantId}
        connectionId={item.id}
        appName={item.clientName}
        cases={options}
        initial={{ ...chosen, cases: valid ? chosen.cases : storedCase(item) }}
        suggestStored={stored.suggestChanges}
        durations={changeDurations(item)}
        defaultDuration={back ? back.duration : AI_KEEP_END}
        suggestionsAvailable={suggestionsAvailable}
        {...(files
          ? {
              files: files.view,
              filesStored: files.byConnection[item.id] ?? [],
              filesInitial: back?.files ?? files.byConnection[item.id] ?? [],
            }
          : {})}
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
  files,
}: {
  readonly item: AiConnectionSummary;
  readonly suggestionsAvailable: boolean;
  readonly files: AiConnectionFiles | undefined;
}) {
  const t = getServerT(applicantSharingCatalog);
  const access = aiAccessLabels(item.scopes);
  const ticked = files?.byConnection[item.id] ?? [];
  return (
    <dl className="ai-connection-facts">
      <div>
        <dt>{t.node('applicantSharing.appApplicantIdSharingAiConnections.connected')}</dt>
        <dd>{formatTimestampDate(item.connectedAt)}</dd>
      </div>
      <div>
        <dt>{t.node('applicantSharing.appApplicantIdSharingAiConnections.canRead')}</dt>
        <dd>
          {access.length > 0
            ? access.join(', ')
            : t.node('applicantSharing.appApplicantIdSharingAiConnections.nothingFromThisRecord')}
        </dd>
      </div>
      <div>
        <dt>{t.node('applicantSharing.appApplicantIdSharingAiConnections.cases')}</dt>
        <dd>{aiCaseLine(item)}</dd>
      </div>
      <div>
        <dt>{AI_FULL_NUMBERS_LABEL}</dt>
        <dd>
          {item.revealIdentifiers
            ? t.node('applicantSharing.appApplicantIdSharingAiConnections.yes')
            : t.node('applicantSharing.appApplicantIdSharingAiConnections.no')}
        </dd>
      </div>
      {ticked.length > 0 ? (
        <div>
          <dt>{AI_ORIGINAL_FILES_LABEL}</dt>
          <dd>
            {files?.view.available
              ? aiFilesLine(ticked)
              : t.node(
                  'applicantSharing.appApplicantIdSharingAiConnections.aifileslineButTurnedOffRightNow',
                  { aiFilesLine: aiFilesLine(ticked) },
                )}
          </dd>
        </div>
      ) : null}
      {aiAllowsSuggestions(item.scopes) ? (
        <div>
          <dt>{AI_SUGGEST_CHANGES_LABEL}</dt>
          <dd>
            {suggestionsAvailable
              ? t.node('applicantSharing.appApplicantIdSharingAiConnections.yes')
              : t.node(
                  'applicantSharing.appApplicantIdSharingAiConnections.yesButTurnedOffRightNow',
                )}
          </dd>
        </div>
      ) : null}
      <div>
        <dt>{t.node('applicantSharing.appApplicantIdSharingAiConnections.ends')}</dt>
        <dd>
          {item.expiresAt
            ? formatTimestamp(item.expiresAt)
            : t.node('applicantSharing.appApplicantIdSharingAiConnections.untilYouTurnItOff')}
        </dd>
      </div>
      <div>
        <dt>{t.node('applicantSharing.appApplicantIdSharingAiConnections.lastUsed')}</dt>
        <dd>
          {item.lastUsedAt
            ? formatTimestamp(item.lastUsedAt)
            : t.node('applicantSharing.appApplicantIdSharingAiConnections.notUsedYet')}
        </dd>
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
  files,
  accessOff,
}: {
  readonly applicantId: string;
  readonly list: AiConnectionList;
  readonly connectorOn: boolean;
  /** "Original Files" (S20): absent while it cannot be offered (not available yet). */
  readonly files?: AiConnectionFiles;
  /** The record's current cases, for Change Access. */
  readonly cases?: readonly CaseOption[];
  /** Change Access choices coming back from a fresh sign-in check: that form opens with them. */
  readonly returning?: AiChangeReturn;
  /** What just happened, after the page reloaded. */
  readonly notice?: 'off' | 'changed';
  /** Whether AI App Suggestions works right now (S21). */
  readonly suggestionsAvailable?: boolean;
  /**
   * Set while AI App Access is off for this person (S28): apps cannot read anything, and the
   * connections stay listed so each one can still be changed or turned off.
   */
  readonly accessOff?: AiFeatureOffReason | null;
}) {
  const t = getServerT(applicantSharingCatalog);
  // While connecting is off the card shows only what can still be acted on, or what just happened.
  if (!connectorOn && list.active.length === 0 && !notice) return null;
  const onlyNotice = !connectorOn && list.active.length === 0;
  return (
    <article
      className="card ai-connections"
      id="ai-connections"
      aria-labelledby="ai-connections-title"
    >
      <p className="card-kicker">
        {t.node('applicantSharing.appApplicantIdSharingAiConnections.aiApps')}
      </p>
      <h2 className="card-title" id="ai-connections-title">
        {t.node('applicantSharing.appApplicantIdSharingAiConnections.aiConnections')}
      </h2>
      {list.active.some((item) => aiAllowsSuggestions(item.scopes)) ? (
        <p className="card-body">
          {t.node('applicantSharing.appApplicantIdSharingAiConnections.aiAppsYouConnectedToThis')}
        </p>
      ) : (
        <p className="card-body">
          {t.node(
            'applicantSharing.appApplicantIdSharingAiConnections.aiAppsYouConnectedToThis12cecd',
          )}
        </p>
      )}
      {accessOff !== undefined && list.active.length > 0 ? (
        <p className="card-body muted">{aiFeatureOffHint(accessOff)}</p>
      ) : null}
      {notice ? (
        <output className="notice ai-connections-notice">
          {notice === 'off'
            ? t.node('applicantSharing.appApplicantIdSharingAiConnections.turnedOffThatAppCanNo')
            : t.node(
                'applicantSharing.appApplicantIdSharingAiConnections.accessChangedTheAppGetsThe',
              )}
        </output>
      ) : null}
      {onlyNotice ? null : !list.available ? (
        <p className="card-body muted">
          {t.node(
            'applicantSharing.appApplicantIdSharingAiConnections.aiConnectionsCannotBeShownRight',
          )}
        </p>
      ) : list.active.length === 0 ? (
        <p className="card-body muted">
          {t.node('applicantSharing.appApplicantIdSharingAiConnections.noAiAppsAreConnectedTo')}
        </p>
      ) : (
        <ul className="ai-connection-list">
          {list.active.map((item) => (
            <li key={item.id} className="ai-connection">
              <h3 className="ai-connection-name">
                {item.clientName} <span className="ai-consent-host">{item.clientHost}</span>
              </h3>
              <Details item={item} suggestionsAvailable={suggestionsAvailable} files={files} />
              {connectorOn ? (
                <ChangeAccess
                  applicantId={applicantId}
                  item={item}
                  cases={cases}
                  returning={returning}
                  suggestionsAvailable={suggestionsAvailable}
                  files={files}
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
          <summary>
            {t.node('applicantSharing.appApplicantIdSharingAiConnections.recentlyTurnedOffLength', {
              length: list.recentlyEnded.length,
            })}
          </summary>
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
