import { describe, expect, it } from 'vitest';
import { rowsToCsv } from './export-csv';

describe('rowsToCsv (PRV-04, Part 7 §14: "readable JSON/CSV metadata")', () => {
  it('returns an empty string for no rows', () => {
    expect(rowsToCsv([])).toBe('');
  });

  it('renders a header row from the first row’s own keys, then one line per row', () => {
    const csv = rowsToCsv([
      { id: 'a1', name: 'Alice', age: 30 },
      { id: 'a2', name: 'Bob', age: 25 },
    ]);
    expect(csv).toBe('id,name,age\r\na1,Alice,30\r\na2,Bob,25');
  });

  it('quotes and escapes a field containing a comma', () => {
    expect(rowsToCsv([{ note: 'Dhaka, Bangladesh' }])).toBe('note\r\n"Dhaka, Bangladesh"');
  });

  it('quotes a field containing a newline and doubles embedded quotes', () => {
    const csv = rowsToCsv([{ note: 'line one\nline "two"' }]);
    expect(csv).toBe('note\r\n"line one\nline ""two"""');
  });

  it('renders null and undefined as empty fields, never the literal string', () => {
    const csv = rowsToCsv([{ a: null, b: undefined, c: 'x' }]);
    expect(csv).toBe('a,b,c\r\n,,x');
  });

  it('renders a Date as its ISO string', () => {
    const when = new Date('2026-01-15T10:00:00.000Z');
    expect(rowsToCsv([{ createdAt: when }])).toBe('createdAt\r\n2026-01-15T10:00:00.000Z');
  });

  it('renders a boolean and falls back to JSON for a nested object', () => {
    const csv = rowsToCsv([{ active: true, meta: { k: 'v' } }]);
    expect(csv).toBe('active,meta\r\ntrue,"{""k"":""v""}"');
  });
});
