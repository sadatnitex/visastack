/**
 * The model IDs offered in AI Settings for each provider: the exact IDs the provider's API takes,
 * newest and recommended first. Only IDs confirmed for the provider are listed (Anthropic's from
 * its models table, checked 2026-10-30; OpenAI's and Gemini's are the ones this platform already
 * runs). Any other ID can still be entered with "Other Model ID", so a model released later works
 * without a code change. Free of imports so the settings form can use it in the browser.
 */

export interface AiModelOption {
  readonly id: string;
  /** The provider's own name for the model, and what it is best at, in a few plain words. */
  readonly label: string;
}

export const AI_MODEL_OPTIONS: Readonly<Record<string, readonly AiModelOption[]>> = {
  anthropic: [
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5, Most Accurate (Recommended)' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5, Fast and Strong' },
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5, Fastest and Cheapest' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1, Most Capable, Highest Cost' },
    { id: 'claude-opus-5', label: 'Claude Opus 5' },
    { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
    { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
    { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
  ],
  openai: [{ id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' }],
  gemini: [
    { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
  ],
};

/** The value the model list sends when the admin types an ID instead of picking one. */
export const OTHER_MODEL = '__other';

export function aiModelOptionsFor(provider: string): readonly AiModelOption[] {
  return AI_MODEL_OPTIONS[provider] ?? [];
}

/** True when `model` is one of the listed IDs for `provider`. */
export function isListedAiModel(provider: string, model: string): boolean {
  return aiModelOptionsFor(provider).some((option) => option.id === model);
}
