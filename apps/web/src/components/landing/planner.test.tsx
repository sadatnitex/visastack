// @vitest-environment jsdom
import { catalogResolve } from '@visastack/i18n';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { landingCatalog } from '../../i18n/landing';
import type { LandingKey } from '../../i18n/landing-messages';
import { axeViolations } from '../../lib/axe.test-support';
import {
  GUIDES_PATH,
  LandingPlanner,
  type Msg,
  type PlanWords,
  PlannerForm,
  PlannerPlan,
  guideHref,
} from './planner';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The words the server hands the planner, resolved the way the home page does it, for one locale. */
function words(locale: 'en' | 'bn') {
  const m = (key: LandingKey): Msg => {
    const { text, lang } = catalogResolve(landingCatalog, locale, key);
    // The page is Bengali when the visitor chose Bengali on a ready route; mark only what differs.
    return lang === locale ? { text } : { text, lang };
  };
  const step = (lead: LandingKey, body: LandingKey) => ({ lead: m(lead), body: m(body) });
  const plan: PlanWords = {
    kicker: m('landing.plan.kicker'),
    title: m('landing.plan.title'),
    fallbackTitle: m('landing.plan.titleFallback'),
    intro: m('landing.plan.intro'),
    partyLabel: m('landing.plan.partyLabel'),
    self: m('landing.plan.self'),
    family: m('landing.plan.family'),
    steps: {
      self: [
        step('landing.plan.sourceLead', 'landing.plan.sourceBody'),
        step('landing.plan.selfCopiesLead', 'landing.plan.selfCopiesBody'),
        step('landing.plan.howLead', 'landing.plan.howBody'),
      ],
      family: [
        step('landing.plan.sourceLead', 'landing.plan.sourceBody'),
        step('landing.plan.familyCopiesLead', 'landing.plan.familyCopiesBody'),
        step('landing.plan.howLead', 'landing.plan.howBody'),
      ],
    },
    guide: m('landing.plan.guide'),
    guideFallback: m('landing.plan.guideFallback'),
  };
  return {
    plan,
    form: {
      label: m('landing.planner.label'),
      placeholder: m('landing.planner.placeholder'),
      submit: m('landing.planner.submit'),
    },
    status: { self: m('landing.plan.announceSelf'), family: m('landing.plan.announceFamily') },
  };
}

const DESTINATIONS = {
  en: [
    { value: 'Japan', label: 'Japan' },
    { value: 'United Kingdom', label: 'United Kingdom' },
  ],
  bn: [
    { value: 'Japan', label: 'জাপান' },
    { value: 'United Kingdom', label: 'যুক্তরাজ্য' },
  ],
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

function mount(locale: 'en' | 'bn' = 'en') {
  const w = words(locale);
  const destinations = DESTINATIONS[locale];
  act(() =>
    root.render(
      <LandingPlanner statusWords={w.status}>
        <div>
          <h1>{locale === 'bn' ? 'আপনার ভিসার কাগজপত্র' : 'Your visa paperwork'}</h1>
          <PlannerForm words={w.form} destinations={destinations} footer={<span>footer</span>} />
          <PlannerPlan words={w.plan} destinations={destinations} />
        </div>
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
    // Choosing again changes nothing until the form is sent, then updates the same plan.
    choose(select, 'Japan');
    expect(plan.querySelector('h2')?.textContent).toBe('Getting ready for United Kingdom');
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
    expect(await axeViolations(container.innerHTML)).toEqual([]);
    choose(select, 'Japan');
    submit(form);
    expect(await axeViolations(container.innerHTML)).toEqual([]);
  });

  describe('in Bengali', () => {
    it('shows Bengali names but sends the catalogue name, so the guides still find the country', () => {
      const { form, select, plan } = mount('bn');
      const options = [...select.querySelectorAll('option')].map((o) => [o.value, o.textContent]);
      expect(options).toEqual([
        ['', 'গন্তব্য বেছে নিন'],
        ['Japan', 'জাপান'],
        ['United Kingdom', 'যুক্তরাজ্য'],
      ]);
      expect(select.name).toBe('q');
      expect(form.getAttribute('action')).toBe(GUIDES_PATH);
      choose(select, 'United Kingdom');
      // What the browser would send without script: the English value, never the label.
      expect(new FormData(form).get('q')).toBe('United Kingdom');
      submit(form);
      expect(plan.querySelector('h2')?.textContent).toBe('যুক্তরাজ্য যাওয়ার প্রস্তুতি');
      const guide = plan.querySelector('a.lp-button') as HTMLAnchorElement;
      expect(guide.getAttribute('href')).toBe('/countries?q=United%20Kingdom');
      expect(guide.textContent).toBe('দেশের গাইডে যুক্তরাজ্য খুঁজুন');
    });

    it('words the steps and the announcements in Bengali, and marks held English as English', () => {
      const { form, select, plan } = mount('bn');
      choose(select, 'Japan');
      submit(form);
      expect(plan.textContent).toContain('আপনার সংরক্ষিত কপিগুলো দেখে নিন');
      const family = container.querySelectorAll('.lp-party button')[1] as HTMLButtonElement;
      expect(family.textContent).toBe('পরিবারের জন্য');
      act(() => family.click());
      expect(plan.textContent).toContain('প্রত্যেক ভ্রমণকারীর কপি দেখে নিন');
      expect(container.querySelector('output')?.textContent).toBe(
        'পরিবারের জন্য প্রস্তুতির ধাপগুলো দেখানো হচ্ছে।',
      );
      // The sentence about the issuing authority is held for review: English, and said to be English.
      const held = [...plan.querySelectorAll('p[lang="en"]')].map((p) => p.textContent);
      expect(held).toEqual([expect.stringContaining('issuing authority')]);
      // Nothing Bengali is marked as English.
      for (const marked of plan.querySelectorAll('[lang="en"]'))
        expect(marked.textContent).not.toMatch(/[\u0980-\u09FF]/);
    });

    it('has no accessibility problems open or closed', async () => {
      const { form, select } = mount('bn');
      expect(await axeViolations(container.innerHTML)).toEqual([]);
      choose(select, 'Japan');
      submit(form);
      expect(await axeViolations(container.innerHTML)).toEqual([]);
    });
  });
});
