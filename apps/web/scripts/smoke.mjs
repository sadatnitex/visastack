#!/usr/bin/env node
/**
 * No-secret deployment smoke check (master directive §8A).
 *
 * Exercises the deployed app over plain HTTP — no credentials, no database
 * access, no browser. Safe to run against any preview or production URL.
 * Usage: SMOKE_BASE_URL=https://your-deploy.vercel.app node scripts/smoke.mjs
 *
 * Without SMOKE_BASE_URL set, this exits 0 immediately (skipped) rather than
 * failing CI runs that have nothing to point it at.
 *
 * A Vercel deployment occasionally fails before this script ever runs, with
 * errorCode BUILD_FAILED / "Resource provisioning failed", zero build log
 * events, and `ready` firing within ~1s of `buildingAt` — a transient
 * platform-side provisioning hiccup, not a code defect (confirmed against
 * this exact repo's history — see
 * docs/audits/commercial-readiness-recovery-baseline.md §3). The fix is a
 * fresh push to retrigger a real build attempt, matching this repo's
 * existing precedent (commit b04d9ff).
 */

function log(line) {
  process.stdout.write(`${line}\n`);
}
function logError(line) {
  process.stderr.write(`${line}\n`);
}

const baseUrl = process.env.SMOKE_BASE_URL?.replace(/\/$/, '');

if (!baseUrl) {
  log('[smoke] SMOKE_BASE_URL not set — skipping deployment smoke check.');
  process.exit(0);
}

/** @type {{ name: string, pass: boolean, detail?: string }[]} */
const results = [];

function record(name, pass, detail) {
  results.push({ name, pass, detail });
  log(`${pass ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function fetchNoRedirect(path) {
  return fetch(`${baseUrl}${path}`, { redirect: 'manual' });
}

async function main() {
  // 1. Liveness is reachable.
  try {
    const res = await fetch(`${baseUrl}/api/health/live`);
    record('/api/health/live is reachable (200)', res.status === 200, `status=${res.status}`);
  } catch (error) {
    record('/api/health/live is reachable', false, String(error));
  }

  // 2. Readiness responds with valid JSON and an honest status code.
  let readinessBody;
  try {
    const res = await fetch(`${baseUrl}/api/health/ready`);
    const body = await res.json();
    readinessBody = body;
    const statusMatchesBody =
      (res.status === 200 && body.status === 'ready') ||
      (res.status === 503 && body.status === 'degraded');
    record(
      '/api/health/ready returns a status code consistent with its body',
      statusMatchesBody,
      `http=${res.status} body.status=${body.status}`,
    );
  } catch (error) {
    record('/api/health/ready is reachable and well-formed', false, String(error));
  }

  // 2a. Readiness truthfully reports the deployment mode and capability
  // registry (master recovery directive §6/§7 "PR 1") — never a green build
  // standing in for production verification.
  record(
    '/api/health/ready reports a real deploymentMode',
    ['development', 'controlled_pilot', 'commercial'].includes(readinessBody?.deploymentMode),
    `deploymentMode=${readinessBody?.deploymentMode}`,
  );
  record(
    '/api/health/ready reports the platform capability registry — agencyCollaboration repaired (PR 2), bulkExport still gated pending real step-up (PR 5)',
    readinessBody?.platform?.agencyCollaboration === 'available' &&
      readinessBody?.platform?.bulkExport === 'disabled',
    `agencyCollaboration=${readinessBody?.platform?.agencyCollaboration} bulkExport=${readinessBody?.platform?.bulkExport}`,
  );

  // 3. Public landing page renders and shows the unmistakable pilot banner.
  try {
    const res = await fetch(`${baseUrl}/`);
    const html = await res.text();
    record(
      'Landing page renders (200, non-empty HTML)',
      res.status === 200 && html.includes('<html'),
      `status=${res.status} bytes=${html.length}`,
    );
    record(
      'Landing page shows the controlled-pilot banner',
      html.includes('pilot-banner') &&
        (html.includes('Controlled Pilot') || html.includes('Development Preview')),
      'looking for .pilot-banner + "Controlled Pilot"/"Development Preview"',
    );
  } catch (error) {
    record('Landing page renders', false, String(error));
  }

  // 4. Public status page renders.
  try {
    const res = await fetch(`${baseUrl}/status`);
    record('Status page renders (200)', res.status === 200, `status=${res.status}`);
  } catch (error) {
    record('Status page renders', false, String(error));
  }

  // 5. Unauthenticated /app redirects toward WorkOS — never renders the workspace.
  try {
    const res = await fetchNoRedirect('/app');
    const location = res.headers.get('location') ?? '';
    const redirectsToAuth =
      (res.status === 302 || res.status === 307) && /workos\.com|authkit\.app/i.test(location);
    record(
      'Unauthenticated /app redirects to WorkOS (never leaks the workspace)',
      redirectsToAuth,
      `status=${res.status} location=${location || '(none)'}`,
    );
  } catch (error) {
    record('Unauthenticated /app redirects to WorkOS', false, String(error));
  }

  // 6. /callback is publicly reachable (not blocked by auth, not a bare 404).
  try {
    const res = await fetchNoRedirect('/callback');
    const reachable = res.status !== 404 && res.status < 500;
    record('/callback is publicly reachable', reachable, `status=${res.status}`);
  } catch (error) {
    record('/callback is publicly reachable', false, String(error));
  }

  // 7. A nested protected route also redirects rather than leaking content.
  try {
    const res = await fetchNoRedirect('/app/privacy');
    const location = res.headers.get('location') ?? '';
    const denied =
      (res.status === 302 || res.status === 307) && /workos\.com|authkit\.app/i.test(location);
    record(
      'Protected nested route denies unauthenticated access',
      denied,
      `status=${res.status} location=${location || '(none)'}`,
    );
  } catch (error) {
    record('Protected nested route denies unauthenticated access', false, String(error));
  }

  const failed = results.filter((r) => !r.pass);
  log(`\n[smoke] ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    logError(`[smoke] FAILED: ${failed.map((f) => f.name).join('; ')}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error) => {
  logError(`[smoke] unexpected error ${error}`);
  process.exit(1);
});
