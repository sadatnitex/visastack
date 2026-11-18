import type { ReactNode } from 'react';
import { DepthGlow, PassportTilt } from '../components/public-site/public-picture';
import { publicText } from '../components/public-site/public-text';
import { ReadinessRing } from '../components/public-site/readiness-ring';
import { Chapter, Scene } from '../components/public-site/scene';
import { ExampleTag, HeadlineWords, StatusChip } from '../components/public-site/story';
import { getPageLanguage } from '../lib/i18n-server';

/**
 * The scroll story of the Home page (WP-PUB2, ADR 0029): documents arrive, are read, are suggested,
 * are confirmed by the person; the file's completeness shows on the ring; the passport closes the
 * page. Every figure is drawn, says it is an example, and reads existing facts only.
 *
 * The words here have no catalogue entry yet, so they are English text marked as such on a Bangla
 * page (publicText) and listed in docs/upgrades/programme/pub/PUB2-records.md for the localization
 * lane. Headings are written as headings by role, not as h2 elements, so the page's long-standing
 * outline (one h1, nine h2) is untouched.
 */

/** The step each scene shows without motion (the engine moves the step while the page scrolls). */
export const INTAKE_STEPS = 4;
export const READY_STEPS = 2;

/** The names and labels drawn in a picture are English for now: mark them so on a Bangla page (WCAG 3.1.2). */
function englishOn(lang: string): { lang?: string } {
  return lang === 'en' ? {} : { lang: 'en' };
}

function Heading({ id, children }: { readonly id: string; readonly children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: an h2 would change the page's tested outline; the role gives the same heading level to a reader
    <p className="land-scene-title" id={id} role="heading" aria-level={2}>
      {children}
    </p>
  );
}

const DOCUMENTS = ['Passport', 'Bank Statement', 'Employment Letter'] as const;

/** Documents fly in, are scanned, Suggested, then Confirmed by the person. */
export function IntakeScene() {
  const lang = getPageLanguage();
  const say = (text: string) => publicText(text, lang);
  return (
    <Chapter tone="dark" className="land-chapter">
      <Scene
        name="intake"
        len={2}
        steps={INTAKE_STEPS}
        finalStep={INTAKE_STEPS - 1}
        labelledBy="pub-intake-title"
        className="land-scene"
      >
        <div className="land-stage land-intake">
          <div className="land-copy">
            <Heading id="pub-intake-title">
              {say('Drop In a Document. ')}
              <HeadlineWords>{say('Check What It Finds.')}</HeadlineWords>
            </Heading>
            <p className="land-lead">
              {say(
                'Document reading is being switched on step by step. This is an example of how it will work.',
              )}
            </p>
          </div>
          <figure
            className="land-draw land-intake-figure"
            aria-label="Example of a document being read"
            {...englishOn(lang)}
          >
            <ExampleTag pageLang={lang} />
            <div className="land-docs" aria-hidden="true">
              {DOCUMENTS.map((name, index) => (
                <div className={`land-doc land-doc-${index + 1}`} key={name}>
                  <span className="land-doc-name">{name}</span>
                  <span className="land-doc-lines">
                    <i />
                    <i />
                    <i />
                  </span>
                  {index === 0 ? <span className="land-scan" /> : null}
                </div>
              ))}
            </div>
            <ol className="land-states">
              <li className="land-state land-state-1">
                <StatusChip status="received" pageLang={lang} />
                <span>{say('Your documents arrive in your private place.')}</span>
              </li>
              <li className="land-state land-state-2">
                <StatusChip status="suggested" pageLang={lang} />
                <span>{say('Reading proposes the values. Nothing is saved yet.')}</span>
              </li>
              <li className="land-state land-state-3">
                <StatusChip status="confirmed" pageLang={lang} />
                <span>{say('You check each value, and it joins your file.')}</span>
              </li>
            </ol>
            <figcaption className="land-caption">
              {say('Illustration with sample documents.')}
            </figcaption>
          </figure>
        </div>
      </Scene>
    </Chapter>
  );
}

const CASE_LINE: readonly { readonly name: string; readonly ready: boolean }[] = [
  { name: 'Passport', ready: true },
  { name: 'Photo', ready: true },
  { name: 'Bank Statement', ready: true },
  { name: 'Employment Letter', ready: true },
  { name: 'Travel Plan', ready: false },
];

/** The case line fills and the ring shows how complete the file is. Completeness, never approval. */
export function ReadyScene() {
  const lang = getPageLanguage();
  const say = (text: string) => publicText(text, lang);
  const done = CASE_LINE.filter((item) => item.ready).length;
  return (
    <Chapter tone="light" className="land-chapter">
      <Scene
        name="ready"
        len={2}
        steps={READY_STEPS}
        finalStep={READY_STEPS - 1}
        labelledBy="pub-ready-title"
        className="land-scene"
      >
        <div className="land-stage land-ready">
          <div className="land-copy">
            <Heading id="pub-ready-title">
              {say('See How Complete ')}
              <HeadlineWords>{say('Your File Is.')}</HeadlineWords>
            </Heading>
            <p className="land-lead">
              {say('Completeness is how much of the list is in your file.')}
            </p>
          </div>
          <figure
            className="land-draw land-ready-figure"
            aria-label="Example of a file filling up"
            {...englishOn(lang)}
          >
            <ExampleTag pageLang={lang} />
            <ol className="land-case-line">
              {CASE_LINE.map((item, index) => (
                <li
                  className={item.ready ? 'land-case-item is-ready' : 'land-case-item'}
                  data-index={index + 1}
                  key={item.name}
                >
                  <span className="land-case-mark" aria-hidden="true" />
                  <span className="land-case-name">{item.name}</span>
                  <span className="land-case-state">{say(item.ready ? 'In file' : 'Missing')}</span>
                </li>
              ))}
            </ol>
            <div className="land-ring">
              <ReadinessRing
                done={done}
                total={CASE_LINE.length}
                size="lg"
                countLabel="Items Ready"
                pageLang={lang}
              />
            </div>
            <span className="land-case-bar" aria-hidden="true">
              <i />
            </span>
            <figcaption className="land-caption">
              {say('Illustration with a sample case.')}
            </figcaption>
          </figure>
        </div>
      </Scene>
    </Chapter>
  );
}

/** The closing scene: the real Bangladesh passport cover tilts into place above the closing call. */
export function ClosingScene({ children }: { readonly children: ReactNode }) {
  const lang = getPageLanguage();
  const say = (text: string) => publicText(text, lang);
  return (
    <Chapter tone="dark" className="land-chapter">
      <Scene name="closing" len={2} steps={1} finalStep={0} className="land-scene land-scene-open">
        <div className="land-stage land-closing">
          <figure className="land-draw land-passport-figure" {...englishOn(lang)}>
            <div className="land-passport-frame">
              <DepthGlow />
              <PassportTilt width={180} label="Bangladesh Passport Cover" />
            </div>
            <ExampleTag pageLang={lang} />
            <figcaption className="land-caption">
              {say('The type of cover, not anyone’s own passport.')}
            </figcaption>
          </figure>
          {children}
        </div>
      </Scene>
    </Chapter>
  );
}
