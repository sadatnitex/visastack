import { DocumentPicture } from '../../pictures/document-picture';
import { publicFormat, publicString, publicText } from '../public-text';
import { ExampleTag } from '../story';
import { DOC_TYPE, type DocKind, englishOn } from './doc-kinds';
import { SegmentRing } from './segment-ring';
import './kit-steps.css';
import './kit.css';

export interface ChecklistCountry {
  /** Two-letter code; its flag is read from this site (`/flags/<code>.svg`). */
  readonly code: string;
  readonly name: string;
  /** `have[i]` says whether `items[i]` is already in the record. */
  readonly have: readonly boolean[];
}

export interface ChecklistItem {
  readonly kind: DocKind;
  readonly label: string;
}

export interface CountryChecklistPanelProps {
  readonly countries: readonly ChecklistCountry[];
  readonly items: readonly ChecklistItem[];
  /**
   * Pins one country (an index). Leave out inside a scene whose steps equal the number of
   * countries: the scene's step picks the country, and the finished state is the last.
   */
  readonly active?: number;
  readonly pageLang?: string;
}

function countOf(country: ChecklistCountry, total: number): number {
  return country.have.slice(0, total).filter(Boolean).length;
}

/**
 * One card with a tab per country, a ring saying how much of that country's list is already in the
 * record, and a row per paper marked Reused or To Add. Readiness is completeness, never approval,
 * and the card says so.
 */
export function CountryChecklistPanel({
  countries,
  items,
  active,
  pageLang = 'en',
}: CountryChecklistPanelProps) {
  const say = (text: string) => publicText(text, pageLang);
  const total = items.length;
  const fixed =
    active === undefined
      ? {}
      : { 'data-kit-step': Math.min(countries.length - 1, Math.max(0, active)) };
  return (
    <figure
      className={active === undefined ? 'kit-panel' : 'kit-panel kit-fixed'}
      data-pub-depth=""
      aria-label="Example of a country checklist"
      {...fixed}
      {...englishOn(pageLang)}
    >
      <ExampleTag pageLang={pageLang} />
      <div className="kit-tabs">
        {countries.map((country, index) => (
          <span className="kit-tab" data-at={index} key={country.code}>
            <img
              className="kit-flag"
              src={`/flags/${country.code}.svg`}
              alt=""
              width={24}
              height={16}
              loading="lazy"
              decoding="async"
            />
            <span>{say(country.name)}</span>
          </span>
        ))}
      </div>
      <div className="kit-panel-head">
        <SegmentRing
          filled={0}
          total={total}
          size={84}
          steps={countries.map((country) => ({ filled: countOf(country, total) }))}
        />
        <div className="kit-panel-count">
          {countries.map((country, index) => {
            const have = countOf(country, total);
            return (
              <span className="kit-sw" data-at={index} key={country.code}>
                <b>{publicFormat('{name}: {have} of {total} Ready', { name: publicString(country.name, pageLang).text, have, total }, pageLang)}</b>
                <span>{say(`${have} reused from your record. ${total - have} to add.`)}</span>
              </span>
            );
          })}
        </div>
      </div>
      <ul className="kit-rows">
        {items.map((item, row) => (
          <li className="kit-row" key={`${row}-${item.kind}`}>
            <span className="kit-row-pic">
              <DocumentPicture type={DOC_TYPE[item.kind]} size={28} />
            </span>
            <span className="kit-row-name">{say(item.label)}</span>
            {countries.map((country, index) => {
              const reused = country.have[row] === true;
              return (
                <span
                  className={reused ? 'kit-sw kit-tag is-reused' : 'kit-sw kit-tag'}
                  data-at={index}
                  key={country.code}
                >
                  {say(reused ? 'Reused' : 'To Add')}
                </span>
              );
            })}
          </li>
        ))}
      </ul>
      <p className="kit-note">{say('Completeness only. Not an approval.')}</p>
    </figure>
  );
}
