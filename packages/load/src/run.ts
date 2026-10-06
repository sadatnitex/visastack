/**
 * Capacity and load run. Made-up data only. Refuses to run against anything that is not a local
 * database. Usage (from the repo root):
 *
 *   packages/load/scripts/start-postgres.sh            # prints a local connection string
 *   pnpm --filter @visastack/load load                 # runs everything, prints a summary
 *
 * Environment (all optional): LOAD_DATABASE_URL, LOAD_SECONDS (60), LOAD_SESSIONS (50),
 * LOAD_DOC_WORKERS (5), LOAD_THINK_MS (1000), LOAD_REPORT (path for the JSON report).
 */
import { writeFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import {
  BasicSafetyScanner,
  BuiltinContentLimitsChecker,
  ClamAvScanner,
  DeterministicTextExtractor,
} from '@visastack/adapters';
import { isOk } from '@visastack/core';
import { createPooledDb, schema } from '@visastack/db';
import {
  type Db,
  addDocumentVersion,
  editFact,
  enqueueIntakeJob,
  listApplicantProfile,
  listApplicants,
  listApplicantsForOrganization,
  listDocumentsDetailed,
  listEvidenceRequestsForOrg,
  listEvidenceRequestsForOrgDetailed,
  listMissions,
  listNotificationsForAccount,
  listTasksForOrg,
  listVisibleMissionsForMember,
  registerDocument,
  runIntakeWorker,
} from '@visastack/services';
import { eq, sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/neon-serverless/migrator';
import { type DatasetManifest, LAUNCH_SHAPE, seedDataset } from './dataset';
import { MemoryBlobStore } from './memory-blobs';
import { buildPdf } from './pdf';
import { startBridge, useLocalBridge } from './pg-bridge';
import { busyPercent, hostSummary, readMachineCpu, readProcessesNamed } from './proc';
import { rowsOf } from './rows';
import { Recorder, round, summarise } from './stats';

const env = (name: string, fallback: string): string => {
  const { [name]: value } = process.env;
  return value && value.length > 0 ? value : fallback;
};

const BASE_URL = env('LOAD_DATABASE_URL', 'postgres://postgres@127.0.0.1:5433/postgres');
const SECONDS = Number(env('LOAD_SECONDS', '60'));
const SESSIONS = Number(env('LOAD_SESSIONS', '50'));
const DOC_WORKERS = Number(env('LOAD_DOC_WORKERS', '5'));
const THINK_MS = Number(env('LOAD_THINK_MS', '1000'));
const PDF_PAGES = 10;
const BRIDGE_PORT = 5434;
const RTT_MS = Number(env('LOAD_RTT_MS', '0'));
const PHASES = new Set(env('LOAD_PHASES', 'idle,volume,docs,launch,stress,outage').split(','));

function assertLocal(url: string): void {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`refusing to run the load harness against a non-local database (${host})`);
  }
}

function dbUrl(name: string): string {
  const u = new URL(BASE_URL);
  u.pathname = `/${name}`;
  u.searchParams.set('sslmode', 'disable');
  return u.toString();
}

/** One short-lived connection per request, like the web app: open, work, close. */
async function withDb<T>(name: string, run: (db: Db) => Promise<T>): Promise<T> {
  const { db, pool } = createPooledDb(dbUrl(name));
  try {
    return await run(db as unknown as Db);
  } finally {
    await pool.end();
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const exp = (mean: number) => (mean <= 0 ? 0 : -Math.log(1 - Math.random()) * mean);
const pickOf = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)] as T;

interface ResourceReport {
  readonly harnessRssMaxMb: number;
  readonly harnessHeapMaxMb: number;
  readonly postgresRssMaxMb: number;
  readonly dbConnectionsMax: number;
  readonly dbConnectionsAvg: number;
  readonly eventLoopDelayP99Ms: number;
  readonly harnessCpuSeconds: number;
  readonly machineCpuBusyPercent: number;
}

/** Samples memory, connections and event-loop delay once a second until stopped. */
function startMonitor(dbName: string) {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const connections: number[] = [];
  let rss = 0;
  let heap = 0;
  let pgRss = 0;
  const cpu0 = process.cpuUsage();
  const machine0 = readMachineCpu();
  const monitor = createPooledDb(dbUrl(dbName));
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    rss = Math.max(rss, m.rss);
    heap = Math.max(heap, m.heapUsed);
    pgRss = Math.max(pgRss, readProcessesNamed('postgres').rssBytes);
    void monitor.db
      .execute(sql`select count(*)::int as n from pg_stat_activity where datname = ${dbName}`)
      .then((r) => connections.push((rowsOf<{ n: number }>(r)[0]?.n ?? 1) - 1))
      .catch(() => undefined);
  }, 1000);
  return {
    async stop(): Promise<ResourceReport> {
      clearInterval(timer);
      histogram.disable();
      await monitor.pool.end();
      const cpu = process.cpuUsage(cpu0);
      return {
        harnessRssMaxMb: round(rss / 1048576),
        harnessHeapMaxMb: round(heap / 1048576),
        postgresRssMaxMb: round(pgRss / 1048576),
        dbConnectionsMax: Math.max(0, ...connections),
        dbConnectionsAvg: round(
          connections.reduce((a, b) => a + b, 0) / Math.max(1, connections.length),
        ),
        eventLoopDelayP99Ms: round(histogram.percentile(99) / 1e6),
        harnessCpuSeconds: round((cpu.user + cpu.system) / 1e6),
        machineCpuBusyPercent: busyPercent(machine0, readMachineCpu()),
      };
    },
  };
}

/**
 * The evidence-request list as it was written before this run found it slow: one applicant lookup per
 * request. Kept ONLY so the before and after numbers can be reproduced side by side.
 */
async function legacyEvidenceRequestsDetailed(db: Db, accountId: string, organizationId: string) {
  const listed = await listEvidenceRequestsForOrg(db, accountId, organizationId);
  if (!isOk(listed)) return listed;
  const out: { applicantName: string }[] = [];
  for (const request of listed.value) {
    const rows = await db
      .select({ displayName: schema.applicants.displayName })
      .from(schema.applicants)
      .where(eq(schema.applicants.id, request.applicantId))
      .limit(1);
    out.push({ applicantName: rows[0]?.displayName ?? 'Unknown applicant' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// What each kind of person does (one "page" is what one screen asks the database for)
// ---------------------------------------------------------------------------

function travellerPages(
  m: DatasetManifest,
  rec: Recorder,
): { name: string; weight: number; run: () => Promise<void> }[] {
  const t = () => pickOf(m.travellers);
  const timed =
    (name: string, body: (db: Db, who: ReturnType<typeof t>) => Promise<unknown>) => async () => {
      const who = t();
      await rec.time(`traveller:${name}`, () => withDb('load', (db) => body(db, who)));
    };
  return [
    {
      name: 'home',
      weight: 30,
      run: timed('home', async (db, w) => {
        await listApplicants(db, w.accountId);
        await listNotificationsForAccount(db, w.accountId);
      }),
    },
    {
      name: 'profile',
      weight: 25,
      run: timed('profile', (db, w) => listApplicantProfile(db, w.applicantId)),
    },
    {
      name: 'documents',
      weight: 25,
      run: timed('documents', (db, w) => listDocumentsDetailed(db, w.accountId, w.applicantId)),
    },
    {
      name: 'cases',
      weight: 10,
      run: timed('cases', (db, w) => listMissions(db, w.accountId, w.applicantId)),
    },
    {
      name: 'save-answer',
      weight: 10,
      run: timed('save-answer (audited write)', async (db, w) => {
        const r = await editFact(db, {
          actorAccountId: w.accountId,
          applicantId: w.applicantId,
          fieldKey: pickOf(m.fieldKeys),
          value: `edited-${Math.floor(Math.random() * 1e6)}`,
        });
        if (!isOk(r)) throw new Error(`edit refused: ${JSON.stringify(r.error)}`);
      }),
    },
  ];
}

function staffPages(
  m: DatasetManifest,
  rec: Recorder,
): { name: string; weight: number; run: () => Promise<void> }[] {
  const timed =
    (
      name: string,
      body: (
        db: Db,
        agency: (typeof m.agencies)[number],
        staff: { accountId: string; role: string },
      ) => Promise<unknown>,
    ) =>
    async () => {
      const agency = pickOf(m.agencies);
      const staff = pickOf(agency.staff);
      await rec.time(`staff:${name}`, () => withDb('load', (db) => body(db, agency, staff)));
    };
  return [
    {
      name: 'case-list',
      weight: 35,
      run: timed('case list', (db, a, s) =>
        listVisibleMissionsForMember(db, a.organizationId, s.accountId),
      ),
    },
    {
      name: 'clients',
      weight: 15,
      run: timed('client list', (db, a) => listApplicantsForOrganization(db, a.organizationId)),
    },
    {
      name: 'case',
      weight: 25,
      run: timed('case detail', async (db, a, s) => {
        const view = await listVisibleMissionsForMember(db, a.organizationId, s.accountId);
        const one = view.missions[0];
        if (one) await listTasksForOrg(db, a.organizationId, one.applicantId, one.missionId);
      }),
    },
    {
      name: 'requests',
      weight: 10,
      run: timed('evidence requests (admin)', async (db, a) => {
        const admin = a.staff.find((x) => x.role === 'ADMIN');
        if (admin) await listEvidenceRequestsForOrgDetailed(db, admin.accountId, a.organizationId);
      }),
    },
    {
      name: 'alerts',
      weight: 15,
      run: timed('notifications', (db, _a, s) =>
        listNotificationsForAccount(db, s.accountId, { limit: 50 }),
      ),
    },
  ];
}

function chooser(pages: { weight: number; run: () => Promise<void> }[]) {
  const total = pages.reduce((a, p) => a + p.weight, 0);
  return () => {
    let r = Math.random() * total;
    for (const p of pages) {
      r -= p.weight;
      if (r <= 0) return p;
    }
    return pages[0] as (typeof pages)[number];
  };
}

async function sessions(
  m: DatasetManifest,
  rec: Recorder,
  count: number,
  seconds: number,
  thinkMs: number,
) {
  const tPick = chooser(travellerPages(m, rec));
  const sPick = chooser(staffPages(m, rec));
  const end = Date.now() + seconds * 1000;
  let views = 0;
  await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const traveller = i % 10 < 7; // 70% travellers, 30% agency staff
      await sleep(Math.random() * 1000); // ramp in
      while (Date.now() < end) {
        try {
          await (traveller ? tPick() : sPick()).run();
        } catch {
          // the error is counted by the recorder under its page label
        }
        views++;
        await sleep(exp(thinkMs));
      }
    }),
  );
  return views;
}

// ---------------------------------------------------------------------------
// Document jobs: real safety check, content limits and text extraction on a 10-page PDF
// ---------------------------------------------------------------------------

interface DocJobSetup {
  readonly blobs: MemoryBlobStore;
  readonly scanner: BasicSafetyScanner | ClamAvScanner;
  readonly scannerName: string;
  readonly extractor: DeterministicTextExtractor;
  readonly limits: BuiltinContentLimitsChecker;
}

function docPorts(): DocJobSetup {
  const blobs = new MemoryBlobStore();
  const { CLAMAV_SOCKET_PATH: socketPath } = process.env;
  // The pilot's built-in scanner refuses every PDF by design, so a PDF can only be released with a real scanner.
  const scanner = socketPath
    ? new ClamAvScanner({
        blobStore: blobs,
        socketPath,
        enforceSignatureFreshness: false,
        engineVersion: 'load-run',
      })
    : new BasicSafetyScanner({ blobStore: blobs });
  return {
    blobs,
    scanner,
    scannerName: socketPath ? 'clamav (local clamd)' : 'built-in basic scanner (refuses PDFs)',
    extractor: new DeterministicTextExtractor({ blobStore: blobs }),
    limits: new BuiltinContentLimitsChecker({
      blobStore: blobs,
      config: { maxPdfPages: 50, maxImageMegapixels: 40 },
    }),
  };
}

async function queueDocuments(
  m: DatasetManifest,
  ports: DocJobSetup,
  count: number,
  tag: string,
): Promise<string[]> {
  const owner = m.travellers[0] as (typeof m.travellers)[number];
  const pdf = buildPdf(PDF_PAGES);
  const ids: string[] = [];
  await withDb('load', async (db) => {
    for (let i = 0; i < count; i++) {
      const doc = await registerDocument(db, {
        actorAccountId: owner.accountId,
        applicantId: owner.applicantId,
        originalName: `reference-10-page-${tag}-${i}.pdf`,
      });
      if (!isOk(doc)) throw new Error('register failed');
      const objectKey = `load-docs/${tag}/${i}`;
      await ports.blobs.putObject({
        bucket: 'QUARANTINE',
        objectKey,
        contentType: 'application/pdf',
        bytes: pdf,
      });
      const version = await addDocumentVersion(db, {
        actorAccountId: owner.accountId,
        documentId: doc.value.id,
        bucket: 'QUARANTINE',
        objectKey,
      });
      if (!isOk(version)) throw new Error('version failed');
      await enqueueIntakeJob(db, { documentVersionId: version.value.version.id });
      ids.push(version.value.version.id);
    }
  });
  return ids;
}

async function runDocWorkers(ports: DocJobSetup, rec: Recorder, workers: number, untilMs: number) {
  let processed = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (Date.now() < untilMs) {
        const start = performance.now();
        const result = await withDb('load', (db) =>
          runIntakeWorker(db, ports.scanner, ports.extractor, ports.limits, { limit: 1 }),
        ).catch(() => ({ processed: 0, failed: 1 }));
        if (result.processed + result.failed === 0) return; // queue drained
        rec.record('document job (claim to done)', performance.now() - start);
        processed += result.processed;
        failed += result.failed;
      }
    }),
  );
  return { processed, failed };
}

async function versionStates(db: Db, versionIds: string[]): Promise<Record<string, number>> {
  const r = await db.execute(
    sql`select processing_status || ' / ' || safety_status as state, count(*)::int as n
        from document_versions
        where id in (${sql.join(
          versionIds.map((v) => sql`${v}::uuid`),
          sql`, `,
        )})
        group by 1`,
  );
  return Object.fromEntries(rowsOf<{ state: string; n: number }>(r).map((x) => [x.state, x.n]));
}

async function jobTimings(versionIds: string[]) {
  if (versionIds.length === 0)
    return { processing: summarise([]), wait: summarise([]), completed: 0, failed: 0 };
  return withDb('load', async (db) => {
    const rows = await db.execute(
      sql`select status,
                 extract(epoch from (completed_at - claimed_at)) * 1000 as processing_ms,
                 extract(epoch from (claimed_at - created_at)) * 1000 as wait_ms
          from processing_jobs
          where document_version_id in (${sql.join(
            versionIds.map((v) => sql`${v}::uuid`),
            sql`, `,
          )})`,
    );
    const list = rowsOf<{ status: string; processing_ms: number | null; wait_ms: number | null }>(
      rows,
    );
    return {
      processing: summarise(
        list.filter((r) => r.processing_ms !== null).map((r) => Number(r.processing_ms)),
      ),
      wait: summarise(list.filter((r) => r.wait_ms !== null).map((r) => Number(r.wait_ms))),
      done: list.filter((r) => r.status === 'DONE').length,
      notDone: list.filter((r) => r.status !== 'DONE').length,
      versions: await versionStates(db, versionIds),
    };
  });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function table(rec: Recorder) {
  return rec.labels().map((label) => ({ label, ...rec.summary(label) }));
}

interface Report {
  [key: string]: unknown;
  when: string;
  node: string;
  settings: unknown;
  host: unknown;
  dataset?: unknown;
  idle?: unknown;
  volume?: unknown;
  documentsAlone?: unknown;
  launchEnvelope?: unknown;
  stress?: unknown;
  scannerOutage?: unknown;
  databaseSizeMb?: unknown;
  documentScanner?: unknown;
}

async function main(): Promise<void> {
  assertLocal(BASE_URL);
  const bridge = await startBridge({
    listenPort: BRIDGE_PORT,
    pgHost: new URL(BASE_URL).hostname,
    pgPort: Number(new URL(BASE_URL).port || 5432),
    oneWayDelayMs: RTT_MS / 2,
  });
  useLocalBridge(BRIDGE_PORT);
  const report: Report = {
    when: new Date().toISOString(),
    node: process.version,
    settings: { SECONDS, SESSIONS, DOC_WORKERS, THINK_MS, PDF_PAGES, RTT_MS, phases: [...PHASES] },
    host: hostSummary(),
  };

  try {
    // Fresh database, real migrations, then the launch-sized dataset
    await withDb('postgres', async (db) => {
      await db.execute(sql.raw('drop database if exists load'));
      await db.execute(sql.raw('create database load'));
    });
    await withDb('load', async (db) => {
      await migrate(db as never, {
        migrationsFolder: fileURLToPath(new URL('../../db/migrations', import.meta.url)),
      });
    });
    process.stdout.write('migrations applied; seeding...\n');
    const manifest = await withDb('load', (db) => seedDataset(db, LAUNCH_SHAPE));
    await withDb('load', (db) => db.execute(sql.raw('analyze')));
    report.dataset = { counts: manifest.counts, seededSeconds: round(manifest.seededMs / 1000) };
    process.stdout.write(`seeded in ${round(manifest.seededMs / 1000)}s\n`);

    const ports = docPorts();
    report.documentScanner = ports.scannerName;
    if (PHASES.has('idle')) {
      // 1. One person on an idle system (the best case, for comparison)
      const idle = new Recorder();
      await sessions(manifest, idle, 1, 25, 150);
      report.idle = table(idle);
    }
    if (PHASES.has('volume')) {
      // 2. Pagination at volume: the case and client lists for the biggest agency and for an agency that sees every case
      const volume = new Recorder();
      const sizes: Record<string, number> = {};
      const biggest = [...manifest.agencies].sort(
        (a, b) => b.caseCount - a.caseCount,
      )[0] as (typeof manifest.agencies)[number];
      const targets = [
        ['biggest normal agency', biggest],
        ['agency that sees all cases', manifest.stressAgency as (typeof manifest.agencies)[number]],
      ] as const;
      for (const [name, agency] of targets) {
        const admin = agency.staff.find((s) => s.role === 'ADMIN') as { accountId: string };
        for (let i = 0; i < 15; i++) {
          const cases = await volume.time(`${name}: case list`, () =>
            withDb('load', (db) =>
              listVisibleMissionsForMember(db, agency.organizationId, admin.accountId),
            ),
          );
          const clients = await volume.time(`${name}: client list`, () =>
            withDb('load', (db) => listApplicantsForOrganization(db, agency.organizationId)),
          );
          if (name === 'biggest normal agency') {
            await volume.time(`${name}: evidence requests (old one-by-one method)`, () =>
              withDb('load', (db) =>
                legacyEvidenceRequestsDetailed(db, admin.accountId, agency.organizationId),
              ),
            );
          }
          const requests = await volume.time(`${name}: evidence requests`, () =>
            withDb('load', (db) =>
              listEvidenceRequestsForOrgDetailed(db, admin.accountId, agency.organizationId),
            ),
          );
          if (i === 0) {
            sizes[`${name}: case list`] = cases.missions.length;
            sizes[`${name}: client list`] = clients.length;
            sizes[`${name}: evidence requests`] = isOk(requests) ? requests.value.length : -1;
            sizes[`${name}: case list payload KB`] = round(
              JSON.stringify(cases.missions).length / 1024,
            );
          }
        }
      }
      report.volume = { rows: sizes, timings: table(volume) };
    }
    if (PHASES.has('docs')) {
      // 3. Documents alone: 5 at a time, 10-page reference PDF
      const alone = new Recorder();
      const aloneIds = await queueDocuments(manifest, ports, 25, 'alone');
      const aloneMon = startMonitor('load');
      const aloneStart = performance.now();
      const aloneResult = await runDocWorkers(ports, alone, DOC_WORKERS, Date.now() + 10 * 60_000);
      const aloneSeconds = (performance.now() - aloneStart) / 1000;
      report.documentsAlone = {
        ...aloneResult,
        wallSeconds: round(aloneSeconds),
        perJob: table(alone),
        jobs: await jobTimings(aloneIds),
        resources: await aloneMon.stop(),
      };
    }
    if (PHASES.has('launch')) {
      // 4. The launch envelope: 50 sessions with normal thinking time, plus 5 document jobs at once
      const normal = new Recorder();
      const docs = new Recorder();
      const normalIds = await queueDocuments(manifest, ports, 150, 'normal');
      const normalMon = startMonitor('load');
      const [views, docResult] = await Promise.all([
        sessions(manifest, normal, SESSIONS, SECONDS, THINK_MS),
        runDocWorkers(ports, docs, DOC_WORKERS, Date.now() + SECONDS * 1000),
      ]);
      const normalRes = await normalMon.stop();
      report.launchEnvelope = {
        sessions: SESSIONS,
        thinkMs: THINK_MS,
        seconds: SECONDS,
        pageViews: views,
        pageViewsPerSecond: round(views / SECONDS),
        overall: summarise(normal.all(), normal.totalErrors()),
        perPage: table(normal),
        documents: { ...docResult, perJob: table(docs), jobs: await jobTimings(normalIds) },
        resources: normalRes,
      };
    }
    if (PHASES.has('stress')) {
      // 5. Stress: same 50 sessions with no thinking time, to find where it bends
      const stress = new Recorder();
      const stressMon = startMonitor('load');
      const stressViews = await sessions(
        manifest,
        stress,
        SESSIONS,
        Math.max(20, Math.floor(SECONDS / 2)),
        0,
      );
      report.stress = {
        sessions: SESSIONS,
        thinkMs: 0,
        seconds: Math.max(20, Math.floor(SECONDS / 2)),
        pageViews: stressViews,
        pageViewsPerSecond: round(stressViews / Math.max(20, Math.floor(SECONDS / 2))),
        overall: summarise(stress.all(), stress.totalErrors()),
        perPage: table(stress),
        resources: await stressMon.stop(),
      };
    }
    if (PHASES.has('outage')) {
      // 6. Scanner outage: a broken scanner must stop release of new documents
      const brokenScanner = new ClamAvScanner({
        blobStore: ports.blobs,
        socketPath: '/nonexistent/clamd.ctl',
        enforceSignatureFreshness: false,
      });
      const outageIds = await queueDocuments(manifest, ports, 1, 'outage');
      const outageResult = await withDb('load', (db) =>
        runIntakeWorker(db, brokenScanner, ports.extractor, ports.limits, { limit: 1 }),
      );
      const state = await withDb('load', async (db) => {
        const r = await db.execute(
          sql`select processing_status, safety_status from document_versions where id = ${outageIds[0]}::uuid`,
        );
        return rowsOf<{ processing_status: string; safety_status: string }>(r)[0] as {
          processing_status: string;
          safety_status: string;
        };
      });
      report.scannerOutage = {
        workerResult: outageResult,
        versionState: state,
        releaseStopped:
          state.safety_status !== 'CLEAN' &&
          !['APPROVED', 'AWAITING_REVIEW'].includes(state.processing_status),
      };
    }
    // Database size, for the record
    report.databaseSizeMb = await withDb('load', async (db) => {
      const r = await db.execute(sql`select pg_database_size('load') / 1048576 as mb`);
      return Number(rowsOf<{ mb: number }>(r)[0]?.mb);
    });
  } finally {
    await bridge.close();
  }
  const path = env('LOAD_REPORT', '');
  if (path) writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    process.stderr.write(
      `load run failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(1);
  },
);
