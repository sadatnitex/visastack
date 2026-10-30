import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AI_MODEL_OPTIONS, OTHER_MODEL, aiModelOptionsFor, isListedAiModel } from './ai-models';
import { IMPLEMENTED_PROVIDERS } from './ai-providers';

/** The same model ID rule the service applies before saving (packages/services/src/ai-provider-config.ts). */
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,99}$/;

describe('AI model list', () => {
  it('lists models for every provider that can be configured, each a valid, unique model ID', () => {
    for (const provider of IMPLEMENTED_PROVIDERS) {
      const options = aiModelOptionsFor(provider);
      expect(options.length, provider).toBeGreaterThan(0);
      const ids = options.map((o) => o.id);
      expect(new Set(ids).size, provider).toBe(ids.length);
      for (const id of ids) {
        expect(id, provider).toMatch(MODEL_ID);
        expect(id).not.toBe(OTHER_MODEL);
      }
    }
    expect(Object.keys(AI_MODEL_OPTIONS).sort()).toEqual([...IMPLEMENTED_PROVIDERS].sort());
  });

  it('recommends Claude Opus 5.5 first for Anthropic, and knows what is listed', () => {
    expect(aiModelOptionsFor('anthropic')[0]?.id).toBe('claude-opus-5-5');
    expect(isListedAiModel('anthropic', 'claude-sonnet-5-5')).toBe(true);
    expect(isListedAiModel('anthropic', 'Claude 5.5')).toBe(false);
    expect(aiModelOptionsFor('unknown')).toEqual([]);
  });
});

describe('AI settings model picker', () => {
  it('offers the provider list with the saved model chosen, or opens on "Other Model ID" with an unlisted one filled in', async () => {
    const { EditConfigForm } = await import('../app/app/admin/ai-settings/forms');
    const view = {
      id: 'c1',
      status: 'DRAFT' as const,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      reasoningEffort: null,
      dataPolicyApproved: true,
      budgetUsd: 10,
      perDocumentBudgetUsd: null,
      maxAttemptsPerDocument: null,
      maxPagesPerDocument: null,
      cacheMaxAgeDays: null,
      maxConcurrentCalls: null,
      fallbackEnabled: false,
      fallbackProviderConfigId: null,
      notes: null,
      apiKeyFingerprint: '...abcd',
      keyRevoked: false,
      editableInPlace: true,
    };
    const listed = renderToStaticMarkup(<EditConfigForm config={view} fallbackOptions={[]} />);
    expect(listed).toContain('<option value="claude-sonnet-5-5" selected="">');
    expect(listed).not.toContain('name="modelOther"');

    const unlisted = renderToStaticMarkup(
      <EditConfigForm config={{ ...view, model: 'claude-future-9' }} fallbackOptions={[]} />,
    );
    expect(unlisted).toContain(`<option value="${OTHER_MODEL}" selected="">`);
    expect(unlisted).toMatch(/name="modelOther"[^>]*value="claude-future-9"/);
  });
});
