import { createHash } from 'node:crypto';
import { type Result, err, ok } from '@visastack/core';
import { and, asc, count, desc, eq, inArray, isNull, lt, max, ne, sql } from 'drizzle-orm';
import { type StaffScope, SystemScope, staffScopeProblem } from './access/principal';
import { appendAuditEvent } from './audit';
import { type Db, first, isUniqueViolation, schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { isUuid } from './lifecycle/foundation/ids';
import { cacheOwner, connectionKey } from './plans-schema';
import { RATE_LIMITS, checkRateLimits } from './rate-limit';
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
  if (packId.length > 0 && !isUuid(packId)) {
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
  if (!isUuid(input.sourceId)) return err(serviceError('not_found', 'Source not found.'));
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
  if (!isUuid(input.candidateId)) {
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
  /** Active sources in this run's scope (every active source, or the one Check Now named). */
  readonly sourcesDue: number;
  /** Read, or confirmed unchanged by the site (304). */
  readonly checked: number;
  /** Detected changes waiting for a person, made in this run. */
  readonly changed: number;
  readonly blocked: number;
  /** Timed out, redirect refused, too large or another error. */
  readonly failed: number;
  readonly unsupported: number;
  /** Active sources not tried in this run yet: left for the next run. */
  readonly deferred: number;
}

export interface SourceCheckSummary extends SourceCheckCounts {
  /**
   * NOT_ALLOWED: the scope was not the source check job or a fresh pack management scope.
   * NOT_READY: migration 0115 has not run. INVALID_SOURCE: Check Now named something that is not
   * a source id. RATE_LIMITED: too many Check Now runs this hour. NOT_DUE: the daily call on a
   * day other than Saturday found no unfinished run this week, so it did nothing. ALREADY_DONE:
   * this week's run (or this manual run) already finished. IN_PROGRESS: another call is running
   * it now. COMPLETED: every active source was tried in this run. PARTIAL: some are left (the
   * per-call cap or the time budget); `deferred` says how many, and the next daily call in the
   * same week tries them first.
   */
  readonly status:
    | 'NOT_ALLOWED'
    | 'NOT_READY'
    | 'INVALID_SOURCE'
    | 'RATE_LIMITED'
    | 'NOT_DUE'
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

/** Every manual run together is also bounded, whoever starts it. */
const ALL_MANUAL_RUNS_SUBJECT = 'platform';

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

async function findRun(db: Db, runKey: string) {
  const r = schema.sourceCheckRuns;
  return first(await db.select().from(r).where(eq(r.runKey, runKey)).limit(1));
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
  const existing = await findRun(db, runKey);
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

function inScope(sourceId: string | undefined) {
  const s = schema.officialSources;
  return sourceId === undefined ? eq(s.active, true) : and(eq(s.active, true), eq(s.id, sourceId));
}

function notTriedIn(runId: string) {
  const s = schema.officialSources;
  const o = schema.sourceObservations;
  return sql`not exists (select 1 from ${o} where ${o.sourceId} = ${s.id} and ${o.runId} = ${runId})`;
}

/**
 * The active sources this run has not tried yet, at most SOURCE_CHECK_MAX_SOURCES, least recently
 * tried first (never tried at all before anything else), so what one call leaves the next call
 * takes first.
 */
async function dueSources(
  db: Db,
  runId: string,
  sourceId: string | undefined,
): Promise<readonly DueSource[]> {
  const s = schema.officialSources;
  const o = schema.sourceObservations;
  const last = db
    .select({ sourceId: o.sourceId, at: max(o.fetchedAt).as('last_at') })
    .from(o)
    .groupBy(o.sourceId)
    .as('last_observation');
  return db
    .select({ id: s.id, url: s.url })
    .from(s)
    .leftJoin(last, eq(last.sourceId, s.id))
    .where(and(inScope(sourceId), notTriedIn(runId)))
    .orderBy(sql`${last.at} asc nulls first`, asc(s.createdAt), asc(s.id))
    .limit(SOURCE_CHECK_MAX_SOURCES);
}

/** Active sources in scope, and how many of them this run has not tried yet. */
async function scopeCounts(
  db: Db,
  runId: string,
  sourceId: string | undefined,
): Promise<{ readonly total: number; readonly remaining: number }> {
  const s = schema.officialSources;
  const row = first(
    await db
      .select({
        total: count(),
        remaining: sql<number>`count(*) filter (where ${notTriedIn(runId)})`,
      })
      .from(s)
      .where(inScope(sourceId)),
  );
  return { total: Number(row?.total ?? 0), remaining: Number(row?.remaining ?? 0) };
}

/**
 * In one query, the source's latest FETCHED observation outside this run (the baseline a change is
 * measured against) and its latest NOT_MODIFIED one; the newer of the two gives the conditional
 * request its tags.
 */
async function previousObservations(db: Db, sourceId: string, runId: string) {
  const o = schema.sourceObservations;
  const isFetched = sql`${o.outcome} = 'FETCHED'`;
  const rows = await db
    .selectDistinctOn([isFetched])
    .from(o)
    .where(
      and(
        eq(o.sourceId, sourceId),
        ne(o.runId, runId),
        inArray(o.outcome, ['FETCHED', 'NOT_MODIFIED']),
      ),
    )
    .orderBy(isFetched, desc(o.fetchedAt));
  const fetched = rows.find((row) => row.outcome === 'FETCHED');
  const conditional = [...rows].sort((a, b) => b.fetchedAt.getTime() - a.fetchedAt.getTime())[0];
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
    // The first successful fetch is the baseline: there is nothing to compare it with. After that,
    // every difference from the previous successful fetch is a change, even back to older text.
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
      .onConflictDoNothing({ target: schema.sourceChangeCandidates.observationId });
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
 * Runs the source check once.
 *
 * The job calls it every day at 03:00 UTC (09:00 in Dhaka) under its own job scope. Scheduled runs
 * are keyed by the Asia/Dhaka week that starts on Saturday: on a Dhaka Saturday the call starts the
 * week's run; on any other day it only carries on with that week's run when it is unfinished, and
 * otherwise does nothing without touching a source. So a retry or a late start never runs twice
 * and never duplicates a candidate, and what one call could not reach the next call finishes.
 *
 * Check Now runs it under the pressing person's fresh pack management scope (a manual run, which
 * may name one source), at most 6 an hour per person and 20 an hour in all.
 *
 * Each call tries at most 40 sources, least recently tried first, 2 at a time, each under the
 * fetcher's 8 s deadline, and starts no fetch that could not finish inside the time budget. Writes
 * only the four monitoring tables, rate-limit counters and one audit record with counts.
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
  if (options.sourceId !== undefined && !isUuid(options.sourceId)) {
    return { status: 'INVALID_SOURCE', ...ZERO };
  }
  if (!(await sourceMonitorReady(db))) return { status: 'NOT_READY', ...ZERO };
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const budgetMs = options.budgetMs ?? SOURCE_CHECK_BUDGET_MS;
  const fetchTimeoutMs = options.fetchTimeoutMs ?? SOURCE_FETCH_TIMEOUT_MS;
  const runKey = runKeyFor(options);

  if (options.trigger === 'SCHEDULED' && !isSaturdayInDhaka(options.now)) {
    // Not Saturday: only finish this week's run, never start one.
    const existing = await findRun(db, runKey);
    if (!existing) return { status: 'NOT_DUE', ...ZERO };
    if (existing.finishedAt !== null) return { status: 'ALREADY_DONE', ...countsOf(existing) };
  }
  if (options.trigger === 'MANUAL' && options.actorAccountId !== null) {
    const limited = await checkRateLimits(
      db,
      [
        {
          input: {
            subjectId: options.actorAccountId,
            action: 'source_check.manual',
            label: 'source check',
          },
          config: RATE_LIMITS.SOURCE_CHECK_MANUAL,
        },
        {
          input: {
            subjectId: ALL_MANUAL_RUNS_SUBJECT,
            action: 'source_check.manual_all',
            label: 'source check',
          },
          config: RATE_LIMITS.SOURCE_CHECK_MANUAL_ALL,
        },
      ],
      options.now,
    );
    if (!limited.allowed) return { status: 'RATE_LIMITED', ...ZERO };
  }

  const claim = await claimRun(db, runKey, options);
  if (claim.kind === 'done') return { status: 'ALREADY_DONE', ...claim.counts };
  if (claim.kind === 'busy') return { status: 'IN_PROGRESS', ...claim.counts };
  const { runId } = claim;

  const queue = [...(await dueSources(db, runId, options.sourceId))];
  const worker = async () => {
    for (;;) {
      // Never start a fetch that could run past the budget: the rest wait for a later call.
      if (clock() - startedAt + fetchTimeoutMs + 2000 > budgetMs) return;
      const source = queue.shift();
      if (source === undefined) return;
      await checkOne(db, source, runId, options);
    }
  };
  await Promise.all(Array.from({ length: SOURCE_CHECK_CONCURRENCY }, worker));

  const tally = await tallyRun(db, runId);
  const { total, remaining } = await scopeCounts(db, runId, options.sourceId);
  const counts: SourceCheckCounts = { sourcesDue: total, ...tally, deferred: remaining };
  await db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t
      .update(schema.sourceCheckRuns)
      .set({
        ...counts,
        finishedAt: remaining > 0 ? null : new Date(options.now.getTime() + (clock() - startedAt)),
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
  return { status: remaining > 0 ? 'PARTIAL' : 'COMPLETED', ...counts };
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
  /** The latest scheduled (weekly) run, and the latest Check Now, shown apart. */
  readonly lastScheduledRun: SourceCheckRunView | null;
  readonly lastManualRun: SourceCheckRunView | null;
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
    lastScheduledRun: null,
    lastManualRun: null,
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
  const runs = schema.sourceCheckRuns;
  const latestRuns = await db
    .selectDistinctOn([runs.trigger])
    .from(runs)
    .orderBy(runs.trigger, desc(runs.startedAt));
  const runView = (trigger: SourceCheckTrigger): SourceCheckRunView | null => {
    const run = latestRuns.find((row) => row.trigger === trigger);
    return run
      ? { ...countsOf(run), trigger, startedAt: run.startedAt, finishedAt: run.finishedAt }
      : null;
  };

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
    lastScheduledRun: runView('SCHEDULED'),
    lastManualRun: runView('MANUAL'),
  };
}

// --- UMPE G2 (R08): when each cited source was last checked --------------------------------------

/** Fetch outcomes that mean the page was actually read (changed or not). */
const CHECKED_OUTCOMES = ['FETCHED', 'NOT_MODIFIED'];

/**
 * The last time each of these source addresses was read by the source check, by address. Only a
 * read that reached the page counts (a blocked or failed fetch is not a check). An address that is
 * not registered, never read, or read before the tables exist is absent. Public catalogue data
 * only: no person, request or document is read.
 */
export async function latestSourceChecks(
  db: Db,
  urls: readonly string[],
): Promise<Map<string, Date>> {
  const wanted = [...new Set(urls.filter((url) => url.length > 0))].slice(0, 200);
  if (wanted.length === 0 || !(await sourceMonitorReady(db))) return new Map();
  const rows = await db
    .select({
      url: schema.officialSources.url,
      checkedAt: max(schema.sourceObservations.fetchedAt),
    })
    .from(schema.sourceObservations)
    .innerJoin(
      schema.officialSources,
      eq(schema.officialSources.id, schema.sourceObservations.sourceId),
    )
    .where(
      and(
        inArray(schema.officialSources.url, wanted),
        inArray(schema.sourceObservations.outcome, CHECKED_OUTCOMES),
      ),
    )
    .groupBy(schema.officialSources.url);
  const checks = new Map<string, Date>();
  for (const row of rows) {
    if (row.checkedAt) checks.set(row.url, new Date(row.checkedAt));
  }
  return checks;
}
