import {
  AI_CONNECTION_DEFAULT_DURATION as SERVICE_DEFAULT_DURATION,
  AI_CONNECTION_DEFAULT_LAYERS as SERVICE_DEFAULT_LAYERS,
  AI_CONNECTION_DURATIONS as SERVICE_DURATIONS,
  AI_CONNECTION_LAYERS as SERVICE_LAYERS,
  AI_CONNECTION_WARNING_LAYERS as SERVICE_WARNING_LAYERS,
} from '@visastack/services';
import { describe, expect, it } from 'vitest';
import * as browser from './ai-consent-choices';
import { AI_DURATION_LABELS, AI_LAYER_LABELS, AI_LAYER_NOTES } from './ai-consent-labels';

describe('the consent screen vocabulary', () => {
  it('is the same list the server stores and checks', () => {
    expect(browser.AI_CONNECTION_LAYERS).toEqual(SERVICE_LAYERS);
    expect(browser.AI_CONNECTION_DEFAULT_LAYERS).toEqual(SERVICE_DEFAULT_LAYERS);
    expect(browser.AI_CONNECTION_WARNING_LAYERS).toEqual(SERVICE_WARNING_LAYERS);
    expect(browser.AI_CONNECTION_DURATIONS).toEqual(SERVICE_DURATIONS);
    expect(browser.AI_CONNECTION_DEFAULT_DURATION).toBe(SERVICE_DEFAULT_DURATION);
  });

  it('names every choice, in words without engineering terms', () => {
    for (const layer of browser.AI_CONNECTION_LAYERS) {
      expect(AI_LAYER_LABELS[layer]).toBeTruthy();
      expect(AI_LAYER_NOTES[layer]).toBeTruthy();
    }
    for (const duration of browser.AI_CONNECTION_DURATIONS) {
      expect(AI_DURATION_LABELS[duration]).toBeTruthy();
    }
    const words = JSON.stringify([
      AI_LAYER_LABELS,
      AI_LAYER_NOTES,
      AI_DURATION_LABELS,
    ]).toLowerCase();
    for (const banned of ['oauth', 'mcp', 'token', 'scope']) expect(words).not.toContain(banned);
  });
});
