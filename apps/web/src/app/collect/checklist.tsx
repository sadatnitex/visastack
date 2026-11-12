import {
  ANY_OF_LABEL,
  NECESSITY_LABELS,
  PROVENANCE_LABELS,
  type RequirementNecessity,
} from '@visastack/core';
import type { GuestChecklistItem, GuestFileView } from '@visastack/services';
import { Icon } from '../../components/icons';
import { collectCatalog } from '../../i18n/collect';
import { getServerT } from '../../lib/i18n-server';
import { Fold } from './fold';

/**
 * The exact checklist an agency issued, read-only, for a verified guest (UMPE P8). Every word for
 * necessity, provenance and alternatives comes from the shared module; items the agency added are
 * labelled as the agency's. Grouped as the locked contract asks: mandatory first, then mandatory if
 * it applies, then recommended and optional, and the agency's own items separately.
 */

const ORDER: readonly RequirementNecessity[] = [
  'MANDATORY',
  'CONDITIONAL',
  'RECOMMENDED',
  'OPTIONAL',
];

/**
 * Items that share a group key form one any-one-of group. A group is shown whole, in the section
 * of its strongest member (each member keeps its own necessity label), and a "group" of one is a
 * plain item: nothing is labelled as alternatives unless there really is a choice.
 */
type Row =
  | { readonly kind: 'item'; readonly item: GuestChecklistItem }
  | { readonly kind: 'group'; readonly key: string; readonly items: readonly GuestChecklistItem[] };

interface Placed {
  readonly section: string;
  readonly row: Row;
}

function rank(necessity: RequirementNecessity): number {
  return ORDER.indexOf(necessity);
}

function sectionOf(item: GuestChecklistItem): string {
  return item.provenance === 'AGENCY_ADDED' ? 'AGENCY' : item.necessity;
}

/**
 * A group's strongest member: the official ones when there are any (so an agency's addition never
 * moves a group), then the highest necessity. It decides the section a group sits in and whether
 * the progress strip counts it as Mandatory, so the two can never disagree.
 */
function strongestOf(members: readonly GuestChecklistItem[]): GuestChecklistItem | undefined {
  const official = members.filter((member) => member.provenance !== 'AGENCY_ADDED');
  return [...(official.length > 0 ? official : members)].sort(
    (a, b) => rank(a.necessity) - rank(b.necessity),
  )[0];
}

/** Every item placed once, in issue order, under the section it belongs to. */
function place(items: readonly GuestChecklistItem[]): Placed[] {
  const groups = new Map<string, GuestChecklistItem[]>();
  for (const item of items) {
    if (item.groupKey) groups.set(item.groupKey, [...(groups.get(item.groupKey) ?? []), item]);
  }
  const placed: Placed[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const members = item.groupKey ? (groups.get(item.groupKey) ?? []) : [];
    if (members.length < 2 || !item.groupKey) {
      placed.push({ section: sectionOf(item), row: { kind: 'item', item } });
      continue;
    }
    if (seen.has(item.groupKey)) continue;
    seen.add(item.groupKey);
    const strongest = strongestOf(members);
    placed.push({
      section: strongest ? sectionOf(strongest) : sectionOf(item),
      row: { kind: 'group', key: item.groupKey, items: members },
    });
  }
  return placed;
}

/**
 * Where one item stands once the guest can add files. Placed: a ready file the guest confirmed
 * sits under it. Suggested: a ready file sits under it only because of its name. Covered:
 * another choice in the same any-one-of group is placed, so this one is not needed. Missing:
 * nothing ready sits under it. The words come from here so the page never invents a state.
 */
export type ItemState = 'placed' | 'suggested' | 'covered' | 'missing';

export const ITEM_STATE_WORDS: Readonly<Record<ItemState, string>> = {
  placed: 'Placed',
  suggested: 'Suggested, Check It',
  covered: 'Another Choice Placed',
  missing: 'Still Missing',
};

/** What the checklist needs to show each item's state; absent before the guest can add files. */
export interface ChecklistProgress {
  readonly files: readonly GuestFileView[];
  /** Issued item ids with no ready file under them (`GuestUploadDesk.stillMissing`). */
  readonly stillMissing: readonly string[];
}

interface ItemView {
  readonly state: ItemState;
  readonly files: readonly GuestFileView[];
}

function viewOf(
  item: GuestChecklistItem,
  progress: ChecklistProgress,
  groupCovered: boolean,
): ItemView {
  const files = progress.files.filter((f) => f.itemId === item.id && f.status === 'ready');
  if (!progress.stillMissing.includes(item.id)) {
    // A file placed only from its name is a suggestion until the guest confirms it.
    const suggestion = files.length > 0 && files.every((f) => f.mapping === 'proposed');
    return { state: suggestion ? 'suggested' : 'placed', files };
  }
  return { state: groupCovered ? 'covered' : 'missing', files };
}

/**
 * The items whose only file is a suggestion from its name, so the guest has not confirmed any. The
 * same rule as the Suggested state on a line, so the strip and the list always agree.
 */
export function suggestedOnlyIds(
  items: readonly GuestChecklistItem[],
  files: readonly GuestFileView[],
  stillMissing: readonly string[],
): string[] {
  const progress = { files, stillMissing };
  return items
    .filter((item) => viewOf(item, progress, false).state === 'suggested')
    .map((item) => item.id);
}

/**
 * The units a guest must cover to have every Mandatory item: each plain item is one unit, and an
 * any-one-of group is one unit, covered when any of its members is. A group counts as Mandatory by
 * its strongest official member, the same rule that places it in a section below, so the progress
 * strip and the list never disagree. Agency-added items count by their own necessity.
 */
export interface MandatoryUnit {
  readonly key: string;
  readonly items: readonly GuestChecklistItem[];
}

export function mandatoryUnits(items: readonly GuestChecklistItem[]): MandatoryUnit[] {
  const units: MandatoryUnit[] = [];
  for (const { row } of place(items)) {
    if (row.kind === 'item') {
      if (row.item.necessity === 'MANDATORY') units.push({ key: row.item.id, items: [row.item] });
      continue;
    }
    if (strongestOf(row.items)?.necessity === 'MANDATORY')
      units.push({ key: `group-${row.key}`, items: row.items });
  }
  return units;
}

/**
 * The necessity and source words for one item. Without file state the list keeps every word. With
 * it, a heading already names the necessity and an official source is the default, so a line says
 * only what the heading does not: a different necessity, or a source that is not official.
 */
function metaWords(item: GuestChecklistItem, section: string, stated: boolean): string {
  if (!stated) return `${NECESSITY_LABELS[item.necessity]} · ${PROVENANCE_LABELS[item.provenance]}`;
  const parts: string[] = [];
  if (section === 'AGENCY' || item.necessity !== section)
    parts.push(NECESSITY_LABELS[item.necessity]);
  if (section !== 'AGENCY' && item.provenance !== 'OFFICIAL') {
    parts.push(PROVENANCE_LABELS[item.provenance]);
  }
  return parts.join(' · ');
}

function ItemLine({
  item,
  view,
  section,
}: {
  readonly item: GuestChecklistItem;
  readonly view?: ItemView | undefined;
  readonly section: string;
}) {
  const t = getServerT(collectCatalog);
  const meta = metaWords(item, section, view !== undefined);
  return (
    <>
      {view ? (
        <span className={`collect-item-mark collect-mark-${view.state}`} aria-hidden="true">
          {view.state === 'placed' ? <Icon name="check" size={16} /> : null}
        </span>
      ) : null}
      <span className="collect-item-label">{item.label}</span>
      <span className="collect-item-detail u-fs-085">
        {view ? (
          <span className={`collect-item-status collect-status-${view.state}`}>
            {ITEM_STATE_WORDS[view.state]}
          </span>
        ) : null}
        {meta ? <span className="collect-item-meta muted">{meta}</span> : null}
        {item.note ? <span className="collect-item-note">{item.note}</span> : null}
      </span>
      {view && view.files.length > 0 ? (
        <span className="collect-item-files u-fs-085">
          {view.files.map((file) => (
            <span key={file.id} className="collect-item-file">
              {file.name}
              {file.mapping === 'proposed'
                ? t('collect.collectChecklist.suggestedFromItsNameCheckIt')
                : ''}
            </span>
          ))}
        </span>
      ) : null}
    </>
  );
}

function itemClass(item: GuestChecklistItem, view: ItemView | undefined): string {
  return view
    ? `collect-item collect-item-stated collect-item-${view.state} collect-need-${item.necessity.toLowerCase()}`
    : 'collect-item';
}

function Section({
  title,
  rows,
  progress,
  sectionKey,
}: {
  /** The section's own key: a necessity, or AGENCY for the agency's added items. */
  readonly sectionKey: string;
  readonly title: string;
  readonly rows: readonly Row[];
  readonly progress?: ChecklistProgress | undefined;
}) {
  if (rows.length === 0) return null;
  const members = rows.flatMap((row) => (row.kind === 'item' ? [row.item] : row.items));
  // A section holding anything that can hold up a submission always stays open.
  const blocking = members.some(
    (item) => item.necessity === 'MANDATORY' || item.necessity === 'CONDITIONAL',
  );
  const folded = progress !== undefined && !blocking;
  const list = (
    <ul className="collect-items">
      {rows.map((row) => {
        if (row.kind === 'item') {
          const view = progress ? viewOf(row.item, progress, false) : undefined;
          return (
            <li key={row.item.id} className={itemClass(row.item, view)}>
              <ItemLine item={row.item} view={view} section={sectionKey} />
            </li>
          );
        }
        return (
          <li key={`group-${row.key}`} className="collect-item collect-item-group">
            <span className="collect-group-label">{ANY_OF_LABEL}</span>
            <ul className="collect-items">
              {row.items.map((item) => {
                const covered = progress
                  ? row.items.some((member) => !progress.stillMissing.includes(member.id))
                  : false;
                const view = progress ? viewOf(item, progress, covered) : undefined;
                return (
                  <li key={item.id} className={itemClass(item, view)}>
                    <ItemLine item={item} view={view} section={sectionKey} />
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
  if (!folded) {
    return (
      <section className="collect-section" aria-label={title}>
        <h2 className="collect-section-title">{title}</h2>
        {list}
      </section>
    );
  }
  // A choice covered by another in its group is not missing.
  const open = rows.filter((row) =>
    row.kind === 'item'
      ? progress?.stillMissing.includes(row.item.id)
      : row.items.every((member) => progress?.stillMissing.includes(member.id)),
  ).length;
  return (
    <section className="collect-section" aria-label={title}>
      <Fold
        title={title}
        headingId={`collect-fold-${title.replace(/\W+/g, '-').toLowerCase()}`}
        status={`${members.length} ${members.length === 1 ? 'item' : 'items'}, ${
          open === 0 ? 'none missing' : `${open} still missing`
        }`}
        open={false}
      >
        {list}
      </Fold>
    </section>
  );
}

export function GuestChecklist({
  items,
  progress,
}: {
  readonly items: readonly GuestChecklistItem[];
  /** The guest's files and what is missing, once they can add files; the list stays read-only. */
  readonly progress?: ChecklistProgress | undefined;
}) {
  const placed = place(items);
  const rowsIn = (section: string) =>
    placed.filter((entry) => entry.section === section).map((entry) => entry.row);
  return (
    <div className="collect-checklist">
      {ORDER.map((necessity) => (
        <Section
          key={necessity}
          title={NECESSITY_LABELS[necessity]}
          sectionKey={necessity}
          rows={rowsIn(necessity)}
          progress={progress}
        />
      ))}
      <Section
        title={PROVENANCE_LABELS.AGENCY_ADDED}
        sectionKey="AGENCY"
        rows={rowsIn('AGENCY')}
        progress={progress}
      />
    </div>
  );
}
