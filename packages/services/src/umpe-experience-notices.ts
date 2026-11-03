/**
 * UMPE P13: the package changes that need the traveller, as Needs Attention items for Home and
 * the traveller's Home (locked contract section 9: show changes only when relevant to action,
 * near the affected trip, with the full record one step away).
 *
 * Two sources, both written by earlier units and only read here:
 * - P4 continuous matching (`umpe_package_changes`): one open change per case.
 * - P11 rule impact (`umpe_rule_impacts`): a newer checklist version was published while the case
 *   still uses the older one.
 *
 * "Needs action" uses the same rules the send-time rechecks of those notes use: the item is open,
 * the case is active and not purged, and for a rule impact the case is still on the older version.
 * A case with both gets one item, the package change (its wording names the precise next step).
 *
 * Items carry plain words, ids for links and nothing else: never a value, a document name or a
 * file name. Both tables ship before their migrations run in production, so a missing table
 * simply contributes nothing. The read is owner-only, through the central gate, like Needs
 * Attention itself.
 */
import { type Result, err, ok } from '@visastack/core';
import { and, desc, eq, isNull, notInArray, sql } from 'drizzle-orm';
import { AuthorizedApplicant } from './access/require-access';
import type { AttentionItem } from './attention';
import { schema } from './db';
import { type ServiceError, serviceError } from './errors';
import { ruleImpactTablesPresent } from './umpe-correction-tables';
import { PACKAGE_CHANGE_LABELS, type PackageChangeKind } from './umpe-package-phrases';
import { INACTIVE_CASE_STATES, packageTablesPresent } from './umpe-package-tables';
import { ruleChangeSentence } from './umpe-rule-impact-service';

/** Upper bound on cases read from each source for one traveller, newest change first. */
export const PACKAGE_NOTICE_LIMIT = 20;

/** The section of the case page that holds the package and its change (both notes link here). */
export const PACKAGE_NOTICE_ANCHOR = 'trip-package';

export const PACKAGE_NOTICE_TITLES = {
  package: 'Trip Package Changed',
  rule: 'Checklist Updated',
} as const;

const KNOWN_KINDS: ReadonlySet<string> = new Set(Object.keys(PACKAGE_CHANGE_LABELS));

function isPackageChangeKind(kind: string): kind is PackageChangeKind {
  return KNOWN_KINDS.has(kind);
}

function ruleKind(value: string): 'ADDED' | 'CHANGED' | 'REMOVED' | 'NONE' {
  return value === 'ADDED' || value === 'CHANGED' || value === 'REMOVED' ? value : 'NONE';
}

function noticeItem(input: {
  readonly source: 'package' | 'rule';
  readonly missionId: string;
  readonly caseTitle: string;
  readonly applicantId: string;
  readonly applicantName: string;
  readonly why: string;
  readonly seenAt: Date;
}): AttentionItem {
  return {
    // One item per case, whichever source raised it, so Home never lists a case twice.
    key: `case_package:${input.missionId}`,
    kind: 'case_changed',
    tier: 4,
    title: PACKAGE_NOTICE_TITLES[input.source],
    why: input.why,
    applicantId: input.applicantId,
    applicantName: input.applicantName,
    caseId: input.missionId,
    caseTitle: input.caseTitle,
    dueDate: null,
    dueState: 'none',
    daysUntilDue: null,
    sentBack: false,
    count: null,
    subject: null,
    href: `/app/mission/${input.missionId}#${PACKAGE_NOTICE_ANCHOR}`,
    createdAt: input.seenAt.toISOString(),
  };
}

/**
 * The open package changes and rule updates on one traveller's active cases, newest first, at
 * most one per case. Owner only: anyone else is refused exactly as Needs Attention refuses them.
 */
export async function listPackageNotices(
  access: AuthorizedApplicant<'VIEW_METADATA'>,
): Promise<Result<readonly AttentionItem[], ServiceError>> {
  if (
    !AuthorizedApplicant.isGenuine(access, 'VIEW_METADATA') ||
    access.actor.kind !== 'applicant_owner' ||
    access.resource.kind !== 'applicant'
  ) {
    return err(serviceError('forbidden', 'package notices are available to the owner only'));
  }
  const db = access.tx;
  const applicantId = access.applicant.id;
  const applicantName = access.applicant.displayName;
  const inactive = [...INACTIVE_CASE_STATES];
  const activeCase = and(
    eq(schema.missions.applicantId, applicantId),
    isNull(schema.missions.purgedAt),
    notInArray(sql`${schema.missions.state}::text`, inactive),
  );

  const [packageReady, ruleReady] = await Promise.all([
    packageTablesPresent(db),
    ruleImpactTablesPresent(db),
  ]);

  const packageRows = packageReady
    ? await db
        .select({
          missionId: schema.umpePackageChanges.missionId,
          kind: schema.umpePackageChanges.kind,
          lastSeenAt: schema.umpePackageChanges.lastSeenAt,
          caseTitle: schema.missions.title,
        })
        .from(schema.umpePackageChanges)
        .innerJoin(schema.missions, eq(schema.missions.id, schema.umpePackageChanges.missionId))
        .where(
          and(
            eq(schema.umpePackageChanges.applicantId, applicantId),
            isNull(schema.umpePackageChanges.resolvedAt),
            activeCase,
          ),
        )
        .orderBy(desc(schema.umpePackageChanges.lastSeenAt), desc(schema.umpePackageChanges.id))
        .limit(PACKAGE_NOTICE_LIMIT)
    : [];

  const covered = new Set(packageRows.map((row) => row.missionId));
  const ruleRows = ruleReady
    ? await db
        .select({
          missionId: schema.umpeRuleImpacts.missionId,
          changeKind: schema.umpeRuleImpacts.changeKind,
          itemKind: schema.umpeRuleImpacts.itemKind,
          itemKey: schema.umpeRuleImpacts.itemKey,
          changedCount: schema.umpeRuleImpacts.changedCount,
          createdAt: schema.umpeRuleImpacts.createdAt,
          caseTitle: schema.missions.title,
        })
        .from(schema.umpeRuleImpacts)
        .innerJoin(schema.missions, eq(schema.missions.id, schema.umpeRuleImpacts.missionId))
        .where(
          and(
            eq(schema.umpeRuleImpacts.subjectKind, 'CASE'),
            isNull(schema.umpeRuleImpacts.resolvedAt),
            // Still on the version the newer one replaced: once the case moves on, it is done.
            eq(schema.missions.packVersionId, schema.umpeRuleImpacts.previousPackVersionId),
            activeCase,
            covered.size > 0
              ? notInArray(schema.umpeRuleImpacts.missionId, [...covered])
              : undefined,
          ),
        )
        .orderBy(desc(schema.umpeRuleImpacts.createdAt), desc(schema.umpeRuleImpacts.id))
        .limit(PACKAGE_NOTICE_LIMIT)
    : [];

  const items: AttentionItem[] = [];
  for (const row of packageRows) {
    if (!isPackageChangeKind(row.kind)) continue;
    items.push(
      noticeItem({
        source: 'package',
        missionId: row.missionId,
        caseTitle: row.caseTitle,
        applicantId,
        applicantName,
        why: PACKAGE_CHANGE_LABELS[row.kind],
        seenAt: row.lastSeenAt,
      }),
    );
  }
  const seen = new Set(covered);
  for (const row of ruleRows) {
    // A case flagged by more than one publication still gets one item: the newest.
    if (row.missionId === null || seen.has(row.missionId)) continue;
    seen.add(row.missionId);
    items.push(
      noticeItem({
        source: 'rule',
        missionId: row.missionId,
        caseTitle: row.caseTitle,
        applicantId,
        applicantName,
        why: `${ruleChangeSentence({
          changeKind: ruleKind(row.changeKind),
          itemKind: row.itemKind === 'FIELD' || row.itemKind === 'DOCUMENT' ? row.itemKind : null,
          itemKey: row.itemKey,
          changedCount: row.changedCount,
        })} Review it before you share anything.`,
        seenAt: row.createdAt,
      }),
    );
  }
  return ok(items);
}
