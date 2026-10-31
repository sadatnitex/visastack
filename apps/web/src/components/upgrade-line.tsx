import Link from 'next/link';

/**
 * The one plain line a refusal adds when a paid plan would give more of what ran short (ADR 0025
 * section 12.2): offered at the moment of need, once, never a pop-up. The server decides whether
 * it shows (`upgradeLineForRefusal`); this only says it.
 */
export type UpgradeLineKind = 'storage' | 'ai';

export const UPGRADE_LINES: Readonly<Record<UpgradeLineKind, string>> = {
  storage: 'A paid plan gives you more room. See Plan & Usage.',
  ai: 'A paid plan gives you a higher daily limit. See Plan & Usage.',
};

/** Where the line leads: the person's own plans to compare. */
export const UPGRADE_LINE_HREF = '/app/account/plan';

/** Whether `value` names one of the lines (for answers read back from the server as JSON). */
export function isUpgradeLineKind(value: unknown): value is UpgradeLineKind {
  return value === 'storage' || value === 'ai';
}

/** The line itself, as a link that reads on its own (WCAG 2.4.4). */
export function UpgradeLine({ kind }: { readonly kind: UpgradeLineKind }) {
  return <Link href={UPGRADE_LINE_HREF}>{UPGRADE_LINES[kind]}</Link>;
}
