import { createHash } from 'node:crypto';
import { type SQL, type SQLWrapper, sql } from 'drizzle-orm';

/**
 * Shared paging for long lists (Scroll Budget programme, WP-SB0).
 *
 * A list read takes an optional `PageRequest` and returns a `Page<T>`: at most `limit` rows,
 * newest first, plus an opaque cursor for the next (older) page. Rules every caller keeps:
 *
 * - The cursor only says where the previous page stopped. The query that uses it must still apply
 *   the same access checks and the same tenant filter as the first page, so a forged cursor can at
 *   most move within rows the reader may already see.
 * - Every cursor is bound to a scope string (for example `applicant:<id>:history`). A cursor made
 *   for another scope, an old format or anything malformed decodes to null, and the caller then
 *   serves the first page: never an error page and never another tenant's rows.
 * - Order by a stable key: the time column plus the row id (`cursorOrder`), or a sequence number.
 *   Postgres keeps microseconds and a JavaScript Date does not, so time keys travel as the text
 *   `cursorTime` selects, never as a Date, or rows inside one millisecond could be skipped.
 */

/** The smallest, default and largest page a list read accepts. */
export const PAGE_LIMIT_MIN = 1;
export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

export interface PageRequest {
  /** How many rows to return; clamped to 1 to 100. */
  readonly limit?: number;
  /** The `nextCursor` of the previous page, as the page received it. */
  readonly before?: string;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** Pass back as `before` for the next, older page; null when nothing older remains. */
  readonly nextCursor: string | null;
}

/** A position in a list ordered by time and then id, newest first. */
export interface TimeCursorKey {
  /** The row's time as `cursorTime` selected it: ISO 8601 in UTC with up to 6 decimals. */
  readonly at: string;
  readonly id: string;
}

/** A position in a list ordered by a whole-number sequence, highest first. */
export interface SeqCursorKey {
  readonly seq: string;
}

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 512;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
// UTC only, so two cursors for the same instant always compare the same way.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
// Row ids are UUIDs or short codes; nothing that could carry markup or SQL.
const ROW_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
// Postgres bigint range, as digits.
const SEQ = /^(?:0|[1-9]\d{0,18})$/;
const MAX_BIGINT = 9_223_372_036_854_775_807n;

/**
 * Clamps a requested page size to 1 to 100. Anything that is not a finite number falls back to the
 * default, and fractions round down.
 */
export function clampLimit(limit: number | undefined, fallback = PAGE_LIMIT_DEFAULT): number {
  const base = Math.min(PAGE_LIMIT_MAX, Math.max(PAGE_LIMIT_MIN, Math.floor(fallback)));
  if (limit === undefined || !Number.isFinite(limit)) return base;
  return Math.min(PAGE_LIMIT_MAX, Math.max(PAGE_LIMIT_MIN, Math.floor(limit)));
}

/** A short one-way tag for the scope, so the cursor does not spell out which view it belongs to. */
function scopeTag(scope: string): string {
  if (scope.length === 0) throw new Error('A paging cursor needs a scope');
  return createHash('sha256')
    .update(`visastack:paging:v1:${scope}`)
    .digest('base64url')
    .slice(0, 22);
}

function pack(body: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
}

/** The fields a cursor body may carry; anything else in it is ignored. */
interface CursorBody {
  readonly v?: unknown;
  readonly s?: unknown;
  readonly t?: unknown;
  readonly i?: unknown;
  readonly q?: unknown;
}

function unpack(cursor: unknown, scope: string): CursorBody | null {
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH)
    return null;
  if (!BASE64URL.test(cursor)) return null;
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as CursorBody;
  if (record.v !== CURSOR_VERSION || record.s !== scopeTag(scope)) return null;
  return record;
}

function validTime(at: unknown): at is string {
  return typeof at === 'string' && ISO_UTC.test(at) && Number.isFinite(Date.parse(at));
}

function validSeq(seq: unknown): seq is string {
  return typeof seq === 'string' && SEQ.test(seq) && BigInt(seq) <= MAX_BIGINT;
}

/** Makes the cursor for a time plus id position. Throws on a key no decoder would accept. */
export function encodeTimeCursor(key: TimeCursorKey, scope: string): string {
  if (!validTime(key.at)) throw new Error('A paging cursor time must be ISO 8601 in UTC');
  if (!ROW_ID.test(key.id)) throw new Error('A paging cursor id has an unexpected shape');
  return pack({ v: CURSOR_VERSION, s: scopeTag(scope), t: key.at, i: key.id });
}

/** Reads a time plus id cursor; null when it is missing, malformed or made for another scope. */
export function decodeTimeCursor(cursor: unknown, scope: string): TimeCursorKey | null {
  const body = unpack(cursor, scope);
  if (!body) return null;
  const at = body.t;
  const id = body.i;
  if (!validTime(at) || typeof id !== 'string' || !ROW_ID.test(id)) return null;
  return { at, id };
}

/** Makes the cursor for a sequence position (for example the audit log's `seq`). */
export function encodeSeqCursor(seq: bigint | number | string, scope: string): string {
  const text = String(seq);
  if (!validSeq(text)) throw new Error('A paging cursor sequence must be a whole number');
  return pack({ v: CURSOR_VERSION, s: scopeTag(scope), q: text });
}

/** Reads a sequence cursor; null when it is missing, malformed or made for another scope. */
export function decodeSeqCursor(cursor: unknown, scope: string): SeqCursorKey | null {
  const body = unpack(cursor, scope);
  if (!body) return null;
  const seq = body.q;
  return validSeq(seq) ? { seq } : null;
}

/** Selects a time column as the exact UTC text a time cursor carries (microseconds kept). */
export function cursorTime(column: SQLWrapper): SQL<string> {
  return sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** The newest-first order a time cursor relies on. Spread into `.orderBy(...)`. */
export function cursorOrder(timeColumn: SQLWrapper, idColumn: SQLWrapper): [SQL, SQL] {
  return [sql`${timeColumn} desc`, sql`${idColumn} desc`];
}

/** The condition for rows strictly older than a time cursor position, in `cursorOrder`. */
export function olderThan(timeColumn: SQLWrapper, idColumn: SQLWrapper, key: TimeCursorKey): SQL {
  return sql`(${timeColumn}, ${idColumn}) < (${key.at}::timestamptz, ${key.id})`;
}

/** The condition for rows below a sequence cursor position, highest first. */
export function belowSeq(seqColumn: SQLWrapper, key: SeqCursorKey): SQL {
  return sql`${seqColumn} < ${key.seq}::bigint`;
}

/**
 * Turns rows read with `limit + 1` into a page: the extra row only proves an older page exists, so
 * it is dropped and the cursor points at the last row kept.
 */
export function toPage<T>(
  rows: readonly T[],
  limit: number,
  cursorFor: (last: T) => string,
): Page<T> {
  const size = clampLimit(limit);
  if (rows.length <= size) return { items: rows, nextCursor: null };
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return { items, nextCursor: last === undefined ? null : cursorFor(last) };
}
