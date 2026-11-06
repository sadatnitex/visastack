import { csvCell, parseCsv } from '../csv';
import {
  type StarterPackDefinition,
  type StarterRequirement,
  type StarterSheetRow,
  sameLine,
} from './build';

/** The columns of the sheet, in order, as its header row names them. */
export const STARTER_SHEET_COLUMNS = [
  'Country',
  'Purpose',
  'Applies when',
  'Document / requirement',
  'Keep?',
  'Reference file',
] as const;

const PURPOSE_NAMES = {
  tourist: 'Tourist (base)',
  business: 'Business (extra)',
  medical: 'Medical (extra)',
} as const;

export type StarterSheetRead =
  | { readonly ok: true; readonly rows: readonly StarterSheetRow[] }
  | { readonly ok: false; readonly problem: string };

/**
 * Reads the sheet saved as CSV. The header row (the one that starts with "Country" and holds the
 * six column names) may follow a few title lines, which are ignored; everything below it is a line.
 * A line with no country and no requirement is skipped.
 */
export function readStarterSheet(csv: string): StarterSheetRead {
  const table = parseCsv(csv);
  const at = table.findIndex(
    (cells) =>
      cells.length >= STARTER_SHEET_COLUMNS.length &&
      STARTER_SHEET_COLUMNS.every(
        (name, i) => (cells[i] ?? '').trim().toLowerCase() === name.toLowerCase(),
      ),
  );
  if (at < 0) {
    return {
      ok: false,
      problem: `The file needs a header row with these columns: ${STARTER_SHEET_COLUMNS.join(', ')}.`,
    };
  }
  const rows: StarterSheetRow[] = [];
  for (const cells of table.slice(at + 1)) {
    const [country = '', purpose = '', appliesWhen = '', text = '', keep = '', reference = ''] =
      cells;
    if (country.trim() === '' && text.trim() === '') continue;
    rows.push({ country, purpose, appliesWhen, text, keep: keep === '' ? 'Yes' : keep, reference });
  }
  return { ok: true, rows };
}

/**
 * The lists as a sheet in the same shape, so an admin can export them, edit them in a spreadsheet
 * and read them back. A Business or Medical list is written as its extra lines only (the base is
 * the Tourist list), which is how the sheet is read.
 */
export function starterSheetCsv(packs: readonly StarterPackDefinition[]): string {
  const lines: string[] = [STARTER_SHEET_COLUMNS.map((name) => csvCell(name)).join(',')];
  // The base of a country is its Tourist list; an extra list adds the lines the base does not have.
  const baseTexts = new Map<string, readonly StarterRequirement[]>();
  for (const pack of packs) {
    if (pack.starterPurpose === 'tourist') {
      baseTexts.set(pack.jurisdiction, pack.requirements);
    }
  }
  for (const pack of packs) {
    const base = pack.starterPurpose === 'tourist' ? null : baseTexts.get(pack.jurisdiction);
    for (const requirement of pack.requirements) {
      if (base?.some((line) => sameLine(line, requirement))) continue;
      lines.push(
        [
          pack.name.replace(/ (Tourist|Business|Medical) Starter List$/, ''),
          PURPOSE_NAMES[pack.starterPurpose],
          requirement.appliesWhen,
          requirement.text,
          'Yes',
          requirement.reference,
        ]
          .map((cell) => csvCell(cell))
          .join(','),
      );
    }
  }
  return `${lines.join('\n')}\n`;
}
