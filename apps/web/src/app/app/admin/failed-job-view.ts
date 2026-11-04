/**
 * What the failed-jobs list may show a staff member. A file name and its error text can identify
 * a traveller, so only roles allowed to read traveller names see them. Everyone else sees the
 * word "Document" and a short code, enough to tell two rows apart and to retry one.
 */
interface FailedJobRow {
  readonly documentId: string;
  readonly documentName: string;
  readonly lastError: string | null;
}

export function documentLabel(documentId: string): string {
  const code = documentId
    .replace(/[^0-9a-zA-Z]/g, '')
    .slice(0, 6)
    .toUpperCase();
  return code ? `Document ${code}` : 'Document';
}

export function hideFileNames<T extends FailedJobRow, L extends { readonly items: readonly T[] }>(
  list: L,
  allowed: boolean,
): L {
  if (allowed) return list;
  return {
    ...list,
    items: list.items.map((job) => ({
      ...job,
      documentName: documentLabel(job.documentId),
      lastError: null,
    })),
  };
}
