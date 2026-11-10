'use client';

import { useId } from 'react';
import { MAX_ASK_ITEMS } from '../../../../lib/request-picker-types';

export interface TrayItem {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}

/**
 * "Selected (N)": what will go out in this send, each with its own Remove. The list is in the
 * order the items were chosen. Removing is by button (never by unticking far up a long list), and
 * each button names its item for a screen reader.
 */
export function EvidenceTray({
  items,
  onRemove,
  onClear,
}: {
  readonly items: readonly TrayItem[];
  readonly onRemove: (id: string, index: number) => void;
  readonly onClear: () => void;
}) {
  const headingId = useId();
  return (
    <section className="ask-tray" aria-labelledby={headingId}>
      <div className="ask-tray-head">
        <p className="ask-tray-title" id={headingId}>
          {`Selected (${items.length})`}
        </p>
        {items.length > 1 ? (
          <button type="button" className="btn btn-secondary" onClick={onClear}>
            Clear All
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="muted u-fs-085">Nothing selected yet. Tick what you need above.</p>
      ) : (
        <ul className="ask-tray-list">
          {items.map((item, index) => (
            <li className="ask-tray-item" key={item.id}>
              <span className="ask-tray-name">
                {item.label}
                {item.hint ? <span className="ask-hint"> ({item.hint})</span> : null}
                <span className="ask-note">
                  {item.id.startsWith('DOCUMENT:') ? 'Document' : 'Detail'}
                </span>
              </span>
              <button
                type="button"
                className="btn btn-secondary ask-remove"
                data-remove={item.id}
                aria-label={`Remove ${item.label}${item.hint ? ` (${item.hint})` : ''}`}
                onClick={() => onRemove(item.id, index)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length >= MAX_ASK_ITEMS ? (
        <p className="muted u-fs-085">{`${MAX_ASK_ITEMS} is the most in one send.`}</p>
      ) : null}
    </section>
  );
}
