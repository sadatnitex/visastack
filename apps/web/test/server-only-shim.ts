/**
 * No-op stand-in for the `server-only` marker package, which Next.js's
 * bundler understands specially but plain Vite/vitest cannot resolve at all.
 * Aliased in vitest.config.ts so unit tests can import `lib/*.ts` modules
 * that start with `import 'server-only'` without pulling in Next's bundler.
 */
export {};
