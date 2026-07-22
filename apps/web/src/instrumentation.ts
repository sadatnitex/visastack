/**
 * Next.js instrumentation hook. `register()` runs once at server startup,
 * before any route module (and therefore before `ws`) is evaluated.
 *
 * The pooled Neon driver talks to Postgres over a WebSocket via `ws`. `ws`
 * optionally speeds up frame masking with the native `bufferutil` addon,
 * loaded through `require('bufferutil')`. When webpack bundles `ws` (which
 * happens here because `@visastack/db` is transpiled), that optional require is
 * mangled and the exported `mask` ends up undefined — every outgoing frame then
 * throws `TypeError: b.mask is not a function`, the socket dies with
 * "Connection terminated unexpectedly", and every DB-backed page 500s.
 *
 * Setting `WS_NO_BUFFER_UTIL` (and the matching validate flag) before `ws`
 * evaluates makes it skip the native require entirely and use its always-defined
 * pure-JS masker, which survives bundling. This is `ws`'s own supported opt-out.
 */
/** Variable-keyed write — avoids both the index-signature and literal-key lint rules. */
function setEnv(name: string, value: string): void {
  process.env[name] = value;
}

export function register(): void {
  setEnv('WS_NO_BUFFER_UTIL', '1');
  setEnv('WS_NO_UTF_8_VALIDATE', '1');
}
