import { type Result, err, ok } from '@visastack/core';
import { type SQL, and, desc, eq, gt, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm';
import { agencyAiAvailable } from '../agency-ai-ready';
import {
  AI_CONNECTION_LAYERS,
  aiConnectionExpiry,
  scopesFromChoices,
} from '../ai-connection-scopes';
import { aiOrganizationContext, getAiFeatureState } from '../ai-feature-settings';
import { appendAuditEvent } from '../audit';
import { type Db, first, required, schema } from '../db';
import { recordProductEvent } from '../product-events';
import {
  AGENCY_AI_CONNECTION_MAX_MS,
  AGENCY_AI_ROLES,
  type AgencyAiStandingRefusal,
  checkAgencyAiStanding,
} from './agency-ai-scope';
import { type AiClientIdentity, issueAiAuthorizationCode } from './ai-connection';

/**
 * Agency AI connections (S22, ADR 0021 S22 amendment): connecting one, listing them for the
 * agency, and turning them off.
 *
 * An agency connection is an `ai_connections` row with no record and one `ai_connection_agencies`
 * row naming the agency. Its account is the owner or admin who connected it (decision D1), and it
 * reaches only what each traveller allowed the agency's AI tools to read (the AI gate decides
 * that on every call). Its choices are fixed: every section, the document list and document text
 * as far as each traveller's AI grants allow, cases through the member's own view, full numbers
 * never, depth at most standard. It lasts at most 30 days (decision D4).
 */

/** How long an agency connection may last (decision D4: never "until I turn it off"). */
export const AGENCY_AI_CONNECTION_DURATIONS = ['1h', '24h', '7d', '30d'] as const;
export type AgencyAiConnectionDuration = (typeof AGENCY_AI_CONNECTION_DURATIONS)[number];

export function isAgencyAiConnectionDuration(value: unknown): value is AgencyAiConnectionDuration {
  return (AGENCY_AI_CONNECTION_DURATIONS as readonly unknown[]).includes(value);
}

/** The revoked reasons an agency connection can carry. */
export const AGENCY_AI_REVOKED_BY_AGENCY = 'turned off by agency';
export const AGENCY_AI_REVOKED_MEMBER_ENDED = 'agency member removed';
export const AGENCY_AI_REVOKED_ROLE_CHANGED = 'agency member no longer owner or admin';

/** Why an agency connection could not be made. */
export type CreateAgencyAiRefusal =
  | AgencyAiStandingRefusal
  /** Agency AI Tools is off for this agency (the switch or the plan) or used up today. */
  | 'feature_off'
  | 'invalid_request';

export interface CreateAgencyAiConnectionInput {
  readonly organizationId: string;
  /** The signed-in account: checked again here, never trusted from the page. */
  readonly accountId: string;
  readonly client: AiClientIdentity;
  readonly duration: AgencyAiConnectionDuration;
  readonly codeChallenge: string;
  readonly redirectUri: string;
  readonly resource: string;
  readonly now?: Date;
}

/**
 * The owner or admin approved the agency consent screen: store the connection (inactive until the
 * app exchanges its code) and return a single-use code. Every condition the AI gate checks on a
 * call is checked here too, from live state: the migrations, an active owner or admin membership,
 * an active agency whose billing is not Suspended, the agency's setting, and Agency AI Tools.
 */
export async function createAgencyAiConnection(
  tx: Db,
  input: CreateAgencyAiConnectionInput,
): Promise<
  Result<{ readonly connectionId: string; readonly code: string }, CreateAgencyAiRefusal>
> {
  if (!isAgencyAiConnectionDuration(input.duration)) return err('invalid_request');
  const now = input.now ?? new Date();
  const standing = await checkAgencyAiStanding(tx, {
    connectionId: null,
    organizationId: input.organizationId,
    accountId: input.accountId,
    connectionCreatedAt: now,
    now,
  });
  if (!standing.ok) return err(standing.error);
  const feature = await getAiFeatureState(
    tx,
    'ai_agency_tools',
    aiOrganizationContext(input.organizationId),
    { now },
  );
  if (!feature.available) return err('feature_off');
  const expiry = aiConnectionExpiry(input.duration, now);
  const cap = new Date(now.getTime() + AGENCY_AI_CONNECTION_MAX_MS);
  const expiresAt = expiry && expiry.getTime() < cap.getTime() ? expiry : cap;
  const scopes = scopesFromChoices({
    layers: AI_CONNECTION_LAYERS,
    documentList: true,
    documentText: true,
    suggestChanges: false,
  });
  const connection = required(
    first(
      await tx
        .insert(schema.aiConnections)
        .values({
          accountId: input.accountId,
          applicantId: null,
          clientId: input.client.clientId,
          clientName: input.client.clientName,
          clientHost: input.client.clientHost,
          scopes,
          caseMode: 'ALL_CURRENT',
          missionId: null,
          revealIdentifiers: false,
          depth: 'standard',
          expiresAt,
          createdAt: now,
        })
        .returning({ id: schema.aiConnections.id }),
    ),
    'agency ai connection',
  );
  await tx
    .insert(schema.aiConnectionAgencies)
    .values({ connectionId: connection.id, organizationId: input.organizationId, createdAt: now });
  const code = await issueAiAuthorizationCode(tx, {
    connectionId: connection.id,
    codeChallenge: input.codeChallenge,
    redirectUri: input.redirectUri,
    resource: input.resource,
    now,
  });
  if (!code.ok) throw new Error('agency ai connection code could not be issued');
  await appendAuditEvent(tx, {
    eventType: 'AI_CONNECTION_CREATED',
    actorAccountId: input.accountId,
    method: 'MANUAL',
    result: 'ALLOWED',
    resourceType: 'ai_connection',
    resourceId: connection.id,
    metadata: {
      clientHost: input.client.clientHost,
      connectionKind: 'AGENCY',
      organizationId: input.organizationId,
      duration: input.duration,
    },
  });
  return ok({ connectionId: connection.id, code: code.value });
}

/** One agency connection as the agency's AI Connections page lists it. */
export interface AgencyAiConnectionSummary {
  readonly id: string;
  readonly clientName: string;
  readonly clientHost: string;
  /** Who connected it (their sign-in address), for the agency's own staff. */
  readonly connectedBy: string;
  readonly createdAt: Date;
  /** When it ends by itself: its chosen end, never more than 30 days after it was made. */
  readonly endsAt: Date;
  readonly lastUsedAt: Date | null;
  /** Ended by time, by being turned off, or never finished connecting and now past its end. */
  readonly live: boolean;
}

export interface AgencyAiConnectionList {
  /** False until both S22 migrations have run. */
  readonly available: boolean;
  readonly connections: readonly AgencyAiConnectionSummary[];
}

/** How many recently ended connections the page also lists, newest first. */
export const AGENCY_AI_ENDED_LIST_LIMIT = 10;

/** Whether this account is an active owner or admin of the agency, read live. */
async function agencyAdmin(tx: Db, organizationId: string, accountId: string): Promise<boolean> {
  const row = first(
    await tx
      .select({ role: schema.memberships.role, active: schema.memberships.active })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.accountId, accountId),
          eq(schema.memberships.organizationId, organizationId),
        ),
      )
      .limit(1),
  );
  return row?.active === true && AGENCY_AI_ROLES.includes(row.role);
}

function endOf(row: { readonly createdAt: Date; readonly expiresAt: Date | null }): Date {
  const cap = new Date(row.createdAt.getTime() + AGENCY_AI_CONNECTION_MAX_MS);
  return row.expiresAt && row.expiresAt.getTime() < cap.getTime() ? row.expiresAt : cap;
}

/**
 * The agency's AI connections, every owner's and admin's (decision D1: owners and admins see all,
 * each with Turn Off). Every live connection is listed (finished connecting, not turned off, not
 * past its end or its 30 days), so none can ever fall off the page; the ten most recently ended
 * follow. A consent never finished read nothing and is not listed. Only an active owner or admin
 * may list them; anyone else gets `forbidden`.
 */
export async function listAgencyAiConnections(
  db: Db,
  input: { readonly organizationId: string; readonly accountId: string; readonly now?: Date },
): Promise<Result<AgencyAiConnectionList, 'forbidden'>> {
  if (!(await agencyAdmin(db, input.organizationId, input.accountId))) return err('forbidden');
  if (!(await agencyAiAvailable(db))) return ok({ available: false, connections: [] });
  const now = input.now ?? new Date();
  const c = schema.aiConnections;
  const oldestLive = new Date(now.getTime() - AGENCY_AI_CONNECTION_MAX_MS);
  const live = and(
    isNull(c.revokedAt),
    gt(c.createdAt, oldestLive),
    or(isNull(c.expiresAt), gt(c.expiresAt, now)),
  );
  // When a connection ended: turned off, else the earlier of its own end and its 30 days. The
  // ended list is newest ended first (round 3), so a long-lived connection turned off today is
  // listed even when many younger ones ended before it.
  const endedAt = sql`coalesce(${c.revokedAt}, least(${c.expiresAt}, ${c.createdAt} + ${sql.raw(
    `interval '${AGENCY_AI_CONNECTION_MAX_MS / 1000} seconds'`,
  )}))`;
  const select = (where: SQL | undefined, order: readonly SQL[], limit: number | null) => {
    const query = db
      .select({
        id: c.id,
        clientName: c.clientName,
        clientHost: c.clientHost,
        email: schema.accounts.email,
        createdAt: c.createdAt,
        expiresAt: c.expiresAt,
        revokedAt: c.revokedAt,
        lastUsedAt: c.lastUsedAt,
      })
      .from(schema.aiConnectionAgencies)
      .innerJoin(c, eq(c.id, schema.aiConnectionAgencies.connectionId))
      .innerJoin(schema.accounts, eq(schema.accounts.id, c.accountId))
      .where(
        and(
          eq(schema.aiConnectionAgencies.organizationId, input.organizationId),
          isNotNull(c.activatedAt),
          where,
        ),
      )
      .orderBy(...order);
    return limit === null ? query : query.limit(limit);
  };
  const [liveRows, endedRows] = await Promise.all([
    select(live, [desc(c.createdAt), desc(c.id)], null),
    select(not(live as SQL), [desc(endedAt), desc(c.id)], AGENCY_AI_ENDED_LIST_LIMIT),
  ]);
  const summary = (row: (typeof liveRows)[number], isLive: boolean): AgencyAiConnectionSummary => ({
    id: row.id,
    clientName: row.clientName,
    clientHost: row.clientHost,
    connectedBy: row.email,
    createdAt: row.createdAt,
    endsAt: endOf(row),
    lastUsedAt: row.lastUsedAt,
    live: isLive,
  });
  return ok({
    available: true,
    connections: [
      ...liveRows.map((row) => summary(row, true)),
      ...endedRows.map((row) => summary(row, false)),
    ],
  });
}

/** Ends connections and cuts off their tokens, with one audit record each. */
async function endConnections(
  tx: Db,
  input: {
    readonly organizationId: string;
    readonly actorAccountId: string;
    readonly connectionIds: readonly string[];
    readonly reason: string;
    readonly auditReason:
      | 'agency_turned_off'
      | 'agency_member_removed'
      | 'agency_member_role_changed';
    readonly now: Date;
  },
): Promise<number> {
  if (input.connectionIds.length === 0) return 0;
  // The rows' update lock first (round 3): an agency call reading under the connection's shared
  // lock finishes before this commits, and any call after it sees the connection ended.
  await tx
    .select({ id: schema.aiConnections.id })
    .from(schema.aiConnections)
    .where(inArray(schema.aiConnections.id, [...input.connectionIds]))
    .orderBy(schema.aiConnections.id)
    .for('update');
  await tx
    .update(schema.aiConnectionTokens)
    .set({ revokedAt: input.now })
    .where(
      and(
        inArray(schema.aiConnectionTokens.connectionId, [...input.connectionIds]),
        isNull(schema.aiConnectionTokens.revokedAt),
      ),
    );
  // Only a connection still live is marked turned off (round 4): one already past its own end
  // or its 30 days keeps no turn-off time, so the ended list shows when each really ended.
  const ended = await tx
    .update(schema.aiConnections)
    .set({ revokedAt: input.now, revokedReason: input.reason })
    .where(
      and(
        inArray(schema.aiConnections.id, [...input.connectionIds]),
        isNull(schema.aiConnections.revokedAt),
        gt(
          schema.aiConnections.createdAt,
          new Date(input.now.getTime() - AGENCY_AI_CONNECTION_MAX_MS),
        ),
        or(isNull(schema.aiConnections.expiresAt), gt(schema.aiConnections.expiresAt, input.now)),
      ),
    )
    .returning({
      id: schema.aiConnections.id,
      accountId: schema.aiConnections.accountId,
      createdAt: schema.aiConnections.createdAt,
    });
  for (const connection of ended) {
    await recordProductEvent(tx, {
      eventType: 'AI_CONNECTOR_REVOKED',
      accountId: connection.accountId,
      metricValue: Math.max(
        0,
        Math.floor((input.now.getTime() - connection.createdAt.getTime()) / 1000),
      ),
      onceFor: connection.id,
    });
    await appendAuditEvent(tx, {
      eventType: 'AI_CONNECTION_REVOKED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'ai_connection',
      resourceId: connection.id,
      metadata: {
        reason: input.auditReason,
        connectionKind: 'AGENCY',
        organizationId: input.organizationId,
      },
    });
  }
  return ended.length;
}

/**
 * Turns one of the agency's connections off (Turn Off on the agency's AI Connections page). An
 * active owner or admin of that agency only; a connection of another agency is `not_found`.
 */
export async function turnOffAgencyAiConnection(
  db: Db,
  input: {
    readonly organizationId: string;
    readonly accountId: string;
    readonly connectionId: string;
  },
): Promise<Result<{ readonly alreadyOff: boolean }, 'forbidden' | 'not_found'>> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.connectionId)) {
    return err('not_found');
  }
  return db.transaction(async (tx) => {
    if (!(await agencyAdmin(tx, input.organizationId, input.accountId))) return err('forbidden');
    if (!(await agencyAiAvailable(tx))) return err('not_found');
    const row = first(
      await tx
        .select({ id: schema.aiConnections.id, revokedAt: schema.aiConnections.revokedAt })
        .from(schema.aiConnectionAgencies)
        .innerJoin(
          schema.aiConnections,
          eq(schema.aiConnections.id, schema.aiConnectionAgencies.connectionId),
        )
        .where(
          and(
            eq(schema.aiConnectionAgencies.connectionId, input.connectionId),
            eq(schema.aiConnectionAgencies.organizationId, input.organizationId),
          ),
        )
        .limit(1)
        .for('update'),
    );
    if (!row) return err('not_found');
    const ended = await endConnections(tx, {
      organizationId: input.organizationId,
      actorAccountId: input.accountId,
      connectionIds: [row.id],
      reason: AGENCY_AI_REVOKED_BY_AGENCY,
      auditReason: 'agency_turned_off',
      now: new Date(),
    });
    return ok({ alreadyOff: ended === 0 });
  });
}

/**
 * Ends every agency connection a member made for this agency, when that member is turned off.
 * The AI gate already refuses such a member on the next call; this also cuts off their tokens and
 * shows the connection as ended. Runs in the caller's transaction; nothing before the migration.
 */
export async function endAgencyAiConnectionsOfMember(
  tx: Db,
  input: {
    readonly organizationId: string;
    readonly memberAccountId: string;
    readonly actorAccountId: string;
    /** Turned off or removed, or (S22 round 2) moved out of owner and admin. */
    readonly reason: 'member_removed' | 'role_changed';
  },
): Promise<number> {
  if (!(await agencyAiAvailable(tx))) return 0;
  const rows = await tx
    .select({ id: schema.aiConnections.id })
    .from(schema.aiConnectionAgencies)
    .innerJoin(
      schema.aiConnections,
      eq(schema.aiConnections.id, schema.aiConnectionAgencies.connectionId),
    )
    .where(
      and(
        eq(schema.aiConnectionAgencies.organizationId, input.organizationId),
        eq(schema.aiConnections.accountId, input.memberAccountId),
        isNull(schema.aiConnections.revokedAt),
      ),
    );
  return endConnections(tx, {
    organizationId: input.organizationId,
    actorAccountId: input.actorAccountId,
    connectionIds: rows.map((row) => row.id),
    reason:
      input.reason === 'role_changed'
        ? AGENCY_AI_REVOKED_ROLE_CHANGED
        : AGENCY_AI_REVOKED_MEMBER_ENDED,
    auditReason:
      input.reason === 'role_changed' ? 'agency_member_role_changed' : 'agency_member_removed',
    now: new Date(),
  });
}

/** For the duration list on the agency consent screen. */
export const AGENCY_AI_DEFAULT_DURATION: AgencyAiConnectionDuration = '30d';
