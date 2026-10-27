/**
 * @type {import('next').NextConfig}
 *
 * Security headers here are the baseline; the full CSP and privacy caching
 * rules (no sensitive PWA cache) are hardened in Phase 6 against the PRD.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

/**
 * One value per build, baked into the server and browser code. The service worker (`/sw.js`)
 * carries it, so every deployment ships a worker that differs from the last one and devices
 * learn that a newer VisaStack is available. Locally it falls back to the build time.
 */
const buildVersion =
  process.env.VERCEL_DEPLOYMENT_ID ??
  process.env.VERCEL_GIT_COMMIT_SHA ??
  `local-${Date.now().toString(36)}`;

const nextConfig = {
  reactStrictMode: true,
  env: { VISASTACK_BUILD_VERSION: buildVersion },
  poweredByHeader: false,
  transpilePackages: ['@visastack/core', '@visastack/db'],
  // The pooled Neon driver talks to Postgres over a WebSocket via `ws`. If
  // webpack bundles `ws`, its optional `bufferutil` require is mangled and the
  // frame-mask fallback is lost ("b.mask is not a function"), which kills the
  // connection ("Connection terminated unexpectedly") and 500s every DB page.
  // Keeping these external makes Node load the real packages at runtime, where
  // the pure-JS mask fallback works. (Next 15 stable key.)
  //
  // `@napi-rs/canvas` (Commercial V1 Part 3, safe preview rendering) ships a
  // native per-platform binary, the same category as the `sharp` example in
  // Next's own docs for this option: it must be traced/copied into the
  // deployed function as-is, never bundled by webpack, or the native addon
  // is missing at runtime on Vercel. Listed here too (`serverExternalPackages`
  // is the documented mechanism), but in this pnpm workspace it alone did
  // NOT stop webpack walking into `@napi-rs/canvas`'s own internal require of
  // the platform-specific `.node` binary when reached transitively through
  // `@visastack/adapters` (confirmed by actually running `pnpm run build` and
  // reading the failure, not assumed): the `webpack()` override below is
  // the mechanism that actually works, kept alongside this list rather than
  // replacing it since `serverExternalPackages` is still the right signal
  // for Vercel's own output file tracing to include the native binary.
  serverExternalPackages: [
    '@neondatabase/serverless',
    'ws',
    '@napi-rs/canvas',
    '@napi-rs/canvas-linux-x64-gnu',
    '@napi-rs/canvas-linux-x64-musl',
    '@napi-rs/canvas-linux-arm64-gnu',
    '@napi-rs/canvas-linux-arm64-musl',
    '@napi-rs/canvas-darwin-x64',
    '@napi-rs/canvas-darwin-arm64',
    '@napi-rs/canvas-win32-x64-msvc',
    // Profile photo re-encoding (WP-PH1) and visa photo sizes (packages/adapters/src/photo-sizer.ts):
    // a native image library, kept external like the canvas above so the deployed function loads
    // the real package and its platform binary.
    'sharp',
  ],
  webpack: (config, { isServer }) => {
    if (isServer) {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [
        ...existing,
        ({ request }, callback) => {
          if (request && (/^@napi-rs\/canvas/.test(request) || request === 'sharp')) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
  experimental: {
    serverActions: {
      // Next's own default is 1 MB, silently below the pilot's own upload
      // quota (packages/services/src/quotas.ts), so every upload above 1 MB
      // was being rejected with a 413 before reaching that quota check at
      // all (master directive §7 "PR 6", upload consistency). Next
      // enforces this by tracking bytes as the request body streams in and
      // rejecting once the running total crosses the limit, never fully
      // buffering an oversize body, so this is also the first,
      // framework-level line of defense against a deliberately huge upload
      // exhausting memory. Set comfortably above the quota's
      // maxUploadBytes (20 MiB, corrected from a stale 10 MiB pilot default
      // this same Part 3 chunk, see quotas.ts) for multipart framing
      // overhead; the quota itself remains the real, precise,
      // runtime-configurable limit. This was left at the OLD quota's margin
      // (15 MB) when maxUploadBytes was bumped to 20 MiB, silently
      // re-introducing the exact bug this comment describes for any upload
      // between 15-20 MiB, caught by re-reading this file while wiring in
      // the preview-render path, not by a report.
      bodySizeLimit: '25mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
