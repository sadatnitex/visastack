export const PRODUCTION_ORIGIN = 'https://vs.obsidianglobal.studio';
const FREQUENT_JOBS = ['/api/jobs/process-notifications'];
const HOURLY_JOBS = ['/api/jobs/process-notification-sweeps'];

/** Existing authenticated endpoints retain all queue, lease and policy checks. */
export async function runScheduledJobs(event, env, fetchImpl = fetch) {
  const origin = env.APP_ORIGIN || PRODUCTION_ORIGIN;
  // A secret must never be forwarded to a preview, arbitrary host or redirect.
  if (
    new URL(origin).origin !== PRODUCTION_ORIGIN ||
    ![PRODUCTION_ORIGIN, `${PRODUCTION_ORIGIN}/`].includes(origin)
  ) {
    throw new Error('Scheduler requires the canonical production origin');
  }
  if (typeof env.CRON_SECRET !== 'string' || env.CRON_SECRET.length < 32) {
    throw new Error('Scheduler secret is missing or too short');
  }
  if (!Number.isFinite(event.scheduledTime)) throw new Error('Invalid scheduled timestamp');
  const jobs = [...FREQUENT_JOBS];
  // Scanner Actions are costly even with an empty queue. Opt in only after
  // measuring backlog and runner usage; upload-driven dispatch stays intact.
  if (env.ENABLE_INTAKE_SCHEDULE === 'true') jobs.unshift('/api/jobs/process-intake');
  if (new Date(event.scheduledTime).getUTCMinutes() === 0) jobs.push(...HOURLY_JOBS);
  const failures = [];
  for (const path of jobs) {
    try {
      const response = await fetchImpl(`${PRODUCTION_ORIGIN}${path}`, {
        method: 'GET',
        redirect: 'manual',
        headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
        signal: AbortSignal.timeout(55_000),
      });
      // Payloads may contain operational details. Never log or forward them.
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) failures.push(path);
    } catch {
      failures.push(path);
    }
  }
  // All independent jobs are attempted, but partial failure stays a failed run.
  if (failures.length) throw new Error('Scheduled job execution failed');
  return { attempted: jobs.length, succeeded: jobs.length };
}

export default {
  async fetch() {
    return new Response('Not found', { status: 404 });
  },
  async scheduled(event, env) {
    await runScheduledJobs(event, env);
  },
};
