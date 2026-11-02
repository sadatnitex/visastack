import { createHash } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, asc, count, desc, eq, inArray, isNull, lt, max, ne, sql } from 'drizzle-orm';
import { type StaffScope, SystemScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { cacheOwner, connectionKey } from './plans-schema';
import {
  SOURCE_FETCH_TIMEOUT_MS,
  type SourceFetchOutcome,
  type SourceFetchResult,
  type SourceFetcher,
  parseSourceUrl,
} from './source-fetch';

/**
 * Official-source monitoring (UMPE P10): the register of official pages per route, the light
 * Saturday check (09:00 Asia/Dhaka, 03:00 UTC), and the queue of machine-detected changes.
 *
 * What this never does: create, approve, publish or change any pack, pack version or pack
 * requirement. A fetched page is not a verified rule. A detected change only becomes a candidate
 * for a person to review; accepting one records the decision and nothing else, and the rule itself
 * still goes through Pack Studio's author and reviewer steps. A page that could not be read
 * (blocked, timed out, refused redirect, too large, an unsupported format such as a PDF) is
 * recorded as an exception: never as checked, and never as a requirement that went away.
 *
 * Callers gate every function here on `PACK_MANAGE` (apps/web admin/packs/sources/actions.ts),
 * exactly like the Pack Studio services. Before migration 0115 every reader returns "not ready"
 * and every writer refuses with a plain message; nothing throws.
 */

export const SOURCE_AUTHORITY_TIERS = [
  'GOVERNMENT',
  'CONSULATE',
  'OFFICIAL_APPLICATION',
  'AUTHORIZED_VAC',
] as const;
export type SourceAuthorityTier = (typeof SOURCE_AUTHORITY_TIERS)[number];

export const SOURCE_CANDIDATE_STATUSES = [
  'NEW',
  'IN_REVIEW',
  'DISMISSED',
  'ACCEPTED_FOR_DRAFT',
] as const;
export type SourceCandidateStatus = (typeof SOURCE_CANDIDATE_STATUSES)[number];
export type SourceCandidateDecision = Exclude<SourceCandidateStatus, 'NEW'>;

export type SourceCheckTrigger = 'SCHEDULED' | 'MANUAL';

/** At most this many active sources are fetched in one run (the job must stay light). */
export const SOURCE_CHECK_MAX_SOURCES = 40;
/** Pages fetched at the same time. */
export const SOURCE_CHECK_CONCURRENCY = 2;
/** The whole run stays inside the route's 60 s limit, with room to write the counts. */
export const SOURCE_CHECK_BUDGET_MS = 50_000;
/** An unfinished run untouched for this long may be picked up again by a later call. */
const RUN_STALE_MS = 2 * 60 * 1000;
export const SOURCE_EXCERPT_MAX = 2000;
const NOTE_MAX = 1000;
const TEXT_MAX = 200;
const ROUTE_MAX = 100;

export const SOURCE_MONITOR_NOT_READY =
  'Source monitoring can be used once the database is updated.';

const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

// --- Time ---------------------------------------------------------------------------------------

/**
 * The Asia/Dhaka week a moment falls in, named by the Dhaka date of the Saturday that starts it
 * ("2026-11-07"). Dhaka is UTC+6 all year (no daylight saving), so the offset is applied directly
 * rather than read from the machine's time zone data: a Dhaka Saturday runs from Friday 18:00 UTC
 * to Saturday 18:00 UTC.
 */
export function dhakaWeekKey(now: Date): string {
  const local = new Date(now.getTime() + DHAKA_OFFSET_MS);
  // getUTCDay on the shifted moment is the Dhaka weekday: Saturday 6 -> 0 days back, Sunday 0 -> 1,
  // Friday 5 -> 6.
  const daysSinceSaturday = (local.getUTCDay() + 1) % 7;
  const saturday = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceSaturday),
  );
  return saturday.toISOString().slice(0, 10);
}

/** True when the moment is a Saturday in Asia/Dhaka. */
export function isSaturdayInDhaka(now: Date): boolean {
  return new Date(now.getTime() + DHAKA_OFFSET_MS).getUTCDay() === 6;
}

// --- Normalising page text ----------------------------------------------------------------------

/**
 * Elements whose content is layout, code or site furniture rather than the rule itself: removed
 * with everything inside them before a page is fingerprinted.
 */
const SKIPPED_ELEMENTS = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'head',
  'nav',
  'header',
  'footer',
  'aside',
  'iframe',
  'object',
]);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '-',
  mdash: '-',
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  hellip: '...',
};

/** Lower-cases ASCII letters only, so every index still lines up with the original text. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

function tagNameAt(lower: string, start: number): string {
  let end = start;
  while (end < lower.length) {
    const code = lower.charCodeAt(end);
    const letter = code >= 97 && code <= 122;
    const digit = code >= 48 && code <= 57;
    if (!(letter || (end > start && (digit || code === 45)))) break;
    end += 1;
  }
  return lower.slice(start, end);
}

/**
 * The visible text of an HTML page, in one linear pass (no backtracking pattern, so a hostile page
 * cannot make it slow): comments, tags and the skipped elements above are dropped.
 */
function htmlText(html: string): string {
  const lower = asciiLower(html);
  const parts: string[] = [];
  /** Elements already known to have no closing tag further on: never searched for again. */
  const unclosed = new Set<string>();
  let at = 0;
  while (at < html.length) {
    const open = html.indexOf('<', at);
    if (open === -1) {
      parts.push(html.slice(at));
      break;
    }
    parts.push(html.slice(at, open));
    if (lower.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      if (end === -1) break;
      parts.push(' ');
      at = end + 3;
      continue;
    }
    const close = html.indexOf('>', open + 1);
    if (close === -1) {
      parts.push(html.slice(open));
      break;
    }
    const name = tagNameAt(lower, open + 1);
    parts.push(' ');
    at = close + 1;
    if (name.length > 0 && SKIPPED_ELEMENTS.has(name) && html[close - 1] !== '/') {
      if (unclosed.has(name)) continue;
      const end = lower.indexOf(`</${name}`, at);
      if (end === -1) {
        unclosed.add(name);
        continue;
      }
      const endClose = html.indexOf('>', end);
      at = endClose === -1 ? html.length : endClose + 1;
    }
  }
  return parts.join('');
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return whole;
      if (code >= 0xd800 && code <= 0xdfff) return whole;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * No-break space, the zero-width characters and the byte order mark, read as plain spaces. Built
 * from code points so the source holds no invisible character.
 */
const INVISIBLE_SPACES = new RegExp(
  [0x00a0, 0x200b, 0x200c, 0x200d, 0x2060, 0xfeff]
    .map((code) => `\\u${code.toString(16).padStart(4, '0')}`)
    .join('|'),
  'g',
);

/**
 * The text a page's fingerprint is taken from: visible words only, every run of white space as one
 * space. Re-indenting the HTML, changing classes or scripts, or editing the site menu, header or
 * footer leaves it unchanged, so those never become a candidate change.
 */
export function normalizeSourceText(text: string, kind: 'html' | 'text'): string {
  const visible = kind === 'html' ? decodeEntities(htmlText(text)) : text;
  return visible.replace(INVISIBLE_SPACES, ' ').replace(/\s+/g, ' ').trim();
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * The earlier and the new text around the first place they differ. Only the first
 * SOURCE_EXCERPT_MAX characters of the earlier page are kept, so a change further down shows the
 * new text only and the reviewer opens the page to compare.
 */
export function changeExcerpts(
  previousExcerpt: string | null,
  nextText: string,
): { readonly oldExcerpt: string | null; readonly newExcerpt: string } {
  const half = SOURCE_EXCERPT_MAX / 2;
  if (previousExcerpt === null) return { oldExcerpt: null, newExcerpt: nextText.slice(0, half) };
  const limit = Math.min(previousExcerpt.length, nextText.length);
  let same = 0;
  while (same < limit && previousExcerpt.charCodeAt(same) === nextText.charCodeAt(same)) same += 1;
  const keptWholeEarlier = previousExcerpt.length < SOURCE_EXCERPT_MAX;
  if (same >= previousExcerpt.length && !keptWholeEarlier) {
    return {
      oldExcerpt: null,
      newExcerpt: nextText.slice(previousExcerpt.length, previousExcerpt.length + half),
    };
  }
  const start = Math.max(0, same - 200);
  return {
    oldExcerpt: previousExcerpt.slice(start, start + half),
    newExcerpt: nextText.slice(start, start + half),
  };
}

// --- Readiness ----------------------------------------------------------------------------------

const readyHandles = new WeakMap<object, true>();
const readyConnections = new Set<string>();

/** Whether migration 0115's four tables exist. Only a yes is remembered. Never raises. */
export async function sourceMonitorReady(db: Db): Promise<boolean> {
  const owner = cacheOwner(db);
  if (readyHandles.has(owner)) return true;
  const key = connectionKey(db);
  if (key !== null && readyConnections.has(key)) return true;
  try {
    const rows = await db
      .select({
        present: sql<boolean>`to_regclass('official_sources') is not null and to_regclass('source_check_runs') is not null and to_regclass('source_observations') is not null and to_regclass('source_change_candidates') is not null`,
      })
      .from(sql`(select 1) as probe`);
    const present = rows[0]?.present === true;
    if (present) {
      readyHandles.set(owner, true);
      if (key !== null) readyConnections.add(key);
    }
    return present;
  } catch {
    return false;
  }
}

// --- Register -----------------------------------------------------------------------------------

export interface RegisterOfficialSourceInput {
  readonly jurisdiction: string;
  readonly route?: string;
  readonly purpose?: string;
  readonly url: string;
  readonly title: string;
  readonly publisher: string;
  readonly authorityTier: string;
  readonly packId?: string;
}

function isAuthorityTier(value: string): value is SourceAuthorityTier {
  return (SOURCE_AUTHORITY_TIERS as readonly string[]).includes(value);
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Registers one official page for a route. The page is not fetched here. */
export async function registerOfficialSource(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: RegisterOfficialSourceInput,
): Promise<Result<{ readonly id: string }, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PACK_MANAGE');
  if (denied) return err(denied);
  const jurisdiction = input.jurisdiction.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(jurisdiction)) {
    return err(serviceError('invalid', 'Enter the two-letter country code, for example GB.'));
  }
  const url = parseSourceUrl(input.url.trim());
  if (url === null) {
    return err(
      serviceError(
        'invalid',
        'Enter the full https address of the official page, with a site name (not a number address).',
      ),
    );
  }
  const title = input.title.trim();
  const publisher = input.publisher.trim();
  if (title.length === 0 || title.length > TEXT_MAX) {
    return err(serviceError('invalid', 'Enter the page title (up to 200 characters).'));
  }
  if (publisher.length === 0 || publisher.length > TEXT_MAX) {
    return err(serviceError('invalid', 'Enter who publishes the page (up to 200 characters).'));
  }
  const route = input.route?.trim() ?? '';
  const purpose = input.purpose?.trim() ?? '';
  if (route.length > ROUTE_MAX || purpose.length > ROUTE_MAX) {
    return err(serviceError('invalid', 'Keep the route and purpose under 100 characters.'));
  }
  if (!isAuthorityTier(input.authorityTier)) {
    return err(serviceError('invalid', 'Choose who the source speaks for.'));
  }
  const packId = input.packId?.trim() ?? '';
  if (packId.length > 0 && !UUID_SHAPE.test(packId)) {
    return err(serviceError('not_found', 'That pack was not found.'));
  }
  if (!(await sourceMonitorReady(db))) return err(serviceError('stale', SOURCE_MONITOR_NOT_READY));

  try {
    return await db.transaction(async (tx) => {
      const t = tx as unknown as Db;
      if (packId.length > 0) {
        const pack = first(
          await t
            .select({ id: schema.packs.id })
            .from(schema.packs)
            .where(eq(schema.packs.id, packId))
            .limit(1),
        );
        if (!pack) return err(serviceError('not_found', 'That pack was not found.'));
      }
      const row = first(
        await t
          .insert(schema.officialSources)
          .values({
            jurisdiction,
            route: route.length > 0 ? route : null,
            purpose: purpose.length > 0 ? purpose : null,
            url: url.href,
            title,
            publisher,
            authorityTier: input.authorityTier as SourceAuthorityTier,
            packId: packId.length > 0 ? packId : null,
            createdByAccountId: staff.accountId,
          })
          .returning({ id: schema.officialSources.id }),
      );
      if (!row) throw new Error('expected official source to be returned by the database');
      await appendAuditEvent(t, {
        eventType: 'OFFICIAL_SOURCE_REGISTERED',
        actorAccountId: staff.accountId,
        method: 'MANUAL',
        result: 'ALLOWED',
        resourceType: 'official_source',
        resourceId: row.id,
        metadata: {
          jurisdiction,
          authorityTier: input.authorityTier,
          packLinked: packId.length > 0,
        },
      });
      return ok({ id: row.id });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return err(serviceError('invalid', 'That page is already registered.'));
    }
    throw error;
  }
}

/** Stops checking a page. Its history stays; the same address can be registered again. */
export async function deactivateOfficialSource(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: { readonly sourceId: string },
): Promise<Result<{ readonly id: string }, ServiceError>> {
  const denied = staffScopeProblem(staff, 'PACK_MANAGE');
  if (denied) return err(denied);
  if (!UUID_SHAPE.test(input.sourceId)) return err(serviceError('not_found', 'Source not found.'));
  if (!(await sourceMonitorReady(db))) return err(serviceError('stale', SOURCE_MONITOR_NOT_READY));
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const row = first(
      await t
        .update(schema.officialSources)
        .set({ active: false, deactivatedAt: new Date() })
        .where(
          and(
            eq(schema.officialSources.id, input.sourceId),
            eq(schema.officialSources.active, true),
          ),
        )
        .returning({ id: schema.officialSources.id }),
    );
    if (!row) return err(serviceError('not_found', 'Source not found, or already stopped.'));
    await appendAuditEvent(t, {
      eventType: 'OFFICIAL_SOURCE_DEACTIVATED',
      actorAccountId: staff.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'official_source',
      resourceId: row.id,
    });
    return ok({ id: row.id });
  });
}

// --- Review -------------------------------------------------------------------------------------

const ALLOWED_FROM: Readonly<Record<SourceCandidateDecision, readonly SourceCandidateStatus[]>> = {
  IN_REVIEW: ['NEW'],
  DISMISSED: ['NEW', 'IN_REVIEW'],
  ACCEPTED_FOR_DRAFT: ['NEW', 'IN_REVIEW'],
};

/**
 * Records a person's decision on a detected change. Accept For Draft records the decision only:
 * the rule is then written in Pack Studio as a draft and goes through its author and reviewer
 * steps. Nothing here touches a pack.
 */
export async function reviewSourceChangeCandidate(
  db: Db,
  staff: StaffScope<'PACK_MANAGE'>,
  input: {
    readonly candidateId: string;
    readonly decision: SourceCandidateDecision;
    readonly note?: string;
  },
): Promise<Result<{ readonly id: string; readonly status: SourceCandidateStatus }, ServiceError>> {
  if (!UUID_SHAPE.test(input.candidateId)) {
    return err(serviceError('not_found', 'Change not found.'));
  }
  const allowedFrom = ALLOWED_FROM[input.decision];
  if (!allowedFrom) return err(serviceError('invalid', 'Choose a decision.'));
  const note = input.note?.trim() ?? '';
  if (note.length > NOTE_MAX) {
    return err(serviceError('invalid', 'Keep the note under 1,000 characters.'));
  }
  if (!(await sourceMonitorReady(db))) return err(serviceError('stale', SOURCE_MONITOR_NOT_READY));
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const c = schema.sourceChangeCandidates;
    const row = first(
      await t
        .update(c)
        .set({
          status: input.decision,
          reviewerAccountId: staff.accountId,
          reviewedAt: new Date(),
          reviewNote: note.length > 0 ? note : null,
        })
        .where(and(eq(c.id, input.candidateId), inArray(c.status, [...allowedFrom])))
        .returning({ id: c.id, sourceId: c.sourceId }),
    );
    if (!row) {
      return err(serviceError('stale', 'This change was already decided. Refresh to see it.'));
    }
    await appendAuditEvent(t, {
      eventType: 'SOURCE_CHANGE_REVIEWED',
      actorAccountId: staff.accountId,
      method: 'MANUAL',
      result: 'ALLOWED',
      resourceType: 'source_change_candidate',
      resourceId: row.id,
      metadata: { decision: input.decision, withNote: note.length > 0 },
    });
    return ok({ id: row.id, status: input.decision });
  });
}

// --- The check ----------------------------------------------------------------------------------

export interface SourceCheckCounts {
  readonly sourcesDue: number;
  readonly checked: number;
  readonly changed: number;
  readonly blocked: number;
  readonly failed: number;
  readonly unsupported: number;
  readonly deferred: number;
}

export interface SourceCheckSummary extends SourceCheckCounts {
  /**
   * NOT_ALLOWED: the scope was not the Saturday job or a fresh pack management scope.
   * NOT_READY: migration 0115 has not run. ALREADY_DONE: this week's run (or this manual run)
   * already finished. IN_PROGRESS: another call is running it now. COMPLETED: every due source was
   * tried. PARTIAL: the time budget ran out; the rest are counted as deferred and a later call in
   * the same week picks them up.
   */
  readonly status:
    | 'NOT_ALLOWED'
    | 'NOT_READY'
    | 'ALREADY_DONE'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'PARTIAL';
}

export interface RunSourceCheckOptions {
  readonly fetcher: SourceFetcher;
  readonly now: Date;
  /** Check Now only (a pack management scope): check this one source now, an urgent recheck. */
  readonly sourceId?: string;
  readonly budgetMs?: number;
  readonly fetchTimeoutMs?: number;
  /** Milliseconds, for the time budget only. */
  readonly clock?: () => number;
}

/** The run as this call makes it: scheduled for the job scope, manual for a person. */
interface RunContext extends RunSourceCheckOptions {
  readonly trigger: SourceCheckTrigger;
  readonly actorAccountId: string | null;
}

const ZERO: SourceCheckCounts = {
  sourcesDue: 0,
  checked: 0,
  changed: 0,
  blocked: 0,
  failed: 0,
  unsupported: 0,
  deferred: 0,
};

function runKeyFor(options: RunContext): string {
  if (options.trigger === 'SCHEDULED') return `scheduled:${dhakaWeekKey(options.now)}`;
  const minute = options.now.toISOString().slice(0, 16);
  return `manual:${minute}:${options.sourceId ?? 'all'}`;
}

function countsOf(run: typeof schema.sourceCheckRuns.$inferSelect): SourceCheckCounts {
  return {
    sourcesDue: run.sourcesDue,
    checked: run.checked,
    changed: run.changed,
    blocked: run.blocked,
    failed: run.failed,
    unsupported: run.unsupported,
    deferred: run.deferred,
  };
}

function bucketOf(outcome: SourceFetchOutcome): 'checked' | 'blocked' | 'unsupported' | 'failed' {
  if (outcome === 'FETCHED' || outcome === 'NOT_MODIFIED') return 'checked';
  if (outcome === 'BLOCKED') return 'blocked';
  if (outcome === 'UNSUPPORTED_FORMAT') return 'unsupported';
  return 'failed';
}

/** Claims the run for this call: a new row, or an unfinished one nobody has touched lately. */
async function claimRun(
  db: Db,
  runKey: string,
  options: RunContext,
): Promise<
  | { readonly kind: 'claimed'; readonly runId: string; readonly fresh: boolean }
  | { readonly kind: 'done'; readonly counts: SourceCheckCounts }
  | { readonly kind: 'busy'; readonly counts: SourceCheckCounts }
> {
  const r = schema.sourceCheckRuns;
  const created = first(
    await db
      .insert(r)
      .values({ runKey, trigger: options.trigger, startedAt: options.now })
      .onConflictDoNothing({ target: r.runKey })
      .returning({ id: r.id }),
  );
  if (created) return { kind: 'claimed', runId: created.id, fresh: true };
  const existing = first(await db.select().from(r).where(eq(r.runKey, runKey)).limit(1));
  if (!existing) throw new Error('source check run vanished while being claimed');
  if (existing.finishedAt !== null) return { kind: 'done', counts: countsOf(existing) };
  const reclaimed = first(
    await db
      .update(r)
      .set({ startedAt: options.now })
      .where(
        and(
          eq(r.id, existing.id),
          isNull(r.finishedAt),
          lt(r.startedAt, new Date(options.now.getTime() - RUN_STALE_MS)),
        ),
      )
      .returning({ id: r.id }),
  );
  if (!reclaimed) return { kind: 'busy', counts: countsOf(existing) };
  return { kind: 'claimed', runId: reclaimed.id, fresh: false };
}

interface DueSource {
  readonly id: string;
  readonly url: string;
}

async function dueSources(
  db: Db,
  runId: string,
  sourceId: string | undefined,
): Promise<{ readonly all: readonly DueSource[]; readonly pending: readonly DueSource[] }> {
  const s = schema.officialSources;
  const conditions = [eq(s.active, true)];
  if (sourceId !== undefined) conditions.push(eq(s.id, sourceId));
  const all = await db
    .select({ id: s.id, url: s.url })
    .from(s)
    .where(and(...conditions))
    .orderBy(asc(s.createdAt), asc(s.id))
    .limit(SOURCE_CHECK_MAX_SOURCES);
  if (all.length === 0) return { all, pending: [] };
  const done = await db
    .select({ sourceId: schema.sourceObservations.sourceId })
    .from(schema.sourceObservations)
    .where(eq(schema.sourceObservations.runId, runId));
  const seen = new Set(done.map((row) => row.sourceId));
  return { all, pending: all.filter((source) => !seen.has(source.id)) };
}

/** The last successful fetch of a source outside this run: the baseline and the conditional keys. */
async function previousObservations(db: Db, sourceId: string, runId: string) {
  const o = schema.sourceObservations;
  const fetched = first(
    await db
      .select()
      .from(o)
      .where(and(eq(o.sourceId, sourceId), ne(o.runId, runId), eq(o.outcome, 'FETCHED')))
      .orderBy(desc(o.fetchedAt))
      .limit(1),
  );
  const conditional = first(
    await db
      .select({ etag: o.etag, lastModified: o.lastModified })
      .from(o)
      .where(
        and(
          eq(o.sourceId, sourceId),
          ne(o.runId, runId),
          inArray(o.outcome, ['FETCHED', 'NOT_MODIFIED']),
        ),
      )
      .orderBy(desc(o.fetchedAt))
      .limit(1),
  );
  return { fetched, conditional };
}

async function checkOne(
  db: Db,
  source: DueSource,
  runId: string,
  options: RunContext,
): Promise<void> {
  const { fetched: previous, conditional } = await previousObservations(db, source.id, runId);
  let result: SourceFetchResult;
  try {
    result = await options.fetcher({
      url: source.url,
      etag: conditional?.etag ?? null,
      lastModified: conditional?.lastModified ?? null,
    });
  } catch {
    result = { outcome: 'ERROR', httpStatus: null, etag: null, lastModified: null, body: null };
  }
  const normalized =
    result.outcome === 'FETCHED' && result.body !== null
      ? normalizeSourceText(result.body.text, result.body.kind)
      : null;
  const normalizedSha256 = normalized === null ? null : sha256(normalized);
  // A page that answered with no readable words is recorded honestly, not as a checked page.
  const outcome: SourceFetchOutcome =
    result.outcome === 'FETCHED' && (normalized === null || normalized.length === 0)
      ? 'UNSUPPORTED_FORMAT'
      : result.outcome;

  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const o = schema.sourceObservations;
    const observation = first(
      await t
        .insert(o)
        .values({
          sourceId: source.id,
          runId,
          fetchedAt: options.now,
          httpStatus: result.httpStatus,
          outcome,
          etag: result.etag,
          lastModified: result.lastModified,
          contentSha256: outcome === 'FETCHED' ? (result.body?.sha256 ?? null) : null,
          normalizedSha256: outcome === 'FETCHED' ? normalizedSha256 : null,
          byteLength: result.body?.byteLength ?? null,
          excerpt:
            outcome === 'FETCHED' ? (normalized?.slice(0, SOURCE_EXCERPT_MAX) ?? null) : null,
        })
        .onConflictDoNothing({ target: [o.sourceId, o.runId] })
        .returning({ id: o.id }),
    );
    if (!observation || outcome !== 'FETCHED' || normalized === null || normalizedSha256 === null) {
      return;
    }
    // The first successful fetch is the baseline: there is nothing to compare it with.
    if (!previous || previous.normalizedSha256 === normalizedSha256) return;
    const excerpts = changeExcerpts(previous.excerpt, normalized);
    await t
      .insert(schema.sourceChangeCandidates)
      .values({
        sourceId: source.id,
        observationId: observation.id,
        previousObservationId: previous.id,
        normalizedSha256,
        oldExcerpt: excerpts.oldExcerpt,
        newExcerpt: excerpts.newExcerpt,
      })
      .onConflictDoNothing({
        target: [
          schema.sourceChangeCandidates.sourceId,
          schema.sourceChangeCandidates.normalizedSha256,
        ],
      });
  });
}

/** Counts for a run, read back from its own rows so a resumed run is counted once. */
async function tallyRun(
  db: Db,
  runId: string,
): Promise<Omit<SourceCheckCounts, 'sourcesDue' | 'deferred'>> {
  const o = schema.sourceObservations;
  const rows = await db
    .select({ outcome: o.outcome, n: count() })
    .from(o)
    .where(eq(o.runId, runId))
    .groupBy(o.outcome);
  const tally = { checked: 0, blocked: 0, failed: 0, unsupported: 0 };
  for (const row of rows) tally[bucketOf(row.outcome as SourceFetchOutcome)] += Number(row.n);
  const changed = first(
    await db
      .select({ n: count() })
      .from(schema.sourceChangeCandidates)
      .innerJoin(o, eq(o.id, schema.sourceChangeCandidates.observationId))
      .where(eq(o.runId, runId)),
  );
  return { ...tally, changed: Number(changed?.n ?? 0) };
}

/**
 * Runs the source check once. Scheduled runs are keyed by the Asia/Dhaka week, so a retry or a
 * late start in the same week never runs twice and never duplicates a candidate; an interrupted
 * run is picked up where it stopped. At most 40 sources, 2 at a time, each under the fetcher's
 * 8 s deadline, and no new fetch starts unless it can finish inside the time budget. Writes only
 * the four monitoring tables and one audit record with counts.
 *
 * The Saturday job runs it under its own job scope (a scheduled run); Check Now runs it under the
 * pressing person's fresh pack management scope (a manual run, which may name one source).
 */
export async function runSourceCheck(
  db: Db,
  scope: SystemScope<'process-source-check'> | StaffScope<'PACK_MANAGE'>,
  runOptions: RunSourceCheckOptions,
): Promise<SourceCheckSummary> {
  let options: RunContext;
  if (SystemScope.isGenuine(scope) && scope.job === 'process-source-check') {
    // The scheduled run checks every active source; one-source checks are a person's Check Now.
    const { sourceId: _ignored, ...scheduled } = runOptions;
    options = { ...scheduled, trigger: 'SCHEDULED', actorAccountId: null };
  } else if (staffScopeProblem(scope, 'PACK_MANAGE') === undefined) {
    options = {
      ...runOptions,
      trigger: 'MANUAL',
      actorAccountId: (scope as StaffScope<'PACK_MANAGE'>).accountId,
    };
  } else {
    return { status: 'NOT_ALLOWED', ...ZERO };
  }
  if (!(await sourceMonitorReady(db))) return { status: 'NOT_READY', ...ZERO };
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const budgetMs = options.budgetMs ?? SOURCE_CHECK_BUDGET_MS;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? SOURCE_FETCH_TIMEOUT_MS;
  const runKey = runKeyFor(options);

  const claim = await claimRun(db, runKey, options);
  if (claim.kind === 'done') return { status: 'ALREADY_DONE', ...claim.counts };
  if (claim.kind === 'busy') return { status: 'IN_PROGRESS', ...claim.counts };
  const { runId } = claim;

  const { all, pending } = await dueSources(db, runId, options.sourceId);
  const queue = [...pending];
  let deferred = 0;
  const worker = async () => {
    for (;;) {
      const source = queue.shift();
      if (source === undefined) return;
      // Never start a fetch that could run past the budget: the rest wait for a later call.
      if (clock() - startedAt + fetchTimeoutMs + 2000 > budgetMs) {
        deferred += 1;
        continue;
      }
      await checkOne(db, source, runId, options);
    }
  };
  await Promise.all(Array.from({ length: SOURCE_CHECK_CONCURRENCY }, worker));

  const tally = await tallyRun(db, runId);
  const counts: SourceCheckCounts = { sourcesDue: all.length, ...tally, deferred };
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t
      .update(schema.sourceCheckRuns)
      .set({
        ...counts,
        finishedAt: deferred > 0 ? null : new Date(options.now.getTime() + (clock() - startedAt)),
      })
      .where(eq(schema.sourceCheckRuns.id, runId));
    await appendAuditEvent(t, {
      eventType: 'SOURCE_CHECK_RUN',
      actorAccountId: options.actorAccountId,
      method: options.trigger === 'MANUAL' ? 'MANUAL' : 'SYSTEM',
      result: 'ALLOWED',
      resourceType: 'source_check_run',
      resourceId: runId,
      metadata: { trigger: options.trigger, resumed: !claim.fresh, ...counts },
    });
  });
  return { status: deferred > 0 ? 'PARTIAL' : 'COMPLETED', ...counts };
}

// --- Reading for the admin page -----------------------------------------------------------------

export interface OfficialSourceView {
  readonly id: string;
  readonly jurisdiction: string;
  readonly route: string | null;
  readonly purpose: string | null;
  readonly url: string;
  readonly title: string;
  readonly publisher: string;
  readonly authorityTier: SourceAuthorityTier;
  readonly packId: string | null;
  readonly packName: string | null;
  readonly active: boolean;
  /** The last time the page answered (read, or confirmed unchanged). Not a verification. */
  readonly lastFetchedAt: Date | null;
  /** The outcome of the latest attempt, whatever it was. */
  readonly lastOutcome: SourceFetchOutcome | null;
  readonly lastAttemptAt: Date | null;
  /**
   * The latest date a person recorded checking this page on an approved or published version of the
   * linked pack (its requirements' observed date, for this exact address). Null: not verified yet.
   */
  readonly lastVerifiedAt: Date | null;
}

export interface SourceChangeCandidateView {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceTitle: string;
  readonly sourceUrl: string;
  readonly jurisdiction: string;
  readonly packId: string | null;
  readonly status: SourceCandidateStatus;
  readonly oldExcerpt: string | null;
  readonly newExcerpt: string | null;
  readonly detectedAt: Date;
}

export interface SourceCheckRunView extends SourceCheckCounts {
  readonly trigger: SourceCheckTrigger;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
}

export interface SourceMonitorOverview {
  readonly ready: boolean;
  readonly sources: readonly OfficialSourceView[];
  /** Changes waiting for a person (New and In Review), newest first. */
  readonly openCandidates: readonly SourceChangeCandidateView[];
  /** How many detected changes a person has decided (dismissed or accepted). */
  readonly reviewedCount: number;
  readonly lastRun: SourceCheckRunView | null;
}

const OVERVIEW_SOURCES_MAX = 200;
const OVERVIEW_CANDIDATES_MAX = 50;

/** Everything the Official Sources page shows, in a few queries. Never throws before 0115. */
export async function sourceMonitorOverview(db: Db): Promise<SourceMonitorOverview> {
  const empty: SourceMonitorOverview = {
    ready: false,
    sources: [],
    openCandidates: [],
    reviewedCount: 0,
    lastRun: null,
  };
  if (!(await sourceMonitorReady(db))) return empty;
  const s = schema.officialSources;
  const o = schema.sourceObservations;
  const c = schema.sourceChangeCandidates;

  const sources = await db
    .select({ source: s, packName: schema.packs.name })
    .from(s)
    .leftJoin(schema.packs, eq(schema.packs.id, s.packId))
    .orderBy(desc(s.active), asc(s.jurisdiction), asc(s.title))
    .limit(OVERVIEW_SOURCES_MAX);
  const ids = sources.map((row) => row.source.id);

  const lastFetched = new Map<string, Date>();
  const lastAttempt = new Map<string, { at: Date; outcome: SourceFetchOutcome }>();
  const verified = new Map<string, Date>();
  if (ids.length > 0) {
    for (const row of await db
      .select({ sourceId: o.sourceId, at: max(o.fetchedAt) })
      .from(o)
      .where(and(inArray(o.sourceId, ids), inArray(o.outcome, ['FETCHED', 'NOT_MODIFIED'])))
      .groupBy(o.sourceId)) {
      if (row.at) lastFetched.set(row.sourceId, row.at);
    }
    for (const row of await db
      .selectDistinctOn([o.sourceId], { sourceId: o.sourceId, at: o.fetchedAt, outcome: o.outcome })
      .from(o)
      .where(inArray(o.sourceId, ids))
      .orderBy(o.sourceId, desc(o.fetchedAt))) {
      lastAttempt.set(row.sourceId, { at: row.at, outcome: row.outcome as SourceFetchOutcome });
    }
    const linked = sources.filter((row) => row.source.packId !== null);
    if (linked.length > 0) {
      const pr = schema.packRequirements;
      const pv = schema.packVersions;
      const verifiedRows = await db
        .select({ packId: pv.packId, url: pr.sourceUrl, at: max(pr.observedDate) })
        .from(pr)
        .innerJoin(pv, eq(pv.id, pr.packVersionId))
        .where(
          and(
            inArray(
              pv.packId,
              linked.map((row) => row.source.packId as string),
            ),
            inArray(pv.status, ['APPROVED', 'PUBLISHED']),
            inArray(
              pr.sourceUrl,
              linked.map((row) => row.source.url),
            ),
          ),
        )
        .groupBy(pv.packId, pr.sourceUrl);
      for (const row of verifiedRows) {
        if (row.at && row.url) verified.set(`${row.packId} ${row.url}`, row.at);
      }
    }
  }

  const open = await db
    .select({ candidate: c, source: s })
    .from(c)
    .innerJoin(s, eq(s.id, c.sourceId))
    .where(inArray(c.status, ['NEW', 'IN_REVIEW']))
    .orderBy(desc(c.createdAt))
    .limit(OVERVIEW_CANDIDATES_MAX);
  const reviewed = first(
    await db
      .select({ n: count() })
      .from(c)
      .where(inArray(c.status, ['DISMISSED', 'ACCEPTED_FOR_DRAFT'])),
  );
  const lastRun = first(
    await db
      .select()
      .from(schema.sourceCheckRuns)
      .orderBy(desc(schema.sourceCheckRuns.startedAt))
      .limit(1),
  );

  return {
    ready: true,
    sources: sources.map(({ source, packName }) => ({
      id: source.id,
      jurisdiction: source.jurisdiction,
      route: source.route,
      purpose: source.purpose,
      url: source.url,
      title: source.title,
      publisher: source.publisher,
      authorityTier: source.authorityTier as SourceAuthorityTier,
      packId: source.packId,
      packName: packName ?? null,
      active: source.active,
      lastFetchedAt: lastFetched.get(source.id) ?? null,
      lastOutcome: lastAttempt.get(source.id)?.outcome ?? null,
      lastAttemptAt: lastAttempt.get(source.id)?.at ?? null,
      lastVerifiedAt:
        source.packId === null ? null : (verified.get(`${source.packId} ${source.url}`) ?? null),
    })),
    openCandidates: open.map(({ candidate, source }) => ({
      id: candidate.id,
      sourceId: source.id,
      sourceTitle: source.title,
      sourceUrl: source.url,
      jurisdiction: source.jurisdiction,
      packId: source.packId,
      status: candidate.status as SourceCandidateStatus,
      oldExcerpt: candidate.oldExcerpt,
      newExcerpt: candidate.newExcerpt,
      detectedAt: candidate.createdAt,
    })),
    reviewedCount: Number(reviewed?.n ?? 0),
    lastRun: lastRun
      ? {
          ...countsOf(lastRun),
          trigger: lastRun.trigger as SourceCheckTrigger,
          startedAt: lastRun.startedAt,
          finishedAt: lastRun.finishedAt,
        }
      : null,
  };
}
