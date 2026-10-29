/**
 * Every provider this codebase can actually dispatch to via a DB config
 * (Part 8 §3: "ship production adapters for OpenAI API; Google Gemini API;
 * Anthropic Claude API" -- all three now implemented). Checked BEFORE
 * `revealAiProviderApiKey` runs (./ai.ts), not after building the adapter --
 * an unimplemented provider must never pay for a real KMS decrypt of a key
 * it is never going to use. Keep this set and `buildAdapterForConfig`'s own
 * switch in sync when a new provider ships. Its own module, free of imports,
 * so the readiness facts (./readiness-signals.ts) can share it without
 * loading the AI adapters.
 */
export const IMPLEMENTED_PROVIDERS: ReadonlySet<string> = new Set([
  'openai',
  'anthropic',
  'gemini',
]);
