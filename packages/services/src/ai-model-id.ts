/**
 * The one rule for an AI configuration's model ID, used by the service before saving and by the
 * settings tests that check the offered list against it.
 *
 * - An exact model ID: letters, digits and `. _ : @ -`, no spaces or slashes, at most 100
 *   characters. A display name ("Claude 5.5") is refused here instead of failing later with a 404.
 * - Gemini places the ID in its request path before `:generateContent`, so `:` and `@` are refused
 *   for Gemini. OpenAI fine-tuned IDs (`ft:...`) keep `:`.
 * - An ID from another provider's family (`claude-` under Gemini, `gemini-` under Anthropic) is
 *   refused, so a provider and model that cannot work together are never saved. An ID from no
 *   known family is allowed: a provider can release a model under a new name.
 */

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/;
const PATH_SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The start of every model ID each provider uses for its own models. */
const MODEL_FAMILIES: Readonly<Record<string, readonly string[]>> = {
  anthropic: ['claude-'],
  gemini: ['gemini-'],
  openai: ['gpt-', 'ft:gpt-'],
};

const PROVIDER_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  openai: 'OpenAI',
};

/** Why `model` cannot be saved for `provider`, as a sentence fragment, or undefined when it can. */
export function aiModelIdProblem(provider: string, model: string): string | undefined {
  const id = model.trim();
  if (id.length === 0) return 'a model is required';
  const rule = provider === 'gemini' ? PATH_SAFE_MODEL_ID : MODEL_ID;
  if (!rule.test(id)) {
    return "the model must be the provider's exact model ID, such as claude-opus-5-5, not its display name";
  }
  const lower = id.toLowerCase();
  for (const [owner, prefixes] of Object.entries(MODEL_FAMILIES)) {
    if (owner !== provider && prefixes.some((prefix) => lower.startsWith(prefix))) {
      return `${id} is ${PROVIDER_NAMES[owner] ?? owner} model; choose that provider, or a model of this one`;
    }
  }
  return undefined;
}
