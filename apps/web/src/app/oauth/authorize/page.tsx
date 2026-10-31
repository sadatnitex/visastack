import { aiFeatureOffSentence } from '@visastack/core/ai-features';
import {
  AGENCY_AI_DEFAULT_DURATION,
  AGENCY_AI_ROLES,
  accountPrincipal,
  getAiFeatureStates,
  getOrganizationAiSetting,
  listAiFileCandidates,
  listApplicants,
  listMembershipsForAccount,
  listMissions,
  requireAccess,
} from '@visastack/services';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { aiConnectorEnabled } from '../../../lib/ai-connector';
import {
  type AiFileChoice,
  type AiFilesView,
  consentChoicesFromQuery,
  settleConsentCases,
} from '../../../lib/ai-consent-choices';
import {
  AI_FILE_PICKS_CONSENT,
  consentRequestKey,
  decodeAiFilePicks,
  rememberedAiFilePicks,
} from '../../../lib/ai-file-picks-retry';
import {
  type AuthorizeParams,
  checkAuthorizeRequest,
  singleParam,
} from '../../../lib/oauth-authorize';
import { withPublicDb } from '../../../lib/public-db';
import { withSession } from '../../../lib/session';
import { AuthShell } from '../../auth/auth-ui';
import { AgencyConsentForm } from './agency-consent-form';
import { ConsentForm } from './consent-form';

export const metadata: Metadata = { title: 'Connect an AI App' };

export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;

const PARAM_NAMES = [
  'response_type',
  'client_id',
  'redirect_uri',
  'code_challenge',
  'code_challenge_method',
  'resource',
  'state',
  'scope',
] as const;

const REFUSALS = {
  unsupported_app: {
    title: 'This AI App Is Not Supported Yet',
    body: 'VisaStack connects only to the AI apps it supports, such as ChatGPT and Claude. Nothing was shared.',
  },
  invalid_link: {
    title: 'This Connection Link Is Not Valid',
    body: 'The request from the AI app is incomplete or does not match the app. Start again from the AI app. Nothing was shared.',
  },
  unavailable: {
    title: 'The AI App Could Not Be Checked',
    body: 'VisaStack could not confirm which app is asking. Try again in a few minutes. Nothing was shared.',
  },
} as const;

/**
 * The AI app consent screen (`/oauth/authorize`, ADR 0021 sections 2 and 5). A signed-in person
 * sees which app is asking, its web address, which record it would read, and chooses exactly what
 * it may read and for how long.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  readonly searchParams: Promise<Search>;
}) {
  if (!aiConnectorEnabled()) notFound();
  const search = await searchParams;
  const params: Record<string, string> = {};
  for (const name of PARAM_NAMES) {
    const value = singleParam(search[name]);
    if (value !== undefined) params[name] = value;
  }
  const check = await withPublicDb((db) => checkAuthorizeRequest(db, params as AuthorizeParams));
  if (check.kind === 'redirect') redirect(check.url);
  if (check.kind === 'refuse') {
    const refusal = REFUSALS[check.reason];
    return (
      <AuthShell title={refusal.title}>
        <p className="card-body">{refusal.body}</p>
      </AuthShell>
    );
  }
  const { request } = check;
  const recordKey = 'record';
  const recordParam = singleParam(search[recordKey]);
  // Set when the person starts from one of their cases: that case is the default choice.
  const caseKey = 'case';
  const caseParam = singleParam(search[caseKey]);
  // S22: an agency the person runs, chosen from the list below. Re-checked here and again when
  // the answer arrives; the address only says which agency was picked, never that it may connect.
  const agencyKey = 'agency';
  const agencyParam = singleParam(search[agencyKey]);
  const remembered = await rememberedAiFilePicks();
  const view = await withSession(async ({ db, accountId }) => {
    // Agencies this person may connect an AI app for right now (S22): an active owner or admin
    // of an active agency whose setting and Agency AI Tools are on.
    const agencies: { readonly id: string; readonly name: string }[] = [];
    for (const membership of await listMembershipsForAccount(db, accountId)) {
      if (
        !membership.active ||
        !AGENCY_AI_ROLES.includes(membership.role) ||
        membership.organization.status !== 'ACTIVE'
      ) {
        continue;
      }
      const setting = await getOrganizationAiSetting(db, {
        organizationId: membership.organization.id,
        accountId,
      });
      if (
        setting.ok &&
        setting.value.available &&
        setting.value.enabled &&
        setting.value.feature.available
      ) {
        agencies.push({ id: membership.organization.id, name: membership.organization.name });
      }
    }
    const agency = agencies.find((item) => item.id === agencyParam) ?? null;
    const records = (await listApplicants(db, accountId)).map((row) => ({
      id: row.id,
      name: row.displayName,
    }));
    const chosen =
      records.find((row) => row.id === recordParam) ??
      (records.length === 1 ? records[0] : undefined);
    const missions = chosen ? await listMissions(db, accountId, chosen.id) : null;
    const cases =
      missions?.ok === true
        ? missions.value
            .filter((mission) => mission.state !== 'CANCELLED' && mission.state !== 'CLOSED')
            .map((mission) => ({ id: mission.id, title: mission.title }))
        : [];
    // "Suggest Changes" is offered only while AI App Suggestions works for this person (S21).
    const access = chosen
      ? await requireAccess(
          db,
          accountPrincipal(accountId),
          'VIEW_METADATA',
          { applicantId: chosen.id },
          { purpose: 'ai_connection' },
        )
      : null;
    // The three AI app features, read once (S28): settings and plan in one pass.
    const states =
      access?.ok === true
        ? await getAiFeatureStates(
            db,
            ['ai_app_suggestions', 'ai_app_access', 'ai_app_original_files'],
            { proof: access.value },
          )
        : null;
    const suggestionsAvailable = states?.ai_app_suggestions.available ?? false;
    // AI App Access (S28): while it is off the app could connect but read nothing, so say so.
    const accessOff =
      states && !states.ai_app_access.available
        ? `${aiFeatureOffSentence('ai_app_access', states.ai_app_access.reason)} The app can still connect, but it reads nothing from your record until AI App Access works again.`
        : null;
    // "Original Files" (S20): the record's documents that may be ticked, once the feature exists.
    let files: AiFilesView | undefined;
    let filesInitial: readonly AiFileChoice[] = [];
    if (access?.ok === true && chosen && access.value.actor.kind === 'applicant_owner') {
      const candidates = await listAiFileCandidates(access.value);
      if (candidates.ok && candidates.value.available) {
        files = {
          available: states?.ai_app_original_files.available ?? false,
          candidates: candidates.value.documents.map((document) => ({
            documentId: document.documentId,
            referenceCode: document.referenceCode,
            kind: document.kind,
            group: document.group,
            safeCopyReady: document.safeCopyReady,
          })),
        };
        // The person's own ticks, back from a fresh sign-in check (a signed cookie, never a link).
        filesInitial =
          decodeAiFilePicks(remembered, {
            accountId,
            applicantId: chosen.id,
            target: AI_FILE_PICKS_CONSENT,
            // Only for this exact request: another app's screen is never pre-ticked.
            request: consentRequestKey({
              clientId: request.client.clientId,
              codeChallenge: request.codeChallenge,
              state: request.state,
            }),
          }) ?? [];
      }
    }
    return {
      records,
      chosen,
      cases,
      suggestionsAvailable,
      files,
      filesInitial,
      accessOff,
      agencies,
      agency,
    };
  });

  const appName = request.client.clientName;
  return (
    <AuthShell title={`Connect ${appName}`} eyebrow="AI App Access">
      <p className="card-body">
        <span className="ai-consent-host">{request.client.host}</span> is asking to read parts of a
        VisaStack record so it can help you.
      </p>
      {request.client.loopback ? (
        <p className="notice notice-warn">
          This app runs on this computer, not on a website. Allow it only if you started it yourself
          just now.
        </p>
      ) : null}
      {view.agency ? (
        <>
          <p className="card-body">
            Agency: <strong>{view.agency.name}</strong>
          </p>
          <AgencyConsentForm
            request={{
              clientId: request.client.clientId,
              redirectUri: request.redirectUri,
              codeChallenge: request.codeChallenge,
              resource: request.resource,
              state: request.state,
            }}
            agency={view.agency}
            defaultDuration={AGENCY_AI_DEFAULT_DURATION}
          />
        </>
      ) : view.records.length === 0 ? (
        <p className="card-body">You have no records to connect yet. Add one in VisaStack first.</p>
      ) : !view.chosen ? (
        <nav aria-label="Choose a Record">
          <p className="card-body">Choose the record this app may read:</p>
          <ul className="rows">
            {view.records.map((row) => (
              <li key={row.id}>
                <a
                  className="btn btn-secondary"
                  href={`/oauth/authorize?${new URLSearchParams({
                    ...params,
                    record: row.id,
                    ...(caseParam !== undefined ? { case: caseParam } : {}),
                  }).toString()}`}
                >
                  {row.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : (
        <>
          <p className="card-body">
            Record: <strong>{view.chosen.name}</strong>
          </p>
          {view.accessOff ? <p className="notice notice-warn">{view.accessOff}</p> : null}
          <ConsentForm
            request={{
              clientId: request.client.clientId,
              redirectUri: request.redirectUri,
              codeChallenge: request.codeChallenge,
              resource: request.resource,
              state: request.state,
            }}
            appName={appName}
            record={view.chosen}
            cases={view.cases}
            suggestionsAvailable={view.suggestionsAvailable}
            {...(view.files ? { files: view.files } : {})}
            filesInitial={view.filesInitial}
            initial={settleConsentCases(
              consentChoicesFromQuery((name) => singleParam(search[name])),
              view.cases.map((item) => item.id),
              caseParam,
            )}
          />
        </>
      )}
      {!view.agency && view.agencies.length > 0 ? (
        <nav aria-label="Connect for an Agency">
          <p className="card-body">Or connect it for an agency you run:</p>
          <ul className="rows">
            {view.agencies.map((item) => (
              <li key={item.id}>
                <a
                  className="btn btn-secondary"
                  href={`/oauth/authorize?${new URLSearchParams({
                    ...params,
                    agency: item.id,
                  }).toString()}`}
                >
                  {item.name}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </AuthShell>
  );
}
