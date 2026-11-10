import { PERMISSION_ACTIONS } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import {
  permissionPhrase,
  permissionSentence,
  recipientPermissionSentence,
} from './permission-phrases';

describe('what each access lets a person do, in plain words (friction F9)', () => {
  it('writes a sentence that starts with They can', () => {
    expect(permissionSentence('PREVIEW')).toBe('They can open and read your documents.');
    expect(permissionSentence('VIEW_METADATA')).toBe('They can see the details of your documents.');
  });

  it('has words for every kind of access, so nothing is shown as a code', () => {
    for (const action of PERMISSION_ACTIONS) {
      const phrase = permissionPhrase(action);
      expect(phrase, action).not.toMatch(/[A-Z_]{4,}/);
      expect(phrase.length, action).toBeGreaterThan(3);
    }
  });

  it('speaks to the person being offered access in their own voice, never as if the files were theirs', () => {
    expect(recipientPermissionSentence('PREVIEW')).toBe(
      'You will be able to open and read their documents.',
    );
    expect(recipientPermissionSentence('PROPOSE_EDIT')).toBe(
      'You will be able to suggest changes, which they approve first.',
    );
    for (const action of PERMISSION_ACTIONS) {
      const sentence = recipientPermissionSentence(action);
      expect(sentence, action).not.toMatch(/\byour\b/i);
      expect(sentence, action).toMatch(/^You will be able to /);
    }
  });
});
