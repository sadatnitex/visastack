'use client';

import type { ComponentProps } from 'react';
import { componentsCatalog } from '../i18n/components';
import type { CasePurposeGroup } from '../lib/case-choices';
import { purposeMark } from '../lib/item-icons';
import { useT } from './i18n-provider';
import { MarkTile } from './mark-tile';

type SelectRest = Omit<
  ComponentProps<'select'>,
  'id' | 'name' | 'className' | 'value' | 'onChange'
>;

/**
 * The "Why?" list on the forms that start a trip. The list itself stays a native one (every
 * browser and screen reader knows it, and it holds the whole purpose list in its groups); beside
 * it, a tile shows what the chosen purpose is as a picture (a mortarboard for study, a first-aid
 * case for treatment), and a plane before anything is chosen. The tile adds no height.
 */
export function PurposeSelect({
  id,
  purposes,
  value,
  onChange,
  ...rest
}: {
  readonly id: string;
  readonly purposes: readonly CasePurposeGroup[];
  readonly value: string;
  readonly onChange: (value: string) => void;
} & SelectRest) {
  const t = useT(componentsCatalog);
  const group = purposes.find((g) => g.options.some((option) => option.key === value));
  // The picture follows the list: a value the list does not hold (nothing chosen yet) is a plane.
  const mark = group
    ? purposeMark(value, group.family)
    : ({ icon: 'plane', tone: 'neutral' } as const);
  return (
    <div className="purpose-select">
      <MarkTile mark={mark} />
      <select
        id={id}
        name="purpose"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        {...rest}
      >
        <option value="" disabled>
          {t.node('components.purposeSelect.chooseAPurpose')}
        </option>
        {purposes.map((group) => (
          <optgroup key={group.family} label={group.label}>
            {group.options.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}
