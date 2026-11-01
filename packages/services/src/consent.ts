import { CONSENT_TYPES, type ConsentType, type Result, err, ok } from '@visastack/core';
import { and, desc, eq } from 'drizzle-orm';
import { appendAuditEvent } from './audit';
import { type Db, first, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  type Page,
  type PageRequest,
  clampLimit,
  cursorOrder,
  cursorTime,
  decodeTimeCursor,
  encodeTimeCursor,
  olderThan,
  toPage,
} from './paging';

/**
 * Separated consent lifecycle (Build Spec §13, PRD §2).
 *
 * Consent is captured per purpose (core processing, AI extraction, sharing,
 * marketing) and is independently grantable and revocable. Records are
 * append-only: each grant/revoke inserts a new row, so the full consent
 * history is preserved. The current state per type is the latest row.
 */

export type ConsentState = Readonly<Record<ConsentType, boolean>>;

export interface SetConsentInput {
  /** The authenticated account performing the action. */
  readonly actorAccountId: string;
  /** The account whose consent is being set (must equal the actor: self-only). */
  readonly accountId: string;
  readonly type: ConsentType;
  readonly granted: boolean;
  readonly ip?: string | null;
  readonly device?: string | null;
}

const ALL_REVOKED: ConsentState = Object.freeze(
  Object.fromEntries(CONSENT_TYPES.map((type) => [type, false])) as Record<ConsentType, boolean>,
);

/** Current consent state for an account, one boolean per consent type. */
export async function getConsents(db: Db, accountId: string): Promise<ConsentState> {
  const rows = await db
    .select()
    .from(schema.consentRecords)
    .where(eq(schema.consentRecords.accountId, accountId))
    .orderBy(desc(schema.consentRecords.createdAt));

  const state: Record<ConsentType, boolean> = { ...ALL_REVOKED };
  const seen = new Set<ConsentType>();
  // Rows are newest-first; the first row seen per type is the current state.
  for (const row of rows) {
    const type = row.type;
    if (seen.has(type)) continue;
    seen.add(type);
    state[type] = row.grantedAt !== null && row.revokedAt === null;
  }
  return state;
}

/** True iff the account currently holds the given consent. */
export async function hasConsent(db: Db, accountId: string, type: ConsentType): Promise<boolean> {
  const row = first(
    await db
      .select()
      .from(schema.consentRecords)
      .where(
        and(eq(schema.consentRecords.accountId, accountId), eq(schema.consentRecords.type, type)),
      )
      .orderBy(desc(schema.consentRecords.createdAt))
      .limit(1),
  );
  return row !== undefined && row.grantedAt !== null && row.revokedAt === null;
}

export type ConsentRecord = typeof schema.consentRecords.$inferSelect;

/**
 * Full consent history for an account, newest first. Records are append-only,
 * so this is the complete grant/revoke trail per purpose (Build Spec §13).
 */
/**
 * Every consent change of one account, newest first (the form the data export uses). Given
 * `options`, it reads one page instead: at most `limit` changes (default 50, clamped to 1 to 100),
 * older pages through the `before` cursor. A cursor made for another account gives the first page.
 */
export async function listConsentHistory(db: Db, accountId: string): Promise<ConsentRecord[]>;
export async function listConsentHistory(
  db: Db,
  accountId: string,
  options: PageRequest,
): Promise<Page<ConsentRecord>>;
export async function listConsentHistory(
  db: Db,
  accountId: string,
  options?: PageRequest,
): Promise<ConsentRecord[] | Page<ConsentRecord>> {
  const c = schema.consentRecords;
  if (options === undefined) {
    return db.select().from(c).where(eq(c.accountId, accountId)).orderBy(desc(c.createdAt));
  }
  const scope = `account:${accountId}:consent-history`;
  const limit = clampLimit(options.limit);
  const key = decodeTimeCursor(options.before, scope);
  const rows = await db
    .select({ record: c, cursorAt: cursorTime(c.createdAt) })
    .from(c)
    .where(and(eq(c.accountId, accountId), key ? olderThan(c.createdAt, c.id, key) : undefined))
    .orderBy(...cursorOrder(c.createdAt, c.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (last) =>
    encodeTimeCursor({ at: last.cursorAt, id: last.record.id }, scope),
  );
  return { items: page.items.map((row) => row.record), nextCursor: page.nextCursor };
}

/** Grant or revoke one consent type for the actor's own account. */
export async function setConsent(
  db: Db,
  input: SetConsentInput,
): Promise<Result<ConsentState, ServiceError>> {
  if (input.actorAccountId !== input.accountId) {
    return err(serviceError('forbidden', 'consent may only be changed by the account owner'));
  }

  return db.transaction(async (tx) => {
    const now = new Date();
    await tx.insert(schema.consentRecords).values({
      accountId: input.accountId,
      type: input.type,
      grantedAt: input.granted ? now : null,
      revokedAt: input.granted ? null : now,
    });
    await appendAuditEvent(tx, {
      eventType: input.granted ? 'CONSENT_GRANTED' : 'CONSENT_REVOKED',
      actorAccountId: input.actorAccountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'consent',
      resourceId: `${input.accountId}:${input.type}`,
      ip: input.ip ?? null,
      device: input.device ?? null,
      metadata: { type: input.type, granted: input.granted },
    });
    return ok(await getConsents(tx, input.accountId));
  });
}
