import { isErr, isOk } from '@visastack/core';
import { schema } from '@visastack/db';
import { createMigratedPglite } from '@visastack/db/testing';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeEach, describe, expect, it } from 'vitest';
import { staffPrincipal } from './access/principal';
import { systemScopeForTest } from './access/system-scope.test-support';
import { provisionAccount } from './accounts';
import type { Db } from './db';
import {
  addPackVersion,
  addRequirement,
  approvePackVersion,
  createPack,
  publishPackVersion,
  verifyPackChecksum,
} from './packs';
import { grantPlatformRole } from './platform-roles';
import { createSourceFetcher } from './source-fetch';
import {
  SOURCE_CHECK_MAX_SOURCES,
  changeExcerpts,
  deactivateOfficialSource,
  dhakaWeekKey,
  isSaturdayInDhaka,
  normalizeSourceText,
  registerOfficialSource,
  reviewSourceChangeCandidate,
  runSourceCheck,
  sourceMonitorOverview,
  sourceMonitorReady,
} from './source-monitor';

/**
 * The Saturday official-source check against a real (in-memory) database and a fake network. All
 * pages, hosts and dates are synthetic.
 */

const TEST_TIMEOUT_MS = 60_000;
/** Saturday 7 Nov 2026, 03:00 UTC = 09:00 in Dhaka: the scheduled time. */
const SAT_1 = new Date('2026-11-07T03:00:00Z');
const SAT_2 = new Date('2026-11-14T03:00:00Z');
const SAT_3 = new Date('2026-11-21T03:00:00Z');
const SAT_4 = new Date('2026-11-28T03:00:00Z');

async function freshDb(): Promise<Db> {
  const client = await createMigratedPglite();
  return drizzle(client, { schema }) as unknown as Db;
}

const emails = new Map<string, string>();
const JOB = systemScopeForTest('process-source-check');

/** A synthetic account holding the platform owner role, so it has pack management rights. */
async function account(db: Db, email: string): Promise<string> {
  const p = await provisionAccount(db, { email });
  if (!isOk(p)) throw new Error('provision');
  const granted = await grantPlatformRole(db, {
    actor: { accountId: p.value.id, email, bootstrapEmails: [email] },
    targetAccountId: p.value.id,
    role: 'PLATFORM_OWNER',
    reason: 'synthetic seed',
    stepUpSatisfied: true,
  });
  if (!isOk(granted)) throw new Error('grant');
  emails.set(p.value.id, email);
  return p.value.id;
}

/** A fresh pack management scope for the account, as the admin actions mint one. */
async function packScope(db: Db, accountId: string) {
  const minted = await staffPrincipal(
    db,
    { accountId, email: emails.get(accountId) ?? '', bootstrapEmails: [] },
    'PACK_MANAGE',
  );
  if (!isOk(minted)) throw new Error('scope');
  return minted.value;
}

/** A fake web: each address answers what `pages` says right now. */
interface Page {
  status?: number;
  body?: string;
  type?: string;
  headers?: Record<string, string>;
  hang?: boolean;
}

function fakeWeb() {
  const pages = new Map<string, Page | ((init: RequestInit) => Page)>();
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const entry = pages.get(String(input));
    const page = typeof entry === 'function' ? entry(init ?? {}) : (entry ?? { status: 404 });
    if (page.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    }
    const status = page.status ?? 200;
    const nullBody = status === 304 || (status >= 300 && status < 400);
    return new Response(nullBody ? null : (page.body ?? ''), {
      status,
      headers: { 'content-type': page.type ?? 'text/html', ...(page.headers ?? {}) },
    });
  };
  const fetcher = createSourceFetcher({
    fetch: fetchImpl as unknown as typeof fetch,
    lookup: async (host) =>
      host === 'private.synthetic-gov.example' ? ['10.1.2.3'] : ['93.184.216.34'],
    timeoutMs: 100,
  });
  return { pages, fetcher };
}

function page(rule: string, extra = ''): string {
  return `<!doctype html><html><head><title>Visit</title><script>var t=${Math.random()}</script></head>
  <body><nav><a href="/">Home</a>${extra}</nav><main><h1>Visit visa</h1><p>${rule}</p></main>
  <footer>Footer ${extra}</footer></body></html>`;
}

async function register(db: Db, actor: string, path: string, packId?: string) {
  const created = await registerOfficialSource(db, await packScope(db, actor), {
    jurisdiction: 'gb',
    route: 'visit',
    url: `https://visas.synthetic-gov.example${path}`,
    title: `Synthetic ${path}`,
    publisher: 'Synthetic Authority',
    authorityTier: 'GOVERNMENT',
    ...(packId ? { packId } : {}),
  });
  if (!isOk(created)) throw new Error(created.error.message);
  return created.value.id;
}

const url = (path: string) => `https://visas.synthetic-gov.example${path}`;

describe('Asia/Dhaka week', () => {
  it('turns at Friday 18:00 UTC, which is Saturday 00:00 in Dhaka', () => {
    expect(dhakaWeekKey(new Date('2026-11-06T17:59:59.999Z'))).toBe('2026-10-31');
    expect(dhakaWeekKey(new Date('2026-11-06T18:00:00.000Z'))).toBe('2026-11-07');
    expect(dhakaWeekKey(SAT_1)).toBe('2026-11-07');
    expect(dhakaWeekKey(new Date('2026-11-13T17:59:59Z'))).toBe('2026-11-07');
    expect(isSaturdayInDhaka(new Date('2026-11-06T17:59:59Z'))).toBe(false);
    expect(isSaturdayInDhaka(new Date('2026-11-06T18:00:00Z'))).toBe(true);
    expect(isSaturdayInDhaka(SAT_1)).toBe(true);
    expect(isSaturdayInDhaka(new Date('2026-11-07T18:00:00Z'))).toBe(false);
    // Across a month and a year end.
    expect(dhakaWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-12-26');
  });
});

describe('normalizeSourceText', () => {
  it('ignores layout, scripts and site furniture but keeps the words of the rule', () => {
    const a = normalizeSourceText(page('You must apply 3 weeks before travel.'), 'html');
    const b = normalizeSourceText(
      page('You  must apply\n   3 weeks before travel.', '<a href="/new">New menu</a>').replace(
        '<p>',
        '<p class="lead">',
      ),
      'html',
    );
    expect(a).toBe(b);
    expect(a).toBe('Visit visa You must apply 3 weeks before travel.');
    expect(normalizeSourceText('<p>Fee &amp; charges&nbsp;&#163;127</p>', 'html')).toBe(
      'Fee & charges £127',
    );
    const c = normalizeSourceText(page('You must apply 4 weeks before travel.'), 'html');
    expect(c).not.toBe(a);
  });

  it('stays linear on hostile input', () => {
    const hostile = `${'<nav'.repeat(50_000)}${'<script'.repeat(50_000)}<!--x`;
    const started = Date.now();
    normalizeSourceText(hostile, 'html');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('shows the earlier and new text around the first difference', () => {
    const before = 'Intro text. You must apply 3 weeks before travel. Outro.';
    const after = 'Intro text. You must apply 4 weeks before travel. Outro.';
    const excerpts = changeExcerpts(before, after);
    expect(excerpts.oldExcerpt).toContain('3 weeks');
    expect(excerpts.newExcerpt).toContain('4 weeks');
  });
});

describe('official-source monitoring', () => {
  let db: Db;
  let admin: string;
  let web: ReturnType<typeof fakeWeb>;
  beforeEach(async () => {
    db = await freshDb();
    admin = await account(db, 'pack-admin@example.com');
    web = fakeWeb();
  });

  const run = async (now: Date, trigger: 'SCHEDULED' | 'MANUAL' = 'SCHEDULED', extra = {}) =>
    runSourceCheck(db, trigger === 'SCHEDULED' ? JOB : await packScope(db, admin), {
      fetcher: web.fetcher,
      now,
      ...extra,
    });

  async function candidates() {
    return db
      .select()
      .from(schema.sourceChangeCandidates)
      .orderBy(asc(schema.sourceChangeCandidates.createdAt));
  }

  it(
    'validates registration and lets a stopped address be registered again',
    async () => {
      const bad = await registerOfficialSource(db, await packScope(db, admin), {
        jurisdiction: 'GB',
        url: 'http://visas.synthetic-gov.example/',
        title: 'x',
        publisher: 'y',
        authorityTier: 'GOVERNMENT',
      });
      expect(isErr(bad)).toBe(true);
      const tier = await registerOfficialSource(db, await packScope(db, admin), {
        jurisdiction: 'GB',
        url: url('/a'),
        title: 'x',
        publisher: 'y',
        authorityTier: 'BLOG',
      });
      expect(isErr(tier)).toBe(true);
      const id = await register(db, admin, '/a');
      const twice = await registerOfficialSource(db, await packScope(db, admin), {
        jurisdiction: 'GB',
        url: url('/a'),
        title: 'x',
        publisher: 'y',
        authorityTier: 'GOVERNMENT',
      });
      expect(isErr(twice) && twice.error.message).toBe('That page is already registered.');
      expect(
        isOk(await deactivateOfficialSource(db, await packScope(db, admin), { sourceId: id })),
      ).toBe(true);
      expect(
        isErr(await deactivateOfficialSource(db, await packScope(db, admin), { sourceId: id })),
      ).toBe(true);
      await register(db, admin, '/a');
      const audit = await db.select().from(schema.auditEvents);
      const kinds = audit.map((e) => e.eventType);
      expect(kinds.filter((k) => k === 'OFFICIAL_SOURCE_REGISTERED')).toHaveLength(2);
      expect(kinds).toContain('OFFICIAL_SOURCE_DEACTIVATED');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'records a first fetch as the baseline and an unchanged page as checked, with no candidate',
    async () => {
      await register(db, admin, '/same');
      web.pages.set(url('/same'), { body: page('Apply 3 weeks before.') });
      const first = await run(SAT_1);
      expect(first).toMatchObject({ status: 'COMPLETED', sourcesDue: 1, checked: 1, changed: 0 });
      const second = await run(SAT_2);
      expect(second).toMatchObject({ status: 'COMPLETED', checked: 1, changed: 0 });
      expect(await candidates()).toHaveLength(0);
      const overview = await sourceMonitorOverview(db);
      expect(overview.sources[0]?.lastFetchedAt?.toISOString()).toBe(SAT_2.toISOString());
      expect(overview.sources[0]?.lastVerifiedAt).toBeNull();
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'sends the stored tags and records 304 as checked and unchanged',
    async () => {
      await register(db, admin, '/tagged');
      web.pages.set(url('/tagged'), { body: page('Rule A'), headers: { etag: '"a"' } });
      await run(SAT_1);
      let seen: string | undefined;
      web.pages.set(url('/tagged'), (init) => {
        seen = (init.headers as Record<string, string>)['if-none-match'];
        return { status: 304 };
      });
      const result = await run(SAT_2);
      expect(seen).toBe('"a"');
      expect(result).toMatchObject({ checked: 1, changed: 0, failed: 0 });
      const outcomes = await db
        .select({ outcome: schema.sourceObservations.outcome })
        .from(schema.sourceObservations);
      expect(outcomes.map((o) => o.outcome).sort()).toEqual(['FETCHED', 'NOT_MODIFIED']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'creates one candidate for changed rule text, never twice for the same text, and none for layout',
    async () => {
      await register(db, admin, '/rule');
      web.pages.set(url('/rule'), { body: page('You must apply 3 weeks before travel.') });
      await run(SAT_1);

      // Layout only: new menu item, re-indented, different script.
      web.pages.set(url('/rule'), {
        body: page('You must   apply 3 weeks before travel.', '<a href="/x">News</a>'),
      });
      expect(await run(SAT_2)).toMatchObject({ checked: 1, changed: 0 });
      expect(await candidates()).toHaveLength(0);

      // The rule changes.
      web.pages.set(url('/rule'), { body: page('You must apply 4 weeks before travel.') });
      expect(await run(SAT_3)).toMatchObject({ checked: 1, changed: 1 });
      let found = await candidates();
      expect(found).toHaveLength(1);
      expect(found[0]?.status).toBe('NEW');
      expect(found[0]?.oldExcerpt).toContain('3 weeks');
      expect(found[0]?.newExcerpt).toContain('4 weeks');

      // A retry in the same week does nothing: no second run row, no second candidate.
      expect(await run(new Date('2026-11-21T09:30:00Z'))).toMatchObject({ status: 'ALREADY_DONE' });
      const runs = await db.select().from(schema.sourceCheckRuns);
      expect(runs).toHaveLength(3);

      // Back and forth: the old text again is a change; the new text again is the same candidate.
      web.pages.set(url('/rule'), { body: page('You must apply 3 weeks before travel.') });
      expect(await run(SAT_4)).toMatchObject({ changed: 1 });
      web.pages.set(url('/rule'), { body: page('You must apply 4 weeks before travel.') });
      expect(await run(new Date('2026-12-05T03:00:00Z'))).toMatchObject({ changed: 0 });
      found = await candidates();
      expect(found).toHaveLength(2);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'records every unreadable page as an exception, never as checked or changed',
    async () => {
      const cases: Record<string, Page> = {
        '/pdf': { body: '%PDF-1.7', type: 'application/pdf' },
        '/blocked': { status: 403, body: 'denied' },
        '/slow': { hang: true },
        '/away': { status: 302, headers: { location: 'https://elsewhere.example/visit' } },
        '/inward': {
          status: 302,
          headers: { location: 'https://private.synthetic-gov.example/visit' },
        },
        '/huge': { body: 'x'.repeat(600 * 1024) },
      };
      for (const [path, answer] of Object.entries(cases)) {
        await register(db, admin, path);
        web.pages.set(url(path), answer);
      }
      const result = await run(SAT_1);
      expect(result).toMatchObject({
        status: 'COMPLETED',
        sourcesDue: 6,
        checked: 0,
        changed: 0,
        blocked: 1,
        unsupported: 1,
        failed: 4,
      });
      const rows = await db
        .select({ outcome: schema.sourceObservations.outcome })
        .from(schema.sourceObservations);
      expect(rows.map((r) => r.outcome).sort()).toEqual([
        'BLOCKED',
        'REDIRECT_REFUSED',
        'REDIRECT_REFUSED',
        'TIMEOUT',
        'TOO_LARGE',
        'UNSUPPORTED_FORMAT',
      ]);
      const overview = await sourceMonitorOverview(db);
      for (const source of overview.sources) {
        expect(source.lastFetchedAt).toBeNull();
        expect(source.lastOutcome).not.toBe('FETCHED');
      }
      expect(await candidates()).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'keys scheduled runs by the Dhaka week across the Friday 18:00 UTC boundary',
    async () => {
      await register(db, admin, '/w');
      web.pages.set(url('/w'), { body: page('Rule') });
      expect((await run(new Date('2026-11-06T17:59:00Z'))).status).toBe('COMPLETED');
      expect((await run(new Date('2026-11-06T18:00:00Z'))).status).toBe('COMPLETED');
      expect((await run(SAT_1)).status).toBe('ALREADY_DONE');
      const keys = (await db.select().from(schema.sourceCheckRuns)).map((r) => r.runKey).sort();
      expect(keys).toEqual(['scheduled:2026-10-31', 'scheduled:2026-11-07']);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'stops starting fetches when the time budget is spent and picks the rest up later',
    async () => {
      for (const path of ['/b1', '/b2', '/b3']) {
        await register(db, admin, path);
        web.pages.set(url(path), { body: page(path) });
      }
      let now = 0;
      const clock = () => now;
      const partial = await runSourceCheck(db, JOB, {
        fetcher: async (request) => {
          now += 5000;
          return web.fetcher(request);
        },
        now: SAT_1,
        clock,
        budgetMs: 14_000,
        fetchTimeoutMs: 5000,
      });
      expect(partial.status).toBe('PARTIAL');
      expect(partial.checked + partial.deferred).toBe(3);
      expect(partial.deferred).toBeGreaterThan(0);
      // Within two minutes another call sees it busy; later it resumes the same run.
      expect((await run(new Date(SAT_1.getTime() + 60_000))).status).toBe('IN_PROGRESS');
      const resumed = await run(new Date(SAT_1.getTime() + 5 * 60_000));
      expect(resumed).toMatchObject({ status: 'COMPLETED', checked: 3, deferred: 0 });
      expect(await db.select().from(schema.sourceCheckRuns)).toHaveLength(1);
      expect(await db.select().from(schema.sourceObservations)).toHaveLength(3);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'checks at most 40 sources per run, 2 at a time, and says how long it took',
    async () => {
      for (let i = 0; i < SOURCE_CHECK_MAX_SOURCES + 5; i++) {
        await register(db, admin, `/many-${i}`);
        web.pages.set(url(`/many-${i}`), { body: page(`Rule ${i}`) });
      }
      let inFlight = 0;
      let peak = 0;
      const started = Date.now();
      const result = await runSourceCheck(db, JOB, {
        fetcher: async (request) => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          try {
            await new Promise((resolve) => setTimeout(resolve, 5));
            return await web.fetcher(request);
          } finally {
            inFlight -= 1;
          }
        },
        now: SAT_1,
      });
      const elapsed = Date.now() - started;
      expect(result).toMatchObject({ status: 'COMPLETED', sourcesDue: 40, checked: 40 });
      expect(peak).toBe(2);
      // Measured for the hand-back; a faked network, so this is the database and parsing cost.
      console.info(`[source-check] 40 faked sources checked in ${elapsed} ms`);
      expect(elapsed).toBeLessThan(45_000);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'leaves a published pack version byte-identical after a run that found changes',
    async () => {
      const pack = await createPack(db, {
        actorAccountId: admin,
        key: 'gb.visit',
        name: 'GB Visit',
      });
      if (!isOk(pack)) throw new Error('pack');
      const version = await addPackVersion(db, { actorAccountId: admin, packId: pack.value.id });
      if (!isOk(version)) throw new Error('version');
      const req = await addRequirement(db, {
        actorAccountId: admin,
        packVersionId: version.value.id,
        kind: 'FIELD',
        fieldKey: 'passport.number',
        citation: 'Synthetic rule 1',
        sourceUrl: url('/pack-rule'),
        sourceTitle: 'Synthetic Page',
        publisher: 'Synthetic Authority',
        observedDate: new Date('2026-10-01T00:00:00Z'),
      });
      if (!isOk(req)) throw new Error(req.error.message);
      expect(
        isOk(
          await approvePackVersion(db, { actorAccountId: admin, packVersionId: version.value.id }),
        ),
      ).toBe(true);
      expect(
        isOk(
          await publishPackVersion(db, { actorAccountId: admin, packVersionId: version.value.id }),
        ),
      ).toBe(true);

      await register(db, admin, '/pack-rule', pack.value.id);
      const snapshot = async () =>
        JSON.stringify({
          packs: await db.select().from(schema.packs),
          versions: await db.select().from(schema.packVersions),
          requirements: await db.select().from(schema.packRequirements),
        });
      const before = await snapshot();
      expect(await verifyPackChecksum(db, version.value.id)).toBe(true);

      web.pages.set(url('/pack-rule'), { body: page('Old wording.') });
      await run(SAT_1);
      web.pages.set(url('/pack-rule'), { body: page('New wording.') });
      expect((await run(SAT_2)).changed).toBe(1);
      const [candidate] = await candidates();
      if (!candidate) throw new Error('candidate');
      expect(
        isOk(
          await reviewSourceChangeCandidate(db, await packScope(db, admin), {
            candidateId: candidate.id,
            decision: 'ACCEPTED_FOR_DRAFT',
            note: 'Wording changed; draft in Pack Studio.',
          }),
        ),
      ).toBe(true);

      expect(await snapshot()).toBe(before);
      expect(await verifyPackChecksum(db, version.value.id)).toBe(true);

      // Last verified by a person comes from the published requirement's observed date.
      const overview = await sourceMonitorOverview(db);
      const linked = overview.sources.find((s) => s.packId === pack.value.id);
      expect(linked?.lastVerifiedAt?.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(linked?.lastFetchedAt?.toISOString()).toBe(SAT_2.toISOString());
      expect(overview.reviewedCount).toBe(1);
      expect(overview.openCandidates).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'moves a candidate only forward and audits each decision with kinds, not page text',
    async () => {
      await register(db, admin, '/r');
      web.pages.set(url('/r'), { body: page('One.') });
      await run(SAT_1);
      web.pages.set(url('/r'), { body: page('Two.') });
      await run(SAT_2);
      const [candidate] = await candidates();
      if (!candidate) throw new Error('candidate');
      const decide = async (decision: 'IN_REVIEW' | 'DISMISSED' | 'ACCEPTED_FOR_DRAFT') =>
        reviewSourceChangeCandidate(db, await packScope(db, admin), {
          candidateId: candidate.id,
          decision,
        });
      expect(isOk(await decide('IN_REVIEW'))).toBe(true);
      expect(isErr(await decide('IN_REVIEW'))).toBe(true);
      expect(isOk(await decide('DISMISSED'))).toBe(true);
      expect(isErr(await decide('ACCEPTED_FOR_DRAFT'))).toBe(true);
      const audit = await db.select().from(schema.auditEvents);
      const reviews = audit.filter((e) => e.eventType === 'SOURCE_CHANGE_REVIEWED');
      expect(reviews.map((e) => (e.metadata as { decision: string }).decision)).toEqual([
        'IN_REVIEW',
        'DISMISSED',
      ]);
      const runs = audit.filter((e) => e.eventType === 'SOURCE_CHECK_RUN');
      expect(runs).toHaveLength(2);
      expect(JSON.stringify(audit)).not.toContain('Two.');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'checks one source on demand as a manual run',
    async () => {
      const a = await register(db, admin, '/one');
      await register(db, admin, '/two');
      web.pages.set(url('/one'), { body: page('One') });
      web.pages.set(url('/two'), { body: page('Two') });
      const result = await run(SAT_1, 'MANUAL', { sourceId: a });
      expect(result).toMatchObject({ status: 'COMPLETED', sourcesDue: 1, checked: 1 });
      const [row] = await db.select().from(schema.sourceCheckRuns);
      expect(row?.trigger).toBe('MANUAL');
      const audit = await db
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.eventType, 'SOURCE_CHECK_RUN'));
      expect(audit[0]?.actorAccountId).toBe(admin);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses any scope but the Saturday job or a fresh pack management scope',
    async () => {
      await register(db, admin, '/scoped');
      web.pages.set(url('/scoped'), { body: page('Scoped') });
      const options = { fetcher: web.fetcher, now: SAT_1 };
      const otherJob = systemScopeForTest('process-rate-limit-prune');
      const minted = await staffPrincipal(
        db,
        { accountId: admin, email: 'pack-admin@example.com', bootstrapEmails: [] },
        'PLANS_MANAGE',
      );
      if (!isOk(minted)) throw new Error('scope');
      const copy = { ...(await packScope(db, admin)) };
      for (const scope of [otherJob, minted.value, copy]) {
        expect((await runSourceCheck(db, scope as unknown as typeof JOB, options)).status).toBe(
          'NOT_ALLOWED',
        );
      }
      const refused = await registerOfficialSource(
        db,
        minted.value as unknown as Awaited<ReturnType<typeof packScope>>,
        {
          jurisdiction: 'GB',
          url: url('/refused'),
          title: 'Refused',
          publisher: 'Synthetic Authority',
          authorityTier: 'GOVERNMENT',
        },
      );
      expect(isErr(refused) && refused.error.code).toBe('forbidden');
      expect(await db.select().from(schema.sourceCheckRuns)).toHaveLength(0);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('before migration 0115', () => {
  it(
    'reports not ready and never throws',
    async () => {
      const client = await createMigratedPglite();
      await client.exec(
        'drop table source_change_candidates, source_observations, source_check_runs, official_sources cascade',
      );
      const db = drizzle(client, { schema }) as unknown as Db;
      const admin = await account(db, 'early@example.com');
      expect(await sourceMonitorReady(db)).toBe(false);
      const { fetcher } = fakeWeb();
      expect(await runSourceCheck(db, JOB, { fetcher, now: SAT_1 })).toMatchObject({
        status: 'NOT_READY',
        checked: 0,
      });
      expect((await sourceMonitorOverview(db)).ready).toBe(false);
      const registered = await registerOfficialSource(db, await packScope(db, admin), {
        jurisdiction: 'GB',
        url: url('/early'),
        title: 'Early',
        publisher: 'Synthetic Authority',
        authorityTier: 'GOVERNMENT',
      });
      expect(isErr(registered) && registered.error.code).toBe('stale');
    },
    TEST_TIMEOUT_MS,
  );
});
