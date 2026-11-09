import { resolveDocumentType } from '@visastack/core/catalogue';
import { humanizeCode } from './format-code';

/**
 * Plain names for the kinds of document a checklist item can be typed as, where the stored code
 * would read badly ("Noc", "Nid"). Keys are the stored code in capitals with underscores. A kind
 * that is a known abbreviation reads out in full with the short form after it.
 */
const KIND_NAMES: Readonly<Record<string, string>> = {
  NOC: 'No Objection Certificate (NOC)',
  NID: 'National ID',
  TIN: 'Tax ID (TIN)',
  CV: 'CV',
};

/**
 * The name of a document kind: the abbreviation table, then the document catalogue's own label,
 * then the stored code made into words. A sentence is never built from this; it only names a
 * type ("Bank Statement") when an item has no sentence of its own.
 */
export function documentKindLabel(key: string): string {
  const code = key
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_');
  return KIND_NAMES[code] ?? resolveDocumentType(key)?.label ?? humanizeCode(key);
}
