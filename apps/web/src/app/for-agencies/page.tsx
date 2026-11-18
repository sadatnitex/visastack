import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { PublicButton } from '../../components/public-site/public-button';
import { ReadinessRing } from '../../components/public-site/readiness-ring';
import { Chapter, Scene } from '../../components/public-site/scene';
import { ScenesRuntime } from '../../components/public-site/scenes-runtime';
import {
  ExampleTag,
  HeadlineWords,
  StatusChip,
  StoryCard,
} from '../../components/public-site/story';
import { isPublicBetaOpen } from '../../lib/public-beta';
import { isSignedIn } from '../../lib/signed-in';
import { AGENCY_POINTS, EXAMPLE_LINE, EXAMPLE_SHARING } from './for-agencies-data';
import './for-agencies.css';

export const metadata: Metadata = { title: 'For Agencies' };

/**
 * Public For Agencies page (WP-PUB4). Invite-only as the home page says today, with today's button
 * labels and the same sign-in flow. It states what the product does and shows pictures made of
 * Example figures only: no logos, counts, testimonials, ratings or partner names.
 */
export default async function ForAgenciesPage(): Promise<ReactElement> {
  const signedIn = await isSignedIn();
  const betaOpen = isPublicBetaOpen();
  const startLabel = signedIn
    ? 'Open Your Workspace'
    : betaOpen
      ? 'Create Your Free Account'
      : 'Sign In to Get Started';
  const startHref = !signedIn && betaOpen ? '/auth/sign-up' : '/app';
  const actions = (
    <div className="pub4-actions">
      <PublicButton href={startHref} variant="primary">
        {startLabel}
      </PublicButton>
      <PublicButton href="/status" variant="secondary">
        See What Works Today
      </PublicButton>
    </div>
  );

  return (
    <>
      <Chapter tone="dark" labelledBy="agencies-title" className="pub4-hero">
        <div className="container pub4-hero-copy">
          <p className="pub4-kicker">{betaOpen ? 'Free Public Beta' : 'Invite-Only Pilot'}</p>
          <h1 id="agencies-title" className="pub4-title">
            Stop Chasing Documents <HeadlineWords>by Message</HeadlineWords>
          </h1>
          <p className="pub4-lede">Ask for a document, then see the answer in one place.</p>
          {actions}
        </div>
      </Chapter>

      <Chapter tone="light" labelledBy="agencies-gets-title">
        <div className="container">
          <h2 id="agencies-gets-title" className="pub4-h2">
            What an Agency Gets
          </h2>
          <div className="pub4-grid">
            {AGENCY_POINTS.map((point) => (
              <StoryCard key={point.title} title={point.title} body={point.body} />
            ))}
          </div>
        </div>
      </Chapter>

      <Chapter tone="dark">
        <Scene name="line" len={2} steps={3} labelledBy="agencies-line-title">
          <div className="container pub4-line">
            <h2 id="agencies-line-title" className="pub4-h2">
              One Case, One Clear Line
            </h2>
            <div className="pub4-board">
              <ExampleTag />
              <ReadinessRing done={4} total={6} size="lg" countLabel="Documents Ready" />
              <ol className="pub4-steps">
                {EXAMPLE_LINE.map((row) => (
                  <li key={row.status} className="pub4-step">
                    <StatusChip status={row.status} />
                    <strong className="pub4-step-name">{row.name}</strong>
                    <span className="pub4-step-note">{row.note}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </Scene>
      </Chapter>

      <Chapter tone="light" labelledBy="agencies-share-title">
        <div className="container">
          <h2 id="agencies-share-title" className="pub4-h2">
            You See Only What Is Shared
          </h2>
          <div className="pub4-grid pub4-grid-two">
            <StoryCard
              title="Saved Is Not Shared"
              body="A client's record is private. Sharing starts with their permission, and every sharing decision is recorded."
              example
              raised
            >
              <div className="pub4-chips">
                {EXAMPLE_SHARING.map((status) => (
                  <StatusChip key={status} status={status} />
                ))}
              </div>
            </StoryCard>
            <StoryCard
              title="Access Can End"
              body="When a client ends access, you stop seeing the record, and the change is recorded."
            />
          </div>
        </div>
      </Chapter>

      <Chapter tone="dark" labelledBy="agencies-close-title">
        <div className="container pub4-hero-copy">
          <h2 id="agencies-close-title" className="pub4-h2">
            One Traveller Profile, Fewer Repeat Requests
          </h2>
          {actions}
        </div>
      </Chapter>
      <ScenesRuntime />
    </>
  );
}
