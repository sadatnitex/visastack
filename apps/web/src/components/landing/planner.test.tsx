// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import { GUIDES_PATH, LandingPlanner, PlannerForm, PlannerPlan, guideHref } from './planner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN = {
  kicker: 'Your Starting Plan',
  titleBefore: 'Getting ready for',
  fallbackTitle: 'Your first steps',
  intro: 'Use this plan to organise your work.',
  partyLabel: 'Who are you preparing for?',
  self: 'Myself',
  family: 'My Family',
  steps: {
    self: [
      { lead: 'Find the official source', body: 'Check the guide.' },
      { lead: 'Check your saved copies', body: 'Keep what still applies.' },
      { lead: 'Decide how you’ll prepare', body: 'On your own or with an agency.' },
    ],
    family: [
      { lead: 'Find the official source', body: 'Check the guide.' },
      { lead: 'Check each traveller’s copies', body: 'Keep each person’s documents apart.' },
      { lead: 'Decide how you’ll prepare', body: 'On your own or with an agency.' },
    ],
  },
  guideBefore: 'Find',
  guideAfter: 'in Country Guides',
  guideFallback: 'Open Country Guide',
} as const;

let root: Root;
let container: HTMLDivElement;
const scrolled = vi.fn();
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  // jsdom draws nothing: stand in for the browser calls the plan makes when it opens.
  Element.prototype.scrollIntoView = scrolled;
  window.requestAnimationFrame = (callback) => {
    callback(0);
    return 0;
  };
  window.matchMedia = ((query: string) => ({ matches: query.includes('reduce') })) as never;
  scrolled.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount() {
  act(() =>
    root.render(
      <LandingPlanner
        statusWords={{
          self: 'Individual preparation steps shown.',
          family: 'Family preparation steps shown.',
        }}
      >
        <main>
          <h1>Your visa paperwork</h1>
          <PlannerForm
            words={{
              label: 'Where are you going?',
              placeholder: 'Choose a destination',
              submit: 'See My First Steps',
            }}
            destinations={['Japan', 'United Kingdom']}
            footer={<span>Start without an account.</span>}
          />
          <PlannerPlan words={PLAN} />
        </main>
      </LandingPlanner>,
    ),
  );
  const form = container.querySelector('form') as HTMLFormElement;
  const select = container.querySelector('select') as HTMLSelectElement;
  const plan = container.querySelector('section.lp-start') as HTMLElement;
  return { form, select, plan };
}

function choose(select: HTMLSelectElement, value: string) {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
const submit = (form: HTMLFormElement) => act(() => form.requestSubmit());
const pressed = () =>
  [...container.querySelectorAll('.lp-party button')].map((b) => b.getAttribute('aria-pressed'));

describe('the destination planner', () => {
  it('starts with the plan closed and nothing chosen, in a form that works without script', () => {
    const { form, select, plan } = mount();
    expect(plan.hidden).toBe(true);
    expect(form.getAttribute('action')).toBe(GUIDES_PATH);
    expect(form.getAttribute('method')).toBe('get');
    expect(select.name).toBe('q');
    expect(select.required).toBe(true);
    expect(select.value).toBe('');
    expect(select.querySelector('option[value=""]')?.hasAttribute('disabled')).toBe(true);
  });

  it('opens nothing for an empty choice (the field refuses it first)', () => {
    const { form, plan } = mount();
    submit(form);
    expect(plan.hidden).toBe(true);
  });

  it('opens the plan for the chosen destination, names it, links its guide and moves focus there', () => {
    const { form, select, plan } = mount();
    choose(select, 'Japan');
    submit(form);
    expect(plan.hidden).toBe(false);
    const heading = plan.querySelector('h2') as HTMLElement;
    expect(heading.textContent).toBe('Getting ready for Japan');
    expect(document.activeElement).toBe(heading);
    expect(scrolled).toHaveBeenCalledWith({ behavior: 'auto', block: 'start' });
    const guide = plan.querySelector('a.lp-button') as HTMLAnchorElement;
    expect(guide.getAttribute('href')).toBe('/countries?q=Japan');
    expect(guide.textContent).toBe('Find Japan in Country Guides');
  });

  it('carries a country with a space in its name to the guides search, encoded once', () => {
    const { form, select, plan } = mount();
    choose(select, 'United Kingdom');
    submit(form);
    expect(guideHref('United Kingdom')).toBe('/countries?q=United%20Kingdom');
    expect((plan.querySelector('a.lp-button') as HTMLAnchorElement).getAttribute('href')).toBe(
      '/countries?q=United%20Kingdom',
    );
    expect(plan.querySelector('h2')?.textContent).toBe('Getting ready for United Kingdom');
    // Choosing again updates the same plan.
    choose(select, 'Japan');
    submit(form);
    expect(plan.querySelector('h2')?.textContent).toBe('Getting ready for Japan');
  });

  it('switches between Myself and My Family in memory: different step, one button pressed, announced', () => {
    const { form, select, plan } = mount();
    choose(select, 'Japan');
    submit(form);
    expect(pressed()).toEqual(['true', 'false']);
    expect(plan.textContent).toContain('Check your saved copies');
    const family = container.querySelectorAll('.lp-party button')[1] as HTMLButtonElement;
    act(() => family.click());
    expect(pressed()).toEqual(['false', 'true']);
    expect(plan.textContent).toContain('Check each traveller’s copies');
    expect(plan.textContent).not.toContain('Check your saved copies');
    expect(container.querySelector('output')?.textContent).toBe('Family preparation steps shown.');
    const self = container.querySelectorAll('.lp-party button')[0] as HTMLButtonElement;
    act(() => self.click());
    expect(container.querySelector('output')?.textContent).toBe(
      'Individual preparation steps shown.',
    );
    expect(plan.querySelectorAll('ol li')).toHaveLength(3);
  });

  it('keeps the guide link on the guides page the form itself uses', () => {
    const { select, form } = mount();
    choose(select, 'Japan');
    const action = form.getAttribute('action') ?? '';
    const data = new URLSearchParams(new FormData(form) as unknown as Record<string, string>);
    expect(`${action}?${data.toString()}`).toBe(guideHref('Japan'));
  });

  it('has no accessibility problems open or closed', async () => {
    const { form, select } = mount();
    expect(await axeViolations(container)).toEqual([]);
    choose(select, 'Japan');
    submit(form);
    expect(await axeViolations(container)).toEqual([]);
  });
});
