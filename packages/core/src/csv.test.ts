import { describe, expect, it } from 'vitest';
import { csvCell, isCsvFormula } from './csv';

describe('csvCell', () => {
  it.each([
    [
      '=HYPERLINK("https://example.test","Open")',
      `"'=HYPERLINK(""https://example.test"",""Open"")"`,
    ],
    ['+1+1', `"'+1+1"`],
    ['-2+3', `"'-2+3"`],
    ['@SUM(A1)', `"'@SUM(A1)"`],
    ['\t=1', `"'\t=1"`],
    ['\r=1', `"'\r=1"`],
    ['   =1+1', `"'   =1+1"`],
  ])('defuses a formula cell: %j', (text, cell) => {
    expect(isCsvFormula(text)).toBe(true);
    expect(csvCell(text)).toBe(cell);
  });

  it('leaves plain text alone and quotes only what CSV needs', () => {
    expect(csvCell('Dear Sir')).toBe('Dear Sir');
    expect(csvCell('a = b')).toBe('a = b');
    expect(csvCell('one, two')).toBe('"one, two"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell('')).toBe('');
    expect(csvCell('   ')).toBe('   ');
    expect(isCsvFormula('2026-10-30')).toBe(false);
  });
});
