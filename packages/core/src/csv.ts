/**
 * One CSV cell that is safe to open in a spreadsheet. Shared by every CSV the product writes (the
 * account export, and the billing ledger), so the rule lives in one place.
 *
 * Formula cells are defused (CSV injection): a cell whose text starts, after any leading spaces,
 * with `=`, `+`, `-`, `@`, a tab or a carriage return would be run as a formula by Excel, Sheets or
 * Numbers. Such a cell gets a leading apostrophe, so it is read as text, and is always quoted.
 * Some spreadsheets show that apostrophe (a phone number such as +44... reads '+44...): the known
 * price of never running a formula. Anything holding a quote, comma or line break is quoted too,
 * with quotes doubled (RFC 4180). The text itself is never otherwise changed.
 *
 * Pure and browser-safe.
 */
const FORMULA_START = new Set(['=', '+', '-', '@', '\t', '\r']);

/** Whether a spreadsheet could read `text` as a formula. */
export function isCsvFormula(text: string): boolean {
  let index = 0;
  while (text[index] === ' ') index += 1;
  const first = text[index];
  return first !== undefined && FORMULA_START.has(first);
}

/**
 * `text` as one safe CSV cell. `alwaysQuote` quotes every cell, as the billing ledger file does;
 * otherwise a cell is quoted only when it needs to be (or was defused).
 */
export function csvCell(text: string, options: { readonly alwaysQuote?: boolean } = {}): string {
  const formula = isCsvFormula(text);
  const safe = formula ? `'${text}` : text;
  if (options.alwaysQuote || formula || /[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}
