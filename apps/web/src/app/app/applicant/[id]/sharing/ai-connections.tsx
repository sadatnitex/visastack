import {
  type AiFeatureOffReason,
  aiAppHost,
  aiAppName,
  aiFeatureOffHint,
} from '@visastack/core/ai-features';
import type { AiConnectionList, AiConnectionSummary } from '@visastack/services';
import {
  AiConnectionTile,
  type AiTileGroup,
  type AiTileRead,
  aiConnectionEndedOn,
  aiConnectionFacts,
} from '../../../../../components/ai-connection-tile';
import type { IconName } from '../../../../../components/icons';
import { applicantSharingCatalog } from '../../../../../i18n/applicant-sharing';
import { componentsCatalog } from '../../../../../i18n/components';
import {
  aiConnectionTimeLeft,
  aiCurrentPeriodStart,
  formatMomentIn,
} from '../../../../../lib/ai-connection-time-left';
import {
  AI_CONNECTION_DURATIONS,
  AI_CONNECTION_LAYERS,
  AI_KEEP_END,
  type AiChangeDuration,
  type AiConnectionLayer,
  type AiFileChoice,
  type AiFilesView,
  type ConsentInitial,
} from '../../../../../lib/ai-consent-choices';
import {
  AI_DOCUMENT_LIST_LABEL,
  AI_DOCUMENT_TEXT_LABEL,
  AI_DURATION_LABELS,
  AI_FULL_NUMBERS_LABEL,
  AI_LAYER_LABELS,
  AI_LAYER_NOTES,
  AI_ORIGINAL_FILES_LABEL,
  AI_ORIGINAL_FILES_NOTE,
  AI_SUGGEST_CHANGES_LABEL,
  AI_SUGGEST_CHANGES_NOTE,
  aiAllowsSuggestions,
  aiFilesLine,
} from '../../../../../lib/ai-consent-labels';
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
export function changeDurations(item: AiConnectionSummary, timeZone?: string | null) {
  return [
    {
      value: AI_KEEP_END,
      label: item.expiresAt
        ? `Keep the Current End (${formatMomentIn(item.expiresAt, timeZone)})`
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
  timeZone,
}: {
  readonly applicantId: string;
  readonly item: AiConnectionSummary;
  readonly cases: readonly CaseOption[];
  readonly returning: AiChangeReturn | undefined;
  readonly suggestionsAvailable: boolean;
  readonly files: AiConnectionFiles | undefined;
  readonly timeZone: string | null | undefined;
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
        durations={changeDurations(item, timeZone)}
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

/** The picture for each thing an app can read (WAL5 tiles); the words are the consent screen's own. */
const LAYER_ICONS: Readonly<Record<AiConnectionLayer, IconName>> = {
  identity: 'user',
  travel_documents: 'docPassport',
  timelines: 'plane',
  money: 'docBank',
  people: 'users',
  qualifications: 'docCertificate',
  declarations: 'alert',
  health: 'activity',
};

/**
 * The first sentence of the Personal Details note ("Name, date of birth, nationality and contact
 * details."), read from the consent note itself. Its second sentence (numbers show only their last
 * three characters) is true only without Full Document Numbers.
 */
export const IDENTITY_NOTE_WHAT = `${AI_LAYER_NOTES.identity.split('. ')[0] ?? ''}.`;

/**
 * What a connection can read and do, as the tile's groups of pictures: the consent screen's labels
 * verbatim, each with the consent screen's own sentence as its Explain note, in its order.
 * 1. "Can Read": the parts of the record and the documents (or "Nothing from this record", a
 *    line of its own); 2. Cases and Full Document Numbers, each naming itself; 3. "Changes":
 *    Suggest Changes, which is not reading.
 */
export function connectionGroups(
  item: AiConnectionSummary,
  files: AiConnectionFiles | undefined,
  suggestionsAvailable: boolean,
): AiTileGroup[] {
  const t = getServerT(applicantSharingCatalog);
  const tc = getServerT(componentsCatalog);
  const fullNumbersNote = tc.node('components.aiAccessChoices.sensitiveShowsWholePassportAndId');
  const ticked = files?.byConnection[item.id] ?? [];
  const reads: AiTileRead[] = AI_CONNECTION_LAYERS.filter((layer) =>
    item.scopes.includes(layer),
  ).map((layer) => ({
    key: layer,
    icon: LAYER_ICONS[layer],
    label: AI_LAYER_LABELS[layer],
    note:
      layer === 'identity' && item.revealIdentifiers ? (
        <>
          {IDENTITY_NOTE_WHAT} {fullNumbersNote}
        </>
      ) : (
        AI_LAYER_NOTES[layer]
      ),
  }));
  if (item.scopes.includes('document_list')) {
    reads.push({
      key: 'document_list',
      icon: 'folder',
      label: AI_DOCUMENT_LIST_LABEL,
      note: tc.node('components.aiAccessChoices.kindDatesAndStatusOnlyNo'),
    });
  }
  if (item.scopes.includes('document_text')) {
    reads.push({
      key: 'document_text',
      icon: 'file',
      label: AI_DOCUMENT_TEXT_LABEL,
      note: tc.node('components.aiAccessChoices.sensitiveTheWordsReadFromDocuments'),
    });
  }
  if (ticked.length > 0) {
    reads.push({
      key: 'original_files',
      icon: 'docPhoto',
      label: AI_ORIGINAL_FILES_LABEL,
      value: files?.view.available
        ? aiFilesLine(ticked)
        : t.node(
            'applicantSharing.appApplicantIdSharingAiConnections.aifileslineButTurnedOffRightNow',
            { aiFilesLine: aiFilesLine(ticked) },
          ),
      note: AI_ORIGINAL_FILES_NOTE,
    });
  }
  const limits: AiTileRead[] = [
    {
      key: 'cases',
      icon: 'briefcase',
      label: t.node('applicantSharing.appApplicantIdSharingAiConnections.cases'),
      value: aiCaseLine(item),
      note: t.node('applicantSharing.appApplicantIdSharingAiConnections.casesNote'),
    },
    {
      key: 'full_numbers',
      icon: item.revealIdentifiers ? 'key' : 'lock',
      label: AI_FULL_NUMBERS_LABEL,
      value: item.revealIdentifiers
        ? t.node('applicantSharing.appApplicantIdSharingAiConnections.yes')
        : t.node('applicantSharing.appApplicantIdSharingAiConnections.no'),
      note: item.revealIdentifiers
        ? fullNumbersNote
        : t.node(
            'applicantSharing.appApplicantIdSharingAiConnections.numbersShowOnlyTheirLastThree',
          ),
    },
  ];
  const changes: AiTileRead[] = aiAllowsSuggestions(item.scopes)
    ? [
        {
          key: 'suggest_changes',
          icon: 'clipboard',
          label: AI_SUGGEST_CHANGES_LABEL,
          value: suggestionsAvailable
            ? t.node('applicantSharing.appApplicantIdSharingAiConnections.yes')
            : t.node('applicantSharing.appApplicantIdSharingAiConnections.yesButTurnedOffRightNow'),
          note: AI_SUGGEST_CHANGES_NOTE,
        },
      ]
    : [];
  return [
    {
      key: 'reads',
      term: t.node('applicantSharing.appApplicantIdSharingAiConnections.canRead'),
      reads,
      empty: t.node('applicantSharing.appApplicantIdSharingAiConnections.nothingFromThisRecord'),
    },
    { key: 'limits', reads: limits },
    { key: 'changes', term: tc.node('components.aiAccessChoices.changes'), reads: changes },
  ];
}

/** The clock, the facts and the ended date of one traveller tile, from one time-left reading. */
function tileClock(item: AiConnectionSummary, now: Date, timeZone: string | null | undefined) {
  const timeLeft = aiConnectionTimeLeft({
    start: aiCurrentPeriodStart(item.connectedAt, item.expiresAt),
    end: item.expiresAt,
    now,
  });
  return {
    timeLeft,
    facts: aiConnectionFacts({
      connectedAt: item.connectedAt,
      end: item.expiresAt,
      lastUsedAt: item.lastUsedAt,
      timeLeft,
      timeZone,
    }),
    endedOn: aiConnectionEndedOn(item.expiresAt, now, timeZone),
  };
}

function endedLine(item: AiConnectionSummary, timeZone: string | null | undefined): string {
  const when = item.endedAt ? formatMomentIn(item.endedAt, timeZone) : '';
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
  timeZone,
  now = new Date(),
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
  /** The person's time zone for dates and days left (UTC only when it is unknown). */
  readonly timeZone?: string | null;
  /** The moment the page is drawn, for the time left. */
  readonly now?: Date;
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
              <AiConnectionTile
                id={item.id}
                appName={item.clientName}
                appHost={item.clientHost}
                groups={connectionGroups(item, files, suggestionsAvailable)}
                {...tileClock(item, now, timeZone)}
                actions={
                  <>
                    {connectorOn ? (
                      <ChangeAccess
                        applicantId={applicantId}
                        item={item}
                        cases={cases}
                        returning={returning}
                        suggestionsAvailable={suggestionsAvailable}
                        files={files}
                        timeZone={timeZone}
                      />
                    ) : null}
                    <div className="page-actions ai-connection-actions">
                      <AiConnectionTurnOff
                        applicantId={applicantId}
                        connectionId={item.id}
                        appName={item.clientName}
                      />
                    </div>
                  </>
                }
              />
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
                  {aiAppName(item.clientName)}{' '}
                  <span className="ai-consent-host">{aiAppHost(item.clientHost)}</span>
                </p>
                <p className="muted u-m-0">{endedLine(item, timeZone)}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </article>
  );
}
