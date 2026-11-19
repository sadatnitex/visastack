import type { ReactElement, ReactNode } from 'react';
import {
  ClosingBand,
  CountryChecklistPanel,
  FIXTURE_COUNTRIES,
  FIXTURE_FIELDS,
  FIXTURE_ITEMS,
  RiseIn,
  ScanPhone,
  ShareSheet,
} from '../public-site/kit';
import { PublicButton } from '../public-site/public-button';
import { publicText } from '../public-site/public-text';
import { Chapter } from '../public-site/scene';
import { HeadlineWords } from '../public-site/story';
import { FlipTile } from './flip-tile';

/**
 * The page's own words, written once here. They are English-only words that go through publicText
 * (marked lang="en" on a Bangla page) and are listed in R2-records.md for the localization lane.
 * Words with an existing catalogue key (the start button) arrive from the page.
 */
export const HOW_WORDS = {
  titleLead: 'How It',
  titleEnd: 'Works.',
  lead: 'Four steps. Each one is yours.',
  add: 'Add',
  check: 'Check',
  prepare: 'Prepare',
  share: 'Share',
  addBody: 'Add a document by photo or file. Details are suggested for you to confirm.',
  checkBody: 'Confirm, change or skip each suggestion. Nothing is assumed.',
  prepareBody: 'Pick a country and purpose. The checklist fills from what you already have.',
  shareBody: 'Choose what leaves, for whom, until when. Turn it off any time.',
  wordsLead: 'Words Mean Exactly',
  wordsEnd: 'What They Say.',
  wordsHint: 'Select a word to read what it means.',
  closingLead: 'See It With Your',
  closingEnd: 'Own Passport.',
  closingSub: 'Start with one document.',
  privacy: 'Privacy and Trust',
} as const;

const WORD_TILES = [
  {
    word: 'Received',
    not: 'is not Reviewed',
    means: 'A file arrived. No one has checked it yet.',
  },
  {
    word: 'Suggested',
    not: 'is not Confirmed',
    means: 'A detail was read from your page. Nothing is true until you say so.',
  },
  {
    word: 'Saved',
    not: 'is not Shared',
    means: 'A saved file stays yours until you choose to share it.',
  },
  {
    word: 'Ready',
    not: 'is not Approved',
    means: 'Ready counts what is complete. It never promises a visa.',
  },
] as const;

export function HowHero({ pageLang }: { readonly pageLang: string }): ReactElement {
  const say = (text: string) => publicText(text, pageLang);
  const chips = [HOW_WORDS.add, HOW_WORDS.check, HOW_WORDS.prepare, HOW_WORDS.share];
  return (
    <Chapter tone="dark" labelledBy="how-title" className="hk-chapter hk-hero">
      <div className="hk-inner">
        <h1 id="how-title" className="hk-h1">
          {say(HOW_WORDS.titleLead)} <HeadlineWords>{say(HOW_WORDS.titleEnd)}</HeadlineWords>
        </h1>
        <p className="hk-lead">{say(HOW_WORDS.lead)}</p>
        <ol className="hk-chips">
          {chips.map((word, index) => (
            <li key={word} className="hk-step-chip">
              <span className="hk-step-num" aria-hidden="true">
                {index + 1}
              </span>
              <span>{say(word)}</span>
            </li>
          ))}
        </ol>
      </div>
    </Chapter>
  );
}

export function HowRows({ pageLang }: { readonly pageLang: string }): ReactElement {
  const say = (text: string) => publicText(text, pageLang);
  const rows: readonly { id: string; title: string; body: string; picture: ReactNode }[] = [
    {
      id: 'add',
      title: HOW_WORDS.add,
      body: HOW_WORDS.addBody,
      picture: <ScanPhone fields={FIXTURE_FIELDS} step={1} pageLang={pageLang} />,
    },
    {
      id: 'check',
      title: HOW_WORDS.check,
      body: HOW_WORDS.checkBody,
      picture: <ScanPhone fields={FIXTURE_FIELDS} step={2} pageLang={pageLang} />,
    },
    {
      id: 'prepare',
      title: HOW_WORDS.prepare,
      body: HOW_WORDS.prepareBody,
      picture: (
        <CountryChecklistPanel
          countries={FIXTURE_COUNTRIES}
          items={FIXTURE_ITEMS}
          active={1}
          pageLang={pageLang}
        />
      ),
    },
    {
      id: 'share',
      title: HOW_WORDS.share,
      body: HOW_WORDS.shareBody,
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
                <h2 className="hk-h2">{say(row.title)}</h2>
                <p className="hk-body">{say(row.body)}</p>
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

export function WordsBand({ pageLang }: { readonly pageLang: string }): ReactElement {
  const say = (text: string) => publicText(text, pageLang);
  return (
    <Chapter tone="light" className="hk-chapter hk-words" id="words" labelledBy="words-title">
      <div className="hk-inner">
        <h2 id="words-title" className="hk-h2">
          {say(HOW_WORDS.wordsLead)} <HeadlineWords>{say(HOW_WORDS.wordsEnd)}</HeadlineWords>
        </h2>
        <p className="hk-hint">{say(HOW_WORDS.wordsHint)}</p>
        <ul className="hk-flip-grid">
          {WORD_TILES.map((item, index) => (
            <li key={item.word}>
              <RiseIn delay={Math.min(0.4, index * 0.08)}>
                <FlipTile word={say(item.word)} not={say(item.not)} means={say(item.means)} />
              </RiseIn>
            </li>
          ))}
        </ul>
      </div>
    </Chapter>
  );
}

export function HowClosing({
  pageLang,
  start,
}: {
  readonly pageLang: string;
  /** The start button's words, from the existing catalogue key. */
  readonly start: ReactNode;
}): ReactElement {
  const say = (text: string) => publicText(text, pageLang);
  return (
    <ClosingBand
      pageLang={pageLang}
      titleId="closing-title"
      title={
        <>
          {say(HOW_WORDS.closingLead)} <HeadlineWords>{say(HOW_WORDS.closingEnd)}</HeadlineWords>
        </>
      }
      sub={say(HOW_WORDS.closingSub)}
      actions={
        <>
          <PublicButton href="/app" variant="primary">
            {start}
          </PublicButton>
          <PublicButton href="/trust" variant="secondary">
            {say(HOW_WORDS.privacy)}
          </PublicButton>
        </>
      }
    />
  );
}
