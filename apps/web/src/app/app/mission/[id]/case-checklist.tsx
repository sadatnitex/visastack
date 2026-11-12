import { groupByRequirementCategory } from '@visastack/core';
import type { PackageItem } from '@visastack/services';
import type { ComponentProps } from 'react';
import { Icon } from '../../../../components/icons';
import { GroupedList, ListRow, type PaneEntry } from '../../../../components/list-pattern';
import { SectionCard } from '../../../../components/ui-lift';
import { appMissionCatalog } from '../../../../i18n/app-mission';
import { formatDateOnly } from '../../../../lib/format-date';
import { getServerT } from '../../../../lib/i18n-server';
import { FIELD_MARK, documentMark } from '../../../../lib/item-icons';
import { CaseItemPane } from './case-item-pane';
import { itemAction, itemNecessity, itemStatus } from './case-item-view';
import {
  CHECKLIST_GROUP_TONE,
  CHECKLIST_ID_PREFIX,
  CHECKLIST_ROWS_SHOWN,
  type CaseSourceRow,
  type ExpiringDocumentRow,
  type RequirementDetailRow,
  buildChecklistGroups,
  categoryProgress,
  plural,
  requirementLabel,
} from './case-model';
import { ChecklistSearch } from './checklist-search';
import type { CandidateView } from './collaboration-panels';
import { OpenGroupOnLink } from './open-group-on-link';
import type { ExplainGapButton } from './readiness-gap-explain';

/** Why Gap Explanations is off, when it is (S28); undefined when it is on. */
export type GapExplanationOff = ComponentProps<typeof ExplainGapButton>['off'];

/** What the checklist needs to offer an AI explanation of a gap. */
export interface ChecklistExplanations {
  /** An AI provider is set up, so the Explain button may show. */
  readonly configured: boolean;
  /** Set (possibly with no reason) when Gap Explanations is switched off; undefined when on. */
  readonly off: GapExplanationOff;
  /** The newest explanation on file per checklist item (`packRequirementId`). */
  readonly byRequirement: ReadonlyMap<string, string | null>;
}

/** What the rows of the checklist need. */
export interface CaseChecklistProps {
  readonly applicantId: string;
  /** Every checklist row of the case, in checklist order (`requirementDetails`). */
  readonly rows: readonly RequirementDetailRow[];
  /** The checklist the rows come from, named beside the heading; null when it could not be read. */
  readonly packName: string | null;
  /**
   * The address that opens one item's panel without script. It keeps the rest of the address, so a
   * list the person had expanded stays expanded.
   */
  readonly itemHref: (id: string) => string;
  /** The item named by the address, if any: its folder starts open. */
  readonly openItem?: string | null | undefined;
}

/** What the panels of the items need (the rows do not read any of it). */
export interface CaseItemPanesProps {
  readonly missionId: string;
  readonly applicantId: string;
  readonly rows: readonly RequirementDetailRow[];
  /** The chosen document names per checklist item (`evidenceLifecycle.chosenByRequirement`). */
  readonly chosenByRequirement: Readonly<Record<string, readonly string[] | undefined>>;
  readonly explanations: ChecklistExplanations;
  /** The traveller may reword items: the case is open and the feature is switched on. */
  readonly wordingEditable?: boolean;
  /** The longest sentence the service accepts, so the box and the service agree. */
  readonly wordingMax?: number;
  /** No agency has access to the case: an agency-added item says who added it, not who asked. */
  readonly selfReviewed?: boolean;
  readonly packageItems: ReadonlyMap<string, PackageItem>;
  /** The files on file for each item, by item. */
  readonly evidence: ReadonlyMap<string, CandidateView>;
  /** The case is open: the choice of which file counts can still change. */
  readonly evidenceEditable: boolean;
  /** The traveller may still change what the package uses: the package is open. */
  readonly packageEditable: boolean;
  /** How each document must be provided, by item (the checklist's format rules). */
  readonly formatLines: Readonly<Record<string, readonly string[]>>;
}

/** The group that starts open: what needs the person, else what is on file. */
function openGroupKey(keys: readonly string[]): string | undefined {
  return (
    keys.find((key) => key === 'needs-you' || key === 'needs-a-check') ??
    (keys.includes('on-file') ? 'on-file' : keys[0])
  );
}

/**
 * The Evidence Checklist, the heart of the case page: one folder per kind of item (Needs You, Needs
 * a Check, Optional, On File, Does Not Apply), each folder's first rows shown and the rest folded,
 * with the category headings and how far each category is when the checklist has categories. A row
 * is a status mark, a name cut to twelve words, a chip with the specific word and at most one
 * action; opening it shows everything else in the item's panel (`caseItemPanes`). The anchor
 * `#readiness` points at this block.
 */
export function CaseChecklist({
  applicantId,
  rows,
  packName,
  itemHref,
  openItem = null,
}: CaseChecklistProps) {
  const t = getServerT(appMissionCatalog);
  const requirementRow = (r: RequirementDetailRow) => {
    const status = itemStatus(r);
    return (
      <ListRow
        key={r.packRequirementId}
        id={r.packRequirementId}
        name={requirementLabel(r) || '(unnamed)'}
        tone={status.tone}
        status={status.word}
        mark={r.kind === 'DOCUMENT' ? documentMark(r.key) : FIELD_MARK}
        tag={itemNecessity(r)}
        action={itemAction(r, applicantId)}
        openHref={itemHref(r.packRequirementId)}
      />
    );
  };
  const groups = buildChecklistGroups(rows);
  // A fold that would hide a single row hides nothing worth folding: every row shows.
  const shown = (count: number) =>
    count <= CHECKLIST_ROWS_SHOWN + 1 ? count : CHECKLIST_ROWS_SHOWN;
  const progress = categoryProgress(rows);
  // UMPE G2 (R02): category headings show only when the checklist gives categories at all.
  const hasCategories = rows.some((r) => r.category !== null);
  const checklistRows = (part: readonly RequirementDetailRow[]) =>
    hasCategories
      ? groupByRequirementCategory(part, (r) => r.category).map((category) => {
          const reached = progress.get(category.category ?? 'other');
          return (
            <div className="case-category" key={category.category ?? 'other'}>
              <div className="lift-category-head">
                <h5 className="case-category-heading">{category.label}</h5>
                {reached ? (
                  <span className="lift-group-count">
                    {reached.onFile} of {reached.total}
                    <span className="sr-only"> on file</span>
                  </span>
                ) : null}
              </div>
              {category.rows.map(requirementRow)}
            </div>
          );
        })
      : part.map(requirementRow);
  const opened = openGroupKey(groups.map((group) => group.key));
  return (
    <div id="readiness">
      <SectionCard
        heading={t('appMission.appMissionIdCaseChecklist.evidenceChecklist')}
        level={3}
        action={
          packName ? (
            <span className="lift-card-note">
              {t('appMission.appMissionIdCaseChecklist.fromPackname', { packName })}
            </span>
          ) : undefined
        }
      >
        {/* WP-SB2: each group opens and closes. Its heading stays a real heading inside the
            opener, so heading navigation still finds every group. */}
        <OpenGroupOnLink scopeId="readiness" />
        <ChecklistSearch scopeId="readiness" rows={rows.length} />
        <GroupedList
          groups={groups.map((group) => {
            const first = shown(group.rows.length);
            return {
              id: `${CHECKLIST_ID_PREFIX}-${group.key}`,
              heading: group.heading,
              count: group.rows.length,
              tone: CHECKLIST_GROUP_TONE[group.key] ?? 'success',
              // The chosen item's folder is open, so its row is on screen beside its panel.
              open:
                group.key === opened || group.rows.some((r) => r.packRequirementId === openItem),
              children: checklistRows(group.rows.slice(0, first)),
              ...(group.rows.length > first
                ? {
                    restOpen: group.rows.slice(first).some((r) => r.packRequirementId === openItem),
                    rest: checklistRows(group.rows.slice(first)),
                    restLabel: plural(
                      group.rows.length - CHECKLIST_ROWS_SHOWN,
                      'More Item',
                      'More Items',
                    ),
                  }
                : {}),
            };
          })}
        />
      </SectionCard>
    </div>
  );
}

/** One panel per checklist item, in checklist order, for the list to open (`ListWithPane`). */
export function caseItemPanes({
  missionId,
  applicantId,
  rows,
  chosenByRequirement,
  explanations,
  wordingEditable = false,
  wordingMax = 400,
  selfReviewed = false,
  packageItems,
  evidence,
  evidenceEditable,
  packageEditable,
  formatLines,
}: CaseItemPanesProps): PaneEntry[] {
  return rows.map((row) => ({
    id: row.packRequirementId,
    title: requirementLabel(row) || '(unnamed)',
    content: (
      <CaseItemPane
        missionId={missionId}
        applicantId={applicantId}
        row={row}
        rows={rows}
        chosen={chosenByRequirement[row.packRequirementId]}
        formatLines={formatLines[row.packRequirementId]}
        candidate={evidence.get(row.packRequirementId)}
        evidenceEditable={evidenceEditable}
        packageItem={packageItems.get(row.packRequirementId)}
        packageEditable={packageEditable}
        explanations={explanations}
        wordingEditable={wordingEditable}
        wordingMax={wordingMax}
        selfReviewed={selfReviewed}
      />
    ),
  }));
}

/** Chosen documents that will not last the trip, each with when it expires and what it must cover. */
export function CaseExpiringDocuments({
  documents,
}: {
  readonly documents: readonly ExpiringDocumentRow[];
}) {
  const t = getServerT(appMissionCatalog);
  return (
    <section
      className="case-expiring lift-card lift-expiring"
      id="expiring-documents"
      aria-labelledby="case-expiring-heading"
    >
      <h3 id="case-expiring-heading" className="case-checklist-heading lift-card-title">
        {t('appMission.appMissionIdCaseChecklist.documentsThatExpireBeforeYourTrip')}
      </h3>
      <ul className="case-sources-list lift-expiring-list">
        {documents.map((doc) => (
          <li key={doc.documentId} className="lift-expiring-row">
            <span className="lift-expiring-icon" aria-hidden="true">
              <Icon name="calendar" size={16} />
            </span>
            <span className="lift-expiring-name">{doc.name}</span>
            <span className="muted lift-expiring-dates">
              {' · '}Expires: <strong>{formatDateOnly(doc.expiresAt)}</strong>
              {' · '}Needed Until: <strong>{formatDateOnly(doc.neededUntil)}</strong>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The official pages the checklist cites, with when each was last read. */
export function CaseSources({ sources }: { readonly sources: readonly CaseSourceRow[] }) {
  const t = getServerT(appMissionCatalog);
  return (
    <section className="case-sources" aria-labelledby="case-sources-heading">
      <h3 id="case-sources-heading" className="case-checklist-heading">
        {t('appMission.appMissionIdCaseChecklist.sourcesForThisChecklist')}
      </h3>
      <ul className="case-sources-list">
        {sources.map((source) => (
          <li key={source.href}>
            <a href={source.href} target="_blank" rel="noreferrer">
              {source.name}
            </a>
            <span className="muted u-fs-085">
              {' · '}Checked:{' '}
              {source.checkedAt ? formatDateOnly(source.checkedAt) : 'Not Checked Yet'}
              {' · '}In Effect Since:{' '}
              {source.inEffectSince ? formatDateOnly(source.inEffectSince) : 'Not Stated'}
            </span>
          </li>
        ))}
      </ul>
      <p className="muted u-fs-085">
        {t('appMission.appMissionIdCaseChecklist.checkedIsWhenVisastackLastRead')}
      </p>
    </section>
  );
}
