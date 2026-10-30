import { describe, expect, it } from 'vitest';
import { switchOn } from './switches';

describe('switchOn (S29)', () => {
  it('is on only for "true", with spaces around it ignored', () => {
    expect(switchOn('true')).toBe(true);
    expect(switchOn(' true ')).toBe(true);
    for (const value of [undefined, null, '', 'TRUE', 'True', '1', 'yes', 'on', 'true!', 'false']) {
      expect(switchOn(value), String(value)).toBe(false);
    }
  });
});
