import type { ReactElement, ReactNode } from 'react';
import { PublicButton } from '../public-site/public-button';
import { Chapter } from '../public-site/scene';
import { HeadlineWords } from '../public-site/story';
import { FlipTile } from './flip-tile';
import { ClosingBand, CountryChecklistPanel, ScanPhone, ShareSheet } from './kit-standins';
import { RiseIn } from './rise-in';

/** The page's words, already translated and marked for their language by the page. */
export interface HowCopy {
  readonly titleLead: ReactNode;
  readonly titleEnd: ReactNode;
  readonly lead: ReactNode;
  readonly add: ReactNode;
  readonly check: ReactNode;
  readonly prepare: ReactNode;
  readonly share: ReactNode;
  readonly addBody: ReactNode;
  readonly checkBody: ReactNode;
  readonly prepareBody: ReactNode;
  readonly shareBody: ReactNode;
  readonly wordsLead: ReactNode;
  readonly wordsEnd: ReactNode;
  readonly wordsHint: ReactNode;
  readonly words: readonly {
    readonly key: string;
    readonly word: ReactNode;
    readonly not: ReactNode;
    readonly means: ReactNode;
  }[];
  readonly closingTitleLead: ReactNode;
  readonly closingTitleEnd: ReactNode;
  readonly closingSub: ReactNode;
  readonly start: ReactNode;
  readonly privacy: ReactNode;
}

/** Made-up record text drawn inside the pictures (English Example text, per the kit contract). */
const FIELDS = [
  { label: 'Surname', value: 'Rahman' },
  { label: 'Passport Ends', value: '14 Mar 2031' },
  { label: 'Nationality', value: 'Bangladeshi' },
] as const;

const COUNTRIES = [
  { code: 'sg', name: 'Singapore', have: [true, true, true, true, true, false, false, false] },
  { code: 'de', name: 'Germany', have: [true, true, false, true, false, false, false, false] },
  { code: 'jp', name: 'Japan', have: [true, true, true, false, true, true, false, false] },
] as const;

const ITEMS = [
  { kind: 'passport', label: 'Passport' },
  { kind: 'photo', label: 'Photo' },
  { kind: 'flight', label: 'Flights' },
  { kind: 'insurance', label: 'Insurance' },
  { kind: 'itinerary', label: 'Itinerary' },
  { kind: 'bank', label: 'Bank Statement' },
  { kind: 'hotel', label: 'Hotel Booking' },
  { kind: 'invitation', label: 'Invitation' },
] as const;

export function HowHero({ copy }: { readonly copy: HowCopy }): ReactElement {
  const chips = [copy.add, copy.check, copy.prepare, copy.share];
  return (
    <Chapter tone="dark" labelledBy="how-title" className="hk-chapter hk-hero">
      <div className="hk-inner">
        <h1 id="how-title" className="hk-h1">
          {copy.titleLead} <HeadlineWords>{copy.titleEnd}</HeadlineWords>
        </h1>
        <p className="hk-lead">{copy.lead}</p>
        <ol className="hk-chips">
          {chips.map((word, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: four fixed chips in a fixed order
            <li key={index} className="hk-step-chip">
              <span className="hk-step-num" aria-hidden="true">
                {index + 1}
              </span>
              <span>{word}</span>
            </li>
          ))}
        </ol>
      </div>
    </Chapter>
  );
}

export function HowRows({
  copy,
  pageLang,
}: {
  readonly copy: HowCopy;
  readonly pageLang: string;
}): ReactElement {
  const rows: readonly { id: string; title: ReactNode; body: ReactNode; picture: ReactNode }[] = [
    {
      id: 'add',
      title: copy.add,
      body: copy.addBody,
      picture: <ScanPhone fields={FIELDS} step={1} pageLang={pageLang} />,
    },
    {
      id: 'check',
      title: copy.check,
      body: copy.checkBody,
      picture: <ScanPhone fields={FIELDS} step={2} pageLang={pageLang} />,
    },
    {
      id: 'prepare',
      title: copy.prepare,
      body: copy.prepareBody,
      picture: (
        <CountryChecklistPanel countries={COUNTRIES} items={ITEMS} active={1} pageLang={pageLang} />
      ),
    },
    {
      id: 'share',
      title: copy.share,
      body: copy.shareBody,
      picture: <ShareSheet mode="scroll" step={3} pageLang={pageLang} />,
    },
  ];
  return (
    <Chapter tone="light" className="hk-chapter hk-rows" id="four-steps">
      <div className="hk-inner">
        {rows.map((row, index) => (
          <div className="hk-row" key={row.id} id={`step-${row.id}`}>
            <RiseIn>
              <div className="hk-row-text">
                <span className="hk-num" aria-hidden="true">
                  {index + 1}
                </span>
                <h2 className="hk-h2">{row.title}</h2>
                <p className="hk-body">{row.body}</p>
              </div>
            </RiseIn>
            <RiseIn delay={0.1}>
              <div className="hk-row-art">{row.picture}</div>
            </RiseIn>
          </div>
        ))}
      </div>
    </Chapter>
  );
}

export function WordsBand({ copy }: { readonly copy: HowCopy }): ReactElement {
  return (
    <Chapter tone="light" className="hk-chapter hk-words" id="words" labelledBy="words-title">
      <div className="hk-inner">
        <h2 id="words-title" className="hk-h2">
          {copy.wordsLead} <HeadlineWords>{copy.wordsEnd}</HeadlineWords>
        </h2>
        <p className="hk-hint">{copy.wordsHint}</p>
        <ul className="hk-flip-grid">
          {copy.words.map((item, index) => (
            <li key={item.key}>
              <RiseIn delay={Math.min(0.4, index * 0.08)}>
                <FlipTile word={item.word} not={item.not} means={item.means} />
              </RiseIn>
            </li>
          ))}
        </ul>
      </div>
    </Chapter>
  );
}

export function HowClosing({ copy }: { readonly copy: HowCopy }): ReactElement {
  return (
    <Chapter tone="dark" className="hk-chapter hk-closing-chapter" labelledBy="closing-title">
      <div className="hk-inner">
        <ClosingBand
          title={
            <h2 id="closing-title" className="hk-h2">
              {copy.closingTitleLead} <HeadlineWords>{copy.closingTitleEnd}</HeadlineWords>
            </h2>
          }
          sub={copy.closingSub}
          actions={
            <>
              <PublicButton href="/app" variant="primary">
                {copy.start}
              </PublicButton>
              <PublicButton href="/trust" variant="secondary">
                {copy.privacy}
              </PublicButton>
            </>
          }
        />
      </div>
    </Chapter>
  );
}
