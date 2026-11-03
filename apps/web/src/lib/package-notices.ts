import {
  type AttentionItem,
  type Db,
  type PackageNoticeTables,
  listPackageNotices,
  packageNoticeTablesReady,
} from '@visastack/services';

/**
 * UMPE P13: the package changes and checklist updates that need one traveller, for Home and the
 * traveller's Home. Read through the owner proof the page already holds. Any refusal or failure
 * gives null, so a page shows everything else exactly as before and never fails for these.
 */
export async function readPackageNotices(
  access: Parameters<typeof listPackageNotices>[0],
  tables?: PackageNoticeTables | null,
): Promise<readonly AttentionItem[] | null> {
  try {
    const read = await listPackageNotices(access, tables ? { tables } : {});
    return read.ok ? read.value : null;
  } catch {
    return null;
  }
}

/**
 * Which source tables exist, asked once for a page that reads many travellers. Null on failure:
 * each traveller's read then asks for itself.
 */
export async function readPackageNoticeTables(db: Db): Promise<PackageNoticeTables | null> {
  try {
    return await packageNoticeTablesReady(db);
  } catch {
    return null;
  }
}

/** The label above a notice in a Needs Attention list (its tier's own label is about confirming). */
export const PACKAGE_NOTICE_TIER_LABEL = 'Trip Changed';

/**
 * The notices worth listing beside `items`: a case that Needs Attention already lists as changed
 * since it was confirmed keeps that one item, so one change never asks for two actions.
 */
export function noticesToRank(
  items: readonly AttentionItem[],
  notices: readonly AttentionItem[],
): readonly AttentionItem[] {
  const changed = new Set(
    items.flatMap((item) => (item.kind === 'case_changed' && item.caseId ? [item.caseId] : [])),
  );
  return notices.filter((notice) => !(notice.caseId && changed.has(notice.caseId)));
}

/** The note shown beside a case on Home: its two-word title and the link to the change. */
export interface CaseNotice {
  readonly title: string;
  readonly href: string;
}

/** The cases that have a notice, keyed by case id (the read gives at most one per case). */
export function noticesByCase(notices: readonly AttentionItem[]): ReadonlyMap<string, CaseNotice> {
  const byCase = new Map<string, CaseNotice>();
  for (const notice of notices) {
    if (notice.caseId && !byCase.has(notice.caseId)) {
      byCase.set(notice.caseId, { title: notice.title, href: notice.href });
    }
  }
  return byCase;
}
