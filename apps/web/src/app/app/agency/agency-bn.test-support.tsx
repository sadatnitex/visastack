import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../../../components/i18n-provider';
import { appAgencyCatalog } from '../../../i18n/app-agency';

const bnCatalog = appAgencyCatalog.bn as Record<string, string>;

/** The Bengali value of an agency message by its short key (without the "appAgency." prefix). */
export const bnText = (key: string): string => {
  const value = bnCatalog[`appAgency.${key}`];
  if (value === undefined) throw new Error(`No Bengali value for appAgency.${key}`);
  return value;
};

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&#x27;': "'",
  '&quot;': '"',
  '&lt;': '<',
  '&gt;': '>',
};

/** One pass over the markup, so a decoded "&" can never start another entity. */
const decode = (html: string) =>
  html
    .replace(/&(?:amp|#x27|quot|lt|gt);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\s+/g, ' ');

/** The fixed words of a message: its text with every {placeholder} (and plural block) cut out. */
function fixedParts(template: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of template) {
    if (ch === '{') {
      if (depth === 0 && current.trim()) parts.push(current.trim());
      if (depth === 0) current = '';
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
    } else if (depth === 0) {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * True when the markup (text, placeholder or accessible name) holds the Bengali message: every
 * fixed run of words from it, in order.
 */
export function showsBengali(html: string, key: string): boolean {
  const page = decode(html);
  let from = 0;
  for (const part of fixedParts(bnText(key))) {
    const at = page.indexOf(part.replace(/\s+/g, ' '), from);
    if (at < 0) return false;
    from = at + part.length;
  }
  return true;
}

/** Keys (short form) that the markup does not show in Bengali. Empty means all are shown. */
export const missingBengali = (html: string, keys: readonly string[]): string[] =>
  keys.filter((key) => !showsBengali(html, key));

/** Renders a client component the way a Bengali visitor's page would. */
export function drawBn(node: React.ReactNode): string {
  return renderToStaticMarkup(
    <I18nProvider locale="bn" pageLang="en">
      {node}
    </I18nProvider>,
  );
}
