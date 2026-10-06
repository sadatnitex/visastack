/**
 * Public-page load against a running production build of the web app (for example `next start -p 3100`).
 * Signed-in pages cannot be measured this way (they need the real sign-in provider), so this covers
 * only the pages anyone can open plus the health probe. Usage:
 *
 *   LOAD_HTTP_BASE=http://localhost:3100 pnpm --filter @visastack/load load:http
 */
import { writeFileSync } from 'node:fs';
import { Recorder, round, summarise } from './stats';

const { LOAD_HTTP_BASE: base = 'http://localhost:3100', LOAD_REPORT: reportPath = '' } =
  process.env;
const { LOAD_SECONDS: secondsRaw = '30', LOAD_SESSIONS: sessionsRaw = '50' } = process.env;
const seconds = Number(secondsRaw);
const sessions = Number(sessionsRaw);
const paths = ['/', '/trust', '/status', '/api/health/live'];

async function main(): Promise<void> {
  const host = new URL(base).hostname;
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
    throw new Error('refusing to load-test anything but a local server');
  }
  const rec = new Recorder();
  const codes = new Map<number, number>();
  const end = Date.now() + seconds * 1000;
  let requests = 0;
  await Promise.all(
    Array.from({ length: sessions }, async () => {
      await new Promise((r) => setTimeout(r, Math.random() * 1000));
      while (Date.now() < end) {
        const path = paths[Math.floor(Math.random() * paths.length)] as string;
        try {
          await rec.time(path, async () => {
            const res = await fetch(`${base}${path}`, { redirect: 'manual' });
            await res.arrayBuffer();
            codes.set(res.status, (codes.get(res.status) ?? 0) + 1);
            if (res.status >= 500) throw new Error(`status ${res.status}`);
          });
        } catch {
          // counted by the recorder
        }
        requests++;
        await new Promise((r) => setTimeout(r, -Math.log(1 - Math.random()) * 1000));
      }
    }),
  );
  const report = {
    base,
    sessions,
    seconds,
    requests,
    requestsPerSecond: round(requests / seconds),
    statusCodes: Object.fromEntries(codes),
    perPath: rec.labels().map((label) => ({ label, ...rec.summary(label) })),
    overall: summarise(rec.all(), rec.totalErrors()),
  };
  const text = JSON.stringify(report, null, 2);
  if (reportPath) writeFileSync(reportPath, `${text}\n`);
  process.stdout.write(`${text}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`http load failed: ${String(error)}\n`);
  process.exit(1);
});
