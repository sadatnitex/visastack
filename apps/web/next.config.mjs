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
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
