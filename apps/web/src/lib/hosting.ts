/**
 * Where this copy of VisaStack is running, in one place, so the app behaves the same on its main
 * host (Vercel) and on the ready-to-switch Render fallback (docs/operations/render-fallback.md).
 *
 * - The Render image (apps/web/Dockerfile) sets `HOSTING_PLATFORM=render`. It wins over everything
 *   else, so a `VERCEL_ENV` copied across with the other Vercel settings cannot make the Render
 *   copy act as a Vercel deployment.
 * - Otherwise Vercel sets `VERCEL_ENV` on every deployment (`production`, `preview` or
 *   `development`). Vercel never sets `HOSTING_PLATFORM`.
 * - Render's own automatic variables are not relied on: an explicit setting cannot appear by
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
  if (readEnv('HOSTING_PLATFORM') === 'render') return 'render';
  if (readEnv('VERCEL_ENV')) return 'vercel';
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

/**
 * Why this host is not ready to serve, in plain words, or `undefined` when nothing is wrong. On
 * Render the site address must be set: Vercel supplies its own production address, Render does
 * not, and without it emails and shared links would point at the old Vercel address. Readiness
 * (readiness.ts) reports not ready until it is fixed. Nothing is checked on Vercel.
 */
export function hostingProblem(readEnv: EnvReader = fromProcess): string | undefined {
  if (hostingPlatform(readEnv) !== 'render') return undefined;
  const address = readEnv('NEXT_PUBLIC_APP_URL')?.trim() ?? '';
  let valid = false;
  try {
    valid = ['https:', 'http:'].includes(new URL(address).protocol);
  } catch {
    valid = false;
  }
  return valid
    ? undefined
    : 'The site address (NEXT_PUBLIC_APP_URL) is not set on this Render service, so links in emails would point to the wrong place.';
}
