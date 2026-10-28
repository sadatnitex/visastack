import type { InventoryEntry } from './inventory';

/**
 * The only differences between a screen before and after Calm Core With Depths that the owner
 * has approved (docs/uiux/ccd/PARITY-LEDGER.md). Anything else missing is a bug. `to: null`
 * is a removal and needs the owner's name against it in the ledger.
 */
export interface ApprovedChange {
  readonly screen: string;
  readonly from: InventoryEntry;
  readonly to: InventoryEntry | null;
  readonly reason: string;
}

export const APPROVED_CHANGES: readonly ApprovedChange[] = [
  {
    screen: 'account',
    from: { kind: 'heading', name: 'traveller@example.com', detail: '1' },
    to: { kind: 'text', name: 'traveller@example.com' },
    reason: 'D3: the page is named "Your Account" and the email sits under the heading.',
  },
];
