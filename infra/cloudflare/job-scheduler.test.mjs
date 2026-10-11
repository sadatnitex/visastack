import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { PRODUCTION_ORIGIN, runScheduledJobs } from './job-scheduler.mjs';

const secret = 'synthetic-scheduler-value'.padEnd(32, 'x');
const time = (minutes) => Date.UTC(2026, 9, 11, 7, minutes);

test('five-minute jobs use fixed production routes and a bounded authenticated request', async () => {
  const calls = [];
  const result = await runScheduledJobs(
    { scheduledTime: time(5) },
    { CRON_SECRET: secret, ENABLE_INTAKE_SCHEDULE: 'true' },
    async (url, options) => {
      calls.push({ url, options });
      return new Response('private diagnostic');
    },
  );
  assert.deepEqual(result, { attempted: 2, succeeded: 2 });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      `${PRODUCTION_ORIGIN}/api/jobs/process-intake`,
      `${PRODUCTION_ORIGIN}/api/jobs/process-notifications`,
    ],
  );
  for (const { options } of calls) {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.ok(options.signal instanceof AbortSignal);
  }
});
test('date sweeps run at the UTC hour boundary only', async () => {
  const calls = [];
  const result = await runScheduledJobs(
    { scheduledTime: time(0) },
    { CRON_SECRET: secret, ENABLE_INTAKE_SCHEDULE: 'true' },
    async (url) => {
      calls.push(url);
      return new Response();
    },
  );
  assert.equal(result.attempted, 3);
  assert.ok(calls.includes(`${PRODUCTION_ORIGIN}/api/jobs/process-notification-sweeps`));
});
test('incorrect origins never receive the scheduler credential', async () => {
  for (const APP_ORIGIN of [
    'https://example.com',
    `${PRODUCTION_ORIGIN}/other`,
    `${PRODUCTION_ORIGIN}?x=1`,
    `${PRODUCTION_ORIGIN}:444`,
    'http://example.com',
  ]) {
    let called = false;
    await assert.rejects(
      runScheduledJobs(
        { scheduledTime: time(5) },
        { APP_ORIGIN, CRON_SECRET: secret },
        async () => {
          called = true;
          return new Response();
        },
      ),
    );
    assert.equal(called, false);
  }
});
test('weak or missing secrets prevent all requests', async () => {
  for (const CRON_SECRET of [undefined, '', 'short']) {
    let called = false;
    await assert.rejects(
      runScheduledJobs({ scheduledTime: time(5) }, { CRON_SECRET }, async () => {
        called = true;
        return new Response();
      }),
    );
    assert.equal(called, false);
  }
});
test('redirects and outages fail the run while independent jobs still execute', async () => {
  for (const status of [307, 403, 503]) {
    let calls = 0;
    await assert.rejects(
      runScheduledJobs(
        { scheduledTime: time(0) },
        { CRON_SECRET: secret, ENABLE_INTAKE_SCHEDULE: 'true' },
        async () => {
          calls++;
          return new Response('private body', { status });
        },
      ),
      /^Error: Scheduled job execution failed$/,
    );
    assert.equal(calls, 3);
  }
});
test('network errors cannot expose private transport details', async () => {
  await assert.rejects(
    runScheduledJobs(
      { scheduledTime: time(5) },
      { CRON_SECRET: secret, ENABLE_INTAKE_SCHEDULE: 'true' },
      async () => {
        throw new Error('private credentials and request payload');
      },
    ),
    /^Error: Scheduled job execution failed$/,
  );
});
test('the public worker endpoint cannot run a job', async () => {
  assert.equal((await worker.fetch()).status, 404);
});

test('scanner scheduling is opt-in so idle ticks do not create Actions runners', async () => {
  const calls = [];
  const result = await runScheduledJobs(
    { scheduledTime: time(5) },
    { CRON_SECRET: secret },
    async (url) => {
      calls.push(url);
      return new Response();
    },
  );
  assert.equal(result.attempted, 1);
  assert.deepEqual(calls, [`${PRODUCTION_ORIGIN}/api/jobs/process-notifications`]);
});
