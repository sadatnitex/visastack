import { DocumentPicture } from '../../pictures/document-picture';
import { ExampleTag } from '../../public-site/story';
import { SegmentRing } from './segment-ring';

/**
 * R4 STAND-IN for the shared kit's CountryChecklistPanel (R1-kit-contract.md), same props. It is
 * still (the active country only). Deleted at the R4 turn, when the page imports `../../kit`.
 */
export interface ChecklistCountry {
  readonly code: string;
  readonly name: string;
  readonly have: readonly boolean[];
}

export interface ChecklistItem {
  readonly kind: string;
  readonly label: string;
}

export interface CountryChecklistPanelProps {
  readonly countries: readonly ChecklistCountry[];
  readonly items: readonly ChecklistItem[];
  readonly active?: number;
  readonly pageLang?: string;
}

export function CountryChecklistPanel({
  countries,
  items,
  active = 0,
  pageLang = 'en',
}: CountryChecklistPanelProps) {
  const current = countries[active] ?? countries[0];
  if (current === undefined) return null;
  const filled = current.have.filter(Boolean).length;
  const english = pageLang === 'en' ? undefined : 'en';
  return (
    <div className="r4s-panel" lang={english}>
      <ul className="r4s-tabs" aria-label="Example Countries">
        {countries.map((country, index) => (
          <li
            key={country.code}
            className={index === active ? 'r4s-tab r4s-tab-on' : 'r4s-tab'}
            aria-current={index === active ? 'true' : undefined}
          >
            <img src={`/flags/${country.code}.svg`} alt="" width={24} height={18} loading="lazy" />
            <span>{country.name}</span>
          </li>
        ))}
      </ul>
      <div className="r4s-summary">
        <SegmentRing filled={filled} total={items.length} size={84} />
        <p>
          <strong>{`${filled} of ${items.length} Ready`}</strong>
          <span>{`${filled} reused from your record. ${items.length - filled} to add.`}</span>
        </p>
      </div>
      <ul className="r4s-items">
        {items.map((item, index) => {
          const have = current.have[index] === true;
          return (
            <li key={item.kind} className={have ? 'r4s-item r4s-item-have' : 'r4s-item'}>
              <DocumentPicture type={item.kind} size={26} />
              <span className="r4s-item-name">{item.label}</span>
              <span className="r4s-item-tag">{have ? 'Reused' : 'To add'}</span>
            </li>
          );
        })}
      </ul>
      <p className="r4s-note">
        <ExampleTag pageLang="en" /> Completeness only. Not an approval.
      </p>
    </div>
  );
}
