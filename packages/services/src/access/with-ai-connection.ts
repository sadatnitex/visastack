import { type Result, err, formatReferenceCode, ok, parseReferenceCode } from '@visastack/core';
import type { DocumentGroupKey, LayerKey } from '@visastack/core/catalogue';
import { eq } from 'drizzle-orm';
import { touchAccountActivity } from '../accounts';
import {
  AI_CONNECTION_LAYERS,
  type AiCaseMode,
  type AiConnectionLayer,
  selectionFromStoredChoices,
} from '../ai-connection-scopes';
import { appendAuditEvent } from '../audit';
import { type Db, first, schema } from '../db';
import type { KeyManagementPort } from '../ports';
import {
  type AI_CONTEXT_DENIAL_LABELS,
  AI_CONTEXT_TOOL_LABELS,
  recordProductEvent,
} from '../product-events';
import {
  type CaseSelection,
  type SelectedOutput,
  type SelectedOutputOptions,
  type Selection,
  type SelectionDepth,
  buildSelectedOutput,
  listSelectableCases,
} from '../selected-output';
import { type ResolvedAiConnection, resolveAiAccessToken } from './ai-connection';
import { accountPrincipal } from './principal';
import { type AuthorizedApplicant, requireAccess } from './require-access';
import { stepUpFromAiConnection } from './step-up-proof';

/**
 * The AI gate (ADR 0021 section 3): the only way an AI app's request reaches a person's record.
 *
 * Every call, from scratch:
 * 1. the access token is looked up again for this exact resource: live, unexpired, unrevoked, on
 *    a live, activated connection (`resolveAiAccessToken`, which also writes `last_used_at` at most
 *    once a minute). The stored connection is the authority, so a change made in VisaStack, or
 *    turning the connection off, takes effect on the very next call;
 * 2. the account must still be admitted (the same pilot-access rule a signed-in page applies,
 *    handed in by the caller), and its activity is recorded at most once a day;
 * 3. the central access gate is asked again whether the connection's account still owns the
 *    record (`requireAccess` with the `ai_connection` purpose). Anything but the owner is refused;
 * 4. the tool is handed a gateway that can do one thing: ask the context composer for the
 *    connection's own Selection, narrowed further if the tool wants less. It cannot widen the
 *    Selection, name another record, reach the database or see the proof.
 *
 * Tools live in `../ai-tools/` and may import nothing that reads data except this module; a guard
 * test (`ai-tools/boundary.test.ts`) fails otherwise.
 *
 * Audit: one `AI_CONTEXT_SERVED` or `AI_CONTEXT_DENIED` event per tool call, describing what the
 * tool actually returned: the connection, client host, tool, layers, case, counts, depth and
 * denial reason. Never a value, document text or token. A call that fails part-way is still
 * recorded, as denied with the reason `failed`.
 *
 * Telemetry (S16): beside each audit record, one product event, `AI_CONTEXT_REQUESTED` (label:
 * the tool; number: sections returned) or `AI_CONTEXT_DENIED` (label: the denial reason). It is
 * best effort: `recordProductEvent` writes in a savepoint and never throws, so a failed event
 * never changes the answer or the audit record.
 */

export const AI_CONNECTION_PURPOSE = 'ai_connection';

/** Pure helpers the tools may use: they render what the gateway composed and read nothing. */
export { AI_CONNECTION_LAYERS, type AiConnectionLayer } from '../ai-connection-scopes';
export { aiContextObject, layerLabel } from '../selected-output';

/** An access token as the token store issues it: the prefix and 32 random bytes, base64url. */
const ACCESS_TOKEN_SHAPE = /^vsa_[A-Za-z0-9_-]{43}$/;

/** Whether a presented token could be one of ours, checked before any database work. */
export function isWellFormedAiAccessToken(token: string): boolean {
  return ACCESS_TOKEN_SHAPE.test(token);
}

/** What a person granted, in plain data, so a tool can refuse plainly. No ids, no values. */
export interface AiGrantedScope {
  readonly layers: readonly AiConnectionLayer[];
  readonly caseMode: AiCaseMode;
  readonly documentList: boolean;
  /** "Text Read From My Documents", for the document groups the chosen layers allow. */
  readonly documentText: boolean;
  readonly documentTextGroups: readonly DocumentGroupKey[];
  readonly revealIdentifiers: boolean;
  readonly depth: SelectionDepth;
}

/**
 * Asking for less than the connection allows. Every field can only take away: the depth is the
 * shallower of the two, booleans are AND-ed, a case must be one the connection already covers.
 * `layers` only chooses which granted sections are shown: what the connection grants (document
 * groups, legal history, health detail, national identifiers) is still decided by its own grant.
 */
export interface AiNarrowing {
  readonly layers?: readonly LayerKey[];
  /** `false`: leave the identity basics out, unread. */
  readonly basics?: boolean;
  /** `connection`: the cases the connection covers (the default); `none`: no case. */
  readonly cases?: 'connection' | 'none' | { readonly reference: string };
  readonly documentList?: boolean;
  readonly documentText?: boolean;
  readonly depth?: SelectionDepth;
  /** Only these profile fields; an empty list reads no values at all (document-only answers). */
  readonly fieldKeys?: readonly string[];
  readonly documentScope?: {
    readonly groups?: readonly DocumentGroupKey[];
    readonly referenceCodes?: readonly string[];
  };
}

export type AiComposeFailure =
  /** The case named is not one this connection covers (or does not exist: the same answer). */
  | 'case_not_shared'
  /** The connection's one case was removed. */
  | 'case_unavailable'
  | 'failed';

/** Why a call was refused, as recorded in the audit (never shown as an id or value). */
export type AiDenialReason =
  | 'layer_not_granted'
  | 'cases_not_granted'
  | 'case_not_shared'
  | 'case_unavailable'
  | 'document_list_not_granted'
  | 'document_text_not_granted'
  | 'document_not_shared'
  | 'document_protected'
  | 'no_text'
  | 'too_large'
  | 'failed';

export interface AiContextGateway {
  readonly scope: AiGrantedScope;
  /** The composer, with the connection's Selection, narrowed by `narrowing`. */
  compose(narrowing?: AiNarrowing): Promise<Result<SelectedOutput, AiComposeFailure>>;
  /** Records the refusal for the audit; the tool still answers in plain words. */
  denied(reason: AiDenialReason): void;
}

/** What a finished call gave back, for the audit: counts and section names only. */
export type AiCallRecord =
  | {
      readonly kind: 'served';
      readonly layers: readonly string[];
      readonly cases: number;
      readonly values: number;
      readonly documents: number;
      readonly documentTexts: number;
    }
  | { readonly kind: 'denied'; readonly reason: AiDenialReason };

export type AiGateRefusal = { readonly kind: 'unauthorized' };

/**
 * Whether the account may still use VisaStack: the deployment's pilot-access rule, handed in by
 * the web layer (it holds the allowlist and the deployment mode). Required, so it is never
 * skipped by accident.
 */
export type AiAdmission = (
  tx: Db,
  account: { readonly accountId: string; readonly email: string },
) => Promise<boolean>;

export interface AiGateRequest {
  readonly token: string;
  readonly resource: string;
  readonly tool: string;
  readonly admission: AiAdmission;
  readonly now?: Date;
  /** Needed to read protected values; without it they are left out and counted. */
  readonly encryption?: KeyManagementPort;
}

/** Account activity (inactive-account rules) is recorded at most this often from AI calls. */
const ACTIVITY_GAP_MS = 24 * 60 * 60 * 1000;

const DEPTH_ORDER: Readonly<Record<SelectionDepth, number>> = { brief: 0, standard: 1, full: 2 };

function shallower(a: SelectionDepth, b: SelectionDepth): SelectionDepth {
  return DEPTH_ORDER[a] <= DEPTH_ORDER[b] ? a : b;
}

function grantedScope(connection: ResolvedAiConnection, selection: Selection): AiGrantedScope {
  return {
    layers: AI_CONNECTION_LAYERS.filter((layer) => selection.layers.includes(layer)),
    caseMode: connection.caseMode,
    documentList: selection.documentList,
    documentText: selection.documentText.length > 0,
    documentTextGroups: selection.documentText,
    revealIdentifiers: selection.revealIdentifiers,
    depth: selection.depth,
  };
}

/** The visible form of a case reference someone typed (`c 7k2q9m` reads as `C-7K2Q9M`), or null. */
function caseReference(input: string): string | null {
  const parsed = parseReferenceCode(input, 'C');
  return parsed.ok ? formatReferenceCode('C', parsed.code) : null;
}

/** Admitted, with its activity recorded at most once a day (a pending inactivity notice at once). */
async function admitted(
  tx: Db,
  accountId: string,
  admission: AiAdmission,
  now: Date,
): Promise<boolean> {
  const account = first(
    await tx
      .select({
        email: schema.accounts.email,
        lastActiveAt: schema.accounts.lastActiveAt,
        inactivityNoticeSentAt: schema.accounts.inactivityNoticeSentAt,
      })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, accountId))
      .limit(1),
  );
  if (!account || !(await admission(tx, { accountId, email: account.email }))) return false;
  if (
    account.inactivityNoticeSentAt !== null ||
    now.getTime() - account.lastActiveAt.getTime() >= ACTIVITY_GAP_MS
  ) {
    await touchAccountActivity(tx, accountId, now);
  }
  return true;
}

/** Looks the connection up and asks the access gate again. `null` means "answer 401". */
async function openConnection(
  tx: Db,
  request: Pick<AiGateRequest, 'token' | 'resource' | 'now' | 'admission'>,
): Promise<{
  readonly connection: ResolvedAiConnection;
  readonly proof: AuthorizedApplicant<'VIEW_METADATA'>;
} | null> {
  if (!isWellFormedAiAccessToken(request.token)) return null;
  const connection = await resolveAiAccessToken(tx, {
    token: request.token,
    resource: request.resource,
    ...(request.now ? { now: request.now } : {}),
  });
  if (!connection) return null;
  if (!(await admitted(tx, connection.accountId, request.admission, new Date()))) return null;
  const access = await requireAccess(
    tx,
    accountPrincipal(connection.accountId),
    'VIEW_METADATA',
    { applicantId: connection.applicantId },
    { purpose: AI_CONNECTION_PURPOSE },
  );
  // The connection speaks for its owner only; a share recipient's access never counts.
  if (!access.ok || access.value.actor.kind !== 'applicant_owner') return null;
  return { connection, proof: access.value };
}

/** Who a request speaks for, for the route's rate limit. Nothing about the record. */
export interface AiCaller {
  readonly connectionId: string;
  readonly clientHost: string;
}

/**
 * The route's first check, before the request reaches the tools: is this a live token for a
 * connection whose account is admitted and still owns its record? Same rules as
 * `withAiConnection`, which still checks again on every tool call.
 */
export async function authenticateAiRequest(
  db: Db,
  request: Pick<AiGateRequest, 'token' | 'resource' | 'now' | 'admission'>,
): Promise<AiCaller | null> {
  if (!isWellFormedAiAccessToken(request.token)) return null;
  const opened = await db.transaction((tx) => openConnection(tx, request));
  return opened
    ? { connectionId: opened.connection.connectionId, clientHost: opened.connection.clientHost }
    : null;
}

interface AuditTarget {
  readonly connectionId: string;
  readonly accountId: string;
  readonly applicantId: string;
  readonly clientHost: string;
  readonly caseMode: AiCaseMode;
  readonly missionId: string | null;
}

/** The case an event is about: only a one-case connection names one. */
function auditBase(target: AuditTarget) {
  const missionId = target.caseMode === 'ONE' ? target.missionId : null;
  return {
    actorAccountId: target.accountId,
    method: 'API' as const,
    applicantId: target.applicantId,
    resourceType: 'ai_connection',
    resourceId: target.connectionId,
    ...(missionId ? { missionId } : {}),
  };
}

/** The product-event label for each denial reason: the same code, upper case. */
const DENIAL_LABEL: Readonly<Record<AiDenialReason, (typeof AI_CONTEXT_DENIAL_LABELS)[number]>> = {
  layer_not_granted: 'LAYER_NOT_GRANTED',
  cases_not_granted: 'CASES_NOT_GRANTED',
  case_not_shared: 'CASE_NOT_SHARED',
  case_unavailable: 'CASE_UNAVAILABLE',
  document_list_not_granted: 'DOCUMENT_LIST_NOT_GRANTED',
  document_text_not_granted: 'DOCUMENT_TEXT_NOT_GRANTED',
  document_not_shared: 'DOCUMENT_NOT_SHARED',
  document_protected: 'DOCUMENT_PROTECTED',
  no_text: 'NO_TEXT',
  too_large: 'TOO_LARGE',
  failed: 'FAILED',
};

/** The product-event label for a tool: one of the five known names, or none at all. */
function toolLabel(tool: string): (typeof AI_CONTEXT_TOOL_LABELS)[number] | undefined {
  const upper = tool.toUpperCase();
  return AI_CONTEXT_TOOL_LABELS.find((label) => label === upper);
}

async function auditDenied(
  tx: Db,
  target: AuditTarget,
  tool: string,
  reason: AiDenialReason,
): Promise<void> {
  await appendAuditEvent(tx, {
    ...auditBase(target),
    eventType: 'AI_CONTEXT_DENIED',
    result: 'DENIED',
    reason,
    metadata: { clientHost: target.clientHost, tool, caseMode: target.caseMode, reason },
  });
  await recordProductEvent(tx, {
    eventType: 'AI_CONTEXT_DENIED',
    accountId: target.accountId,
    dimension: DENIAL_LABEL[reason],
  });
}

/** Best effort, never throws: a failed call is still recorded, in a small transaction of its own. */
async function auditFailedCall(db: Db, target: AuditTarget, tool: string): Promise<void> {
  try {
    await db.transaction((tx) => auditDenied(tx, target, tool, 'failed'));
  } catch {
    // The call has already failed; a missing audit row must not change its answer.
  }
}

/**
 * Records that the route withheld a tool's answer because it was too large to send (after the
 * call itself was recorded). Best effort, never throws.
 */
export async function auditAiAnswerWithheld(
  db: Db,
  input: { readonly connectionId: string; readonly tool: string },
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      const row = first(
        await tx
          .select()
          .from(schema.aiConnections)
          .where(eq(schema.aiConnections.id, input.connectionId))
          .limit(1),
      );
      if (!row) return;
      await auditDenied(tx, { ...row, connectionId: row.id }, input.tool, 'too_large');
    });
  } catch {
    // Recording is best effort here; the app already gets a plain refusal.
  }
}

/**
 * Runs one tool call for the connection behind `request.token`. `work` receives the gateway and
 * nothing else; `describe` turns what it returned into the audit record (counts only). Returns
 * `unauthorized` when the token, the connection, the account's admission or the owner's access is
 * no longer good; the route answers that with 401 so the app signs in again. A failure part-way
 * is recorded as denied (`failed`) and thrown again for the caller to answer plainly.
 */
export async function withAiConnection<T>(
  db: Db,
  request: AiGateRequest,
  work: (gateway: AiContextGateway) => Promise<T>,
  describe: (value: T) => AiCallRecord,
): Promise<Result<T, AiGateRefusal>> {
  // Set once the connection is known, so a failure part-way can still be recorded.
  const seen: { target: AuditTarget | null } = { target: null };
  try {
    return await db.transaction(async (tx) => {
      const opened = await openConnection(tx, request);
      if (!opened) return err({ kind: 'unauthorized' } as const);
      const { connection, proof } = opened;
      seen.target = connection;
      const selection = selectionFromStoredChoices(connection);
      const stepUp = selection.revealIdentifiers
        ? await stepUpFromAiConnection(tx, connection.connectionId)
        : undefined;
      // Without a standing check (for example the record changed hands), numbers stay masked.
      const effective: Selection = stepUp ? selection : { ...selection, revealIdentifiers: false };
      const scope = grantedScope(connection, effective);
      const options: SelectedOutputOptions = {
        ...(request.now ? { now: request.now } : {}),
        ...(request.encryption ? { encryption: request.encryption } : {}),
        ...(stepUp ? { stepUp } : {}),
      };
      // The gateway works only while this call runs, inside its transaction.
      let open = true;
      let depth: SelectionDepth | null = null;
      let denial: AiDenialReason | null = null;

      async function resolveCases(
        wanted: AiNarrowing['cases'],
      ): Promise<Result<CaseSelection, AiComposeFailure>> {
        if (wanted === undefined || wanted === 'connection') return ok(effective.cases);
        if (wanted === 'none') return ok({ kind: 'none' });
        const reference = caseReference(wanted.reference);
        if (!reference || effective.cases.kind === 'none') return err('case_not_shared');
        const listed = await listSelectableCases(proof);
        if (!listed.ok) return err('failed');
        const match = listed.value.find((c) => c.referenceCode === reference);
        if (!match) return err('case_not_shared');
        if (effective.cases.kind === 'one') {
          return match.id === effective.cases.missionId
            ? ok(effective.cases)
            : err('case_not_shared');
        }
        // "All current cases" covers a case only while it is current.
        return match.current ? ok({ kind: 'one', missionId: match.id }) : err('case_not_shared');
      }

      const gateway: AiContextGateway = Object.freeze({
        scope,
        async compose(
          narrowing: AiNarrowing = {},
        ): Promise<Result<SelectedOutput, AiComposeFailure>> {
          if (!open) return err('failed');
          const cases = await resolveCases(narrowing.cases);
          if (!cases.ok) return cases;
          const narrowed: Selection = {
            // The grant itself is never narrowed: it decides what may be shown at all.
            layers: effective.layers,
            cases: cases.value,
            documentList: effective.documentList && narrowing.documentList !== false,
            documentText: narrowing.documentText === false ? [] : effective.documentText,
            revealIdentifiers: effective.revealIdentifiers,
            depth: narrowing.depth ? shallower(narrowing.depth, effective.depth) : effective.depth,
          };
          const built = await buildSelectedOutput(proof, narrowed, {
            ...options,
            ...(narrowing.layers ? { profileLayers: narrowing.layers } : {}),
            ...(narrowing.basics === false ? { basics: false } : {}),
            ...(narrowing.documentScope ? { documentScope: narrowing.documentScope } : {}),
            ...(narrowing.fieldKeys ? { fieldKeys: narrowing.fieldKeys } : {}),
          });
          if (!built.ok) {
            const failure: AiComposeFailure =
              built.error.code === 'not_found' && narrowed.cases.kind === 'one'
                ? 'case_unavailable'
                : 'failed';
            return err(failure);
          }
          depth = narrowed.depth;
          return ok(built.value);
        },
        denied(reason: AiDenialReason) {
          denial = reason;
        },
      });

      let value: T;
      try {
        value = await work(gateway);
      } finally {
        open = false;
      }
      const record: AiCallRecord =
        denial !== null ? { kind: 'denied', reason: denial } : describe(value);
      if (record.kind === 'denied') {
        await auditDenied(tx, connection, request.tool, record.reason);
      } else {
        await appendAuditEvent(tx, {
          ...auditBase(connection),
          eventType: 'AI_CONTEXT_SERVED',
          result: 'ALLOWED',
          metadata: {
            clientHost: connection.clientHost,
            tool: request.tool,
            layers: [...record.layers].sort(),
            caseMode: connection.caseMode,
            cases: record.cases,
            values: record.values,
            documents: record.documents,
            documentTexts: record.documentTexts,
            depth: depth ?? scope.depth,
          },
        });
        const label = toolLabel(request.tool);
        await recordProductEvent(tx, {
          eventType: 'AI_CONTEXT_REQUESTED',
          accountId: connection.accountId,
          ...(label ? { dimension: label } : {}),
          metricValue: new Set(record.layers).size,
        });
      }
      return ok(value);
    });
  } catch (error) {
    if (seen.target) await auditFailedCall(db, seen.target, request.tool);
    throw error;
  }
}
