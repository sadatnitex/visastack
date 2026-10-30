/**
 * Where this copy of VisaStack is running, in one place, so the app behaves the same on its main
 * host (Vercel) and on the ready-to-switch Render fallback (docs/operations/render-fallback.md).
 *
 * - Vercel sets `VERCEL_ENV` on every deployment (`production`, `preview` or `development`).
 * - The Render fallback is marked by the owner with `HOSTING_PLATFORM=render` on that one service.
 *   Render's own automatic variables are not relied on: an explicit setting cannot appear by
 *   accident on a laptop or another host.
 *
 * On Vercel every answer here is exactly what the code read before this helper existed
 * (`VERCEL_ENV === 'production'`), so nothing changes there. No `server-only` import: the
 * middleware and plain helpers use it too, and it reads nothing secret.
 */

export type HostingPlatform = 'vercel' | 'render' | 'other';

type EnvReader = (name: string) => string | undefined;

const fromProcess: EnvReader = (name) => process.env[name];

export function hostingPlatform(readEnv: EnvReader = fromProcess): HostingPlatform {
  if (readEnv('VERCEL_ENV')) return 'vercel';
  if (readEnv('HOSTING_PLATFORM') === 'render') return 'render';
  return 'other';
}

/**
 * True only on the live production site: Vercel's production environment, or the Render fallback
 * service. Previews, local machines and tests are never the production site, so jobs that start
 * outside work (the private document scanner, the backup dispatch) stay off there.
 */
export function isProductionSite(readEnv: EnvReader = fromProcess): boolean {
  switch (hostingPlatform(readEnv)) {
    case 'vercel':
      return readEnv('VERCEL_ENV') === 'production';
    case 'render':
      return true;
    default:
      return false;
  }
}
