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

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@visastack/core', '@visastack/db'],
  // The pooled Neon driver talks to Postgres over a WebSocket via `ws`. If
  // webpack bundles `ws`, its optional `bufferutil` require is mangled and the
  // frame-mask fallback is lost ("b.mask is not a function"), which kills the
  // connection ("Connection terminated unexpectedly") and 500s every DB page.
  // Keeping these external makes Node load the real packages at runtime, where
  // the pure-JS mask fallback works. (Next 15 stable key.)
  serverExternalPackages: ['@neondatabase/serverless', 'ws'],
  experimental: {
    serverActions: {
      // Next's own default is 1 MB — silently below the pilot's own 10 MB
      // upload quota (packages/services/src/quotas.ts), so every upload
      // between 1-10 MB was being rejected with a 413 before reaching that
      // quota check at all (master directive §7 "PR 6" — upload
      // consistency). Next enforces this by tracking bytes as the request
      // body streams in and rejecting once the running total crosses the
      // limit — never fully buffering an oversize body — so this is also
      // the first, framework-level line of defense against a deliberately
      // huge upload exhausting memory. Set comfortably above the quota's
      // maxUploadBytes default (10 MB) for multipart framing overhead; the
      // quota itself remains the real, precise, runtime-configurable limit.
      bodySizeLimit: '15mb',
    },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
