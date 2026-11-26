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
 */

/** The guides' own search address, so the plan and the no-script form open the same list. */
export const GUIDES_PATH = '/countries';

export function guideHref(country: string): string {
  return `${GUIDES_PATH}?q=${encodeURIComponent(country)}`;
}

export type Party = 'self' | 'family';

interface PlannerState {
  readonly country: string;
  readonly open: boolean;
  readonly party: Party;
  readonly choose: (country: string) => void;
  readonly submit: (event: FormEvent<HTMLFormElement>) => void;
  readonly setParty: (party: Party) => void;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly status: string;
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
  readonly statusWords: Readonly<Record<Party, string>>;
}) {
  const [country, setCountry] = useState('');
  const [open, setOpen] = useState(false);
  const [party, setPartyState] = useState<Party>('self');
  const [status, setStatus] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const submit = useCallback((event: FormEvent<HTMLFormElement>) => {
    const value = (new FormData(event.currentTarget).get('q') ?? '').toString();
    // An empty choice is stopped by the field itself (required); never open a plan for nothing.
    if (!value) return;
    event.preventDefault();
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
    () => ({ country, open, party, choose: setCountry, submit, setParty, headingRef, status }),
    [country, open, party, submit, setParty, status],
  );
  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export interface PlannerFormWords {
  readonly label: string;
  readonly placeholder: string;
  readonly submit: string;
}

/** The form in the first screen: a labelled destination list and the button that opens the plan. */
export function PlannerForm({
  words,
  destinations,
  footer,
}: {
  readonly words: PlannerFormWords;
  readonly destinations: readonly string[];
  readonly footer: ReactNode;
}) {
  const { country, choose, submit } = usePlanner();
  return (
    <form
      className="lp-planner"
      id="planner"
      action={GUIDES_PATH}
      method="get"
      onSubmit={submit}
      tabIndex={-1}
    >
      <label htmlFor="lp-destination">{words.label}</label>
      <div className="lp-planner-controls">
        <div className="lp-select">
          <select
            id="lp-destination"
            name="q"
            required
            value={country}
            onChange={(event) => choose(event.target.value)}
          >
            <option value="" disabled>
              {words.placeholder}
            </option>
            {destinations.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <button className="lp-button lp-primary" type="submit">
          {words.submit}
        </button>
      </div>
      <div className="lp-planner-foot">{footer}</div>
    </form>
  );
}

export interface PlanWords {
  readonly kicker: string;
  /** "Getting ready for {country}" built by the caller's template: the parts around the name. */
  readonly titleBefore: string;
  readonly fallbackTitle: string;
  readonly intro: string;
  readonly partyLabel: string;
  readonly self: string;
  readonly family: string;
  readonly steps: Readonly<
    Record<
      Party,
      readonly [
        { readonly lead: string; readonly body: string },
        { readonly lead: string; readonly body: string },
        { readonly lead: string; readonly body: string },
      ]
    >
  >;
  readonly guideBefore: string;
  readonly guideAfter: string;
  readonly guideFallback: string;
}

/** The plan that opens below the first screen (closed until a destination is chosen). */
export function PlannerPlan({ words }: { readonly words: PlanWords }) {
  const { country, open, party, setParty, headingRef, status } = usePlanner();
  const steps = words.steps[party];
  return (
    <section className="lp-start" hidden={!open} aria-labelledby="lp-start-title">
      <div className="lp-wrap lp-start-inner">
        <div>
          <p className="lp-kicker">{words.kicker}</p>
          <h2 id="lp-start-title" tabIndex={-1} ref={headingRef}>
            {country ? `${words.titleBefore} ${country}` : words.fallbackTitle}
          </h2>
          <p>{words.intro}</p>
        </div>
        <div className="lp-start-content">
          {/* biome-ignore lint/a11y/useSemanticElements: a group of two toggle buttons, not a fieldset */}
          <div className="lp-party" role="group" aria-label={words.partyLabel}>
            <button type="button" aria-pressed={party === 'self'} onClick={() => setParty('self')}>
              {words.self}
            </button>
            <button
              type="button"
              aria-pressed={party === 'family'}
              onClick={() => setParty('family')}
            >
              {words.family}
            </button>
          </div>
          <ol className="lp-start-steps">
            {steps.map((step) => (
              <li key={step.lead}>
                <strong>{step.lead}</strong>
                <span>{step.body}</span>
              </li>
            ))}
          </ol>
          <a className="lp-button lp-primary" href={country ? guideHref(country) : GUIDES_PATH}>
            {country ? `${words.guideBefore} ${country} ${words.guideAfter}` : words.guideFallback}
          </a>
          <output className="lp-sr">{status}</output>
        </div>
      </div>
    </section>
  );
}
