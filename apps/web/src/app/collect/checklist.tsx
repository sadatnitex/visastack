import {
  ANY_OF_LABEL,
  NECESSITY_LABELS,
  PROVENANCE_LABELS,
  type RequirementNecessity,
} from '@visastack/core';
import type { GuestChecklistItem } from '@visastack/services';

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
    const official = members.filter((member) => member.provenance !== 'AGENCY_ADDED');
    const strongest = [...(official.length > 0 ? official : members)].sort(
      (a, b) => rank(a.necessity) - rank(b.necessity),
    )[0];
    placed.push({
      section: strongest ? sectionOf(strongest) : sectionOf(item),
      row: { kind: 'group', key: item.groupKey, items: members },
    });
  }
  return placed;
}

function ItemLine({ item }: { readonly item: GuestChecklistItem }) {
  return (
    <>
      <span className="collect-item-label">{item.label}</span>
      <span className="collect-item-meta muted u-fs-085">
        {NECESSITY_LABELS[item.necessity]} · {PROVENANCE_LABELS[item.provenance]}
      </span>
      {item.note ? <span className="collect-item-note u-fs-085">{item.note}</span> : null}
    </>
  );
}

function Section({ title, rows }: { readonly title: string; readonly rows: readonly Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="collect-section" aria-label={title}>
      <h2 className="collect-section-title">{title}</h2>
      <ul className="collect-items">
        {rows.map((row) =>
          row.kind === 'item' ? (
            <li key={row.item.id} className="collect-item">
              <ItemLine item={row.item} />
            </li>
          ) : (
            <li key={`group-${row.key}`} className="collect-item collect-item-group">
              <span className="collect-group-label">{ANY_OF_LABEL}</span>
              <ul className="collect-items">
                {row.items.map((item) => (
                  <li key={item.id} className="collect-item">
                    <ItemLine item={item} />
                  </li>
                ))}
              </ul>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

export function GuestChecklist({ items }: { readonly items: readonly GuestChecklistItem[] }) {
  const placed = place(items);
  const rowsIn = (section: string) =>
    placed.filter((entry) => entry.section === section).map((entry) => entry.row);
  return (
    <div className="collect-checklist">
      {ORDER.map((necessity) => (
        <Section key={necessity} title={NECESSITY_LABELS[necessity]} rows={rowsIn(necessity)} />
      ))}
      <Section title={PROVENANCE_LABELS.AGENCY_ADDED} rows={rowsIn('AGENCY')} />
    </div>
  );
}
