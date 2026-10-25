import { describe, expect, it } from 'vitest';
import { agree, plural } from './plural';

describe('plural', () => {
  it('says one thing in the singular and any other count in the plural', () => {
    expect(plural(1, 'item')).toBe('1 item');
    expect(plural(0, 'item')).toBe('0 items');
    expect(plural(2, 'item')).toBe('2 items');
    expect(plural(2, 'person', 'people')).toBe('2 people');
  });

  it('makes the verb agree with the count', () => {
    expect(`${plural(1, 'item')} ${agree(1, 'needs', 'need')} a decision`).toBe(
      '1 item needs a decision',
    );
    expect(`${plural(2, 'item')} ${agree(2, 'needs', 'need')} a decision`).toBe(
      '2 items need a decision',
    );
  });
});
