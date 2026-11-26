'use client';

import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

/**
 * The home page's destination planner. One choice (a destination) and one in-memory toggle (who is
 * preparing) drive a short, general preparation plan; nothing is saved, sent or stored, and route
 * specific requirements stay in the country guides, which the plan only opens.
 *
 * Two parts share one state through a provider: the form in the first screen and the plan that
 * opens below it. Without script the form is a plain GET to the guides' own search
 * (`/countries?q=Name`), so the destination still arrives; the plan stays closed.
 *
 * Words come from the server already in the visitor's language (`Msg`), each with the language it
 * is really written in when that differs from the page's, so the browser holds no translation code.
 * What the form SENDS never changes with the language: a destination's `value` is the catalogue's
 * English country name (what `/countries?q=` searches for); only its `label` is localized.
 */

/** The guides' own search address, so the plan and the no-script form open the same list. */
export const GUIDES_PATH = '/countries';

export function guideHref(country: string): string {
  return `${GUIDES_PATH}?q=${encodeURIComponent(country)}`;
}

/** A message in the visitor's language. `lang` is set only when it differs from the page's. */
export interface Msg {
  readonly text: string;
  readonly lang?: 'en' | 'bn';
}

/** The `lang` attribute for an element that holds only this message. */
const langOf = (message: Msg) => (message.lang ? { lang: message.lang } : {});

/** Puts the country into a message that carries `{country}`. */
const withCountry = (message: Msg, country: string): Msg => ({
  ...message,
  text: message.text.replaceAll('{country}', country),
});

export interface Destination {
  /** Sent to the guides: the catalogue's English country name. */
  readonly value: string;
  /** Shown to the visitor, in their language. */
  readonly label: string;
}

export type Party = 'self' | 'family';

interface PlannerState {
  /** What the list shows now (not yet planned for). */
  readonly choice: string;
  /** The destination the open plan is for: set only when the form is submitted. */
  readonly country: string;
  readonly open: boolean;
  readonly party: Party;
  readonly choose: (value: string) => void;
  readonly submit: (event: FormEvent<HTMLFormElement>) => void;
  readonly setParty: (party: Party) => void;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly status: Msg | null;
}

const PlannerContext = createContext<PlannerState | null>(null);

function usePlanner(): PlannerState {
  const state = useContext(PlannerContext);
  if (!state) throw new Error('The planner parts belong inside LandingPlanner.');
  return state;
}

export function LandingPlanner({
  children,
  statusWords,
}: {
  readonly children: ReactNode;
  /** The words announced when the preparation mode changes (one per mode). */
  readonly statusWords: Readonly<Record<Party, Msg>>;
}) {
  const [choice, setChoice] = useState('');
  const [country, setCountry] = useState('');
  const [open, setOpen] = useState(false);
  const [party, setPartyState] = useState<Party>('self');
  const [status, setStatus] = useState<Msg | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const submit = useCallback((event: FormEvent<HTMLFormElement>) => {
    const value = (new FormData(event.currentTarget).get('q') ?? '').toString();
    // An empty choice is stopped by the field itself (required); never open a plan for nothing.
    if (!value) return;
    event.preventDefault();
    setChoice(value);
    setCountry(value);
    setOpen(true);
    // The plan opens below the form: move to its heading so a keyboard or screen reader user
    // lands on it, and a sighted one sees it (the scroll is smooth only when motion is welcome).
    requestAnimationFrame(() => {
      const heading = headingRef.current;
      if (!heading) return;
      heading.focus({ preventScroll: true });
      const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? true;
      heading.scrollIntoView?.({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
    });
  }, []);

  const setParty = useCallback(
    (next: Party) => {
      setPartyState(next);
      setStatus(statusWords[next]);
    },
    [statusWords],
  );

  const value = useMemo<PlannerState>(
    () => ({
      choice,
      country,
      open,
      party,
      choose: setChoice,
      submit,
      setParty,
      headingRef,
      status,
    }),
    [choice, country, open, party, submit, setParty, status],
  );
  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export interface PlannerFormWords {
  readonly label: Msg;
  readonly placeholder: Msg;
  readonly submit: Msg;
}

/** The form in the first screen: a labelled destination list and the button that opens the plan. */
export function PlannerForm({
  words,
  destinations,
  footer,
}: {
  readonly words: PlannerFormWords;
  readonly destinations: readonly Destination[];
  readonly footer: ReactNode;
}) {
  const { choice, choose, submit } = usePlanner();
  return (
    <form
      className="lp-planner"
      id="planner"
      action={GUIDES_PATH}
      method="get"
      onSubmit={submit}
      tabIndex={-1}
    >
      <label htmlFor="lp-destination" {...langOf(words.label)}>
        {words.label.text}
      </label>
      <div className="lp-planner-controls">
        <div className="lp-select">
          <select
            id="lp-destination"
            name="q"
            required
            value={choice}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="" disabled {...langOf(words.placeholder)}>
              {words.placeholder.text}
            </option>
            {destinations.map((destination) => (
              <option key={destination.value} value={destination.value}>
                {destination.label}
              </option>
            ))}
          </select>
        </div>
        <button className="lp-button lp-primary" type="submit" {...langOf(words.submit)}>
          {words.submit.text}
        </button>
      </div>
      <div className="lp-planner-foot">{footer}</div>
    </form>
  );
}

interface Step {
  readonly lead: Msg;
  readonly body: Msg;
}

export interface PlanWords {
  readonly kicker: Msg;
  /** Carries `{country}`. */
  readonly title: Msg;
  readonly fallbackTitle: Msg;
  readonly intro: Msg;
  readonly partyLabel: Msg;
  readonly self: Msg;
  readonly family: Msg;
  readonly steps: Readonly<Record<Party, readonly [Step, Step, Step]>>;
  /** Carries `{country}`. */
  readonly guide: Msg;
  readonly guideFallback: Msg;
}

/** The plan that opens below the first screen (closed until a destination is chosen). */
export function PlannerPlan({
  words,
  destinations,
}: {
  readonly words: PlanWords;
  readonly destinations: readonly Destination[];
}) {
  const { country, open, party, setParty, headingRef, status } = usePlanner();
  const steps = words.steps[party];
  // The plan names the destination as the visitor reads it; the link carries the catalogue name.
  const shown = destinations.find((destination) => destination.value === country)?.label ?? country;
  const title = country ? withCountry(words.title, shown) : words.fallbackTitle;
  const guide = country ? withCountry(words.guide, shown) : words.guideFallback;
  return (
    <section className="lp-start" hidden={!open} aria-labelledby="lp-start-title">
      <div className="lp-wrap lp-start-inner">
        <div>
          <p className="lp-kicker" {...langOf(words.kicker)}>
            {words.kicker.text}
          </p>
          <h2 id="lp-start-title" tabIndex={-1} ref={headingRef} {...langOf(title)}>
            {title.text}
          </h2>
          <p {...langOf(words.intro)}>{words.intro.text}</p>
        </div>
        <div className="lp-start-content">
          <div
            className="lp-party"
            // biome-ignore lint/a11y/useSemanticElements: a group of two toggle buttons, not a fieldset
            role="group"
            aria-label={words.partyLabel.text}
            {...langOf(words.partyLabel)}
          >
            <button
              type="button"
              aria-pressed={party === 'self'}
              onClick={() => setParty('self')}
              {...langOf(words.self)}
            >
              {words.self.text}
            </button>
            <button
              type="button"
              aria-pressed={party === 'family'}
              onClick={() => setParty('family')}
              {...langOf(words.family)}
            >
              {words.family.text}
            </button>
          </div>
          <ol className="lp-start-steps">
            {steps.map((step) => (
              <li key={step.lead.text}>
                <strong {...langOf(step.lead)}>{step.lead.text}</strong>
                <span {...langOf(step.body)}>{step.body.text}</span>
              </li>
            ))}
          </ol>
          <a
            className="lp-button lp-primary"
            href={country ? guideHref(country) : GUIDES_PATH}
            {...langOf(guide)}
          >
            {guide.text}
          </a>
          <output className="lp-sr" {...(status ? langOf(status) : {})}>
            {status?.text ?? ''}
          </output>
        </div>
      </div>
    </section>
  );
}
