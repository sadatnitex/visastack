import { supportedFieldKeys } from '@visastack/core/catalogue/documents';

export interface FieldScope {
  /** The field keys the model may map to for this document. */
  readonly keys: readonly string[];
  /** True when the list was narrowed to what the document type carries. */
  readonly scoped: boolean;
}

/**
 * Narrows the fields an AI reading may propose to the ones the document type is known to carry.
 *
 * - A document with no type yet, or a type the catalogue has no list for, keeps every registered field,
 *   exactly as before.
 * - Only registered fields can ever be proposed (a proposal needs a field definition to be approved), so the
 *   narrowed list is the overlap of the two lists.
 * - When none of a type's listed fields is registered yet, nothing would be left to read, so the full
 *   registered list is kept. That holds until the registry catches up with the catalogue; it never hides data
 *   a person could already approve today.
 */
export function scopeFieldKeys(registered: readonly string[], docType: string | null): FieldScope {
  if (!docType) return { keys: registered, scoped: false };
  const supported = supportedFieldKeys(docType);
  if (!supported) return { keys: registered, scoped: false };
  const allowed = new Set(supported);
  const keys = registered.filter((key) => allowed.has(key));
  return keys.length > 0 ? { keys, scoped: true } : { keys: registered, scoped: false };
}
