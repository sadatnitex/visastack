import type { ReactNode } from 'react';
import { Icon } from '../components/icons';
import { DocumentPicture } from '../components/pictures/document-picture';
import {
  CasesTable,
  ClosingBand,
  CountryChecklistPanel,
  DocumentDeck,
  FIXTURE_CASES,
  FIXTURE_COUNTRIES,
  FIXTURE_FIELDS,
  FIXTURE_ITEMS,
  FIXTURE_STAGES,
  JourneyTrack,
  RiseIn,
  ScanPhone,
  SegmentRing,
  ShareSheet,
} from '../components/public-site/kit';
import { PublicButton } from '../components/public-site/public-button';
import { publicText } from '../components/public-site/public-text';
import { Chapter, Scene } from '../components/public-site/scene';
import { ScenesRuntime } from '../components/public-site/scenes-runtime';
import { ExampleTag, HeadlineWords } from '../components/public-site/story';
import './home-story.css';

/**
 * The Home page as the approved reference tells it (R1, owner 18 Nov 2026): eight chapters and
 * nothing between the header and the footer. Pinned chapters move with the scroll on a computer;
 * on a phone, with reduced motion, with data saver or without JavaScript every chapter rests
 * finished and still. Every figure is made up and says so.
 *
 * The words here have no catalogue entry yet, so they are English text marked as such on a Bangla
 * page (publicText) and listed in docs/upgrades/programme/pub/R1-records.md for the localization
 * lane. The buttons keep today's labels and links; the page passes them in.
 */

export interface HomeActions {
  /** Today's main button: its words and where it goes. */
  readonly start: { readonly label: ReactNode; readonly href: string };
  /** Today's second button. */
  readonly status: { readonly label: ReactNode; readonly href: string };
  /** The For Agencies link's words. */
  readonly forAgencies: ReactNode;
}

export interface HomeStoryProps {
  readonly actions: HomeActions;
  /** The pilot or beta line shown in the first chapter (today's words). */
  readonly nudge: ReactNode;
  /** The pilot or beta terms, in the owner's own words, shown at the foot of the page. */
  readonly notice: ReactNode;
  /** A sign-in problem notice from a failed sign-in, shown above the first chapter's words. */
  readonly alert?: ReactNode;
  readonly pageLang: string;
}

/** Hero: five papers fan around the passport while the ring counts up. */
const HERO_STEPS = 6;
const HERO_DOCS = ['insurance', 'flight', 'passport', 'bank', 'photo'] as const;

const ADD_STEPS = [
  { title: 'Add', body: 'Take a photo or pick a file.' },
  { title: 'Read', body: 'Details are suggested from the page.' },
  { title: 'Confirm', body: 'Nothing is saved as true until you say so.' },
] as const;

const SHARE_CAPTIONS = [
  'Nothing leaves unless you choose it.',
  'Choose a document and exactly which part.',
  'Add only what the agency needs.',
  'Set an end date. It stops by itself.',
  'Or turn it off now. Access ends at once.',
] as const;

const RULE_CARDS = [
  {
    type: 'TRAVEL_ITINERARY',
    title: 'Source Shown',
    body: 'Each requirement links to its official page.',
    chip: 'Official page',
    icon: 'file',
  },
  {
    type: 'VISA',
    title: 'Checked Date',
    body: 'You see when a rule was last checked.',
    chip: 'Checked on an Example date',
    icon: 'clock',
  },
  {
    type: 'TAX_RETURN',
    title: 'Changes Flagged',
    body: 'If a rule changes, your checklist says so.',
    chip: 'Changed',
    icon: 'alert',
  },
] as const;

function englishOn(lang: string): { lang?: string } {
  return lang === 'en' ? {} : { lang: 'en' };
}

/** The flight arcs that draw behind the checklist as the scene runs (stroke only, from --p). */
function FlightArcs() {
  return (
    <svg
      className="hs-arcs"
      viewBox="0 0 100 60"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path className="hs-arc" data-arc="1" pathLength={1} d="M8 52 C30 5, 60 5, 92 14" />
      <path className="hs-arc" data-arc="2" pathLength={1} d="M8 52 C35 30, 70 32, 94 40" />
      <path className="hs-arc" data-arc="3" pathLength={1} d="M8 52 C25 58, 60 62, 90 54" />
    </svg>
  );
}

export function HomeStory({ actions, nudge, notice, alert, pageLang }: HomeStoryProps) {
  const say = (text: string) => publicText(text, pageLang);
  const buttons = (
    <>
      <PublicButton href={actions.start.href} variant="primary">
        {actions.start.label}
      </PublicButton>
      <PublicButton href={actions.status.href} variant="secondary">
        {actions.status.label}
      </PublicButton>
    </>
  );
  return (
    <div className="hs">
      <ScenesRuntime />
      <Chapter tone="dark" className="hs-chapter">
        <Scene
          name="hero"
          len={2}
          steps={HERO_STEPS}
          finalStep={HERO_STEPS - 1}
          minWidth={900}
          kitStage
          labelledBy="hs-hero-title"
          className="hs-scene"
        >
          <div className="hs-hero">
            <div className="hs-hero-words">
              {alert}
              <p className="hs-nudge">{nudge}</p>
              <h1 className="kit-h1" id="hs-hero-title">
                {say('One record.')}
                <br />
                <HeadlineWords>{say('Every visa.')}</HeadlineWords>
              </h1>
              <p className="kit-sub">
                {say(
                  'Keep your passport, photos and papers in one private place. Reuse them for every trip.',
                )}
              </p>
              <div className="kit-actions">{buttons}</div>
            </div>
            <DocumentDeck
              docs={HERO_DOCS}
              label="Example: five papers fanned around a passport, 5 of 8 ready. Completeness only. Not an approval."
              {...englishOn(pageLang)}
            />
            {/* The ring and its note repeat the figure's own text alternative (the deck's label), so a reader hears them once. */}
            <div className="hs-hero-cap" aria-hidden="true" {...englishOn(pageLang)}>
              <span className="hs-hero-chip">
                <SegmentRing
                  filled={0}
                  tone="dark"
                  size={48}
                  steps={Array.from({ length: HERO_STEPS }, (_, step) => ({
                    filled: step,
                    label: `${step} of 8 Ready`,
                  }))}
                />
              </span>
              <span className="hs-hero-note">
                <ExampleTag pageLang={pageLang} />
                <span>{say('Example. Completeness only. Not an approval.')}</span>
              </span>
            </div>
          </div>
        </Scene>
      </Chapter>

      <Chapter tone="dark" className="hs-chapter" id="how-it-works">
        <Scene
          name="add"
          len={1.5}
          steps={3}
          finalStep={2}
          minWidth={900}
          kitStage
          labelledBy="hs-add-title"
          className="hs-scene"
        >
          <div className="hs-grid">
            <div className="hs-copy">
              <h2 className="kit-h2" id="hs-add-title">
                {say('Add it once.')}
                <br />
                <HeadlineWords>{say('Confirm what it reads.')}</HeadlineWords>
              </h2>
              <ol className="hs-steps">
                {ADD_STEPS.map((step, index) => (
                  <li className="hs-step" data-at={index} key={step.title}>
                    <b className="hs-step-num">{index + 1}</b>
                    <span className="hs-step-text">
                      <b>{say(step.title)}</b>
                      <span className="hs-step-body kit-sw" data-at={index}>
                        {say(step.body)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="hs-visual">
              <ScanPhone fields={FIXTURE_FIELDS} pageLang={pageLang} />
            </div>
          </div>
        </Scene>
      </Chapter>

      <Chapter tone="light" className="hs-chapter" id="capabilities">
        <Scene
          name="ready"
          len={1.5}
          steps={FIXTURE_COUNTRIES.length}
          finalStep={FIXTURE_COUNTRIES.length - 1}
          minWidth={900}
          kitStage
          labelledBy="hs-ready-title"
          className="hs-scene"
        >
          <FlightArcs />
          <div className="hs-grid">
            <div className="hs-copy">
              <h2 className="kit-h2" id="hs-ready-title">
                {say('Ready for')}
                <br />
                <HeadlineWords>{say('every trip.')}</HeadlineWords>
              </h2>
              <p className="kit-sub">
                {say('Each country has its own checklist. What you already added is reused.')}
              </p>
            </div>
            <div className="hs-visual">
              <CountryChecklistPanel
                countries={FIXTURE_COUNTRIES}
                items={FIXTURE_ITEMS}
                pageLang={pageLang}
              />
            </div>
          </div>
        </Scene>
      </Chapter>

      {/* PUBFIX2 P2-7: the case rests on its first stage (Getting Started, You), as the approved
          reference starts, on a phone, with reduced motion and without script. A scene that rests on
          its first step is not replayed by reveal or gentle mode, so the picture stays still there. */}
      <Chapter tone="light" className="hs-chapter hs-chapter-soft">
        <Scene
          name="journey"
          len={1.5}
          steps={FIXTURE_STAGES.length}
          finalStep={0}
          minWidth={900}
          kitStage
          labelledBy="hs-journey-title"
          className="hs-scene"
        >
          <div className="hs-journey">
            <h2 className="kit-h2" id="hs-journey-title">
              {say('Know where')}
              <br />
              <HeadlineWords>{say('it stands.')}</HeadlineWords>
            </h2>
            <JourneyTrack stages={FIXTURE_STAGES} pageLang={pageLang} />
          </div>
        </Scene>
      </Chapter>

      <Chapter tone="dark" className="hs-chapter">
        <Scene
          name="share"
          len={2}
          steps={5}
          finalStep={3}
          minWidth={900}
          kitStage
          labelledBy="hs-share-title"
          className="hs-scene"
        >
          <div className="hs-grid">
            <div className="hs-copy">
              <h2 className="kit-h2" id="hs-share-title">
                {say('You decide')}
                <br />
                <HeadlineWords>{say('who sees what.')}</HeadlineWords>
              </h2>
              <div className="hs-captions">
                {SHARE_CAPTIONS.map((caption, index) => (
                  <p className="hs-caption kit-sw" data-at={index} key={caption}>
                    {say(caption)}
                  </p>
                ))}
              </div>
            </div>
            <div className="hs-visual">
              <ShareSheet mode="scroll" pageLang={pageLang} />
            </div>
          </div>
        </Scene>
      </Chapter>

      <Chapter
        tone="light"
        className="hs-chapter hs-section"
        id="sources"
        labelledBy="hs-rules-title"
      >
        <div className="hs-wrap">
          <RiseIn>
            <h2 className="kit-h2" id="hs-rules-title">
              {say('Every rule shows')}
              <br />
              <HeadlineWords>{say('its source.')}</HeadlineWords>
            </h2>
          </RiseIn>
          <ul className="hs-cards">
            {RULE_CARDS.map((card, index) => (
              <RiseIn as="li" delay={index * 0.1} className="hs-card" key={card.title}>
                <span className="hs-card-art">
                  <DocumentPicture type={card.type} size={44} />
                </span>
                <b className="hs-card-title">{say(card.title)}</b>
                <span className="hs-card-body">{say(card.body)}</span>
                <span className="hs-card-chip" {...englishOn(pageLang)}>
                  <Icon name={card.icon} size={16} />
                  {card.chip}
                </span>
              </RiseIn>
            ))}
          </ul>
          <p className="hs-example">
            <ExampleTag pageLang={pageLang} />
            <span>{say('Illustration of how a rule is shown.')}</span>
          </p>
        </div>
      </Chapter>

      <Chapter
        tone="light"
        className="hs-chapter hs-chapter-soft hs-section"
        id="for-agencies"
        labelledBy="hs-agencies-title"
      >
        <div className="hs-wrap hs-grid">
          <div className="hs-copy">
            <RiseIn>
              <h2 className="kit-h2" id="hs-agencies-title">
                {say('Built for')}
                <br />
                <HeadlineWords>{say('agencies too.')}</HeadlineWords>
              </h2>
            </RiseIn>
            <RiseIn delay={0.1}>
              <p className="kit-sub">
                {say(
                  'Clients keep their own record. You see only what they share, and who is missing what.',
                )}
              </p>
            </RiseIn>
            <RiseIn delay={0.2} className="kit-actions">
              <PublicButton href="/for-agencies" variant="secondary">
                {actions.forAgencies}
              </PublicButton>
            </RiseIn>
          </div>
          <div className="hs-visual">
            <CasesTable rows={FIXTURE_CASES} pageLang={pageLang} />
          </div>
        </div>
      </Chapter>

      <ClosingBand
        id="start"
        title={
          <>
            {say('Start with')}
            <br />
            <HeadlineWords>{say('your passport.')}</HeadlineWords>
          </>
        }
        sub={say('Add one document and see what your first trip still needs.')}
        actions={buttons}
        note={notice}
        pageLang={pageLang}
      />
    </div>
  );
}
