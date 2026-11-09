import type { PackageCopy, PackageItem } from '@visastack/services';
import type { PackageChoiceOption } from './package-forms';

/** How a package item reads and what it offers, shared by the item panel and the package summary. */

export function copyName(copy: PackageCopy): string {
  if (copy.kind === 'FIELD') return 'Your Saved Answer';
  const name = copy.displayName ?? 'Document';
  return copy.documentDate ? `${name} (${copy.documentDate})` : name;
}

export function optionValue(copy: PackageCopy): string | null {
  if (copy.documentVersionId) return `d:${copy.documentVersionId}`;
  if (copy.factVersionId) return `f:${copy.factVersionId}`;
  return null;
}

export function usingLine(item: PackageItem): string {
  const chosen = item.chosen;
  if (chosen?.choice === 'EXCLUDE') return 'Left out of this package by you.';
  if (chosen?.choice === 'LEAVE_MISSING') return 'Left missing for now.';
  if (chosen?.copy) return `Using: ${copyName(chosen.copy)}, chosen by you.`;
  if (item.proposed) return `Suggested: ${copyName(item.proposed)}.`;
  return 'Nothing on file matches yet.';
}

export function choiceOptions(item: PackageItem): {
  options: PackageChoiceOption[];
  current: string;
} {
  const copies: PackageCopy[] = [];
  const seen = new Set<string>();
  for (const copy of [item.chosen?.copy, item.proposed, item.newerCopy, ...item.alternatives]) {
    const value = copy ? optionValue(copy) : null;
    if (!copy || !value || seen.has(value) || !copy.usable) continue;
    seen.add(value);
    copies.push(copy);
  }
  const options = copies.map((copy) => ({
    value: optionValue(copy) as string,
    label: `Use ${copyName(copy)}`,
  }));
  const current =
    item.chosen?.choice === 'LEAVE_MISSING'
      ? 'missing'
      : item.chosen?.choice === 'EXCLUDE'
        ? 'exclude'
        : ((item.chosen?.copy ? optionValue(item.chosen.copy) : null) ??
          (item.proposed ? optionValue(item.proposed) : null) ??
          'missing');
  return { options, current };
}
