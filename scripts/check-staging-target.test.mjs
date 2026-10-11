import assert from 'node:assert/strict';
import test from 'node:test';
import { validateStagingTarget, verifyStagingDeployment } from './check-staging-target.mjs';
const env = {
  E2E_SYNTHETIC_ISOLATION_VERIFIED: 'true',
  PLAYWRIGHT_BASE_URL: 'https://visastack-abc123-nazmus-sadats-projects-d8da1138.vercel.app',
};
test('accepts only an explicit immutable staging origin with isolation attestation', () => {
  assert.equal(validateStagingTarget(env), env.PLAYWRIGHT_BASE_URL);
});
test('refuses missing targets, moving aliases, custom production, credentials and absent isolation', () => {
  for (const target of [
    '',
    'https://vs.obsidianglobal.studio',
    'https://visastack-five.vercel.app',
    'https://visastack-git-main-nazmus-sadats-projects-d8da1138.vercel.app',
    'http://localhost:3000',
    `${env.PLAYWRIGHT_BASE_URL}/app`,
    'https://user:pass@visastack-abc123-nazmus-sadats-projects-d8da1138.vercel.app',
  ])
    assert.throws(() => validateStagingTarget({ ...env, PLAYWRIGHT_BASE_URL: target }));
  assert.throws(() => validateStagingTarget({ ...env, E2E_SYNTHETIC_ISOLATION_VERIFIED: '' }));
});

test('checks the exact SHA and rejects an immutable production deployment before login', async () => {
  const config = {
    ...env,
    STAGING_VERCEL_TOKEN: 'synthetic-not-a-secret',
    E2E_STAGING_DEPLOYMENT_ID: 'synthetic-deployment',
    E2E_EXPECTED_SHA: 'a'.repeat(40),
  };
  const deployment = {
    target: null,
    projectId: 'prj_RZcDRy1odwehHuDqsiGwvVGC0epe',
    readyState: 'READY',
    url: new URL(env.PLAYWRIGHT_BASE_URL).hostname,
    meta: { githubCommitSha: config.E2E_EXPECTED_SHA },
  };
  const request = (record) => async () => new Response(JSON.stringify(record));
  assert.equal(await verifyStagingDeployment(config, request(deployment)), env.PLAYWRIGHT_BASE_URL);
  for (const invalid of [
    { ...deployment, target: 'production' },
    { ...deployment, meta: { githubCommitSha: 'b'.repeat(40) } },
    { ...deployment, readyState: 'BUILDING' },
    { ...deployment, projectId: 'other' },
  ])
    await assert.rejects(() => verifyStagingDeployment(config, request(invalid)));
  await assert.rejects(() =>
    verifyStagingDeployment({ ...config, STAGING_VERCEL_TOKEN: '' }, request(deployment)),
  );
});
