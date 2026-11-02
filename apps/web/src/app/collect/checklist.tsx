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

/** Items that share a group key form one any-one-of group, shown where its first member sits. */
type Row =
  | { readonly kind: 'item'; readonly item: GuestChecklistItem }
  | { readonly kind: 'group'; readonly key: string; readonly items: readonly GuestChecklistItem[] };

function rows(items: readonly GuestChecklistItem[]): Row[] {
  const out: Row[] = [];
  const groups = new Map<string, GuestChecklistItem[]>();
  for (const item of items) {
    if (!item.groupKey) {
      out.push({ kind: 'item', item });
      continue;
    }
    const existing = groups.get(item.groupKey);
    if (existing) {
      existing.push(item);
      continue;
    }
    const members = [item];
    groups.set(item.groupKey, members);
    out.push({ kind: 'group', key: item.groupKey, items: members });
  }
  return out;
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

function Section({
  title,
  items,
}: {
  readonly title: string;
  readonly items: readonly GuestChecklistItem[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="collect-section" aria-label={title}>
      <h3 className="collect-section-title">{title}</h3>
      <ul className="collect-items">
        {rows(items).map((row) =>
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
  const official = items.filter((item) => item.provenance !== 'AGENCY_ADDED');
  const agency = items.filter((item) => item.provenance === 'AGENCY_ADDED');
  return (
    <div className="collect-checklist">
      {ORDER.map((necessity) => (
        <Section
          key={necessity}
          title={NECESSITY_LABELS[necessity]}
          items={official.filter((item) => item.necessity === necessity)}
        />
      ))}
      <Section title={PROVENANCE_LABELS.AGENCY_ADDED} items={agency} />
    </div>
  );
}
