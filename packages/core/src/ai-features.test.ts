import { describe, expect, it } from 'vitest';
import {
  AI_FEATURES,
  AI_FEATURE_KEYS,
  AI_FEATURE_LIMIT_HINT,
  AI_FEATURE_OFF_HINT,
  AI_FEATURE_OFF_REASONS,
  AI_PLAN_TIERS,
  aiFeatureOffHint,
  aiFeatureOffSentence,
  effectiveAiDailyLimit,
  isAiFeatureKey,
} from './ai-features';

describe('the AI feature registry', () => {
  it('registers every AI feature (S28), the six that worked before on by default and uncapped', () => {
    expect(AI_FEATURE_KEYS).toEqual([
      'ai_automatic_reading',
      'ai_document_reading',
      'ai_document_kind',
      'ai_explanations',
      'ai_consistency_checks',
      'ai_app_access',
      'ai_app_suggestions',
      'ai_app_original_files',
    ]);
    for (const key of [
      'ai_automatic_reading',
      'ai_document_reading',
      'ai_document_kind',
      'ai_explanations',
      'ai_consistency_checks',
      'ai_app_access',
    ] as const) {
      // Defaults keep today's behaviour: on, included, counted but not limited.
      expect(AI_FEATURES[key]).toMatchObject({
        defaultEnabled: true,
        planDefault: { included: true, dailyLimit: null },
      });
      expect(AI_PLAN_TIERS.FREE[key]).toEqual({ included: true, dailyLimit: null });
    }
    expect(AI_FEATURES.ai_app_access.kind).toBe('connector');
    expect(AI_FEATURES.ai_document_reading).toMatchObject({ name: 'Read with AI', kind: 'model' });
  });

  it('registers AI App Suggestions, off until the platform owner turns it on, 15 a day', () => {
    expect(AI_FEATURES.ai_app_suggestions).toMatchObject({
      name: 'AI App Suggestions',
      defaultEnabled: false,
      planDefault: { included: true, dailyLimit: 15 },
    });
    expect(AI_PLAN_TIERS.FREE.ai_app_suggestions).toEqual({ included: true, dailyLimit: 15 });
  });

  it('registers AI App Original Files (S20), off until the platform owner turns it on, 30 a day', () => {
    expect(AI_FEATURES.ai_app_original_files).toMatchObject({
      name: 'AI App Original Files',
      defaultEnabled: false,
      planDefault: { included: true, dailyLimit: 30 },
    });
    expect(AI_PLAN_TIERS.FREE.ai_app_original_files).toEqual({ included: true, dailyLimit: 30 });
  });

  it('gives every feature a Title Case name, one sentence, a unit and a place in every plan', () => {
    for (const key of AI_FEATURE_KEYS) {
      const feature = AI_FEATURES[key];
      expect(feature.key).toBe(key);
      // Every word starts with a capital ("AI" included), except a small joining word; one space
      // between words.
      expect(feature.name).toMatch(
        /^[A-Z][A-Za-z]*(?: (?:with|for|and|of|the|to|[A-Z][A-Za-z]*))*$/,
      );
      expect(feature.description).toMatch(/^[A-Z].*\.$/);
      expect(feature.unit).toMatch(/^[a-z]+$/);
      expect(['model', 'connector']).toContain(feature.kind);
      // The built-in plan is the registry's own default, so the two can never drift apart.
      for (const tier of Object.values(AI_PLAN_TIERS)) expect(tier[key]).toBe(feature.planDefault);
    }
  });

  it('knows only registered keys', () => {
    expect(isAiFeatureKey('ai_app_suggestions')).toBe(true);
    expect(isAiFeatureKey('ai_automatic_reading')).toBe(true);
    expect(isAiFeatureKey('toString')).toBe(false);
    expect(isAiFeatureKey('automatic_reading')).toBe(false);
  });

  it('takes the smaller of the plan and admin limits, never raising the plan', () => {
    expect(effectiveAiDailyLimit(15, null)).toBe(15);
    expect(effectiveAiDailyLimit(15, 5)).toBe(5);
    expect(effectiveAiDailyLimit(15, 500)).toBe(15);
    expect(effectiveAiDailyLimit(null, 7)).toBe(7);
    expect(effectiveAiDailyLimit(null, null)).toBeNull();
  });

  it('lists the reasons a feature is off in the order they are decided, and words each', () => {
    expect(AI_FEATURE_OFF_REASONS).toEqual([
      'platform_off',
      'turned_off',
      'not_in_plan',
      'daily_limit',
      'not_available_yet',
    ]);
    expect(aiFeatureOffHint('daily_limit')).toBe(AI_FEATURE_LIMIT_HINT);
    expect(AI_FEATURE_LIMIT_HINT).toContain('6 AM Bangladesh time');
    for (const reason of AI_FEATURE_OFF_REASONS.filter((r) => r !== 'daily_limit')) {
      expect(aiFeatureOffHint(reason)).toBe(AI_FEATURE_OFF_HINT);
    }
  });

  it('names the feature where one screen speaks about it (S28 round 2)', () => {
    expect(aiFeatureOffSentence('ai_app_access', 'turned_off')).toBe(
      'AI App Access is turned off right now.',
    );
    expect(aiFeatureOffSentence('ai_app_access', 'daily_limit')).toBe(
      'You have reached today’s limit for AI App Access. It starts again at 6 AM Bangladesh time.',
    );
  });
});

describe('how an AI app is named on screen', () => {
  it('cleans the name again, keeps only an address, and falls back to "an AI App"', async () => {
    const { aiAppLabel, aiAppName } = await import('./ai-features');
    expect(aiAppLabel({ name: 'Claude', host: 'claude.ai' })).toBe('Claude (claude.ai)');
    expect(aiAppName(`Clau${String.fromCodePoint(0x202e)}de   App`)).toBe('Claude App');
    expect(aiAppName('   ')).toBe('an AI App');
    expect(aiAppLabel({ name: null, host: 'chatgpt.com' })).toBe('an AI App (chatgpt.com)');
    expect(aiAppLabel({ name: 'X', host: '<script>' })).toBe('X (script)');
    expect(aiAppLabel({ name: 'X', host: null })).toBe('X');
  });
});
