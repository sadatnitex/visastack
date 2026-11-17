'use client';
import type { ReactNode } from 'react';
import { documentCatalogueKey } from '../lib/item-icons';
import { DocumentPicture } from './pictures/document-picture';
import { PassportCover } from './pictures/passport-cover';
import { StatusBadge } from './ui';

/**
 * The documents as a stack of picture cards (WP-PIC5, owner decision 17 Nov 2026). An opt-in view
 * of the same documents the list shows: each card is the picture of the document TYPE (and, for a
 * passport, the cover for the traveller's nationality), its name and its state word. Nothing about
 * the paper itself is drawn. A card opens exactly what the row opens, because the browser passes
 * the same opener to both.
 */

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

export interface WalletStackItem {
  readonly id: string;
  readonly name: string;
  /** The stored type key (for example PASSPORT); the picture comes from it, never from the label. */
  readonly docType: string | null;
  /** The kind in plain words, as the row's second line shows it. */
  readonly kindLine: string;
  /** The one word a row shows when something is not normal, or null (a normal file shows none). */
  readonly state: { readonly label: string; readonly tone: Tone } | null;
  readonly selected: boolean;
  /** The row's Manage menu, drawn under the card exactly as under a row. */
  readonly manage?: ReactNode;
}

const CARD_PICTURE = 48;

function CardPicture({
  docType,
  nationality,
}: {
  readonly docType: string | null;
  readonly nationality: string | null | undefined;
}) {
  // The word is beside the picture, so the picture is decoration for a screen reader.
  // The same alias table as the picture (for example PASSPORT_BIO_PAGE is a passport) decides.
  return documentCatalogueKey(docType) === 'PASSPORT' ? (
    <PassportCover nationality={nationality} width={CARD_PICTURE} decorative />
  ) : (
    <DocumentPicture type={docType} size={CARD_PICTURE} />
  );
}

export function DocumentWalletStack({
  items,
  nationality,
  onOpen,
}: {
  readonly items: readonly WalletStackItem[];
  /** The traveller's saved nationality, when the page has it; the neutral cover otherwise. */
  readonly nationality?: string | null | undefined;
  readonly onOpen: (id: string, opener: HTMLButtonElement) => void;
}) {
  return (
    <ul className="wallet-stack" aria-label="Document Cards">
      {items.map((item) => (
        <li
          key={item.id}
          id={`document-${item.id}`}
          data-selected={item.selected ? 'true' : undefined}
        >
          <button
            type="button"
            className="wallet-stack-card pic-depth"
            aria-pressed={item.selected}
            onClick={(event) => onOpen(item.id, event.currentTarget)}
          >
            <CardPicture docType={item.docType} nationality={nationality} />
            <span className="wallet-stack-text">
              <span className="wallet-stack-name" data-value="name">
                {item.name}
              </span>
              <span className="wallet-stack-kind" data-value="kind">
                {item.kindLine}
              </span>
            </span>
            {item.state ? (
              <span className="wallet-stack-state">
                <StatusBadge tone={item.state.tone}>{item.state.label}</StatusBadge>
              </span>
            ) : null}
          </button>
          {item.manage ? <div className="wallet-document-manage">{item.manage}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * A ghost card for an empty wallet: it shows what a card will look like and says plainly that it
 * is an Example. It is not a control and never stands for the person's own document.
 */
export function DocumentWalletGhostCard() {
  return (
    <div className="wallet-ghost" data-testid="wallet-ghost-card">
      <div className="wallet-stack-card wallet-ghost-card">
        <PassportCover nationality={null} width={CARD_PICTURE} decorative />
        <span className="wallet-stack-text">
          <span className="wallet-stack-name">Passport</span>
          <span className="wallet-ghost-tag">Example</span>
        </span>
      </div>
    </div>
  );
}
