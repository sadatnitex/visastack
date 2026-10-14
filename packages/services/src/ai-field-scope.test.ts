import { describe, expect, it } from 'vitest';
import { scopeFieldKeys } from './ai-field-scope';

const registered = ['given_name', 'passport_number', 'monthly_income', 'bank_name'];

describe('scopeFieldKeys', () => {
  it('keeps every registered field when the document has no type yet', () => {
    expect(scopeFieldKeys(registered, null)).toEqual({ keys: registered, scoped: false });
  });

  it('keeps every registered field for a type the catalogue does not know', () => {
    expect(scopeFieldKeys(registered, 'SCRAPBOOK_PAGE')).toEqual({
      keys: registered,
      scoped: false,
    });
  });

  it('narrows a passport to the registered fields a passport carries', () => {
    const result = scopeFieldKeys(registered, 'PASSPORT');
    expect(result.scoped).toBe(true);
    expect(result.keys).toEqual(['given_name', 'passport_number']);
  });

  it('matches the type by alias and ignores case and punctuation', () => {
    expect(scopeFieldKeys(registered, 'passport').keys).toEqual(['given_name', 'passport_number']);
  });

  it('never offers a field that is not registered', () => {
    const result = scopeFieldKeys(['passport_number'], 'PASSPORT');
    expect(result.keys).toEqual(['passport_number']);
  });

  it("keeps the full list when none of the type's fields is registered yet", () => {
    // Bank statements list fields that are not live today. Narrowing to nothing would silently stop reading.
    const result = scopeFieldKeys(registered, 'BANK_STATEMENT');
    expect(result).toEqual({ keys: registered, scoped: false });
  });
});
