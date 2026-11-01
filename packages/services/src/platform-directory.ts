import { type Result, err, ok } from '@visastack/core';
import { and, asc, gt, ilike } from 'drizzle-orm';
import { type Db, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import {
  clampLimit,
  cursorOrder,
  cursorTime,
  decodeTimeCursor,
  encodeTimeCursor,
  olderThan,
  toPage,
} from './paging';
import { type PlatformAuthInput, isPlatformOwner } from './platform-roles';

export interface PlatformMember {
  readonly id: string;
  readonly email: string;
  readonly emailVerifiedAt: Date | null;
  readonly createdAt: Date;
}

/** The largest page of the member directory when it is read with options (WP-SB7). */
export const MEMBER_PAGE_MAX = 20;
const MEMBER_SEARCH_MAX_CHARS = 100;

/** How the owner's member directory is narrowed and paged when read with options. */
export interface PlatformMemberListOptions {
  /** How many members to return; 1 to 20, default 20. */
  readonly limit?: number;
  /** The previous page's `next`, as received; one from another search gives the first page. */
  readonly before?: string;
  /** Part of an email address, any case. Trimmed; at most 100 characters are used. */
  readonly emailSearch?: string;
}

function memberCursorScope(search: string): string {
  return `platform:members:${search.toLowerCase()}`;
}

/**
 * Owner-only account directory, independent of legacy IDs or staff-role reports. Without
 * `options`, 50 accounts in id order after `after` (today's behaviour). With `options`, at most 20
 * accounts, newest first, optionally narrowed by part of the email address; `next` is then an
 * opaque cursor for `options.before`, and `after` is not used.
 */
export async function listPlatformMembers(
  db: Db,
  actor: PlatformAuthInput,
  after?: string,
  options?: PlatformMemberListOptions,
): Promise<
  Result<
    { readonly members: readonly PlatformMember[]; readonly next: string | null },
    ServiceError
  >
> {
  if (!(await isPlatformOwner(db, actor)))
    return err(serviceError('forbidden', 'Platform owner access is required.'));
  if (options) return ok(await readMemberPage(db, options));
  if (after && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(after)) {
    return err(
      serviceError('invalid', 'This page link is invalid. Open the member directory again.'),
    );
  }
  const rows = await db
    .select({
      id: schema.accounts.id,
      email: schema.accounts.email,
      emailVerifiedAt: schema.accounts.emailVerifiedAt,
      createdAt: schema.accounts.createdAt,
    })
    .from(schema.accounts)
    .where(after ? gt(schema.accounts.id, after) : undefined)
    .orderBy(asc(schema.accounts.id))
    .limit(51);
  return ok({ members: rows.slice(0, 50), next: rows.length > 50 ? (rows[49]?.id ?? null) : null });
}

async function readMemberPage(
  db: Db,
  options: PlatformMemberListOptions,
): Promise<{ readonly members: readonly PlatformMember[]; readonly next: string | null }> {
  const search = (options.emailSearch ?? '').trim().slice(0, MEMBER_SEARCH_MAX_CHARS);
  const limit = clampLimit(Math.min(options.limit ?? MEMBER_PAGE_MAX, MEMBER_PAGE_MAX));
  const scope = memberCursorScope(search);
  const cursor = decodeTimeCursor(options.before, scope);
  const table = schema.accounts;
  const rows = await db
    .select({
      id: table.id,
      email: table.email,
      emailVerifiedAt: table.emailVerifiedAt,
      createdAt: table.createdAt,
      at: cursorTime(table.createdAt),
    })
    .from(table)
    .where(
      and(
        search ? ilike(table.email, `%${search.replace(/[\\%_]/g, '\\$&')}%`) : undefined,
        cursor ? olderThan(table.createdAt, table.id, cursor) : undefined,
      ),
    )
    .orderBy(...cursorOrder(table.createdAt, table.id))
    .limit(limit + 1);
  const page = toPage(rows, limit, (last) => encodeTimeCursor({ at: last.at, id: last.id }, scope));
  return {
    members: page.items.map(({ at: _at, ...member }) => member),
    next: page.nextCursor,
  };
}
