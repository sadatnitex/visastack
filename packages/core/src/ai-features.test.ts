import { describe, expect, it } from 'vitest';
import {
  AI_FEATURES,
  AI_FEATURE_KEYS,
  AI_PLAN_TIERS,
  effectiveAiDailyLimit,
  isAiFeatureKey,
} from './ai-features';

describe('the AI feature registry', () => {
  it('registers AI App Suggestions, off until the platform owner turns it on, 15 a day', () => {
    expect(AI_FEATURE_KEYS).toEqual(['ai_app_suggestions']);
    expect(AI_FEATURES.ai_app_suggestions).toMatchObject({
      name: 'AI App Suggestions',
      defaultEnabled: false,
      defaultDailyLimit: 15,
    });
    expect(AI_PLAN_TIERS.FREE.ai_app_suggestions).toEqual({ included: true, dailyLimit: 15 });
  });

  it('gives every feature a Title Case name, one sentence and a place in every plan', () => {
    for (const key of AI_FEATURE_KEYS) {
      const feature = AI_FEATURES[key];
      expect(feature.key).toBe(key);
      // Every word starts with a capital ("AI" included); one space between words.
      expect(feature.name).toMatch(/^[A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*$/);
      expect(feature.description).toMatch(/^[A-Z].*\.$/);
      for (const tier of Object.values(AI_PLAN_TIERS)) expect(tier[key]).toBeDefined();
    }
  });

  it('knows only registered keys', () => {
    expect(isAiFeatureKey('ai_app_suggestions')).toBe(true);
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
