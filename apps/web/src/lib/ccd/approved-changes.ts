import type { InventoryEntry } from './inventory';

/**
 * The only differences between a screen before and after Calm Core With Depths that the owner
 * has approved (docs/uiux/ccd/PARITY-LEDGER.md). Anything else missing is a bug. `to: null`
 * is a removal and needs the owner's name against it in the ledger.
 */
export interface ApprovedChange {
  readonly screen: string;
  readonly from: InventoryEntry;
  /** The element that replaces it (worked out per state when the wording depends on the person), or null for a removal. */
  readonly to: InventoryEntry | null | ((state: string) => InventoryEntry | null);
  readonly reason: string;
}

/** Home states (parity-home.test.tsx) with no record of the person's own, so no first name. */
const HOME_STATES_WITHOUT_OWN_RECORD = new Set([
  'nothing started yet, agency member',
  'more people than Home reads',
]);

export const APPROVED_CHANGES: readonly ApprovedChange[] = [
  {
    screen: 'account',
    from: { kind: 'heading', name: 'traveller@example.com', detail: '1' },
    to: { kind: 'text', name: 'traveller@example.com' },
    reason: 'D3: the page is named "Your Account" and the email sits under the heading.',
  },
  {
    screen: 'home',
    from: { kind: 'heading', name: 'Account Overview', detail: '1' },
    // Only the states that hold a record of the person's own greet them by first name.
    to: (state) => ({
      kind: 'heading',
      name: HOME_STATES_WITHOUT_OWN_RECORD.has(state) ? 'Welcome back' : 'Welcome back, Karim',
      detail: '1',
    }),
    reason:
      'D3: Home is headed "Welcome back, {first name}", or "Welcome back" when no name is known.',
  },
];
