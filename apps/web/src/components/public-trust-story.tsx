import Link from 'next/link';
import type { ReactNode } from 'react';
import { ShareHero } from '../app/trust/share-hero';
import { trustCatalog } from '../i18n/trust';
import { getPageLanguage, getServerT } from '../lib/i18n-server';
import { isPublicBetaOpen } from '../lib/public-beta';
import { ownDetailsWelcome } from '../lib/real-data-wording';
import { Icon, type IconName } from './icons';
import { DocumentPicture } from './pictures/document-picture';
// Imported by file, never through the kit's index: the index also names the client-side timed sheet, and
// a page that imports the index would ship that sheet's code to every visitor (public JavaScript budget).
import { ClosingBand } from './public-site/kit/closing-band';
import { englishOn } from './public-site/kit/doc-kinds';
import { RiseIn } from './public-site/kit/rise-in';
import { ShareSheetBody, type ShareStep } from './public-site/kit/share-sheet-body';
import { PublicButton } from './public-site/public-button';
import { publicText } from './public-site/public-text';
import { Chapter } from './public-site/scene';
import { ExampleTag, HeadlineWords } from './public-site/story';
import './public-pub3-story.css';

/** The five steps of the share picture, in order (nothing shared, one paper, another, an end date, ended). */
const SHARE_STEPS: readonly ShareStep[] = [0, 1, 2, 3, 4];

/** The five promises, in the order the approved reference shows them. Each says only what the code does today. */
const PROMISES = [
  {
    type: 'PASSPORT',
    title: 'Private by Default',
    body: 'Agencies and other people see it only when you share it. Support help is the one exception: it needs a reason and a second approval, lasts at most an hour, and is logged.',
  },
  {
    type: 'BANK_STATEMENT',
    title: 'See What Leaves',
    body: 'Before you share, you see what goes and what stays private.',
  },
  {
    type: 'NATIONAL_ID',
    title: 'Turn Off Any Time',
    body: 'Every share ends on a date, and you can end it sooner. Copies already downloaded cannot be recalled.',
  },
  {
    type: 'TAX_RETURN',
    title: null,
    body: 'Sharing, ending and access to your papers go into a history you can read.',
  },
  {
    type: 'PHOTO',
    title: 'You Approve Suggestions',
    body: 'A suggested detail is saved as a fact only when you confirm it. You can also type it yourself.',
  },
] as const;

/** The history rows are made up, so the chapter carries the Example tag. */
const HISTORY: readonly { icon: IconName; text: string; when: string }[] = [
  { icon: 'lock', text: 'You ended sharing with Agency', when: 'Today' },
  { icon: 'share', text: 'You shared Passport with Agency', when: '12 Nov' },
  { icon: 'check', text: 'You confirmed Surname', when: '10 Nov' },
];

const WE_DO = [
  'Keep your documents private to you',
  'Show what every share contains',
  'Record sharing, ending and access to your papers',
] as const;

const WE_DO_NOT = [
  'Approve or refuse a visa',
  'Say a document is genuine',
  'Share your papers unless you choose to',
] as const;

/**
 * The Privacy and Trust page as the approved reference tells it (R3, owner, 18 Nov 2026): six
 * chapters. A dark opening with the timed share sheet, five promises, the history, what we do and
 * do not do, where we are today (the country rules list lives here, shown only when it has
 * entries), and the closing band. Everything drawn is made up and tagged Example; private sharing
 * records are never read here.
 */
export function PublicTrustStory({ catalog }: { readonly catalog?: ReactNode }) {
  const t = getServerT(trustCatalog);
  const lang = getPageLanguage();
  const say = (text: string) => publicText(text, lang);
  // Owner, 19 Nov 2026: no practice-record words once own details are welcome.
  const ownWelcome = ownDetailsWelcome();
  const betaOpen = isPublicBetaOpen();

  return (
    <>
      <Chapter tone="dark" labelledBy="trust-story-title" className="tr-chapter tr-hero">
        <div className="tr-wrap tr-hero-grid">
          <div className="tr-hero-copy">
            <h1 id="trust-story-title" className="kit-h1">
              {say('You decide')}
              <br />
              <HeadlineWords>{say('who sees what.')}</HeadlineWords>
            </h1>
            <p className="kit-sub">
              {say('Agencies and other people see it only when you share it.')}
            </p>
            <div className="kit-actions">
              <PublicButton href="/app" variant="primary">
                {t.node('trust.publicTrustStory.startWithYourOwnProfile')}
              </PublicButton>
              <span className="tr-hero-more">
                <PublicButton href="/privacy" variant="secondary">
                  {t.node('trust.publicTrustStory.viewPrivacyDetails')}
                </PublicButton>
              </span>
            </div>
          </div>
          <div className="tr-hero-visual">
            <ShareHero
              steps={SHARE_STEPS.map((step) => (
                <ShareSheetBody key={step} step={step} pageLang={lang} />
              ))}
              pauseFace={
                <>
                  <Icon name="pause" size={16} />
                  {say('Pause the Animation')}
                </>
              }
              playFace={
                <>
                  <Icon name="arrow" size={16} />
                  {say('Play the Animation')}
                </>
              }
            />
          </div>
        </div>
      </Chapter>

      <Chapter
        tone="dark"
        labelledBy="trust-promises-title"
        className="tr-chapter tr-section"
        id="promises"
      >
        <div className="tr-wrap">
          <RiseIn>
            <h2 className="kit-h2" id="trust-promises-title">
              {say('Five promises.')}
            </h2>
          </RiseIn>
          <ul className="tr-promises">
            {PROMISES.map((promise, index) => (
              <RiseIn as="li" delay={index * 0.08} className="tr-promise" key={promise.type}>
                <span className="tr-promise-art">
                  <DocumentPicture type={promise.type} size={56} />
                </span>
                <b className="tr-promise-title">
                  {promise.title === null
                    ? t.node('trust.publicTrustStory.aHistoryYouCanReview')
                    : say(promise.title)}
                </b>
                <span className="tr-promise-body">{say(promise.body)}</span>
              </RiseIn>
            ))}
          </ul>
        </div>
      </Chapter>

      <Chapter
        tone="dark"
        labelledBy="trust-history-title"
        className="tr-chapter tr-section tr-history-chapter"
        id="history"
      >
        <div className="tr-wrap">
          <RiseIn>
            <h2 className="kit-h2" id="trust-history-title">
              {say('Your history,')}
              <br />
              <HeadlineWords>{say('in plain view.')}</HeadlineWords>
            </h2>
          </RiseIn>
          <ol className="tr-history" aria-labelledby="trust-history-title">
            {HISTORY.map((row, index) => (
              <RiseIn as="li" delay={index * 0.12} className="tr-event" key={row.text}>
                <span className="tr-event-icon" aria-hidden="true">
                  <Icon name={row.icon} size={18} />
                </span>
                <span className="tr-event-text">
                  <b>{say(row.text)}</b>
                  <span className="tr-event-when">
                    <ExampleTag pageLang={lang} />
                    <span {...englishOn(lang)}>{row.when}</span>
                  </span>
                </span>
              </RiseIn>
            ))}
          </ol>
        </div>
      </Chapter>

      <Chapter
        tone="light"
        labelledBy="trust-limits-title"
        className="tr-chapter tr-section"
        id="limits"
      >
        <div className="tr-wrap">
          <RiseIn>
            <h2 className="kit-h2" id="trust-limits-title">
              {say('What we do.')}
              <br />
              <HeadlineWords>{say('What we do not.')}</HeadlineWords>
            </h2>
          </RiseIn>
          <div className="tr-two">
            <RiseIn className="tr-col">
              <h3 className="tr-col-title">{say('We Do')}</h3>
              <ul className="tr-list">
                {WE_DO.map((line) => (
                  <li key={line}>
                    <Icon name="check" size={18} />
                    <span>{say(line)}</span>
                  </li>
                ))}
              </ul>
            </RiseIn>
            <RiseIn delay={0.1} className="tr-col">
              <h3 className="tr-col-title">{say('We Do Not')}</h3>
              <ul className="tr-list tr-list-not">
                {WE_DO_NOT.map((line) => (
                  <li key={line}>
                    <Icon name="close" size={18} />
                    <span>{say(line)}</span>
                  </li>
                ))}
              </ul>
            </RiseIn>
          </div>
          <p className="tr-disclaimer">
            {t.node('trust.publicTrustStory.clearBoundariesHumanControlNoApproval')}
          </p>
        </div>
      </Chapter>

      <Chapter
        tone="light"
        labelledBy="trust-today-title"
        className="tr-chapter tr-section tr-today-chapter"
        id="today"
      >
        <div className="tr-wrap">
          <p className="p3-eyebrow">
            {say(betaOpen ? 'Free Public Beta' : ownWelcome ? 'Invited Use' : 'Controlled Pilot')}
          </p>
          <RiseIn className="tr-today-copy">
            <h2 className="kit-h2" id="trust-today-title">
              {say('Where we are')}
              <br />
              <HeadlineWords>{say('today.')}</HeadlineWords>
            </h2>
            <p className="kit-sub tr-today-text">
              {say(
                betaOpen
                  ? 'VisaStack is a free public beta, provided as it is. You may use your own details and documents. Independent checks will be listed here as they are completed, and nothing before.'
                  : ownWelcome
                    ? 'VisaStack is open to invited users, provided as it is. You may use your own details and documents. Independent checks will be listed here as they are completed, and nothing before.'
                    : 'VisaStack is in a controlled pilot. Only practice records are used. Independent checks will be listed here as they are completed, and nothing before.',
              )}
            </p>
          </RiseIn>
          <div className="tr-today-links">
            <Link className="p3-text-link" href="/how-it-works">
              {say('How It Works')} <Icon name="arrow" size={16} />
            </Link>
            <Link className="p3-text-link" href="/privacy">
              {t.node('trust.publicTrustStory.viewPrivacyDetails')} <Icon name="arrow" size={16} />
            </Link>
          </div>
          {catalog}
        </div>
      </Chapter>

      <ClosingBand
        titleId="trust-closing-title"
        pageLang={lang}
        title={
          <>
            {say('Private from')}
            <br />
            <HeadlineWords>{say('the first document.')}</HeadlineWords>
          </>
        }
        sub={say(ownWelcome ? 'Start with your own record.' : 'Start with a practice record.')}
        actions={
          <PublicButton href="/app" variant="primary">
            {t.node('trust.publicTrustStory.startWithYourOwnProfile')}
          </PublicButton>
        }
      />
    </>
  );
}
