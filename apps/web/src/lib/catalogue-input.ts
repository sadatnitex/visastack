import { isKnownFieldKey, resolveDocumentType } from '@visastack/core/catalogue';

/**
 * Checks for the names an admin types when building a rule pack, a reminder ladder or a retention
 * rule. The name is matched against the profile catalogue and saved in its one canonical form, so
 * "Pay Slip" and "SALARY_SLIP" become the same requirement and can never silently fail to match the
 * document type the scanner assigns. Applies only to what is typed now; nothing already saved is
 * changed.
 */
export type ParsedName =
  | { readonly ok: true; readonly key: string; readonly label?: string }
  | { readonly ok: false; readonly message: string };

export function parseDocumentTypeInput(raw: string): ParsedName {
  const typed = raw.trim();
  if (typed.length === 0) return { ok: false, message: 'Enter the document type.' };
  const found = resolveDocumentType(typed);
  if (!found) {
    return {
      ok: false,
      message: `"${typed}" is not a known document type. Pick one from the list, or use an "Other" type such as Other Financial Document.`,
    };
  }
  return { ok: true, key: found.key, label: found.label };
}

/** "Passport Number", "passport-number" and "passport_number" all give passport_number. */
export function parseFieldKeyInput(raw: string): ParsedName {
  const typed = raw.trim();
  if (typed.length === 0) return { ok: false, message: 'Enter the field key.' };
  const key = typed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!isKnownFieldKey(key)) {
    return {
      ok: false,
      message: `"${typed}" is not a known profile field. Pick one from the list.`,
    };
  }
  return { ok: true, key };
}
