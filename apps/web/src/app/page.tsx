import Link from 'next/link';
import type { ReactNode } from 'react';
import { CountryChecklistPicker } from '../components/country-checklist-picker';
import { Icon, type IconName } from '../components/icons';
import { countryStartData } from '../lib/country-start';
import { isPublicBetaOpen } from '../lib/public-beta';
import { isSignedIn } from '../lib/signed-in';
import { LandingStoryHelper } from './landing-story';
import './landing-c1.css';
import type { CatalogKey } from '@visastack/i18n';
import { homeCatalog } from '../i18n/home';
import { getServerT, primeLocale } from '../lib/i18n-server';

type HomeKey = CatalogKey<typeof homeCatalog>;

/**
 * The public home page, built on the frozen Harbor C1 reference (Programme X WP-L1).
 * Written for a traveller or an agency who has never heard of the product: plain words,
 * what it does and what is honestly not switched on yet. No engineering vocabulary and no
 * names of the tools behind it (guarded by `lib/plain-language.test.ts`).
 *
 * The Harbor hero and product chapter come first. The sections Harbor does not depict
 * (problem, how it works, availability, agencies, trust, road ahead, closing call) are
 * kept with Harbor colours only. Every drawn example is sample information and says so.
 * Each statement on this page maps to a claim row in docs/upgrades/programme/COVERAGE-LEDGER.csv.
 */

// The promise (owner decision, 27 Oct 2026, Growth G1): "A clean file you can stand behind."
// It is about the person's own file being complete, current and tidy. It never says or implies
// that any authority has approved, accepted or guaranteed anything.
const HERO_HEADLINE_FIRST: HomeKey = 'home.page.aCleanFile';
const HERO_HEADLINE_SECOND: HomeKey = 'home.page.youCanStandBehind';

interface PhoneFile {
  readonly name: HomeKey;
  readonly detail: HomeKey;
  readonly tag: HomeKey;
  readonly warning?: boolean;
}

const PHONE_FILES: readonly PhoneFile[] = [
  {
    name: 'home.page.passport',
    detail: 'home.page.currentRecordVersion2',
    tag: 'home.page.current',
  },
  {
    name: 'home.page.employmentLetteraaddbb',
    detail: 'home.page.addedToJapanCase',
    tag: 'home.page.added',
  },
  {
    name: 'home.page.bankStatement',
    detail: 'home.page.newerCopyRequested',
    tag: 'home.page.update',
    warning: true,
  },
];

interface Float {
  readonly id: 'c1-fc1' | 'c1-fc2' | 'c1-fc3' | 'c1-fc4';
  readonly icon: string;
  readonly title: HomeKey;
  readonly detail: HomeKey;
  readonly warning?: boolean;
}

// CL04-CL07. The third card is the expiry reminder (D5); "Prepared again, faster" returns
// only once Prepare again ships (WP-V6).
const FLOATS: readonly Float[] = [
  {
    id: 'c1-fc1',
    icon: '⌛',
    title: 'home.page.documentNeedsUpdating',
    detail: 'home.page.bankStatementJapanCase',
    warning: true,
  },
  {
    id: 'c1-fc2',
    icon: '▤',
    title: 'home.page.previousVersionKept',
    detail: 'home.page.historyStaysAvailableToYou',
  },
  {
    id: 'c1-fc3',
    icon: '◷',
    title: 'home.page.reminderBeforeItExpires',
    detail: 'home.page.passportSampleRecord',
  },
  {
    id: 'c1-fc4',
    icon: '◉',
    title: 'home.page.accessEnds30November',
    detail: 'home.page.threeSelectedRecordsShared',
  },
];

const BEFORE: readonly HomeKey[] = [
  'home.page.theSamePassportScanSentAgain',
  'home.page.documentsBuriedInChatsEmailsAnd',
  'home.page.noIdeaWhichVersionAnAgency',
  'home.page.surpriseRequestsForPapersThatHave',
];

const AFTER: readonly HomeKey[] = [
  'home.page.enterYourDetailsOnceAndReuse',
  'home.page.everyDocumentInOnePrivatePlace',
  'home.page.everyChangeKeptAsANew',
  'home.page.aWarningBeforeADocumentRuns',
];

interface Step {
  readonly title: HomeKey;
  readonly body: HomeKey;
  readonly icon: IconName;
}

const STEPS: readonly Step[] = [
  {
    title: 'home.page.addYourDetailsOnce',
    body: 'home.page.fillInYourProfileAndUpload',
    icon: 'upload',
  },
  {
    title: 'home.page.seeWhatIsMissing',
    body: 'home.page.pickAVisaRouteAndCheck',
    icon: 'clipboard',
  },
  {
    title: 'home.page.shareOnlyWhatIsNeeded',
    body: 'home.page.inviteAnAgencyToSeeSpecific',
    icon: 'share',
  },
];

interface Audience {
  readonly who: HomeKey;
  readonly title: HomeKey;
  readonly points: readonly HomeKey[];
  readonly icon: IconName;
}

const AUDIENCES: readonly Audience[] = [
  {
    who: 'home.page.forTravellers',
    title: 'home.page.knowWhereYourPapersAreAnd',
    points: [
      'home.page.storePassportAndSupportingDocumentsOnce',
      'home.page.seeWhichDocumentsAreMissingFor',
      'home.page.answerAnAgencySDocumentRequest',
    ],
    icon: 'user',
  },
  {
    who: 'home.page.forAgencies',
    title: 'home.page.stopChasingDocumentsByMessage',
    points: [
      'home.page.askAClientForASpecific',
      'home.page.openACaseAndSeeAt',
      'home.page.keepAClearRecordOfWho',
    ],
    icon: 'briefcase',
  },
];

const PROMISES: readonly { readonly icon: IconName; readonly text: HomeKey }[] = [
  { icon: 'eye', text: 'home.page.recordSharingStartsWithYourPermission' },
  { icon: 'activity', text: 'home.page.sharingDecisionsAreRecorded' },
  { icon: 'file', text: 'home.page.changesAreKeptAsNewVersions' },
  { icon: 'building', text: 'home.page.officialInformationShowsWhereItCame' },
  { icon: 'shield', text: 'home.page.aiNeverChangesYourProfileOn' },
  { icon: 'check', text: 'home.page.aManualWayToManageYour' },
];

const HORIZONS: readonly {
  readonly label: HomeKey;
  readonly title: HomeKey;
  readonly body: HomeKey;
  readonly state: 'now' | 'next' | 'later';
}[] = [
  {
    label: 'home.page.inThePilotToday',
    title: 'home.page.theCoreOfOneProfile',
    body: 'home.page.yourProfileWithSavedVersionsA',
    state: 'now',
  },
  {
    label: 'home.page.beingSwitchedOn',
    title: 'home.page.helpThatStaysInYourHands',
    body: 'home.page.aiSuggestionsFromYourDocumentsAnd',
    state: 'next',
  },
  {
    label: 'home.page.whereWeAreHeading',
    title: 'home.page.oneTrustedFileForEveryJourney',
    body: 'home.page.weAreWorkingTowardASingle',
    state: 'later',
  },
];

/**
 * A short heading written as one message whose English breaks onto set lines ("\n" in the
 * catalogue). Each line break becomes a `<br />`; a translation without one wraps on its own.
 * The element around it carries the message's language (`t.lang`).
 */
function Lines({ text }: { readonly text: string }) {
  const [first, ...rest] = text.split('\n');
  if (rest.length === 0) return <>{first}</>;
  return (
    <>
      {first}
      <br />
      <Lines text={rest.join('\n')} />
    </>
  );
}

/**
 * One story group (WP-SB8): a named region holding a details group whose summary row shows the
 * kicker and the section's own second-level heading. Closed, it is one short row; it opens in
 * place with a tap or the keyboard, and its words stay in the page for search.
 */
function StoryGroup({
  id,
  titleId,
  kicker,
  title,
  className,
  children,
}: {
  readonly id: string;
  readonly titleId: string;
  readonly kicker: ReactNode;
  readonly title: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="land-story-section" aria-labelledby={titleId}>
      <details className={className ? `land-group ${className}` : 'land-group'} id={id}>
        <summary className="land-group-summary">
          <span className="land-group-title">
            <span className="land-kicker">{kicker}</span>
            <h2 className="land-h2" id={titleId}>
              {title}
            </h2>
          </span>
          <span className="land-group-chevron" aria-hidden="true">
            <Icon name="chevronDown" size={22} />
          </span>
        </summary>
        <div className="land-group-body">{children}</div>
      </details>
    </section>
  );
}

/** The story groups a link may open (the site menu links to three of them). */
const STORY_GROUP_IDS: readonly string[] = [
  'problem',
  'how-it-works',
  'capabilities',
  'for-agencies',
  'trust',
  'road-ahead',
];

interface HomePageProps {
  readonly searchParams: Promise<{ readonly auth_error?: string }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  await primeLocale();
  const t = getServerT(homeCatalog);
  // A failed sign-in sends the visitor back here with a short reference that holds no
  // personal information (see apps/web/src/app/callback/route.ts), so they get a way
  // forward instead of a blank error page.
  const { auth_error: authError } = await searchParams;
  // Someone already signed in is taken straight to their workspace, never asked to sign in again.
  const signedIn = await isSignedIn();
  const betaOpen = isPublicBetaOpen();
  const startLabel = signedIn
    ? t.node('home.page.openYourWorkspace')
    : betaOpen
      ? t.node('home.page.createYourFreeAccount')
      : t.node('home.page.signInToGetStarted');
  const startHref = !signedIn && betaOpen ? '/auth/sign-up' : '/app';

  return (
    <div className="c1">
      <section className="c1-hero c1-shell" aria-labelledby="land-hero-title">
        {authError ? (
          <p className="notice notice-warn c1-alert" role="alert">
            {t.node('home.page.signInDidnTCompletePlease')} <strong>{authError}</strong>.
          </p>
        ) : null}
        <p className="c1-nudge">
          {betaOpen ? t.node('home.page.freePublicBeta') : t.node('home.page.inviteOnlyPilot')}
        </p>
        <h1 className="c1-headline" id="land-hero-title">
          {t.node(HERO_HEADLINE_FIRST)} <br />
          {t.node(HERO_HEADLINE_SECOND)}
        </h1>
        <p className="c1-subline">{t.node('home.page.onePrivateFileForYourPassport')}</p>
        <div className="c1-cta">
          <a className="c1-pill" href={startHref}>
            {startLabel}{' '}
            <span className="c1-chevron" aria-hidden="true">
              ↗
            </span>
          </a>
          <Link className="c1-pill c1-pill-light" href="/status">
            {t.node('home.page.seeWhatWorksToday')}
          </Link>
        </div>
        <p className="c1-meta">{t.node('home.page.onePersonalRecordSeparateCasesExplicit')}</p>

        <figure
          className="c1-devices"
          aria-label={t('home.page.illustrativeInterfaceWithSampleInformation')}
        >
          <div className="c1-phone">
            <div className="c1-island" />
            <div className="c1-statusbar" aria-hidden="true">
              <span>9:41</span>
              <span>●●● ▰</span>
            </div>
            <div className="c1-phonebody">
              <p className="c1-tinycap">{t.node('home.page.visastackPersonalRecord')}</p>
              <p className="c1-phonename" {...t.lang('home.page.readyForWhatSNext')}>
                <Lines text={t('home.page.readyForWhatSNext')} />
              </p>
              <p className="c1-sample">{t.node('home.page.ayeshaSRecordExample')}</p>
              <div className="c1-segment" aria-hidden="true">
                <span>{t.node('home.page.documents')}</span>
                <span>{t.node('home.page.cases')}</span>
                <span>{t.node('home.page.sharing')}</span>
              </div>
              <div className="c1-phonepanel">
                <p className="c1-tinycap c1-panelcap">{t.node('home.page.yourDocuments')}</p>
                {PHONE_FILES.map((file) => (
                  <div className="c1-fileline" key={file.name}>
                    <span className="c1-fileico" aria-hidden="true">
                      ▤
                    </span>
                    <span className="c1-fileinfo">
                      <b>{t.node(file.name)}</b>
                      <small>{t.node(file.detail)}</small>
                    </span>
                    <span className={file.warning ? 'c1-tag c1-tag-warning' : 'c1-tag'}>
                      {t.node(file.tag)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="c1-phonepanel">
                <p className="c1-next-label">{t.node('home.page.nextAction')}</p>
                <b className="c1-next-title">{t.node('home.page.replaceBankStatement')}</b>
                <p className="c1-next-detail">
                  {t.node('home.page.requestedForYourJapanVisitorVisa')}
                </p>
                <span className="c1-capsule">{t.node('home.page.reviewRequest')}</span>
              </div>
            </div>
            <div className="c1-bottomnav" aria-hidden="true">
              <span>{t.node('home.page.home')}</span>
              <span>{t.node('home.page.record')}</span>
              <span>{t.node('home.page.casese84518')}</span>
              <span>{t.node('home.page.sharingc17536')}</span>
            </div>
          </div>
          {FLOATS.map((float) => (
            <div className={`c1-floatcard ${float.id}`} key={float.id}>
              <span
                className={float.warning ? 'c1-float-icon c1-float-icon-warning' : 'c1-float-icon'}
                aria-hidden="true"
              >
                {float.icon}
              </span>
              <span>
                <b>{t.node(float.title)}</b>
                <small>{t.node(float.detail)}</small>
              </span>
            </div>
          ))}
          <figcaption className="c1-fineprint">
            {t.node('home.page.illustrativeInterfaceSampleInformation')}
          </figcaption>
        </figure>
      </section>

      {signedIn ? null : (
        <section
          className="land-section country-start"
          id="start"
          aria-labelledby="land-country-title"
        >
          <div className="land-wrap">
            <div className="land-head">
              <p className="land-kicker">{t.node('home.page.seeYourChecklist')}</p>
              <h2 className="land-h2" id="land-country-title">
                {t.node('home.page.pickACountrySeeWhatIs')}
              </h2>
              <p className="land-sub">{t.node('home.page.noAccountIsNeededToLook')}</p>
            </div>
            <CountryChecklistPicker
              variant="home"
              data={countryStartData()}
              signUpOpen={betaOpen}
            />
          </div>
        </section>
      )}

      <section className="c1-darkstage" id="product" aria-labelledby="land-product-title">
        <div className="c1-shell">
          <div className="c1-darkintro">
            <div>
              <p className="c1-nudge">{t.node('home.page.theProductNotJustThePromise')}</p>
              <h2 className="c1-sectionhead" id="land-product-title">
                {t.node('home.page.lessPaperworkMoreControl')}
              </h2>
            </div>
            <p>{t.node('home.page.yourDocumentsLiveInYourPersonal')}</p>
          </div>
          {/* WP-SB8: on a phone the four cards sit in one row that scrolls sideways (no stacked grid). */}
          <div
            className="c1-bento"
            // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; these are cards
            role="group"
            aria-labelledby="land-product-title"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: on a phone this row scrolls sideways, so the keyboard must reach it; LandingStoryHelper drops the stop where it does not scroll.
            tabIndex={0}
          >
            <article className="c1-feature c1-feature-glow c1-feature-big">
              <span className="c1-small-label">{t.node('home.page.01AReusableRecord')}</span>
              <h3 {...t.lang('home.page.keepTheDetailsLoseTheRepetition')}>
                <Lines text={t('home.page.keepTheDetailsLoseTheRepetition')} />
              </h3>
              <p>{t.node('home.page.findYourCurrentDocumentsAndSee')}</p>
              <div className="c1-miniui" aria-hidden="true">
                <b>{t.node('home.page.personalRecord')}</b>
                <div className="c1-fileline">
                  <span className="c1-fileico">▤</span>
                  <span className="c1-fileinfo">
                    <b>{t.node('home.page.passport')}</b>
                    <small>{t.node('home.page.currentVersionUpdated8Oct')}</small>
                  </span>
                  <span className="c1-tag">{t.node('home.page.current')}</span>
                </div>
              </div>
            </article>
            <article className="c1-feature c1-feature-mid">
              <span className="c1-small-label">{t.node('home.page.02SpecificRequests')}</span>
              <h3 {...t.lang('home.page.seeExactlyWhatSMissing')}>
                <Lines text={t('home.page.seeExactlyWhatSMissing')} />
              </h3>
              <p>{t.node('home.page.oneClearRequestWithTheDocument')}</p>
              <p className="c1-request" aria-hidden="true">
                <span>{t.node('home.page.employmentLetter')}</span>
                <span className="c1-request-state">{t.node('home.page.requested')}</span>
              </p>
            </article>
            <article className="c1-feature c1-feature-light">
              <span className="c1-small-label">{t.node('home.page.03YourChoice')}</span>
              <h3 {...t.lang('home.page.shareThePartNotTheWhole')}>
                <Lines text={t('home.page.shareThePartNotTheWhole')} />
              </h3>
              <p>{t.node('home.page.selectRecordsReviewTheScopeAnd')}</p>
            </article>
            <article className="c1-feature c1-feature-deep">
              <span className="c1-small-label">{t.node('home.page.04HistoricalAccuracy')}</span>
              <h3 {...t.lang('home.page.yesterdayStaysYesterday')}>
                <Lines text={t('home.page.yesterdayStaysYesterday')} />
              </h3>
              <p>{t.node('home.page.keepAnAccurateHistoryOfPrevious')}</p>
            </article>
          </div>
          <p className="c1-chapter-note">{t.node('home.page.privacyAndSharingAreGovernedBy')}</p>
        </div>
      </section>

      {/* WP-SB8 (scroll budget): the six story sections are one block of groups that open in
          place, so a phone reads the page in about five screens. Each group shows its kicker and
          heading and opens with one tap or key press; all start closed so the block reads as a
          short index (opening the first one by default costs about 700px on a phone and leaves
          too little room under the 6-screen budget). All words stay in the page (and in its
          search), and the menu's links still land on their group by its id. */}
      <div className="land-section land-story">
        <div className="land-wrap">
          <StoryGroup
            id="problem"
            titleId="land-problem-title"
            kicker={t.node('home.page.theProblem')}
            title={t.node('home.page.everyVisaStartsWithTheSame')}
          >
            <p className="land-sub">{t.node('home.page.yourLifeDoesNotChangeBetween')}</p>
            <div className="land-versus">
              <div className="land-versus-col land-versus-before">
                <p className="land-versus-label">{t.node('home.page.withoutOneProfile')}</p>
                <ul>
                  {BEFORE.map((line) => (
                    <li key={line}>
                      <Icon name="close" size={16} />
                      <span>{t.node(line)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="land-versus-col land-versus-after">
                <p className="land-versus-label">{t.node('home.page.withVisastack')}</p>
                <ul>
                  {AFTER.map((line) => (
                    <li key={line}>
                      <Icon name="check" size={16} />
                      <span>{t.node(line)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </StoryGroup>

          <StoryGroup
            id="how-it-works"
            titleId="land-how-title"
            kicker={t.node('home.page.threeSimpleSteps')}
            title={t.node('home.page.howItWorks')}
          >
            <p className="land-sub">{t.node('home.page.threeStepsAndTheFirstOne')}</p>
            <ol className="land-steps">
              {STEPS.map((step, index) => {
                const value = index + 1;
                return (
                  <li className="land-step" key={step.title}>
                    <span className="land-step-icon">
                      <Icon name={step.icon} size={22} />
                    </span>
                    <p className="land-step-kicker">{t.node('home.page.stepValue', { value })}</p>
                    <h3 className="land-h3">{t.node(step.title)}</h3>
                    <p className="land-body">{t.node(step.body)}</p>
                  </li>
                );
              })}
            </ol>
          </StoryGroup>

          <StoryGroup
            id="capabilities"
            titleId="land-cap-title"
            kicker={t.node('home.page.whatWorksToday')}
            title={t.node('home.page.switchedOnStepByStep')}
          >
            <p className="land-sub">
              {betaOpen
                ? t.node('home.page.visastackIsInPublicBetaSo')
                : t.node('home.page.visastackIsInAPrivatePilot')}
            </p>
            <p className="land-trust-link">
              <Link href="/status">{t.node('home.page.seeWhatWorksToday')}</Link>
            </p>
          </StoryGroup>

          <StoryGroup
            id="for-agencies"
            titleId="land-who-title"
            kicker={t.node('home.page.whoItIsFor')}
            title={t.node('home.page.calmerForTheTravellerClearerFor')}
          >
            <div className="land-who">
              {AUDIENCES.map((audience) => (
                <article className="land-who-card" key={audience.who}>
                  <span className="land-tile-icon">
                    <Icon name={audience.icon} size={22} />
                  </span>
                  <p className="land-step-kicker">{t.node(audience.who)}</p>
                  <h3 className="land-h3">{t.node(audience.title)}</h3>
                  <ul className="land-ticks">
                    {audience.points.map((point) => (
                      <li key={point}>
                        <Icon name="check" size={16} />
                        <span>{t.node(point)}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
            {/* VS-016, chosen by the owner on 6 Nov 2026: what the product does, with no number to prove. */}
            <p className="land-sub land-proof">
              {t.node('home.page.oneTravellerProfileSoAgenciesStop')}
            </p>
          </StoryGroup>

          <StoryGroup
            id="trust"
            titleId="land-trust-title"
            kicker={t.node('home.page.trustBuiltIn')}
            title={t.node('home.page.howVisastackTreatsYourInformation')}
            className="land-trust"
          >
            <p className="land-sub">{t.node('home.page.thesePromisesAreBuiltIntoHow')}</p>
            <ul className="land-promises">
              {PROMISES.map((promise) => (
                <li key={promise.text}>
                  <span className="land-promise-icon">
                    <Icon name={promise.icon} size={20} />
                  </span>
                  <span>{t.node(promise.text)}</span>
                </li>
              ))}
            </ul>
            <p className="land-trust-link">
              <Link href="/trust">{t.node('home.page.readOurPublicTrustPage')}</Link>
            </p>
          </StoryGroup>

          <StoryGroup
            id="road-ahead"
            titleId="land-road-title"
            kicker={t.node('home.page.theRoadAhead')}
            title={t.node('home.page.honestAboutWhereWeAre')}
          >
            <p className="land-sub">
              {betaOpen
                ? t.node('home.page.registrationIsOpenForPublicBeta')
                : t.node('home.page.thisIsAPrivatePilotFor')}{' '}
              {betaOpen
                ? t.node('home.page.itIsFreeToUseAt')
                : t.node('home.page.pleaseUseMadeUpDetailsOr')}
            </p>
            <ol className="land-horizons">
              {HORIZONS.map((horizon) => (
                <li className={`land-horizon land-horizon-${horizon.state}`} key={horizon.title}>
                  <p className="land-horizon-label">
                    {horizon.state === 'now' && betaOpen
                      ? t.node('home.page.availableInBeta')
                      : t.node(horizon.label)}
                  </p>
                  <h3 className="land-h3">{t.node(horizon.title)}</h3>
                  <p className="land-body">{t.node(horizon.body)}</p>
                </li>
              ))}
            </ol>
          </StoryGroup>
        </div>
      </div>

      <LandingStoryHelper groupIds={STORY_GROUP_IDS} rowSelector=".c1-bento" />

      <section className="land-final" aria-labelledby="land-final-title">
        <div className="land-wrap">
          <div className="land-final-card">
            <h2 className="land-final-title" id="land-final-title">
              {t.node('home.page.stopStartingFromZero')}
            </h2>
            <p className="land-final-sub">{t.node('home.page.buildYourProfileOnceAndLet')}</p>
            <div className="cta-row land-final-cta">
              <a className="btn land-btn land-btn-light" href={startHref}>
                {startLabel}
                <Icon name="arrow" size={18} />
              </a>
              <Link className="btn land-btn land-btn-ghost" href="/status">
                {t.node('home.page.seeWhatWorksToday')}
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
