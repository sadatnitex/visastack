import { type AttentionItem, listPackageNotices } from '@visastack/services';

/**
 * UMPE P13: the package changes and checklist updates that need one traveller, for Home and the
 * traveller's Home. Read through the owner proof the page already holds. Any refusal or failure
 * gives null, so a page shows everything else exactly as before and never fails for these.
 */
export async function readPackageNotices(
  access: Parameters<typeof listPackageNotices>[0],
): Promise<readonly AttentionItem[] | null> {
  try {
    const read = await listPackageNotices(access);
    return read.ok ? read.value : null;
  } catch {
    return null;
  }
}

/** The note shown beside a case on Home: its two-word title and the link to the change. */
export interface CaseNotice {
  readonly title: string;
  readonly href: string;
}

/** The cases that have a package notice, keyed by case id (one notice per case). */
export function noticesByCase(items: readonly AttentionItem[]): ReadonlyMap<string, CaseNotice> {
  const byCase = new Map<string, CaseNotice>();
  for (const item of items) {
    if (item.key.startsWith('case_package:') && item.caseId && !byCase.has(item.caseId)) {
      byCase.set(item.caseId, { title: item.title, href: item.href });
    }
  }
  return byCase;
}
