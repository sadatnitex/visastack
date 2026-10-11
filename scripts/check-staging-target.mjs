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
