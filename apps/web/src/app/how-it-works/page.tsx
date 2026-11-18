import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { PublicButton } from '../../components/public-site/public-button';
import { publicText } from '../../components/public-site/public-text';
import { ReadinessRing } from '../../components/public-site/readiness-ring';
import { Chapter, Scene } from '../../components/public-site/scene';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import {
  ExampleTag,
  HeadlineWords,
  StatusChip,
  StoryCard,
} from '../../components/public-site/story';
import { trustCatalog } from '../../i18n/trust';
import { getPageLanguage, getServerT, primeLocale } from '../../lib/i18n-server';
import { CASE_STATUS } from '../../lib/status-words';
import '../../components/public-pub3-story.css';

export const metadata: Metadata = { title: 'How It Works' };

/**
 * The case story (WP-PUB3). The stage names are the product's own words (status-words.ts), in the
 * order a case moves through them. The case drawn here is made up and says so. Only stages a case can reach
 * today are shown: Submitted is not reachable yet (packages/core domain.ts).
 */
const STAGES = [
  { word: CASE_STATUS.DRAFT.word, line: 'You pick a country and a route.', ready: 0 },
  { word: CASE_STATUS.INTAKE.word, line: 'Documents join the case from your vault.', ready: 2 },
  {
    word: CASE_STATUS.IN_REVIEW.word,
    line: 'You look over the case before it moves on.',
    ready: 5,
  },
  {
    word: CASE_STATUS.AWAITING_APPLICANT.word,
    line: 'If something is missing, the case comes back to you.',
    ready: 6,
  },
  {
    word: CASE_STATUS.SUBMISSION_READY.word,
    line: 'You confirm it, and the case is ready.',
    ready: 8,
  },
] as const;
const TOTAL = 8;

export default async function HowItWorksPage(): Promise<ReactElement> {
  await primeLocale();
  const lang = getPageLanguage();
  const t = getServerT(trustCatalog);
  const say = (text: string) => publicText(text, lang);

  return (
    <>
      <ScenesRuntime />
      <Chapter tone="dark" labelledBy="how-title" className="p3-ch p3-hero">
        <div className="p3-inner">
          <h1 id="how-title" className="p3-hero-title">
            {say('Your Case,')} <HeadlineWords>{say('Step by Step')}</HeadlineWords>
          </h1>
          <p className="p3-lead">
            {say('Add your documents once. See what each case needs next.')}
          </p>
          <div>
            <PublicButton href="/app" variant="primary">
              {t.node('trust.publicTrustStory.startWithYourOwnProfile')}
            </PublicButton>
          </div>
        </div>
      </Chapter>

      <Chapter tone="light" className="p3-ch" id="case-story" labelledBy="case-title">
        <Scene name="case" len={3} steps={STAGES.length}>
          <div className="p3-inner">
            <div className="p3-scene-grid">
              <div className="p3-inner-col">
                <p className="p3-eyebrow">{say('Follow a Case')}</p>
                <h2 id="case-title" className="p3-heading">
                  {say('Every Case Has a Clear Next Step')}
                </h2>
                <div className="p3-bar" aria-hidden="true">
                  <span className="p3-fill" />
                </div>
                <ol className="p3-stages">
                  {STAGES.map((stage, index) => (
                    <li className="p3-stage" key={stage.word}>
                      <span className="p3-node" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span>
                        <span className="p3-stage-word">{say(stage.word)}</span>
                        <span className="p3-stage-line">{say(stage.line)}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="p3-panel">
                <ExampleTag pageLang={lang} />
                <h3 className="p3-panel-title">{say('Example Case: Japan Visit')}</h3>
                {STAGES.map((stage, index) => (
                  <div
                    className="p3-at"
                    data-at={index}
                    key={stage.word}
                    hidden={index !== STAGES.length - 1}
                  >
                    <ReadinessRing
                      done={stage.ready}
                      total={TOTAL}
                      countLabel="Documents Ready"
                      pageLang={lang}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Scene>
      </Chapter>

      <Chapter tone="dark" className="p3-ch" id="in-charge" labelledBy="charge-title">
        <div className="p3-inner">
          <h2 id="charge-title" className="p3-heading">
            {say('You Stay in Charge')}
          </h2>
          <div className="p3-cards">
            <StoryCard
              example
              pageLang={lang}
              title={say('Suggested Is Not Confirmed')}
              body={say(
                'What we read from your document is only a suggestion. Nothing changes until you confirm it.',
              )}
            >
              <div className="p3-chips">
                <StatusChip status="suggested" pageLang={lang} />
                <StatusChip status="confirmed" pageLang={lang} />
              </div>
            </StoryCard>
            <StoryCard
              example
              pageLang={lang}
              title={say('Saved Is Not Shared')}
              body={say(
                'A document you save stays yours. Agencies and other people see it only when you share it.',
              )}
            >
              <div className="p3-chips">
                <StatusChip status="saved" pageLang={lang} />
                <StatusChip status="shared" pageLang={lang} />
              </div>
            </StoryCard>
            <StoryCard
              example
              pageLang={lang}
              title={say('Received Is Not Reviewed')}
              body={say(
                'Your agency is told when a file arrives. That is not a review. You are told when it is accepted.',
              )}
            >
              <div className="p3-chips">
                <StatusChip status="received" pageLang={lang} />
                <StatusChip status="reviewed" pageLang={lang} />
              </div>
            </StoryCard>
          </div>
        </div>
      </Chapter>

      <Chapter tone="light" className="p3-ch" labelledBy="next-title">
        <div className="p3-inner">
          <h2 id="next-title" className="p3-heading">
            {say('Ready When You Are')}
          </h2>
          <p className="p3-lead">
            {say('Readiness shows how complete a case is. It is never an approval.')}
          </p>
          <div className="p3-bottom">
            <PublicButton href="/app" variant="primary">
              {t.node('trust.publicTrustStory.startWithYourOwnProfile')}
            </PublicButton>
            <Link className="p3-text-link" href="/trust">
              {say('Privacy and Trust')}
            </Link>
          </div>
        </div>
      </Chapter>
    </>
  );
}
