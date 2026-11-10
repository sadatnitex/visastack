'use client';

import { useEffect, useRef, useState } from 'react';
import type { CasePurposeGroup, CasePurposeOption } from '../lib/case-choices';
import { COMMON_PURPOSE_KEYS } from '../lib/common-purposes';
import { type ItemMark, purposeMark } from '../lib/item-icons';
import { MarkTile } from './mark-tile';
import { PurposeSelect } from './purpose-select';

/** The field problem wiring `fieldProblem` returns, put on the group so the error belongs to it. */
type Problem = { readonly 'aria-invalid'?: true; readonly 'aria-describedby'?: string };

interface CommonPurpose {
  readonly option: CasePurposeOption;
  readonly mark: ItemMark;
}

/** The common purposes the list holds, in the order of `COMMON_PURPOSE_KEYS`, each with its picture. */
function commonPurposes(groups: readonly CasePurposeGroup[]): readonly CommonPurpose[] {
  const found: CommonPurpose[] = [];
  for (const key of COMMON_PURPOSE_KEYS) {
    for (const group of groups) {
      const option = group.options.find((item) => item.key === key);
      if (option) {
        found.push({ option, mark: purposeMark(option.key, group.family) });
        break;
      }
    }
  }
  return found;
}

const MORE_MARK: ItemMark = { icon: 'more', tone: 'neutral' };

/**
 * The "Why?" question on the forms that start a trip. It opens on the eight reasons people start
 * a trip most often, each a picture tile that is a real radio button (arrow keys move between
 * them, a screen reader reads the group with its legend), and a "More Purposes" tile that swaps
 * in the whole grouped list (`PurposeSelect`). Both ways submit the same field, `purpose`, with
 * the same value, so the server action and its checks are untouched. Only one of the two is on
 * the screen at a time, so only one `purpose` field is ever sent. A purpose chosen from the list
 * that has no tile keeps the list open, because the tiles could not show it.
 */
export function PurposeChoice({
  id,
  purposes,
  value,
  onChange,
  problem = {},
  legend = 'Why?',
}: {
  readonly id: string;
  readonly purposes: readonly CasePurposeGroup[];
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly problem?: Problem;
  readonly legend?: string;
}) {
  const common = commonPurposes(purposes);
  const [more, setMore] = useState(false);
  const group = useRef<HTMLFieldSetElement>(null);
  // Where focus goes after the view swaps, so a keyboard user is not dropped on the page.
  const [moveFocus, setMoveFocus] = useState<'list' | 'tiles' | null>(null);
  const hasTile = common.some((item) => item.option.key === value);
  const listOpen = common.length === 0 || more || (value !== '' && !hasTile);

  useEffect(() => {
    if (!moveFocus) return;
    if (moveFocus === 'list') {
      document.getElementById(id)?.focus();
    } else {
      const radios = Array.from(
        group.current?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [],
      );
      (radios.find((radio) => radio.checked) ?? radios[0])?.focus();
    }
    setMoveFocus(null);
  }, [moveFocus, id]);

  if (listOpen) {
    return (
      <div className="purpose-choice">
        <label className="label" htmlFor={id}>
          {legend}
        </label>
        <PurposeSelect id={id} purposes={purposes} value={value} onChange={onChange} {...problem} />
        {common.length > 0 && (value === '' || hasTile) ? (
          <button
            type="button"
            className="btn btn-secondary purpose-choice-back"
            onClick={() => {
              setMoveFocus('tiles');
              setMore(false);
            }}
          >
            Show Common Purposes
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <fieldset ref={group} className="purpose-choice" role="radiogroup" {...problem}>
      <legend className="label">{legend}</legend>
      <div className="purpose-tile-grid">
        {common.map(({ option, mark }) => (
          <label key={option.key} className="purpose-tile">
            <input
              className="purpose-tile-input"
              type="radio"
              name="purpose"
              value={option.key}
              checked={value === option.key}
              onChange={() => onChange(option.key)}
            />
            <span className="purpose-tile-face">
              <MarkTile mark={mark} size="lg" />
              <span className="purpose-tile-word">{option.label}</span>
            </span>
          </label>
        ))}
        <button
          type="button"
          className="purpose-tile purpose-tile-more"
          onClick={() => {
            setMoveFocus('list');
            setMore(true);
          }}
        >
          <span className="purpose-tile-face">
            <MarkTile mark={MORE_MARK} size="lg" />
            <span className="purpose-tile-word">More Purposes</span>
          </span>
        </button>
      </div>
    </fieldset>
  );
}
