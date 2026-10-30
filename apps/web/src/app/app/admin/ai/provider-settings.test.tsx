// @vitest-environment jsdom
import type { AiProviderConfig } from '@visastack/services';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The server actions are stand-ins: the sections are only drawn here.
vi.mock('../ai-settings/actions', () =>
  Object.fromEntries(
    [
      'createDraftAiProviderConfigAction',
      'updateDraftAiProviderConfigAction',
      'deleteDraftAiProviderConfigAction',
      'activateAiProviderConfigAction',
      'rollbackAiProviderConfigAction',
      'emergencyDisableAiProviderConfigAction',
      'revokeAiProviderConfigKeyAction',
      'testAiProviderConfigAction',
      'runAiProviderConfigEvaluationAction',
      'recordAiProviderTermsAction',
      'setAiDataRuleAction',
    ].map((name) => [name, async () => ({ ok: true, message: '' })]),
  ),
);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

const { AiAppsSection, AiProvidersSection, DataTermsSection } = await import('./provider-settings');
type Data = Parameters<typeof AiProvidersSection>[0]['data'];

/*
 * S28 round 4: the AI Providers, Data Terms and AI Apps sections of the one AI area keep #351's
 * layout (Active Setup, Drafts, New Setup, Earlier Versions), with headings in order: the section
 * at level 2, its parts at level 3, each version's card at level 4. "Data Terms" is said once.
 */

function config(id: string, status: AiProviderConfig['status']): AiProviderConfig {
  return {
    id,
    status,
    provider: 'anthropic',
    model: `claude-${id}`,
    reasoningEffort: null,
    apiKeyCiphertext: new Uint8Array([1]),
    apiKeyNonce: new Uint8Array([1]),
    apiKeyVersion: 'v1',
    apiKeyFingerprint: '...MQAA',
    keyRevokedAt: null,
    dataPolicyApproved: true,
    budgetLimitUnits: 1_000_000,
    perDocumentBudgetLimitUnits: null,
    maxAttemptsPerDocument: 3,
    maxPagesPerDocument: null,
    cacheMaxAgeDays: null,
    maxConcurrentCalls: null,
    fallbackEnabled: false,
    fallbackProviderConfigId: null,
    notes: null,
    createdByAccountId: null,
    createdAt: new Date('2026-10-30T00:00:00Z'),
    activatedAt: null,
    supersededAt: null,
    disabledAt: null,
  } as AiProviderConfig;
}

function data(): Data {
  const active = config('active', 'ACTIVE');
  return {
    connectionCounts: 'unreadable',
    active,
    fallback: undefined,
    history: [active, config('draft', 'DRAFT'), config('old', 'SUPERSEDED')],
    hasAny: true,
    hasActive: true,
    terms: { available: false, byConfigId: new Map() },
    setting: {
      requireNoTraining: false,
      changedAt: null,
      changedByAccountId: null,
      source: 'default',
    },
    mode: 'synthetic_only',
  } as Data;
}

/** Every heading in the markup, as "h2 AI Providers", read by the HTML parser. */
function headings(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(
    (heading) => `${heading.tagName.toLowerCase()} ${(heading.textContent ?? '').trim()}`,
  );
}

describe('the AI Providers, Data Terms and AI Apps sections (S28 round 4)', () => {
  it('keeps the #351 parts in order, with headings one level under each other', () => {
    const html = renderToStaticMarkup(
      <>
        <DataTermsSection data={data()} />
        <AiAppsSection data={data()} />
        <AiProvidersSection data={data()} />
      </>,
    );
    expect(headings(html)).toEqual([
      'h2 Data Terms',
      'h3 What AI Providers Do with What We Send',
      'h2 AI Apps',
      'h3 AI App Connections',
      'h2 AI Providers',
      'h3 Active Setup',
      'h4 claude-active',
      'h3 Drafts (1)',
      'h4 claude-draft',
      'h3 New Setup',
      'h3 Earlier Versions',
      'h4 claude-old',
    ]);
    // "Data Terms" is the section's own heading, not said again inside its card.
    const terms = renderToStaticMarkup(<DataTermsSection data={data()} />);
    expect(terms.match(/>Data Terms</g)).toHaveLength(1);
  });

  it('never skips a heading level', () => {
    const html = renderToStaticMarkup(<AiProvidersSection data={data()} />);
    const levels = headings(html).map((h) => Number(h.slice(1, 2)));
    for (const [i, level] of levels.entries()) {
      if (i > 0) expect(level - (levels[i - 1] ?? level)).toBeLessThanOrEqual(1);
    }
  });
});
