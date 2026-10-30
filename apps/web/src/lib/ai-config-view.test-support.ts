import type { ConfigFormView } from '../app/app/admin/ai-settings/forms';

/** A saved AI configuration as the settings forms see it. */
export function aiConfigView(overrides: Partial<ConfigFormView> = {}): ConfigFormView {
  return {
    id: 'c1',
    status: 'DRAFT',
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    reasoningEffort: null,
    dataPolicyApproved: true,
    budgetUsd: 100,
    perDocumentBudgetUsd: null,
    maxAttemptsPerDocument: 3,
    maxPagesPerDocument: null,
    cacheMaxAgeDays: null,
    maxConcurrentCalls: null,
    fallbackEnabled: false,
    fallbackProviderConfigId: null,
    notes: 'Pilot',
    apiKeyFingerprint: '...MQAA',
    keyRevoked: false,
    editableInPlace: true,
    ...overrides,
  };
}
