import { type Result, err, formatReferenceCode, ok, parseReferenceCode } from '@visastack/core';
import type { DocumentGroupKey, LayerKey } from '@visastack/core/catalogue';
import { resolveDocumentType } from '@visastack/core/catalogue/documents';
import { and, eq, isNull } from 'drizzle-orm';
import { touchAccountActivity } from '../accounts';
import { aiFileErasurePending } from '../ai-connection-files';
import {
  AI_CONNECTION_LAYERS,
  type AiCaseMode,
  type AiConnectionLayer,
  type AiDenialReason,
  type AiFileVariant,
  aiAuditToolName,
  allowsSuggestions,
  isAiFileVariant,
  selectionFromStoredChoices,
} from '../ai-connection-scopes';
import {
  type AiFeatureGate,
  chargeAiFeatureUse,
  getAiFeatureState,
  openAiFeatureGate,
  refundAiFeatureUse,
} from '../ai-feature-settings';
import { aiFilesAvailable } from '../ai-files-ready';
import {
  type AiWriteOutcome,
  type AiWriter,
  aiSuggestionsAvailable,
  appSuggestionMayBeWaiting,
  decideSuggestionField,
  recordAiDraft,
  recordAiReminder,
  recordProfileSuggestion,
} from '../ai-suggestions';
import { appendAuditEvent } from '../audit';
import { hasConsent } from '../consent';
import { type Db, first, schema } from '../db';
import { readOriginalDocumentFile, writeDocumentAccessAudit } from '../document-access';
import type { KeyManagementPort } from '../ports';
import {
  aiContextDayKey,
  aiContextDenialLabel,
  aiContextToolLabel,
  recordProductEvent,
} from '../product-events';
import { RATE_LIMITS, checkRateLimit, checkRateLimits, isRateLimitReached } from '../rate-limit';
import { type RedactionDeps, produceSafeCopy } from '../redaction';
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
import {
  type AuthorizedApplicant,
  DEFAULT_DOCUMENT_PROTECTION,
  requireAccess,
} from './require-access';
import { documentTypeRestricted, loadDocumentProtectionSettings } from './restricted-documents';
import { stepUpForAiOriginalFile, stepUpFromAiConnection } from './step-up-proof';

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
 * Telemetry (S16): beside the audit records, `AI_CONTEXT_REQUESTED` (label: the tool) and
 * `AI_CONTEXT_DENIED` (label: the denial reason), each once per connection, per UTC day and per
 * label, so analytics grow with connections, not with calls (call counts come from the audit). It
 * is best effort: `recordProductEvent` writes in a savepoint and never throws, so a failed event
 * never changes the answer or the audit record. A tool is named only from the five known names.
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
  /** "Suggest Changes" (S21): the app may leave suggestions, drafts and reminders. */
  readonly suggestChanges: boolean;
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
export type { AiDenialReason } from '../ai-connection-scopes';

export interface AiContextGateway {
  readonly scope: AiGrantedScope;
  /** The composer, with the connection's Selection, narrowed by `narrowing`. */
  compose(narrowing?: AiNarrowing): Promise<Result<SelectedOutput, AiComposeFailure>>;
  /** Records the refusal for the audit; the tool still answers in plain words. */
  denied(reason: AiDenialReason): void;
}

/** Why a suggestion, draft or reminder was not saved. Each is also an audit denial reason. */
export type AiWriteFailure = Extract<
  AiDenialReason,
  | 'suggestions_not_granted'
  | 'not_available'
  | 'consent_required'
  | 'layer_not_granted'
  | 'field_not_shared'
  | 'document_list_not_granted'
  | 'document_not_shared'
  | 'cases_not_granted'
  | 'case_not_shared'
  | 'case_unavailable'
  | 'case_finished'
  | 'write_limit'
  | 'invalid_input'
  | 'feature_off'
  | 'failed'
>;

export interface AiSuggestProfileInput {
  readonly section: AiConnectionLayer;
  readonly field: string;
  readonly value: string;
  readonly reason: string;
  /** `D-XXXXXX`: the suggestion is about this document. */
  readonly documentReference?: string;
}

export interface AiSaveDraftInput {
  readonly title: string;
  readonly body: string;
  /** `C-XXXXXX`: the draft is for this case. */
  readonly caseReference?: string;
}

export interface AiAddReminderInput {
  readonly caseReference: string;
  readonly title: string;
  /** `YYYY-MM-DD`. */
  readonly dueDate: string;
}

/**
 * The only writes an AI app can make (S21, ADR 0021 extension), each one something left for the
 * person: a suggestion waiting for approval, a draft, or a reminder on their own case. None changes
 * a fact, a document, a case's state, a share, a permission or a payment, and none sends anything.
 * Each refusal is recorded for the audit by the gate itself; the tool answers in plain words.
 */
export interface AiSuggestionWrites {
  suggestProfileUpdate(input: AiSuggestProfileInput): Promise<
    Result<
      {
        readonly fieldLabel: string;
        readonly documentReference: string | null;
      },
      AiWriteFailure
    >
  >;
  saveDraft(
    input: AiSaveDraftInput,
  ): Promise<Result<{ readonly caseReference: string | null }, AiWriteFailure>>;
  addReminder(
    input: AiAddReminderInput,
  ): Promise<Result<{ readonly caseReference: string; readonly dueDate: string }, AiWriteFailure>>;
}

/** The gateway a suggestion tool gets: the read gateway, plus the three writes. */
export interface AiWriteGateway extends AiContextGateway {
  readonly writes: AiSuggestionWrites;
}

/**
 * The largest file an AI app is given, before it is encoded for the answer (S20, decision O1). The
 * answer carries the file as base64 (a third larger) inside one response, and a hosted function's
 * response is limited to about 4.5 MB, so 3 MB is what fits with room for the rest of the answer.
 * ADR 0021's 10 MB needs a streamed answer verified on the host, and is deferred.
 */
export const AI_FILE_RESPONSE_LIMIT_BYTES = 3_000_000;

/** The file types an AI app is given (decision O4). */
export type AiFileMimeType = 'application/pdf' | 'image/png' | 'image/jpeg';

/** A file the gate gave back for one ticked document: the bytes and plain facts, never an id or key. */
export interface AiServedFile {
  /** `D-XXXXXX`. */
  readonly referenceCode: string;
  /** The document's kind in plain words ("Visa"). */
  readonly kind: string;
  readonly variant: AiFileVariant;
  readonly mimeType: AiFileMimeType;
  readonly sizeBytes: number;
  readonly bytes: Uint8Array;
}

/** Why a file was not given. Each is also an audit denial reason. */
export type AiFileFailure = Extract<
  AiDenialReason,
  | 'not_available'
  | 'feature_off'
  | 'files_not_granted'
  | 'file_not_chosen'
  | 'document_protected'
  | 'file_limit'
  | 'safe_copy_limit'
  | 'file_not_ready'
  | 'safe_copy_not_ready'
  | 'file_too_large'
  | 'file_type_unsupported'
  | 'failed'
>;

/** The gateway the file tool gets (S20): the read gateway, plus one ticked document's file. */
export interface AiFileGateway extends AiContextGateway {
  file(documentReference: string): Promise<Result<AiServedFile, AiFileFailure>>;
}

/** What the gate needs to give files: the private storage and the Safe Copy renderer. */
export type AiFileDeps = Pick<RedactionDeps, 'storage' | 'renderer'>;

/** What a served file adds to the audit record: never contents, file name, hash or key. */
export interface AiServedFileRecord {
  readonly documentId: string;
  readonly variant: AiFileVariant;
  readonly sizeBytes: number;
  readonly mimeType: AiFileMimeType;
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
      /** The file tool (S20): set by the gate itself, from the file it actually gave. */
      readonly file?: AiServedFileRecord;
    }
  | { readonly kind: 'denied'; readonly reason: AiDenialReason };

export type AiGateRefusal =
  | { readonly kind: 'unauthorized' }
  /**
   * AI App Access is off for this person (the platform owner's switch or the plan), or today's
   * limit of requests is used up (S28). The connection is still good: the app is told plainly and
   * is not asked to sign in again.
   */
  | { readonly kind: 'feature_off'; readonly reason: 'feature_off' | 'access_limit' };

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
  /** Needed to give files (S20); without it the file tool answers "not available yet". */
  readonly files?: AiFileDeps;
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
    suggestChanges: allowsSuggestions(connection.scopes),
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

interface DeniedOptions {
  /** The route withheld an answer the gate had already recorded as served. */
  readonly withheld?: boolean;
  readonly now?: Date;
}

/**
 * One refusal: the product event first (a savepoint that never throws), then the audit record,
 * so the audit chain's lock is held only for the audit insert. The tool is named only from the
 * five known names (`unknown` otherwise): an app's own text never reaches either record.
 */
async function auditDenied(
  tx: Db,
  target: AuditTarget,
  tool: string,
  reason: AiDenialReason,
  options: DeniedOptions = {},
): Promise<void> {
  const label = aiContextDenialLabel(reason);
  await recordProductEvent(tx, {
    eventType: 'AI_CONTEXT_DENIED',
    accountId: target.accountId,
    dimension: label,
    onceFor: aiContextDayKey(target.connectionId, label, options.now ?? new Date()),
  });
  await appendAuditEvent(tx, {
    ...auditBase(target),
    eventType: 'AI_CONTEXT_DENIED',
    result: 'DENIED',
    reason,
    metadata: {
      clientHost: target.clientHost,
      tool: aiAuditToolName(tool),
      caseMode: target.caseMode,
      reason,
      ...(options.withheld ? { withheld: true } : {}),
    },
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
 * Records that the route withheld a tool's answer because it was too large to send. The gate has
 * already recorded that call as served (it did compose and release that answer), so this denial
 * is marked `withheld`: counts of answered calls subtract these, and the trail still says both
 * what the gate released and that the app never received it. `tool` comes from the app's request:
 * it is recorded only if it is one of the five known names. Best effort, never throws.
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
      await auditDenied(tx, { ...row, connectionId: row.id }, input.tool, 'too_large', {
        withheld: true,
      });
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
  return runGate(db, request, { mode: 'read', work }, describe);
}

/**
 * The same gate for the three suggestion tools (S21): the gateway also carries the writes. Every
 * write still needs "Suggest Changes" on the stored connection, read again on this very call.
 */
export async function withAiSuggestionConnection<T>(
  db: Db,
  request: AiGateRequest,
  work: (gateway: AiWriteGateway) => Promise<T>,
  describe: (value: T) => AiCallRecord,
): Promise<Result<T, AiGateRefusal>> {
  return runGate(db, request, { mode: 'suggest', work }, describe);
}

/**
 * The same gate for the file tool (S20): the gateway also gives the file of one document the
 * person ticked under "Original Files", read again on this very call.
 */
export async function withAiFileConnection<T>(
  db: Db,
  request: AiGateRequest,
  work: (gateway: AiFileGateway) => Promise<T>,
  describe: (value: T) => AiCallRecord,
): Promise<Result<T, AiGateRefusal>> {
  return runGate(db, request, { mode: 'file', work }, describe);
}

type GateWork<T> =
  | { readonly mode: 'read'; readonly work: (gateway: AiContextGateway) => Promise<T> }
  | { readonly mode: 'suggest'; readonly work: (gateway: AiWriteGateway) => Promise<T> }
  | { readonly mode: 'file'; readonly work: (gateway: AiFileGateway) => Promise<T> };

/** Carries a refused write out of its savepoint, so everything it wrote is rolled back. */
class WriteAborted extends Error {
  constructor(readonly reason: AiWriteFailure) {
    super('ai write refused');
  }
}

async function runGate<T>(
  db: Db,
  request: AiGateRequest,
  job: GateWork<T>,
  describe: (value: T) => AiCallRecord,
): Promise<Result<T, AiGateRefusal>> {
  // Set once the connection is known, so a failure part-way can still be recorded.
  const seen: { target: AuditTarget | null } = { target: null };
  // AI App Access with no daily limit: the answer given is counted after the call, see below.
  const after: { count: AiFeatureGate | null } = { count: null };
  let result: Result<T, AiGateRefusal>;
  try {
    result = await db.transaction(async (tx) => {
      const opened = await openConnection(tx, request);
      if (!opened) return err({ kind: 'unauthorized' } as const);
      const { connection, proof } = opened;
      seen.target = connection;
      const now = request.now ?? new Date();
      // AI App Access (S28), on every call: the platform owner's switch, the person's plan and
      // today's limit. Off, the app is told plainly; the connection stays listed and revocable.
      const access = await openAiFeatureGate(tx, 'ai_app_access', { proof }, { now });
      const accessRefusal = (reason: 'feature_off' | 'access_limit') =>
        err({ kind: 'feature_off', reason } as const);
      if (!access.ok) {
        const reason = access.error.reason === 'daily_limit' ? 'access_limit' : 'feature_off';
        await auditDenied(tx, connection, request.tool, reason, { now });
        return accessRefusal(reason);
      }
      // With a daily limit, counted as the call starts, so this count row is always locked before
      // the limit rows and the audit chain (one lock order for every tool), and given back below
      // if the call ends refused: only answers actually given count. With no limit (the default)
      // nothing is locked here: the answer is counted after the call, in a statement of its own,
      // so one person's calls never wait on each other.
      const limited = access.value.dailyLimit !== null;
      const charge = limited ? await chargeAiFeatureUse(tx, access.value, { now }) : null;
      if (limited && !charge) {
        await auditDenied(tx, connection, request.tool, 'access_limit', { now });
        return accessRefusal('access_limit');
      }
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

      // The file the file tool was given on this call, for the audit record (S20).
      let served: AiServedFileRecord | null = null;
      let value: T;
      try {
        if (job.mode === 'read') {
          value = await job.work(gateway);
        } else if (job.mode === 'suggest') {
          value = await job.work(
            Object.freeze({
              ...gateway,
              writes: suggestionWrites({
                tx,
                request,
                connection,
                proof,
                scope,
                compose: gateway.compose,
                resolveCases,
                isOpen: () => open,
                deny: (reason) => {
                  denial = reason;
                },
              }),
            }),
          );
        } else {
          const file = fileReader({
            tx,
            request,
            connection,
            proof,
            scope,
            isOpen: () => open,
            deny: (reason) => {
              denial = reason;
            },
            served: (record) => {
              served = record;
            },
          });
          value = await job.work(Object.freeze({ ...gateway, file }));
        }
      } finally {
        open = false;
      }
      const described: AiCallRecord =
        denial !== null ? { kind: 'denied', reason: denial } : describe(value);
      const record: AiCallRecord =
        described.kind === 'served' && served !== null ? { ...described, file: served } : described;
      if (record.kind === 'denied') {
        await refundAiFeatureUse(tx, charge);
        await auditDenied(tx, connection, request.tool, record.reason, { now });
      } else {
        if (!limited) after.count = access.value;
        // Product events first (savepoints that never throw), then the audit record.
        if (record.file) {
          await recordProductEvent(tx, {
            eventType: 'AI_FILE_SERVED',
            accountId: connection.accountId,
            dimension: record.file.variant,
            onceFor: aiContextDayKey(
              connection.connectionId,
              `FILE_${record.file.variant}`,
              request.now ?? new Date(),
            ),
          });
        }
        const label = aiContextToolLabel(request.tool);
        await recordProductEvent(tx, {
          eventType: 'AI_CONTEXT_REQUESTED',
          accountId: connection.accountId,
          ...(label ? { dimension: label } : {}),
          onceFor: aiContextDayKey(
            connection.connectionId,
            label ?? 'UNKNOWN',
            request.now ?? new Date(),
          ),
        });
        await appendAuditEvent(tx, {
          ...auditBase(connection),
          eventType: 'AI_CONTEXT_SERVED',
          result: 'ALLOWED',
          metadata: {
            clientHost: connection.clientHost,
            tool: aiAuditToolName(request.tool),
            layers: [...record.layers].sort(),
            caseMode: connection.caseMode,
            cases: record.cases,
            values: record.values,
            documents: record.documents,
            documentTexts: record.documentTexts,
            depth: depth ?? scope.depth,
            // The file tool (S20): which document, how it was given, its type and size. Never its
            // contents, file name, hash or storage key.
            ...(record.file
              ? {
                  fileServed: true,
                  variant: record.file.variant,
                  documentId: record.file.documentId,
                  sizeBytes: record.file.sizeBytes,
                  mimeType: record.file.mimeType,
                }
              : {}),
          },
        });
      }
      return ok(value);
    });
  } catch (error) {
    if (seen.target) await auditFailedCall(db, seen.target, request.tool);
    throw error;
  }
  // Outside the call's transaction: one short statement, holding no lock while the call runs.
  if (after.count) await chargeAiFeatureUse(db, after.count, { now: request.now ?? new Date() });
  return result;
}

interface WriteContext {
  readonly tx: Db;
  readonly request: AiGateRequest;
  readonly connection: ResolvedAiConnection;
  /** The owner's read proof for this call: the AI feature's state is read through it. */
  readonly proof: AuthorizedApplicant<'VIEW_METADATA'>;
  readonly scope: AiGrantedScope;
  readonly compose: AiContextGateway['compose'];
  readonly resolveCases: (
    wanted: AiNarrowing['cases'],
  ) => Promise<Result<CaseSelection, AiComposeFailure>>;
  readonly isOpen: () => boolean;
  readonly deny: (reason: AiWriteFailure) => void;
}

type WriteKind = 'profile_suggestion' | 'draft' | 'reminder';

/**
 * The three writes (S21), built for one call. Before anything is written, on this very call:
 * "Suggest Changes" is on for the stored connection, the migration has run, the person has
 * processing turned on, and neither daily limit is reached. Then, in a savepoint of the call's own
 * transaction: a second proof from the access gate (`PROPOSE_EDIT`, owner only, `ai_connection`
 * purpose), the write, the charge against both limits and the `AI_CHANGE_SUGGESTED` audit record.
 * A refusal at any step rolls the savepoint back, so a refused write leaves nothing behind and is
 * never counted; a suggestion already waiting from the same app is answered again, uncounted.
 */
function suggestionWrites(context: WriteContext): AiSuggestionWrites {
  const { tx, request, connection, scope } = context;
  const now = request.now ?? new Date();
  const writer: AiWriter = {
    connectionId: connection.connectionId,
    clientName: connection.clientName,
    clientHost: connection.clientHost,
  };
  /** The two daily limits, at the AI feature's limit for this person (set once the state is read). */
  let caps: readonly {
    readonly input: { readonly subjectId: string; readonly action: string };
    readonly config: { readonly limit: number; readonly windowMs: number };
  }[] = [];
  function capsAt(dailyLimit: number | null) {
    const perPerson = dailyLimit ?? RATE_LIMITS.AI_WRITE_ACCOUNT_DAY.limit;
    return [
      {
        input: { subjectId: connection.connectionId, action: 'ai_write.connection' },
        config: {
          ...RATE_LIMITS.AI_WRITE_CONNECTION_DAY,
          limit: Math.min(RATE_LIMITS.AI_WRITE_CONNECTION_DAY.limit, perPerson),
        },
      },
      {
        input: { subjectId: connection.accountId, action: 'ai_write.account' },
        config: { ...RATE_LIMITS.AI_WRITE_ACCOUNT_DAY, limit: perPerson },
      },
    ] as const;
  }

  function fail<V>(reason: AiWriteFailure): Result<V, AiWriteFailure> {
    context.deny(reason);
    return err(reason);
  }

  async function blocked(): Promise<AiWriteFailure | null> {
    if (!context.isOpen()) return 'failed';
    if (!scope.suggestChanges) return 'suggestions_not_granted';
    // The storage check caches a "yes" per handle, so the feature state below does not probe again.
    if (!(await aiSuggestionsAvailable(tx))) return 'not_available';
    // The platform owner's switch for AI App Suggestions and the person's plan, on every call.
    const feature = await getAiFeatureState(tx, 'ai_app_suggestions', { proof: context.proof });
    if (!feature.available) {
      return feature.reason === 'not_available_yet' ? 'not_available' : 'feature_off';
    }
    caps = capsAt(feature.dailyLimit);
    if (!(await hasConsent(tx, connection.accountId, 'CORE_PROCESSING'))) {
      return 'consent_required';
    }
    return null;
  }

  /**
   * Read only and cheap: whether either daily limit is already reached. Each write asks it after
   * looking for the same suggestion already waiting (a resend after a timeout is answered again,
   * never refused here) and before any expensive work, such as listing documents or resolving a
   * case. Nothing is counted here; the atomic charge is in `save`, just before the audit records.
   */
  async function atLimit(): Promise<boolean> {
    for (const cap of caps) {
      if (await isRateLimitReached(tx, cap.input, cap.config, now)) return true;
    }
    return false;
  }

  async function chosenCase(
    reference: string,
  ): Promise<Result<{ readonly missionId: string; readonly reference: string }, AiWriteFailure>> {
    if (scope.caseMode === 'NONE') return err('cases_not_granted');
    const visible = caseReference(reference);
    if (!visible) return err('case_not_shared');
    const cases = await context.resolveCases({ reference: visible });
    if (!cases.ok) return err(cases.error);
    if (cases.value.kind !== 'one') return err('case_not_shared');
    return ok({ missionId: cases.value.missionId, reference: visible });
  }

  async function save<V>(
    kind: WriteKind,
    target: { readonly applicantId: string } | { readonly missionId: string },
    write: (proof: AuthorizedApplicant<'PROPOSE_EDIT'>) => Promise<AiWriteOutcome<V>>,
    audit: { readonly layer?: string; readonly missionId?: string; readonly document?: boolean },
  ): Promise<Result<V, AiWriteFailure>> {
    try {
      const value = await tx.transaction(async (savepoint) => {
        const access = await requireAccess(
          savepoint,
          accountPrincipal(connection.accountId),
          'PROPOSE_EDIT',
          target,
          { purpose: AI_CONNECTION_PURPOSE },
        );
        if (
          !access.ok ||
          access.value.actor.kind !== 'applicant_owner' ||
          access.value.applicant.id !== connection.applicantId
        ) {
          throw new WriteAborted('failed');
        }
        const outcome = await write(access.value);
        if (outcome.kind === 'refused') throw new WriteAborted(outcome.reason);
        if (outcome.kind === 'existing') return outcome.value;
        // Charged last, only for something actually saved; over the limit undoes the write.
        // Lock order, the same for every write: the connection's limit row, the account's limit
        // row (in `caps` order), then the audit chain (guarded in tool-guard.test.ts).
        const charged = await checkRateLimits(savepoint, caps, now);
        if (!charged.allowed) throw new WriteAborted('write_limit');
        for (const record of outcome.audit ?? []) await appendAuditEvent(savepoint, record);
        await appendAuditEvent(savepoint, {
          ...auditBase(connection),
          ...(audit.missionId ? { missionId: audit.missionId } : {}),
          eventType: 'AI_CHANGE_SUGGESTED',
          result: 'ALLOWED',
          metadata: {
            clientHost: connection.clientHost,
            tool: aiAuditToolName(request.tool),
            kind,
            ...(audit.layer ? { layer: audit.layer } : {}),
            ...(audit.document !== undefined ? { document: audit.document } : {}),
            caseMode: connection.caseMode,
            count: 1,
            // The tools are for changes the person asked their app for (owner decision 30 Oct).
            requestedBy: 'person_via_app',
          },
        });
        return outcome.value;
      });
      return ok(value);
    } catch (error) {
      if (error instanceof WriteAborted) return fail(error.reason);
      throw error;
    }
  }

  const writes: AiSuggestionWrites = {
    async suggestProfileUpdate(input: AiSuggestProfileInput) {
      const stop = await blocked();
      if (stop) return fail(stop);
      if (!scope.layers.includes(input.section)) return fail('layer_not_granted');
      const policy = decideSuggestionField({
        field: input.field,
        section: input.section,
        layers: scope.layers,
        revealIdentifiers: scope.revealIdentifiers,
      });
      if (!policy) return fail('field_not_shared');
      const mayBeWaiting = await appSuggestionMayBeWaiting(context.proof, {
        writer,
        fieldKey: policy.key,
        value: input.value,
      });
      if (!mayBeWaiting && (await atLimit())) return fail('write_limit');
      let documentReference: string | null = null;
      if (input.documentReference !== undefined) {
        if (!scope.documentList) return fail('document_list_not_granted');
        const parsed = parseReferenceCode(input.documentReference, 'D');
        if (!parsed.ok) return fail('document_not_shared');
        const reference = formatReferenceCode('D', parsed.code);
        // Only a document this connection can see in its own list of documents.
        const listed = await context.compose({
          cases: 'none',
          basics: false,
          documentText: false,
          fieldKeys: [],
          documentScope: { referenceCodes: [reference] },
        });
        if (!listed.ok) return fail('failed');
        if (!listed.value.documents.some((d) => d.referenceCode === reference)) {
          return fail('document_not_shared');
        }
        documentReference = reference;
      }
      const saved = await save(
        'profile_suggestion',
        { applicantId: connection.applicantId },
        (proof) =>
          recordProfileSuggestion(proof, {
            writer,
            fieldKey: policy.key,
            value: input.value,
            reason: input.reason,
            documentReference,
          }),
        { layer: input.section, document: documentReference !== null },
      );
      if (!saved.ok) return err(saved.error);
      return ok({ fieldLabel: policy.label, documentReference });
    },

    async saveDraft(input: AiSaveDraftInput) {
      const stop = await blocked();
      if (stop) return fail(stop);
      // Drafts are never deduplicated, so the limit is checked straight away.
      if (await atLimit()) return fail('write_limit');
      let chosen: { readonly missionId: string; readonly reference: string } | null = null;
      if (input.caseReference !== undefined) {
        const found = await chosenCase(input.caseReference);
        if (!found.ok) return fail(found.error);
        chosen = found.value;
      }
      const saved = await save(
        'draft',
        { applicantId: connection.applicantId },
        (proof) =>
          recordAiDraft(proof, {
            writer,
            missionId: chosen?.missionId ?? null,
            title: input.title,
            body: input.body,
          }),
        chosen ? { missionId: chosen.missionId } : {},
      );
      if (!saved.ok) return err(saved.error);
      return ok({ caseReference: chosen?.reference ?? null });
    },

    async addReminder(input: AiAddReminderInput) {
      const stop = await blocked();
      if (stop) return fail(stop);
      // Reminders are never deduplicated, so the limit is checked before the case is resolved.
      if (await atLimit()) return fail('write_limit');
      const found = await chosenCase(input.caseReference);
      if (!found.ok) return fail(found.error);
      const chosen = found.value;
      const saved = await save(
        'reminder',
        { missionId: chosen.missionId },
        (proof) =>
          recordAiReminder(proof, {
            writer,
            title: input.title,
            dueDate: input.dueDate,
            now,
          }),
        { missionId: chosen.missionId },
      );
      if (!saved.ok) return err(saved.error);
      return ok({ caseReference: chosen.reference, dueDate: saved.value.dueDate });
    },
  };
  return Object.freeze(writes);
}

interface FileContext {
  readonly tx: Db;
  readonly request: AiGateRequest;
  readonly connection: ResolvedAiConnection;
  /** The owner's read proof for this call: the AI feature's state is read through it. */
  readonly proof: AuthorizedApplicant<'VIEW_METADATA'>;
  readonly scope: AiGrantedScope;
  readonly isOpen: () => boolean;
  readonly deny: (reason: AiFileFailure) => void;
  readonly served: (record: AiServedFileRecord) => void;
}

/** Carries a refused file out of its savepoint, so the access and the count are rolled back. */
class FileAborted extends Error {
  constructor(
    readonly reason: AiFileFailure,
    /** A refused Safe Copy's DENIED access record, written again outside the savepoint. */
    readonly denied?: {
      readonly proof: AuthorizedApplicant<'DOWNLOAD_REDACTED'>;
      readonly reason: string;
    },
  ) {
    super('ai file refused');
  }
}

/** What a DOCUMENT_ACCESS event records as the purpose of a Safe Copy given to an AI app. */
const AI_SAFE_COPY_PURPOSES = Object.freeze({
  owner: 'ai_connection_safe_copy',
  shared: 'ai_connection_safe_copy',
});

/**
 * The file of one ticked document (S20, ADR 0021 amendment), built for one call. Every step reads
 * the stored state again, in the call's own transaction, in this order:
 *
 * 1. the feature: the migration has run, the file deps are wired, and AI App Original Files works
 *    for this person (the platform owner's switch and the plan); List of My Documents is on;
 * 2. the reference names a document this connection has ticked, on this connection's own record,
 *    current and kept in the person's own documents (anything else: `file_not_chosen`, the same
 *    answer whether it exists, is someone else's, or was unticked);
 * 3. its type is not restricted by the document protection switches as they are now;
 * 4. a cheap, read-only check that the person's daily file limit is not already reached;
 * 5. a second proof from the access gate, owner only, for this one document: `DOWNLOAD_REDACTED`
 *    for a Safe Copy, `DOWNLOAD_ORIGINAL` (with the standing identity check of a stored Original)
 *    for the Original;
 * 6. a Safe Copy only from `produceSafeCopy`: when it is not ready, or out of date after a new
 *    version, the answer is `safe_copy_not_ready`, and the original is never given instead;
 * 7. an Original only from `readOriginalDocumentFile`: the latest clean version, within the size
 *    limit before a byte is read, a PDF, PNG or JPEG matching its stored hash;
 * 8. the daily limit is charged last, only for a file actually given; over the limit undoes it.
 *
 * Steps 5 to 8 run in a savepoint: a file that is made but then refused (too large, over the
 * limit) leaves no allowed access record and no count behind.
 */
function fileReader(context: FileContext): AiFileGateway['file'] {
  const { tx, request, connection, scope } = context;
  const now = request.now ?? new Date();

  function fail(reason: AiFileFailure): Result<AiServedFile, AiFileFailure> {
    context.deny(reason);
    return err(reason);
  }

  return async (documentReference: string) => {
    if (!context.isOpen()) return fail('failed');
    // 1. The feature, on every call.
    const deps = request.files;
    if (!deps || !(await aiFilesAvailable(tx))) return fail('not_available');
    const feature = await getAiFeatureState(tx, 'ai_app_original_files', { proof: context.proof });
    if (!feature.available) {
      return fail(feature.reason === 'not_available_yet' ? 'not_available' : 'feature_off');
    }
    if (!scope.documentList) return fail('files_not_granted');

    // 2. A document this connection ticked, on its own record.
    const parsed = parseReferenceCode(documentReference, 'D');
    if (!parsed.ok) return fail('file_not_chosen');
    const reference = formatReferenceCode('D', parsed.code);
    const chosen = first(
      await tx
        .select({
          documentId: schema.documents.id,
          docType: schema.documents.docType,
          variant: schema.aiConnectionDocuments.variant,
        })
        .from(schema.referenceCodes)
        .innerJoin(
          schema.aiConnectionDocuments,
          and(
            eq(schema.aiConnectionDocuments.documentId, schema.referenceCodes.entityId),
            eq(schema.aiConnectionDocuments.connectionId, connection.connectionId),
          ),
        )
        .innerJoin(
          schema.documents,
          and(
            eq(schema.documents.id, schema.aiConnectionDocuments.documentId),
            eq(schema.documents.applicantId, connection.applicantId),
            isNull(schema.documents.supersededByDocumentId),
            eq(schema.documents.walletVisible, true),
          ),
        )
        .where(
          and(eq(schema.referenceCodes.kind, 'D'), eq(schema.referenceCodes.code, parsed.code)),
        )
        .limit(1),
    );
    if (!chosen || !isAiFileVariant(chosen.variant)) return fail('file_not_chosen');
    const variant: AiFileVariant = chosen.variant;
    // A document queued for erasure is gone: the same answer as one never ticked.
    if (await aiFileErasurePending(context.proof, chosen.documentId)) {
      return fail('file_not_chosen');
    }

    // 3. Never a type the document protection switches restrict, as they are now (decision O2).
    const protection = await loadDocumentProtectionSettings(tx, DEFAULT_DOCUMENT_PROTECTION);
    if (documentTypeRestricted(chosen.docType, protection)) return fail('document_protected');

    // 4. Read only: whether the person's daily file limit is already reached.
    const cap = {
      input: { subjectId: connection.accountId, action: 'ai_file.account' },
      config: {
        ...RATE_LIMITS.AI_FILE_ACCOUNT_DAY,
        limit: feature.dailyLimit ?? RATE_LIMITS.AI_FILE_ACCOUNT_DAY.limit,
      },
    } as const;
    if (await isRateLimitReached(tx, cap.input, cap.config, now)) return fail('file_limit');

    // 5 to 8, in a savepoint.
    let given: Omit<AiServedFile, 'referenceCode' | 'kind' | 'variant'>;
    try {
      given = await tx
        .transaction(async (savepoint) => {
          const principal = accountPrincipal(connection.accountId);
          const target = { documentId: chosen.documentId };
          let file: { bytes: Uint8Array; mimeType: AiFileMimeType };
          if (variant === 'SAFE_COPY') {
            const access = await requireAccess(savepoint, principal, 'DOWNLOAD_REDACTED', target, {
              purpose: AI_CONNECTION_PURPOSE,
            });
            if (!ownerAccess(access, connection.applicantId)) throw new FileAborted('failed');
            // A copy that is not ready is refused before the owner's hourly limit is counted.
            const copy = await produceSafeCopy(access.value, deps, {
              purposes: AI_SAFE_COPY_PURPOSES,
              disposition: 'ai_file',
            });
            // Any refusal rolls the savepoint back, a count with it; its DENIED access record is
            // written again below, outside the savepoint, as for an Original.
            if (!copy.ok) {
              throw new FileAborted(
                safeCopyFailure(copy.error),
                copy.error.auditReason !== undefined
                  ? { proof: access.value, reason: copy.error.auditReason }
                  : undefined,
              );
            }
            file = { bytes: copy.value.bytes, mimeType: copy.value.contentType };
          } else {
            const stepUp = await stepUpForAiOriginalFile(
              savepoint,
              connection.connectionId,
              chosen.documentId,
            );
            if (!stepUp) throw new FileAborted('file_not_chosen');
            const access = await requireAccess(savepoint, principal, 'DOWNLOAD_ORIGINAL', target, {
              purpose: AI_CONNECTION_PURPOSE,
              stepUp,
            });
            if (!ownerAccess(access, connection.applicantId)) throw new FileAborted('failed');
            const original = await readOriginalDocumentFile(
              access.value,
              deps,
              AI_FILE_RESPONSE_LIMIT_BYTES,
            );
            if (!original.ok) return { refused: originalFailure(original.error) } as const;
            file = { bytes: original.value.bytes, mimeType: original.value.contentType };
          }
          // A Safe Copy can be up to 4 MB; an answer holds at most the file limit.
          if (file.bytes.byteLength > AI_FILE_RESPONSE_LIMIT_BYTES) {
            throw new FileAborted('file_too_large');
          }
          // Charged last, only for a file actually given; over the limit undoes it.
          const charged = await checkRateLimit(savepoint, cap.input, cap.config, now);
          if (!charged.allowed) throw new FileAborted('file_limit');
          return { ...file, sizeBytes: file.bytes.byteLength } as const;
        })
        .then((outcome) => {
          if ('refused' in outcome) throw new FileAborted(outcome.refused);
          return outcome;
        });
    } catch (error) {
      if (!(error instanceof FileAborted)) throw error;
      if (error.denied) {
        // The refused Safe Copy's own record, with the fields `produceSafeCopy` writes.
        await writeDocumentAccessAudit(
          error.denied.proof,
          {
            documentId: chosen.documentId,
            applicantId: connection.applicantId,
            allowed: false,
            reason: error.denied.reason,
            metadata: { variant: 'redacted', disposition: 'ai_file' },
            purposes: AI_SAFE_COPY_PURPOSES,
          },
          tx,
        );
      }
      return fail(error.reason);
    }

    context.served({
      documentId: chosen.documentId,
      variant,
      sizeBytes: given.sizeBytes,
      mimeType: given.mimeType,
    });
    return ok({
      referenceCode: reference,
      kind:
        (chosen.docType ? resolveDocumentType(chosen.docType)?.label : undefined) ??
        'Other Document',
      variant,
      mimeType: given.mimeType,
      sizeBytes: given.sizeBytes,
      bytes: given.bytes,
    });
  };
}

/** The connection speaks for its owner only, on its own record; a share recipient never counts. */
function ownerAccess<A extends 'DOWNLOAD_REDACTED' | 'DOWNLOAD_ORIGINAL'>(
  access: Result<AuthorizedApplicant<A>, unknown>,
  applicantId: string,
): access is { readonly ok: true; readonly value: AuthorizedApplicant<A> } {
  return (
    access.ok &&
    access.value.actor.kind === 'applicant_owner' &&
    access.value.applicant.id === applicantId
  );
}

/** A Safe Copy that was not made, as the app is told. Never a fallback to the original. */
function safeCopyFailure(error: {
  readonly code: string;
  readonly refusal?: string;
}): AiFileFailure {
  // The owner's own hourly Safe Copy limit, never the daily AI file limit.
  if (error.code === 'rate_limited') return 'safe_copy_limit';
  switch (error.refusal) {
    case 'not_prepared':
    case 'not_ready_yet':
    case 'out_of_date':
      return 'safe_copy_not_ready';
    case 'not_available':
      return 'file_not_ready';
    case 'too_large':
      return 'file_too_large';
    case 'unsupported':
      return 'file_type_unsupported';
    default:
      return 'failed';
  }
}

/** An Original that was not read, as the app is told. */
function originalFailure(
  refusal: 'not_ready' | 'too_large' | 'unsupported' | 'unreadable',
): AiFileFailure {
  switch (refusal) {
    case 'not_ready':
      return 'file_not_ready';
    case 'too_large':
      return 'file_too_large';
    case 'unsupported':
      return 'file_type_unsupported';
    case 'unreadable':
      return 'failed';
  }
}
