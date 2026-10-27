import { BUILD_VERSION } from '../../lib/pwa/build-version';
import {
  buildRetirementScript,
  buildServiceWorkerScript,
  isServiceWorkerEnabled,
} from '../../lib/pwa/service-worker';

// Read per request so the switch-off takes effect without a rebuild.
export const dynamic = 'force-dynamic';

/**
 * `/sw.js`, the service worker (see `lib/pwa/service-worker.ts`). Served from the site root so
 * it may control every page. `no-cache` makes browsers check for a newer worker on each update
 * check; the build version inside it changes on every deployment.
 */
export function GET(): Response {
  const body = isServiceWorkerEnabled((name) => process.env[name])
    ? buildServiceWorkerScript(BUILD_VERSION)
    : buildRetirementScript();
  return new Response(body, {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, max-age=0, must-revalidate',
    },
  });
}
