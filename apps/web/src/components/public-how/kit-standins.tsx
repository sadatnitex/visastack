import type { ReactNode } from 'react';
import { DocumentPicture } from '../pictures/document-picture';
import { PassportTilt } from '../public-site/public-picture';
import { ExampleTag } from '../public-site/story';

/**
 * Stand-ins for the R1 picture kit, with the names and props of R1-kit-contract.md, so the swap to
 * the real kit is an import change. Server parts, flat, no script. Words arrive as props.
 */
export type Tone = 'light' | 'dark';
export type DocKind =
  | 'passport'
  | 'photo'
  | 'flight'
  | 'insurance'
  | 'itinerary'
  | 'bank'
  | 'hotel'
  | 'invitation';

export interface SegmentRingProps {
  readonly filled: number;
  readonly total?: number;
  readonly label?: string;
  readonly tone?: Tone;
  readonly size?: number;
}

/** Eight arcs with gaps, clockwise from the top. The ring is hidden from screen readers; the label says it. */
export function SegmentRing({
  filled,
  total = 8,
  label,
  tone = 'light',
  size = 96,
}: SegmentRingProps) {
  const radius = 30;
  const gap = 7;
  const arcs = Array.from({ length: total }, (_, index) => {
    const start = ((index * 360) / total + gap / 2 - 90) * (Math.PI / 180);
    const end = (((index + 1) * 360) / total - gap / 2 - 90) * (Math.PI / 180);
    const point = (angle: number) =>
      `${(36 + radius * Math.cos(angle)).toFixed(2)} ${(36 + radius * Math.sin(angle)).toFixed(2)}`;
    return (
      <path
        key={`arc-${index.toString()}`}
        d={`M${point(start)} A${radius} ${radius} 0 0 1 ${point(end)}`}
        className={index < filled ? 'hk-arc hk-arc-on' : 'hk-arc'}
      />
    );
  });
  return (
    <span className={`hk-ring hk-ring-${tone}`}>
      <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
        {arcs}
        <text x="36" y="43" textAnchor="middle" className="hk-ring-text">
          {`${filled}/${total}`}
        </text>
      </svg>
      {label ? <span className="hk-ring-label">{label}</span> : null}
    </span>
  );
}

export interface ScanPhoneProps {
  readonly fields: readonly { readonly label: string; readonly value: string }[];
  /** 0 camera, 1 fields with Suggested chips, 2 chips flipped to Confirmed (the finished state). */
  readonly step?: 0 | 1 | 2;
  readonly pageLang?: string;
}

/** Words inside a picture are English Example text; on a Bangla page the figure is marked lang="en". */
function figureLang(pageLang: string): { lang?: string } {
  return pageLang === 'en' ? {} : { lang: 'en' };
}

export function ScanPhone({ fields, step = 2, pageLang = 'en' }: ScanPhoneProps) {
  const word = step === 2 ? 'Confirmed' : 'Suggested';
  return (
    <figure
      className="hk-phone"
      data-step={step}
      aria-label={`A phone showing three ${word.toLowerCase()} fields`}
      {...figureLang(pageLang)}
    >
      <div className="hk-phone-screen">
        <b className="hk-phone-title">Add Document</b>
        <div className="hk-phone-cam" aria-hidden="true">
          <DocumentPicture type="passport" size={64} />
        </div>
        <ul className="hk-fields">
          {step === 0
            ? null
            : fields.map((field) => (
                <li key={field.label}>
                  <span className="hk-field-label">{field.label}</span>
                  <b className="hk-field-value">{field.value}</b>
                  <em className={`pub-chip pub-chip-${step === 2 ? 'confirmed' : 'suggested'}`}>
                    {word}
                  </em>
                </li>
              ))}
        </ul>
        <p className="hk-example-row">
          <ExampleTag pageLang="en" />
          <span>Example record.</span>
        </p>
      </div>
    </figure>
  );
}

export interface CountryChecklistPanelProps {
  readonly countries: readonly {
    readonly code: string;
    readonly name: string;
    readonly have: readonly boolean[];
  }[];
  readonly items: readonly { readonly kind: DocKind; readonly label: string }[];
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
  const filled = current ? current.have.filter(Boolean).length : 0;
  return (
    <figure
      className="hk-panel"
      aria-label={`A ${current?.name ?? ''} checklist with ${filled} of ${items.length} items ready`}
      {...figureLang(pageLang)}
    >
      <div className="hk-tabs">
        {countries.map((country, index) => (
          <span
            key={country.code}
            className={index === active ? 'hk-tab hk-tab-on' : 'hk-tab'}
            {...(index === active ? { 'aria-current': 'true' as const } : {})}
          >
            <img src={`/flags/${country.code}.svg`} alt="" width={24} height={16} />
            <span className="hk-tab-name">{country.name}</span>
          </span>
        ))}
      </div>
      <div className="hk-panel-head">
        <SegmentRing filled={filled} total={items.length} size={84} />
        <div>
          <b>{`${filled} of ${items.length} Ready`}</b>
          <span>{`${filled} reused from your record. ${items.length - filled} to add.`}</span>
        </div>
      </div>
      <ul className="hk-list">
        {items.map((item, index) => {
          const has = current?.have[index] === true;
          return (
            <li key={item.kind} className={has ? 'hk-list-yes' : 'hk-list-no'}>
              <span className="hk-list-art" aria-hidden="true">
                <DocumentPicture type={item.kind} size={28} />
              </span>
              <span className="hk-list-name">{item.label}</span>
              <span className="hk-list-tag">{has ? 'Reused' : 'To add'}</span>
            </li>
          );
        })}
      </ul>
      <p className="hk-example-row">
        <ExampleTag pageLang="en" />
        <span>Completeness only. Not an approval.</span>
      </p>
    </figure>
  );
}

export interface ShareSheetProps {
  /** `scroll` follows a scene, `timed` cycles by itself; the stand-in is a still, so both rest on `step`. */
  readonly mode: 'scroll' | 'timed';
  readonly step?: 0 | 1 | 2 | 3 | 4;
  readonly pageLang?: string;
}

/** "Saved is not Shared": a toggle says Not shared until it is switched on. Resting step 3 by default. */
export function ShareSheet({ step = 3, pageLang = 'en' }: ShareSheetProps) {
  const rows: readonly { kind: DocKind; name: string; part: string; on: boolean }[] = [
    { kind: 'passport', name: 'Passport', part: 'Photo page only', on: step >= 1 && step < 4 },
    { kind: 'photo', name: 'Photo', part: 'Visa size', on: step >= 2 && step < 4 },
    { kind: 'bank', name: 'Bank', part: 'Not shared', on: false },
  ];
  const sees = rows.filter((row) => row.on).map((row) => row.name);
  return (
    <figure
      className="hk-sheet"
      aria-label="A share sheet with an end date"
      {...figureLang(pageLang)}
    >
      <b className="hk-sheet-title">Share With Agency</b>
      <ul className="hk-sheet-rows">
        {rows.map((row) => (
          <li key={row.kind}>
            <span className="hk-sheet-art" aria-hidden="true">
              <DocumentPicture type={row.kind} size={32} />
            </span>
            <span className="hk-sheet-name">
              <b>{row.name}</b>
              <span>{row.on ? row.part : 'Not shared'}</span>
            </span>
            <span className={row.on ? 'hk-switch hk-switch-on' : 'hk-switch'} aria-hidden="true" />
          </li>
        ))}
      </ul>
      <p className="hk-sheet-sees">
        <span>{sees.length > 0 ? 'Agency can see:' : 'Agency can see nothing.'}</span>
        {sees.map((name) => (
          <em key={name} className="pub-chip pub-chip-shared">
            {name}
          </em>
        ))}
      </p>
      <p className="hk-sheet-ends">Ends 31 Dec. Turn it off any time.</p>
      <span className="hk-sheet-action">{step === 3 ? 'Turn Off' : 'Share'}</span>
      <p className="hk-example-row">
        <ExampleTag pageLang="en" />
        <span>Example sharing choices.</span>
      </p>
    </figure>
  );
}

export interface ClosingBandProps {
  readonly title: ReactNode;
  readonly sub: ReactNode;
  readonly actions: ReactNode;
  readonly passport?: boolean;
  readonly nationality?: string;
}

/** The closing dark chapter's content: title, one sentence, the page's buttons, the real passport cover. */
export function ClosingBand({
  title,
  sub,
  actions,
  passport = true,
  nationality = 'BD',
}: ClosingBandProps) {
  return (
    <div className="hk-closing">
      {title}
      <p className="hk-lead">{sub}</p>
      <div className="hk-actions">{actions}</div>
      {passport ? <PassportTilt nationality={nationality} width={200} /> : null}
    </div>
  );
}
