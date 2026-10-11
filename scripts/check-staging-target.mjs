// No default target: credentialed tests must never fall through to production.
export function validateStagingTarget(env) {
  if (env.E2E_SYNTHETIC_ISOLATION_VERIFIED !== 'true')
    throw new Error(
      'BLOCKED: isolated synthetic database and auth fixtures have not been verified.',
    );
  const target = new URL(env.PLAYWRIGHT_BASE_URL ?? '');
  if (
    target.protocol !== 'https:' ||
    target.username ||
    target.password ||
    target.port ||
    target.search ||
    target.hash ||
    target.pathname !== '/'
  )
    throw new Error('BLOCKED: staging must use an explicit HTTPS deployment origin.');
  if (!/^visastack-[a-z0-9]+-nazmus-sadats-projects-d8da1138\.vercel\.app$/.test(target.hostname))
    throw new Error(
      'BLOCKED: use an isolated immutable staging deployment URL, never a production or moving alias.',
    );
  return target.origin;
}
export async function verifyStagingDeployment(env, request = fetch) {
  const origin = validateStagingTarget(env);
  if (
    !env.STAGING_VERCEL_TOKEN ||
    !env.E2E_STAGING_DEPLOYMENT_ID ||
    !/^[a-f0-9]{40}$/.test(env.E2E_EXPECTED_SHA ?? '')
  )
    throw new Error('BLOCKED: exact staging deployment proof is missing.');
  const response = await request(
    `https://api.vercel.com/v13/deployments/${encodeURIComponent(env.E2E_STAGING_DEPLOYMENT_ID)}?teamId=team_YDtSBrhGH5u4NwrHUCCddXwS`,
    { headers: { Authorization: `Bearer ${env.STAGING_VERCEL_TOKEN}` } },
  );
  if (!response.ok) throw new Error('BLOCKED: staging deployment could not be verified.');
  const deployment = await response.json();
  if (
    deployment.target === 'production' ||
    deployment.projectId !== 'prj_RZcDRy1odwehHuDqsiGwvVGC0epe' ||
    deployment.readyState !== 'READY' ||
    `https://${deployment.url}` !== origin ||
    deployment.meta?.githubCommitSha !== env.E2E_EXPECTED_SHA
  )
    throw new Error(
      'BLOCKED: staging must be a READY non-production deployment of this exact revision.',
    );
  if (!env.STAGING_ATTESTATION_SECRET)
    throw new Error('BLOCKED: independent staging configuration proof is required before login.');
  const proofResponse = await request(`${origin}/api/staging/attestation`, {
    headers: { Authorization: `Bearer ${env.STAGING_ATTESTATION_SECRET}` },
    redirect: 'error',
  });
  if (!proofResponse.ok)
    throw new Error('BLOCKED: deployment cannot attest its staging resource bindings.');
  const proof = await proofResponse.json();
  if (
    proof.deployment !== env.E2E_EXPECTED_SHA ||
    proof.isolatedSyntheticConfiguration !== true ||
    !proof.databaseHost ||
    !proof.databaseName ||
    !proof.neonAuthBaseUrl
  )
    throw new Error('BLOCKED: staging configuration proof is incomplete.');
  const envResponse = await request(
    'https://api.vercel.com/v9/projects/prj_RZcDRy1odwehHuDqsiGwvVGC0epe/env?teamId=team_YDtSBrhGH5u4NwrHUCCddXwS',
    { headers: { Authorization: `Bearer ${env.STAGING_VERCEL_TOKEN}` } },
  );
  if (!envResponse.ok)
    throw new Error('BLOCKED: production bindings cannot be independently checked.');
  const configured = await envResponse.json();
  const production = {};
  for (const key of ['DATABASE_URL', 'NEON_AUTH_BASE_URL']) {
    const item = configured.envs?.find(
      (entry) => entry.key === key && entry.target.includes('production') && !entry.gitBranch,
    );
    if (!item) throw new Error('BLOCKED: production binding is unavailable.');
    const response = await request(
      `https://api.vercel.com/v9/projects/prj_RZcDRy1odwehHuDqsiGwvVGC0epe/env/${encodeURIComponent(item.id)}?teamId=team_YDtSBrhGH5u4NwrHUCCddXwS&decrypt=true`,
      { headers: { Authorization: `Bearer ${env.STAGING_VERCEL_TOKEN}` } },
    );
    if (!response.ok) throw new Error('BLOCKED: production binding cannot be verified.');
    const record = await response.json();
    production[key] = record.value;
  }
  const database = new URL(production.DATABASE_URL);
  const auth = new URL(production.NEON_AUTH_BASE_URL);
  if (
    proof.databaseHost === database.hostname.replace('-pooler.', '.') ||
    new URL(proof.neonAuthBaseUrl).origin === auth.origin
  )
    throw new Error('BLOCKED: staging reuses a production database or Neon Auth binding.');
  return origin;
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    await verifyStagingDeployment(process.env);
    console.info(
      'Exact non-production staging deployment verified. Synthetic database/auth isolation attestation remains a prerequisite.',
    );
  } catch {
    console.error(
      'BLOCKED: staging configuration or exact deployment proof is missing or invalid.',
    );
    process.exitCode = 1;
  }
}
