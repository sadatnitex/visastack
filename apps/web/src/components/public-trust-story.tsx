import Link from 'next/link';
import { trustCatalog } from '../i18n/trust';
import { getPageLanguage, getServerT } from '../lib/i18n-server';
import { Icon } from './icons';
import { PublicButton } from './public-site/public-button';
import { publicText } from './public-site/public-text';
import { Chapter, Scene } from './public-site/scene';
import { ScenesRuntime } from './public-site/scenes-runtime';
import { ExampleTag, HeadlineWords, StatusChip, StoryCard } from './public-site/story';
import './public-pub3-story.css';

/**
 * The Privacy and Trust story (WP-PUB3): a dark opening, the share scene (Saved, then Shared, then
 * Access Ended), the four promises, and a light closing that holds the privacy link. Everything
 * drawn is made up and tagged Example; private sharing records are never read here.
 */
export function PublicTrustStory() {
  const t = getServerT(trustCatalog);
  const lang = getPageLanguage();
  const say = (text: string) => publicText(text, lang);
  const items = [
    { key: 'passport', icon: 'check', label: t.node('trust.publicTrustStory.passportSummary') },
    { key: 'itinerary', icon: 'check', label: t.node('trust.publicTrustStory.confirmedItinerary') },
  ] as const;

  return (
    <>
      <ScenesRuntime />
      <Chapter tone="dark" labelledBy="trust-story-title" className="p3-ch p3-hero">
        <div className="p3-inner">
          <h1 id="trust-story-title" className="p3-hero-title">
            {say('Your documents.')} <HeadlineWords>{say('Your decisions.')}</HeadlineWords>
          </h1>
          <p className="p3-lead">{say('Share only what you choose, for as long as you choose.')}</p>
          <div>
            <PublicButton href="/app" variant="primary">
              {t.node('trust.publicTrustStory.startWithYourOwnProfile')}
            </PublicButton>
          </div>
        </div>
      </Chapter>

      <Chapter tone="light" className="p3-ch" id="sharing" labelledBy="share-title">
        <Scene name="share" len={2} steps={4}>
          <div className="p3-inner">
            <div className="p3-scene-grid">
              <div className="p3-inner-col">
                <p className="p3-eyebrow">{t.node('trust.publicTrustStory.theTrustModel')}</p>
                <h2 id="share-title" className="p3-heading">
                  {t.node('trust.publicTrustStory.sharingPermissions')}
                </h2>
                <p>{t.node('trust.publicTrustStory.yourPassportAndPersonalRecordsBelong')}</p>
                <ol className="p3-moments">
                  <li className="p3-moment">
                    <StatusChip status="saved" pageLang={lang} />
                    <span>{say('Saved is yours alone. Nobody else can see it.')}</span>
                  </li>
                  <li className="p3-moment">
                    <StatusChip status="shared" pageLang={lang} />
                    <span>{say('You switch on the items an agency may see.')}</span>
                  </li>
                  <li className="p3-moment">
                    <StatusChip status="shared" pageLang={lang} />
                    <span>{t.node('trust.publicTrustStory.selectedItemsForALimitedTime')}</span>
                  </li>
                  <li className="p3-moment">
                    <StatusChip status="accessEnded" pageLang={lang} />
                    <span>{t.node('trust.publicTrustStory.reviewPauseOrEndFutureAccess')}</span>
                  </li>
                </ol>
              </div>
              <aside
                className="p3-panel"
                aria-label={t('trust.publicTrustStory.exampleOfSharingPermissions')}
              >
                <ExampleTag pageLang={lang} />
                <div className="p3-people">
                  <span className="p3-person">
                    {t.node('trust.publicTrustStory.exampleTraveller')}
                  </span>
                  <small>{t.node('trust.publicTrustStory.ownerOfThisExampleFile')}</small>
                </div>
                <div className="p3-people">
                  <span className="p3-person">
                    {t.node('trust.publicTrustStory.exampleAgency')}
                  </span>
                </div>
                <ul className="p3-rows">
                  {items.map((item) => (
                    <li className="p3-row" key={item.key}>
                      <span>
                        <Icon name={item.icon} size={15} /> {item.label}
                      </span>
                      <span className="p3-state p3-state-saved">
                        <StatusChip status="saved" pageLang={lang} />
                      </span>
                      <span className="p3-state p3-state-shared">
                        <StatusChip status="shared" pageLang={lang} />
                      </span>
                      <span className="p3-state p3-state-ended">
                        <StatusChip status="accessEnded" pageLang={lang} />
                      </span>
                    </li>
                  ))}
                  <li className="p3-row">
                    <span>
                      <Icon name="lock" size={15} />{' '}
                      {t.node('trust.publicTrustStory.originalFilesStayProtected')}
                    </span>
                  </li>
                </ul>
                <p className="p3-until">{say('Access ends when you choose.')}</p>
              </aside>
            </div>
          </div>
        </Scene>
      </Chapter>

      <Chapter tone="dark" className="p3-ch" id="promises" labelledBy="promises-title">
        <div className="p3-inner">
          <h2 id="promises-title" className="p3-heading">
            {say('How Your Records Are Protected')}
          </h2>
          <div className="p3-cards">
            <StoryCard
              title={t.node('trust.publicTrustStory.privateByDesign')}
              body={t.node('trust.publicTrustStory.yourRecordsBelongToYouChoose')}
            />
            <StoryCard
              title={t.node('trust.publicTrustStory.knowWhoCanSeeWhat')}
              body={t.node('trust.publicTrustStory.accessStartsAfterAcceptanceYouCan')}
            />
            <StoryCard
              title={t.node('trust.publicTrustStory.aHistoryYouCanReview')}
              body={t.node('trust.publicTrustStory.changesAreRecordedAsNewVersions')}
            />
            <StoryCard
              title={t.node('trust.publicTrustStory.aiSuggestsYouDecide')}
              body={t.node('trust.publicTrustStory.aSuggestionStaysSeparateFromA')}
            />
          </div>
          <div className="p3-bottom">
            <p className="p3-panel-title">
              {t.node('trust.publicTrustStory.clearBoundariesHumanControlNoApproval')}
            </p>
            <Link className="p3-text-link" href="/how-it-works">
              {say('How It Works')} <Icon name="arrow" size={16} />
            </Link>
            <Link className="p3-text-link" href="/privacy">
              {t.node('trust.publicTrustStory.viewPrivacyDetails')} <Icon name="arrow" size={16} />
            </Link>
          </div>
        </div>
      </Chapter>
    </>
  );
}
