import { describe, expect, it } from 'vitest';
import { humanizeCode } from './format-code';

describe('humanizeCode', () => {
  it('writes a stored code as plain words', () => {
    expect(humanizeCode('IN_PROGRESS')).toBe('In Progress');
    expect(humanizeCode('bank_statement')).toBe('Bank Statement');
    expect(humanizeCode('PASSPORT')).toBe('Passport');
    expect(humanizeCode('')).toBe('');
  });
});
