import { type Result, err, formatReferenceCode, ok, parseReferenceCode } from '@visastack/core';
import type { DocumentGroupKey, LayerKey } from '@visastack/core/catalogue';
import {
  AI_CONNECTION_LAYERS,
  type AiCaseMode,
  type AiConnectionLayer,
  selectionFromStoredChoices,
} from '../ai-connection-scopes';
import { appendAuditEvent } from '../audit';
import type { Db } from '../db';
import type { KeyManagementPort } from '../ports';
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
 * 2. the central access gate is asked again whether the connection's account still owns the
 *    record (`requireAccess` with the `ai_connection` purpose). Anything but the owner is refused;
 * 3. the tool is handed a gateway that can do one thing: ask the context composer for the
 *    connection's own Selection, narrowed further if the tool wants less. It cannot widen the
 *    Selection, name another record, reach the database or see the proof.
 *
 * Tools live in `../ai-tools/` and may import nothing that reads data except this module; a guard
 * test (`ai-tools/boundary.test.ts`) fails otherwise.
 *
 * Audit (the part S14 needs; S16 adds the rest): one `AI_CONTEXT_SERVED` or `AI_CONTEXT_DENIED`
 * event per tool call, with the connection, client host, tool, layers returned, case, counts,
 * depth and denial reason. Never a value, document text or token.
 */

export const AI_CONNECTION_PURPOSE = 'ai_connection';

/** Pure helpers the tools may use: they render what the gateway composed and read nothing. */
export { AI_CONNECTION_LAYERS, type AiConnectionLayer } from '../ai-connection-scopes';
export { layerLabel, renderAiContext } from '../selected-output';

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
 * Asking for less than the connection allows. Every field can only take away: layers are
 * intersected, booleans are AND-ed, the depth is the shallower of the two, and a case must be one
 * the connection already covers.
 */
export interface AiNarrowing {
  readonly layers?: readonly LayerKey[];
  /** `connection`: the cases the connection covers (the default); `none`: no case. */
  readonly cases?: 'connection' | 'none' | { readonly reference: string };
  readonly documentList?: boolean;
  readonly documentText?: boolean;
  readonly depth?: SelectionDepth;
  /** Only these profile fields; an empty list leaves every value out (for document-only answers). */
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

/** Why a tool refused, as recorded in the audit (never shown as an id or value). */
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
  | 'failed';

export interface AiContextGateway {
  readonly scope: AiGrantedScope;
  /** The composer, with the connection's Selection, narrowed by `narrowing`. */
  compose(narrowing?: AiNarrowing): Promise<Result<SelectedOutput, AiComposeFailure>>;
  /** Records the refusal for the audit; the tool still answers in plain words. */
  denied(reason: AiDenialReason): void;
}

export type AiGateRefusal = { readonly kind: 'unauthorized' };

export interface AiGateRequest {
  readonly token: string;
  readonly resource: string;
  readonly tool: string;
  readonly now?: Date;
  /** Needed to read protected values; without it they are left out and counted. */
  readonly encryption?: KeyManagementPort;
}

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

/** Looks the connection up and asks the access gate again. `null` means "answer 401". */
async function openConnection(
  tx: Db,
  request: Pick<AiGateRequest, 'token' | 'resource' | 'now'>,
): Promise<{
  readonly connection: ResolvedAiConnection;
  readonly proof: AuthorizedApplicant<'VIEW_METADATA'>;
} | null> {
  const connection = await resolveAiAccessToken(tx, {
    token: request.token,
    resource: request.resource,
    ...(request.now ? { now: request.now } : {}),
  });
  if (!connection) return null;
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
 * connection whose account still owns its record? Same rules as `withAiConnection`, which still
 * checks again on every tool call.
 */
export async function authenticateAiRequest(
  db: Db,
  request: Pick<AiGateRequest, 'token' | 'resource' | 'now'>,
): Promise<AiCaller | null> {
  const opened = await db.transaction((tx) => openConnection(tx, request));
  return opened
    ? { connectionId: opened.connection.connectionId, clientHost: opened.connection.clientHost }
    : null;
}

interface ServedSummary {
  layers: Set<string>;
  missionIds: Set<string>;
  cases: number;
  values: number;
  documents: number;
  documentTexts: number;
  depth: SelectionDepth | null;
}

function countValues(output: SelectedOutput): number {
  return (
    output.person.basics.length +
    Object.values(output.profile).reduce((sum, list) => sum + (list?.length ?? 0), 0)
  );
}

/**
 * Runs one tool call for the connection behind `request.token`. `work` receives the gateway and
 * nothing else. Returns `unauthorized` when the token, the connection or the owner's access is no
 * longer good; the route answers that with 401 so the app signs in again.
 */
export async function withAiConnection<T>(
  db: Db,
  request: AiGateRequest,
  work: (gateway: AiContextGateway) => Promise<T>,
): Promise<Result<T, AiGateRefusal>> {
  return db.transaction(async (tx) => {
    const opened = await openConnection(tx, request);
    if (!opened) return err({ kind: 'unauthorized' } as const);
    const { connection, proof } = opened;
    const selection = selectionFromStoredChoices(connection);
    const stepUp = selection.revealIdentifiers
      ? await stepUpFromAiConnection(tx, connection.connectionId)
      : undefined;
    // Without a standing check (for example the record changed hands), full numbers stay masked.
    const effective: Selection = stepUp ? selection : { ...selection, revealIdentifiers: false };
    const scope = grantedScope(connection, effective);
    // The gateway works only while this call runs, inside its transaction.
    let open = true;
    const options: SelectedOutputOptions = {
      ...(request.now ? { now: request.now } : {}),
      ...(request.encryption ? { encryption: request.encryption } : {}),
      ...(stepUp ? { stepUp } : {}),
    };

    const served: ServedSummary = {
      layers: new Set(),
      missionIds: new Set(),
      cases: 0,
      values: 0,
      documents: 0,
      documentTexts: 0,
      depth: null,
    };
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
          layers: narrowing.layers
            ? effective.layers.filter((layer) => narrowing.layers?.includes(layer))
            : effective.layers,
          cases: cases.value,
          documentList: effective.documentList && narrowing.documentList !== false,
          documentText: narrowing.documentText === false ? [] : effective.documentText,
          revealIdentifiers: effective.revealIdentifiers,
          depth: narrowing.depth ? shallower(narrowing.depth, effective.depth) : effective.depth,
        };
        const built = await buildSelectedOutput(proof, narrowed, {
          ...options,
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
        const output = built.value;
        for (const layer of Object.keys(output.profile)) served.layers.add(layer);
        if (narrowed.cases.kind === 'one') served.missionIds.add(narrowed.cases.missionId);
        served.cases = Math.max(served.cases, output.cases.length);
        served.values += countValues(output);
        served.documents += output.documents.length;
        served.documentTexts += output.documentText.length;
        served.depth = narrowed.depth;
        return ok(output);
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
    const missionId =
      served.missionIds.size === 1
        ? ([...served.missionIds][0] as string)
        : connection.caseMode === 'ONE'
          ? connection.missionId
          : null;
    const base = {
      actorAccountId: connection.accountId,
      method: 'API' as const,
      applicantId: connection.applicantId,
      resourceType: 'ai_connection',
      resourceId: connection.connectionId,
      ...(missionId ? { missionId } : {}),
    };
    if (denial !== null) {
      await appendAuditEvent(tx, {
        ...base,
        eventType: 'AI_CONTEXT_DENIED',
        result: 'DENIED',
        reason: denial,
        metadata: { clientHost: connection.clientHost, tool: request.tool, reason: denial },
      });
    } else {
      await appendAuditEvent(tx, {
        ...base,
        eventType: 'AI_CONTEXT_SERVED',
        result: 'ALLOWED',
        metadata: {
          clientHost: connection.clientHost,
          tool: request.tool,
          layers: [...served.layers].sort(),
          caseMode: connection.caseMode,
          cases: served.cases,
          values: served.values,
          documents: served.documents,
          documentTexts: served.documentTexts,
          depth: served.depth ?? scope.depth,
        },
      });
    }
    return ok(value);
  });
}
