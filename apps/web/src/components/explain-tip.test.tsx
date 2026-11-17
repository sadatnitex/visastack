// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appApplicantCatalog } from '../i18n/app-applicant';
import { EXPLAIN_CLOSE_DELAY, EXPLAIN_OPEN_DELAY } from '../lib/use-explain-tip';
import { ExplainTip } from './explain-tip';
import { I18nProvider } from './i18n-provider';

vi.mock('../app/app/applicant/[id]/actions', () => ({
  acceptClearDetailsAction: vi.fn(),
  decideClassificationProposalAction: vi.fn(),
  decideInconsistencyFlagAction: vi.fn(),
  decideProposalAction: vi.fn(),
  readAgainAction: vi.fn(),
  runClassificationAction: vi.fn(),
  runInconsistencyCheckAction: vi.fn(),
}));
const { OcrResultView } = await import('../app/app/applicant/[id]/ai-review');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LABEL = 'Check This Date';
const TEXT = 'We could not read this date clearly, so look at it on the paper.';

async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

/** A pointer event of a given kind; jsdom has no PointerEvent, so the kind is set by hand. */
function pointer(type: string, pointerType: 'mouse' | 'touch' | 'pen', target: Element) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  target.dispatchEvent(event);
}

/** React reads enter and leave from `pointerover` and `pointerout`. */
const hoverIn = (
  target: Element,
  from: Element = document.body,
  kind: 'mouse' | 'touch' = 'mouse',
) => {
  const event = new MouseEvent('pointerover', { bubbles: true, relatedTarget: from });
  Object.defineProperty(event, 'pointerType', { value: kind });
  target.dispatchEvent(event);
};
const hoverOut = (target: Element, to: Element = document.body) => {
  const event = new MouseEvent('pointerout', { bubbles: true, relatedTarget: to });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(event);
};

const tip = (host: HTMLElement) => {
  const trigger = host.querySelector<HTMLButtonElement>('button.explain-tip-trigger');
  const popup = host.querySelector<HTMLElement>('.explain-tip-popup');
  if (!trigger || !popup) throw new Error('ExplainTip did not render its trigger and popup');
  return { trigger, popup, wrap: trigger.parentElement as HTMLElement };
};

const picture = <svg data-testid="pic" />;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('ExplainTip: what it is', () => {
  it('is a real button named by its label, with the sentence linked by aria-describedby', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    expect(trigger.tagName).toBe('BUTTON');
    expect(trigger.getAttribute('type')).toBe('button');
    expect(trigger.textContent?.trim()).toBe(LABEL);
    expect(trigger.querySelector('.explain-tip-picture')?.getAttribute('aria-hidden')).toBe('true');
    expect(popup.getAttribute('role')).toBe('tooltip');
    const described = trigger.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    expect(document.getElementById(described ?? '')?.textContent).toBe(TEXT);
    expect(popup.contains(document.getElementById(described ?? ''))).toBe(true);
    expect(trigger.hasAttribute('title')).toBe(false);
    expect(popup.hidden).toBe(true);
    await unmount();
  });

  it('keeps the label readable before any script runs', () => {
    const html = renderToStaticMarkup(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    expect(html).toContain(`<span class="sr-only">${LABEL}</span>`);
    expect(html).toMatch(/<button type="button" class="explain-tip-trigger"/);
    expect(html).not.toContain('title=');
  });
});

describe('ExplainTip: opening and closing', () => {
  it('opens on hover only after a short pause', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => hoverIn(trigger));
    expect(popup.hidden).toBe(true);
    await act(async () => vi.advanceTimersByTime(EXPLAIN_OPEN_DELAY - 1));
    expect(popup.hidden).toBe(true);
    await act(async () => vi.advanceTimersByTime(1));
    expect(popup.hidden).toBe(false);
    expect(popup.textContent).toContain(LABEL);
    expect(popup.textContent).toContain(TEXT);
    await unmount();
  });

  it('a pointer that passes over without pausing opens nothing', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => hoverIn(trigger));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_OPEN_DELAY / 2));
    await act(async () => hoverOut(trigger));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_OPEN_DELAY * 2));
    expect(popup.hidden).toBe(true);
    await unmount();
  });

  it('stays open while the pointer crosses onto the popup, and closes once it leaves both', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => hoverIn(trigger));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_OPEN_DELAY));
    expect(popup.hidden).toBe(false);
    // The pointer leaves the trigger into the gap (outside the holder), then reaches the popup.
    await act(async () => hoverOut(trigger));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_CLOSE_DELAY - 10));
    await act(async () => hoverIn(popup));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_CLOSE_DELAY * 4));
    expect(popup.hidden).toBe(false);
    await act(async () => hoverOut(popup));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_CLOSE_DELAY));
    expect(popup.hidden).toBe(true);
    await unmount();
  });

  it('opens on keyboard focus at once and closes when focus moves away', async () => {
    const { host, unmount } = await mount(
      <>
        <ExplainTip label={LABEL} text={TEXT}>
          {picture}
        </ExplainTip>
        <button type="button" id="next">
          Next
        </button>
      </>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => trigger.focus());
    expect(popup.hidden).toBe(false);
    await act(async () => document.getElementById('next')?.focus());
    expect(popup.hidden).toBe(true);
    await unmount();
  });

  it('opens on a tap and closes on a second tap, so a touch screen reaches the words', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    // Each step is its own event, as a browser delivers them, so the screen updates between them.
    const tap = async () => {
      await act(async () => hoverIn(trigger, document.body, 'touch'));
      await act(async () => pointer('pointerdown', 'touch', trigger));
      await act(async () => trigger.focus());
      await act(async () => pointer('pointerup', 'touch', trigger));
      await act(async () => trigger.click());
    };
    await tap();
    expect(popup.hidden).toBe(false);
    await act(async () => vi.advanceTimersByTime(EXPLAIN_OPEN_DELAY * 2));
    expect(popup.hidden).toBe(false);
    await tap();
    expect(popup.hidden).toBe(true);
    await unmount();
  });

  it('closes on Escape', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => trigger.focus());
    expect(popup.hidden).toBe(false);
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(popup.hidden).toBe(true);
    expect(document.activeElement).toBe(trigger);
    await unmount();
  });

  it('closes on a press outside, not on a press inside the popup', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => trigger.click());
    expect(popup.hidden).toBe(false);
    await act(async () => pointer('pointerdown', 'mouse', popup));
    expect(popup.hidden).toBe(false);
    await act(async () => pointer('pointerdown', 'mouse', document.body));
    expect(popup.hidden).toBe(true);
    await unmount();
  });

  it('only one is open at a time', async () => {
    const { host, unmount } = await mount(
      <>
        <ExplainTip label="First" text="The first one.">
          {picture}
        </ExplainTip>
        <ExplainTip label="Second" text="The second one.">
          {picture}
        </ExplainTip>
      </>,
    );
    const [one, two] = [...host.querySelectorAll<HTMLButtonElement>('button.explain-tip-trigger')];
    const [popOne, popTwo] = [...host.querySelectorAll<HTMLElement>('.explain-tip-popup')];
    if (!one || !two || !popOne || !popTwo) throw new Error('two tips expected');
    await act(async () => one.click());
    expect(popOne.hidden).toBe(false);
    await act(async () => two.click());
    expect(popTwo.hidden).toBe(false);
    expect(popOne.hidden).toBe(true);
    await unmount();
  });
});

describe('ExplainTip: what a real browser does in between', () => {
  it('resting on the icon and then clicking it keeps the popup open', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => hoverIn(trigger));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_OPEN_DELAY));
    expect(popup.hidden).toBe(false);
    await act(async () => pointer('pointerdown', 'mouse', trigger));
    await act(async () => trigger.focus());
    await act(async () => pointer('pointerup', 'mouse', trigger));
    await act(async () => trigger.click());
    expect(popup.hidden).toBe(false);
    // A second click on a popup a click holds open closes it.
    await act(async () => trigger.click());
    expect(popup.hidden).toBe(true);
    await unmount();
  });

  it('pressing on the popup text while the trigger has focus does not close it', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => trigger.focus());
    expect(popup.hidden).toBe(false);
    // The press lands on text that cannot take focus, so focus leaves the button for the page.
    await act(async () => pointer('pointerdown', 'mouse', popup));
    await act(async () => trigger.blur());
    expect(popup.hidden).toBe(false);
    await act(async () => pointer('pointerup', 'mouse', popup));
    await unmount();
  });

  it('a popup a pen tap opened stays when the pen lifts away', async () => {
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => trigger.click());
    expect(popup.hidden).toBe(false);
    await act(async () => hoverOut(trigger));
    await act(async () => vi.advanceTimersByTime(EXPLAIN_CLOSE_DELAY * 4));
    expect(popup.hidden).toBe(false);
    await unmount();
  });

  it('Escape on the trigger closes only the popup, not a menu or dialog around it', async () => {
    const outer = vi.fn();
    document.addEventListener('keydown', outer);
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup } = tip(host);
    await act(async () => trigger.focus());
    await act(async () => {
      trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(popup.hidden).toBe(true);
    expect(outer).not.toHaveBeenCalled();
    // Closed, it no longer holds Escape back.
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(outer).toHaveBeenCalledTimes(1);
    document.removeEventListener('keydown', outer);
    await unmount();
  });
});

describe('ExplainTip: where it opens', () => {
  it('opens below with room, flips above near the bottom edge, and stays inside a 320 px screen', async () => {
    vi.stubGlobal('innerHeight', 640);
    Object.defineProperty(document.documentElement, 'clientWidth', {
      configurable: true,
      value: 320,
    });
    const { host, unmount } = await mount(
      <ExplainTip label={LABEL} text={TEXT}>
        {picture}
      </ExplainTip>,
    );
    const { trigger, popup, wrap } = tip(host);
    Object.defineProperty(popup, 'offsetWidth', { configurable: true, value: 288 });
    Object.defineProperty(popup, 'scrollHeight', { configurable: true, value: 90 });
    const at = (top: number, left: number) => {
      trigger.getBoundingClientRect = () =>
        ({ top, bottom: top + 44, left, right: left + 44, width: 44, height: 44 }) as DOMRect;
    };

    at(40, 138);
    await act(async () => trigger.click());
    expect(wrap.getAttribute('data-placement')).toBe('below');
    expect(wrap.style.getPropertyValue('--explain-tip-max-height')).toMatch(/^\d+px$/);
    const shift = Number.parseFloat(wrap.style.getPropertyValue('--explain-tip-shift'));
    const align = wrap.getAttribute('data-align');
    const left = (align === 'end' ? 138 + 44 - 288 : 138) + shift;
    expect(left).toBeGreaterThanOrEqual(16);
    expect(left + 288).toBeLessThanOrEqual(320 - 16);
    await act(async () => trigger.click());

    at(560, 8);
    await act(async () => trigger.click());
    expect(wrap.getAttribute('data-placement')).toBe('above');
    await unmount();
    vi.unstubAllGlobals();
  });
});

describe('ExplainTip: stylesheet (WP-PIC1 block)', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const marker = '/* WP-PIC1 ';
  const start = css.indexOf(marker);
  const rest = start < 0 ? '' : css.slice(start);
  const nextMarker = rest.slice(marker.length).search(/\n\/\* WP-/);
  const block = nextMarker < 0 ? rest : rest.slice(0, marker.length + nextMarker);
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');

  it('is one marked block at the end of the stylesheet', () => {
    expect(css.split(marker).length - 1).toBe(1);
    expect(nextMarker).toBe(-1);
  });

  it('gives the trigger a 44 px target and draws every class the component uses', () => {
    expect(rules).toMatch(/\.explain-tip-trigger \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
    for (const name of [
      'explain-tip',
      'explain-tip-popup',
      'explain-tip-title',
      'explain-tip-text',
    ]) {
      expect(rules, name).toMatch(new RegExp(`\\.${name}[ ,:\\[{]`));
    }
  });

  it('stays flat and on the shared tokens', () => {
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/\brgba?\(|\bhsla?\(/);
    expect(rules).not.toMatch(
      /gradient|box-shadow|text-shadow|drop-shadow|backdrop|filter|!important|url\(|data:|blob:/,
    );
    expect(rules).toMatch(/\.explain-tip-popup \{[^}]*border: 1px solid var\(--[a-z-]+\);/);
    expect(rules).toMatch(/\.explain-tip-popup \{[^}]*background: var\(--bg-elevated\);/);
  });

  it('moves only opacity and transform, on the shared speeds, and not under reduced motion', () => {
    const motion = rules.match(/(animation|transition)[^;]*;/g) ?? [];
    expect(motion.length).toBeGreaterThan(0);
    for (const line of motion) {
      if (/:\s*none;/.test(line)) continue;
      expect(line).toMatch(/var\(--motion-(press|state)\)/);
    }
    const frames = rules.match(/@keyframes [a-z-]+ \{[\s\S]*?\n\}/g) ?? [];
    for (const frame of frames) {
      const props = frame.match(/\b([a-z-]+):/g) ?? [];
      for (const prop of props) expect(['opacity:', 'transform:']).toContain(prop);
    }
    expect(rules).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.explain-tip-popup \{\s*animation: none;/,
    );
  });
});

describe('ExplainTip pilot: the backup reader badge on a document reading', () => {
  const K = 'appApplicant.appApplicantIdAiReview.';
  for (const locale of ['en', 'bn'] as const) {
    it(`puts the badge hint behind a tap, focus and screen reader (${locale})`, async () => {
      const words = appApplicantCatalog[locale] as Record<string, string>;
      const { host, unmount } = await mount(
        <I18nProvider locale={locale} pageLang="en">
          <OcrResultView text="" reviewIssues={[]} usedFallback />
        </I18nProvider>,
      );
      const { trigger, popup } = tip(host);
      const hint = words[`${K}theFirstReaderTimedOutOr`];
      expect(trigger.textContent?.trim()).toBe(words[`${K}fallbackProviderUsed`]);
      expect(
        document.getElementById(trigger.getAttribute('aria-describedby') ?? '')?.textContent,
      ).toBe(hint);
      expect(trigger.querySelector('svg.icon')).not.toBeNull();
      // The badge says the same words, so screen readers hear them once, from the button.
      expect(host.querySelector('.badge-neutral')?.getAttribute('aria-hidden')).toBe('true');
      await act(async () => trigger.click());
      expect(popup.hidden).toBe(false);
      expect(popup.textContent).toContain(hint);
      // Bengali words on an English page are marked as Bengali (WCAG 3.1.2), in the name and the hint.
      if (locale === 'bn') {
        expect(trigger.querySelector('[lang="bn"]')?.textContent).toBe(
          words[`${K}fallbackProviderUsed`],
        );
        expect(popup.querySelector('.explain-tip-text [lang="bn"]')?.textContent).toBe(hint);
      }
      await unmount();
    });
  }

  it('shows no Explain popup when the first reader answered', async () => {
    const { host, unmount } = await mount(
      <I18nProvider locale="en" pageLang="en">
        <OcrResultView text="" reviewIssues={[]} usedFallback={false} />
      </I18nProvider>,
    );
    expect(host.querySelector('.explain-tip')).toBeNull();
    await unmount();
  });
});
