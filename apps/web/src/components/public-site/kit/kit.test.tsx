// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type Declaration } from 'postcss';
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Scene } from '../scene';
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
  segmentPath,
} from './index';
import { SHARE_TICK_MS } from './share-sheet-timed';

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const CSS = readFileSync(join(__dirname, 'kit.css'), 'utf8');
const STEPS_CSS = readFileSync(join(__dirname, 'kit-steps.css'), 'utf8');

describe('SegmentRing', () => {
  it('draws eight arcs and fills the first N clockwise', () => {
    const out = html(<SegmentRing filled={5} label="5 of 8 Ready" />);
    expect(out.match(/class="kit-seg[^"]*"/g)).toHaveLength(8);
    expect(out.match(/class="kit-seg is-on"/g)).toHaveLength(5);
    expect(out).toContain('5/8');
    expect(out).toContain('5 of 8 Ready');
    expect(out).toContain('aria-hidden="true"');
  });

  it('keeps the count inside 0 to total, whatever is passed', () => {
    expect(html(<SegmentRing filled={99} />).match(/kit-seg is-on/g)).toHaveLength(8);
    expect(html(<SegmentRing filled={-4} />).match(/kit-seg is-on/g)).toBeNull();
    expect(html(<SegmentRing filled={Number.NaN} />).match(/kit-seg is-on/g)).toBeNull();
  });

  it('reads on a dark chapter: white numerals, white arcs, no light tint behind', () => {
    expect(html(<SegmentRing filled={3} tone="dark" />)).toContain('data-tone="dark"');
    expect(CSS).toMatch(/\.kit-ring\[data-tone="dark"\] \{[^}]*--ring-ink: var\(--bg-elevated\)/);
    expect(CSS).toMatch(/\.kit-ring\[data-tone="dark"\] \{[^}]*--ring-on: var\(--bg-elevated\)/);
  });

  it('follows a scene: one group and one set of words per step', () => {
    const out = html(
      <SegmentRing
        filled={0}
        steps={[
          { filled: 0, label: '0 of 8 Ready' },
          { filled: 3, label: '3 of 8 Ready' },
        ]}
      />,
    );
    expect(out.match(/<g class="kit-sw" data-at="\d"/g)).toHaveLength(2);
    expect(out).toContain('3 of 8 Ready');
  });

  it('puts the eight arcs on a circle with gaps and no overlap', () => {
    const paths = Array.from({ length: 8 }, (_, index) => segmentPath(index, 8));
    expect(new Set(paths).size).toBe(8);
    expect(paths[0]).toMatch(/^M[\d. ]+ A30 30 0 0 1 [\d. ]+$/);
  });
});

describe('DocumentDeck', () => {
  it('draws the five papers, the passport in the middle, from the product pictures', () => {
    const out = html(
      <DocumentDeck
        docs={['insurance', 'flight', 'passport', 'bank', 'photo']}
        label="Five papers"
      />,
    );
    expect(out.match(/class="kit-deck-doc"/g)).toHaveLength(5);
    expect(out).toContain('data-slot="hero" data-kind="passport"');
    expect(out).toContain('role="img" aria-label="Five papers"');
    expect(out).not.toMatch(/data:|blob:/);
    // The one picture file is the real Bangladesh cover, served from this site.
    expect(out.match(/<img[^>]*src="([^"]+)"/g)).toEqual([
      expect.stringContaining('/pictures/passport-bd.png'),
    ]);
  });

  it('moves with the scene only by transform, from its --p', () => {
    expect(CSS).toMatch(/\.kit-deck \{[^}]*--t: clamp\(0, calc\(var\(--p, 1\) \/ 0\.85\), 1\)/);
    expect(CSS).toMatch(/\.kit-deck-doc \{[^}]*transform:/);
  });
});

describe('ScanPhone', () => {
  it('shows Suggested and Confirmed as different words, and says it is an example', () => {
    const out = html(<ScanPhone fields={FIXTURE_FIELDS} />);
    expect(out).toContain('Suggested');
    expect(out).toContain('Confirmed');
    expect(out).toContain('Example record.');
    expect(out).toContain('class="pub-example"');
    for (const field of FIXTURE_FIELDS) expect(out).toContain(field.value);
  });

  it('pins a step without a scene', () => {
    expect(html(<ScanPhone fields={FIXTURE_FIELDS} step={1} />)).toContain('data-kit-step="1"');
  });
});

describe('CountryChecklistPanel', () => {
  it('counts what each country already has in the record', () => {
    const out = html(<CountryChecklistPanel countries={FIXTURE_COUNTRIES} items={FIXTURE_ITEMS} />);
    expect(out).toContain('Singapore: 5 of 8 Ready');
    expect(out).toContain('Germany: 3 of 8 Ready');
    expect(out).toContain('Reused');
    expect(out).toContain('To Add');
    expect(out).toContain('Completeness only. Not an approval.');
    expect(out).toContain('src="/flags/sg.svg"');
    expect(out.match(/<li class="kit-row"/g)).toHaveLength(8);
  });

  it('pins one country and keeps the pin inside the list', () => {
    const out = html(
      <CountryChecklistPanel countries={FIXTURE_COUNTRIES} items={FIXTURE_ITEMS} active={9} />,
    );
    expect(out).toContain('data-kit-step="2"');
  });
});

describe('JourneyTrack', () => {
  it('names the product stage words and who acts', () => {
    const out = html(<JourneyTrack stages={FIXTURE_STAGES} />);
    for (const word of ['Getting Started', 'Being Checked', 'Needs You', 'Submitted']) {
      expect(out).toContain(word);
    }
    expect(out).toContain('You');
    expect(out).toContain('Agency');
    expect(out).toContain('Embassy');
    expect(out).toContain('class="pub-example"');
    expect(out.match(/class="kit-sw kit-stage"/g)).toHaveLength(FIXTURE_STAGES.length);
  });

  it('never says a decision is made for anyone', () => {
    expect(html(<JourneyTrack stages={FIXTURE_STAGES} />)).not.toMatch(
      /approved|accepted|granted/i,
    );
  });
});

describe('ShareSheet', () => {
  it('starts every switch off and says Not shared (Saved is not Shared)', () => {
    const out = html(<ShareSheet mode="scroll" step={0} />);
    expect(out).toContain('Not Shared');
    expect(out).toContain('Agency can see nothing.');
    expect(out).toContain('data-kit-step="0"');
  });

  it('ends with Access Ended', () => {
    const out = html(<ShareSheet mode="scroll" step={4} />);
    expect(out).toContain('Access Ended');
    expect(out).toContain('Everything is private again.');
  });

  it('timed mode renders finished on the server, so it rests on Access Ended without motion', () => {
    expect(html(<ShareSheet mode="timed" />)).toContain('data-kit-step="4"');
  });
});

describe('ShareSheet timed clock', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  const motion = (reduce: boolean) =>
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: reduce && query.includes('reduce'),
      addEventListener() {},
      removeEventListener() {},
    }));

  it('plays the five steps in turn and starts again', () => {
    motion(false);
    act(() => root.render(<ShareSheet mode="timed" />));
    const step = () => host.querySelector('.kit-sheet')?.getAttribute('data-kit-step');
    expect(step()).toBe('0');
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS * 2);
    });
    expect(step()).toBe('2');
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS * 3);
    });
    expect(step()).toBe('0');
  });

  it('only runs while it is on screen and the tab is showing (MOT1)', () => {
    motion(false);
    let notify: (entries: Array<{ isIntersecting: boolean }>) => void = () => undefined;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    act(() => root.render(<ShareSheet mode="timed" />));
    const step = () => host.querySelector('.kit-sheet')?.getAttribute('data-kit-step');
    act(() => notify([{ isIntersecting: true }]));
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS);
    });
    expect(step()).toBe('1');
    act(() => notify([{ isIntersecting: false }]));
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS * 5);
    });
    expect(step()).toBe('1');
    act(() => notify([{ isIntersecting: true }]));
    let hidden = true;
    Object.defineProperty(document, 'hidden', { get: () => hidden, configurable: true });
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS * 5);
    });
    expect(step()).toBe('1');
    hidden = false;
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS);
    });
    expect(step()).toBe('2');
    Reflect.deleteProperty(document, 'hidden');
  });

  it('has a keyboard-operable Pause button (the loop is longer than 5 s) that holds the step and carries on from it', () => {
    motion(false);
    act(() => root.render(<ShareSheet mode="timed" />));
    const step = () => host.querySelector('.kit-sheet')?.getAttribute('data-kit-step');
    const button = host.querySelector('button.kit-pause') as HTMLButtonElement;
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('Pause the Animation');
    expect(button.hasAttribute('data-idle')).toBe(false);
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS);
    });
    expect(step()).toBe('1');
    act(() => button.click());
    expect(button.textContent).toBe('Play the Animation');
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS * 6);
    });
    expect(step()).toBe('1');
    act(() => button.click());
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS);
    });
    expect(step()).toBe('2');
  });

  it('plays for visitors who asked for less motion too, with the Pause button shown (gentle mode)', () => {
    motion(true);
    act(() => root.render(<ShareSheet mode="timed" />));
    const step = () => host.querySelector('.kit-sheet')?.getAttribute('data-kit-step');
    const button = host.querySelector('.kit-pause') as HTMLButtonElement;
    expect(button.hasAttribute('data-idle')).toBe(false);
    expect(step()).toBe('0');
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS * 2);
    });
    expect(step()).toBe('2');
  });

  it('renders the Pause button idle from the server: space kept before hydration, none without JavaScript', () => {
    const out = html(<ShareSheet mode="timed" />);
    expect(out).toContain('class="pub-button pub-button-secondary kit-pause"');
    expect(out).toContain('data-idle=""');
    expect(out).toContain('aria-hidden="true"');
    expect(out).toContain('tabindex="-1"');
    // Hidden but laid out (visibility, never display), so nothing shifts when it appears, with or
    // without the early mark.
    expect(CSS).toMatch(/\.kit-pause\[data-idle\] \{\s*visibility: hidden;/);
    expect(CSS).toMatch(/\.tr-pause\[data-idle\] \{\s*visibility: hidden;/);
    expect(CSS).not.toMatch(/\[data-idle\][^{]*\{[^}]*display: none/);
  });
});

describe('CasesTable', () => {
  it('shows flag, ring, missing count and status, tagged Example', () => {
    const out = html(<CasesTable rows={FIXTURE_CASES} />);
    expect(out).toContain('2 missing');
    expect(out).toContain('Complete');
    expect(out).toContain('Being Checked');
    expect(out).toContain('class="pub-example"');
    expect(out).toContain('src="/flags/de.svg"');
    expect(out.match(/class="kit-rise/g)).toHaveLength(3);
  });
});

describe('ClosingBand', () => {
  it('shows the real Bangladesh cover from this site and the page’s own buttons', () => {
    const out = html(
      <ClosingBand title="Start" sub="Sub" actions={<a href="/app">Sign in to get started</a>} />,
    );
    expect(out).toContain('src="/pictures/passport-bd.png"');
    expect(out).toContain('href="/app"');
    expect(out).toContain('data-tone="dark"');
    expect(out).toContain('aria-labelledby="pub-closing-title"');
  });

  it('can leave the passport out', () => {
    expect(html(<ClosingBand title="t" sub="s" actions={null} passport={false} />)).not.toContain(
      'passport-bd',
    );
  });
});

describe('RiseIn', () => {
  it('renders its words visibly with no JavaScript (hiding is the stylesheet, only while scenes are live)', () => {
    const out = html(<RiseIn delay={0.2}>Words</RiseIn>);
    expect(out).toContain('Words');
    expect(out).toContain('kit-rise kit-rise-d2');
    expect(CSS).toContain('html[data-scenes="live"] .kit-rise:not(.is-in)');
    expect(CSS).toContain('html[data-scenes="reveal"] .kit-rise:not(.is-in)');
    expect(CSS).not.toMatch(/(^|\n)\.kit-rise:not\(\.is-in\)/);
  });

  it('adds is-in once seen, and straight away when there is no observer', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('IntersectionObserver', undefined);
    act(() => root.render(<RiseIn>Words</RiseIn>));
    expect(host.querySelector('.kit-rise')?.classList.contains('is-in')).toBe(true);
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
});

describe('Scene opt-in', () => {
  it('centres the stage only for a scene that asks (kitStage), so older pages are unchanged', () => {
    expect(
      html(
        <Scene name="a" len={2} steps={2} kitStage>
          <i />
        </Scene>,
      ),
    ).toContain('data-kit-stage=""');
    expect(
      html(
        <Scene name="b" len={2} steps={2}>
          <i />
        </Scene>,
      ),
    ).not.toContain('data-kit-stage');
    const sheet = readFileSync(join(__dirname, '..', 'public-site.css'), 'utf8');
    expect(sheet).toContain('.pub-scene[data-kit-stage] .pub-scene-stage');
    expect(sheet).not.toMatch(/html\[data-scenes="live"\] \.pub-scene-stage \{[^}]*display: grid/);
  });
});

describe('reveal mode styles (MOT1)', () => {
  it('moves with transform and opacity only, never layout, and only under reveal and calm motion', () => {
    const start = CSS.indexOf('MOT1 reveal mode');
    const block = CSS.slice(start, CSS.indexOf('MOT1 gentle mode'));
    expect(block).toContain(
      'html[data-scenes="reveal"] .pub-scene[data-reveal="playing"] .kit-scan',
    );
    // Data saver never stops motion (owner, 18 Nov 2026): no kit rule keys on it.
    expect(CSS).not.toContain('data-save-data');
    // The reveal block is inside the no-preference media query that opens the rise-in rules.
    const open = CSS.lastIndexOf('@media (prefers-reduced-motion: no-preference)', start);
    expect(CSS.slice(open, start)).not.toContain('@keyframes');
    for (const layout of ['width:', 'height:', 'top:', 'left:', 'margin', 'padding'])
      expect(block).not.toContain(`  ${layout}`);
  });
  it('sizes a tab label by the finished step in reveal mode, so playing never shifts the page', () => {
    const phone = CSS.slice(CSS.indexOf('MOT1: in reveal mode a tab label'));
    const folded = phone.replace(/\s+/g, ' ');
    expect(folded).toContain(
      'html:is([data-scenes="reveal"], [data-scenes="gentle"]) .pub-scene .kit-tab > span { max-width: 0; }',
    );
    for (let step = 0; step < 12; step++)
      expect(folded).toContain(
        `html:is([data-scenes="reveal"], [data-scenes="gentle"]) .pub-scene[data-rest="${step}"] .kit-tab[data-at="${step}"] > span { max-width: 140px; }`,
      );
    // Never a rule that gives every label a width whatever the step (it overflowed 360 px screens).
    expect(CSS).not.toMatch(/html\[data-scenes="(?:reveal|gentle)"\] \.kit-tab > span/);
  });
  it('lays alternative words out by the finished step, never by the playing step (no layout change)', () => {
    // The stylesheet is formatted by the linter, so compare with the white space folded.
    const block = STEPS_CSS.slice(STEPS_CSS.indexOf('MOT1 reveal and gentle modes'))
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')');
    expect(block).not.toContain('data-step');
    const scene = 'html:is([data-scenes="reveal"], [data-scenes="gentle"]) .pub-scene';
    const set = (from: number, to: number) =>
      `:is(${Array.from({ length: to - from + 1 }, (_, i) => `[data-rest="${from + i}"]`).join(', ')})`;
    for (let step = 0; step < 12; step++) {
      expect(block).toContain(`${scene}[data-rest="${step}"] .kit-sw[data-at="${step}"] {`);
      expect(block).toContain(`${scene}:not([data-rest="${step}"]) .kit-sw[data-at="${step}"] {`);
      // From K on: shown when the scene finishes at K or later. Until K: at K or earlier.
      expect(block).toContain(`${scene}${set(step, 11)} .kit-sw[data-from="${step}"] {`);
      expect(block).toContain(`${scene}:not(${set(step, 11)}) .kit-sw[data-from="${step}"] {`);
      expect(block).toContain(`${scene}${set(0, step)} .kit-sw[data-upto="${step}"] {`);
      expect(block).toContain(`${scene}:not(${set(0, step)}) .kit-sw[data-upto="${step}"] {`);
    }
  });
  it('registers the scene progress as a number so it can ease between steps', () => {
    expect(CSS).toMatch(
      /@property --p \{\s*syntax: "<number>";\s*inherits: true;\s*initial-value: 1;/,
    );
  });
});

/**
 * The gentle mode (owner, 18 Nov 2026) is the only place that overrides the global reduced-motion
 * rule (globals.css switches every transition and animation off with !important). So every
 * !important transition or animation in kit.css must sit under html[data-scenes="gentle"], fade
 * only opacity and colours (the one move allowed is the 8 px rise, on .kit-rise), take at most 0.4 s
 * and never start an animation.
 */
const GENTLE_PROPS = new Set(['opacity', 'background-color', 'border-color', 'color']);

function gentleProblems(css: string): string[] {
  const problems: string[] = [];
  postcss.parse(css).walkRules((rule) => {
    const overrides = rule.nodes.filter(
      (node): node is Declaration =>
        node.type === 'decl' && node.important && /^(?:transition|animation)/.test(node.prop),
    );
    if (overrides.length === 0) return;
    for (const selector of rule.selectors)
      if (!selector.includes('[data-scenes="gentle"]'))
        problems.push(`not under gentle mode: ${selector}`);
    for (const decl of overrides) {
      if (decl.prop.startsWith('animation')) problems.push(`animation: ${rule.selector}`);
      else
        for (const part of decl.value.split(',')) {
          const words = part.trim().split(/\s+/);
          const property = words[0] ?? '';
          const rise =
            property === 'transform' && rule.selectors.every((s) => /\.kit-rise$/.test(s));
          if (!GENTLE_PROPS.has(property) && !rise)
            problems.push(`property ${property}: ${rule.selector}`);
          for (const word of words) {
            const time = /^([\d.]+)(m?s)$/.exec(word);
            if (time && Number(time[1]) * (time[2] === 's' ? 1000 : 1) > 400)
              problems.push(`longer than 0.4 s (${word}): ${rule.selector}`);
          }
        }
    }
  });
  return problems;
}

describe('no endless loop without a Pause (WCAG 2.2.2)', () => {
  it('has no infinite animation anywhere in the kit styles: a scan runs twice, a picture loop has a Pause button', () => {
    for (const file of ['kit.css', 'kit-steps.css'])
      expect(readFileSync(join(__dirname, file), 'utf8'), file).not.toMatch(/\binfinite\b/);
    expect(CSS).toMatch(
      /html\[data-scenes="live"\] \.kit-scan \{\s*animation: kit-scan [\d.]+s ease-in-out 2 alternate both;/,
    );
  });
});

describe('gentle mode styles (owner, 18 Nov 2026: reduced motion gets gentle fading)', () => {
  const start = CSS.indexOf('/* MOT1 gentle mode');
  const whole = CSS.slice(start, CSS.indexOf('/* MOT1: in reveal mode a tab label'));
  const block = whole.replace(/\/\*[\s\S]*?\*\//g, '');
  it('only overrides the global reduced-motion rule under gentle mode, with 0.4 s fades of opacity and colour', () => {
    expect(gentleProblems(CSS)).toEqual([]);
    expect(block).toContain('!important');
  });
  it('fails each rule on a bad example', () => {
    expect(gentleProblems('.a { transition: opacity 0.4s ease !important }')).toEqual([
      'not under gentle mode: .a',
    ]);
    expect(
      gentleProblems(
        'html[data-scenes="gentle"] .a { transition: transform 0.4s ease !important }',
      ),
    ).toEqual(['property transform: html[data-scenes="gentle"] .a']);
    expect(
      gentleProblems('html[data-scenes="gentle"] .a { transition: opacity 0.7s ease !important }'),
    ).toEqual(['longer than 0.4 s (0.7s): html[data-scenes="gentle"] .a']);
    expect(
      gentleProblems('html[data-scenes="gentle"] .a { animation: kit-fade 0.4s ease !important }'),
    ).toEqual(['animation: html[data-scenes="gentle"] .a']);
    expect(
      gentleProblems(
        'html[data-scenes="gentle"] .kit-rise { transition: transform 0.4s ease !important }',
      ),
    ).toEqual([]);
  });
  it('neutralises every step-driven move over 8 px or scale in the base styles (they would jump or scale in gentle mode)', () => {
    const risky: string[] = [];
    const neutral = new Set<string>();
    postcss.parse(CSS).walkRules((rule) => {
      for (const decl of rule.nodes) {
        if (decl.type !== 'decl' || decl.prop !== 'transform') continue;
        if (rule.selector.includes('[data-scenes=')) {
          if (decl.value === 'none' && rule.selector.includes('"gentle"'))
            for (const one of rule.selectors) neutral.add(one.replace(/^.*\) /, '').trim());
          continue;
        }
        if (!decl.value.includes('var(--on')) continue;
        const over = [...decl.value.matchAll(/\*\s*([\d.]+)px/g)].some(([, px]) => Number(px) > 8);
        if (/scale\(/.test(decl.value) || over) risky.push(rule.selector);
      }
    });
    expect(risky.length).toBeGreaterThanOrEqual(2);
    for (const selector of risky) expect([...neutral], selector).toContain(selector);
  });
  it('replaces the sliding switch knob by two knobs that cross-fade', () => {
    expect(block).toMatch(/\.kit-switch::after \{[^}]*opacity: calc\(1 - var\(--on, 0\)\)/);
    expect(block).toMatch(/\.kit-switch::before \{[^}]*opacity: var\(--on, 0\)/);
  });
  it('moves nothing by more than 8 px and never scales, slides, tilts or sweeps', () => {
    expect(block).not.toMatch(/scale\(|perspective|rotate|translateX|--p\b|kit-scan|animation/);
    for (const [, px] of block.matchAll(/translate[XY]?\((-?[\d.]+)px\)/g))
      expect(Math.abs(Number(px))).toBeLessThanOrEqual(8);
    expect(block).not.toMatch(/transition-delay/);
  });
  it('has its rules only under html[data-scenes="gentle"]', () => {
    const selectors: string[] = [];
    postcss.parse(block).walkRules((rule) => {
      selectors.push(...rule.selectors);
    });
    expect(selectors.length).toBeGreaterThanOrEqual(8);
    for (const selector of selectors)
      expect(selector, selector).toMatch(/^html\[data-scenes="gentle"\] /);
  });
});

describe('kit rules', () => {
  it('has switch rules for every step 0 to 11, at, from and upto', () => {
    for (let step = 0; step < 12; step++) {
      expect(STEPS_CSS).toContain(
        `[data-step="${step}"], [data-kit-step="${step}"]) [data-at="${step}"]`,
      );
      expect(STEPS_CSS).toMatch(new RegExp(`\\[data-from="${step}"\\] \\{`));
      expect(STEPS_CSS).toMatch(new RegExp(`\\[data-upto="${step}"\\] \\{`));
    }
  });

  it('carries no colour of its own: tokens only, no cyan, mint or the reference blue', () => {
    for (const sheet of [CSS, STEPS_CSS]) {
      expect(sheet).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(sheet).not.toMatch(/rgba?\(|hsla?\(/i);
    }
  });

  it('is flat: no gradient, shadow, blur or backdrop here', () => {
    expect(CSS).not.toMatch(
      /gradient\(|box-shadow|text-shadow|backdrop-filter|blur\(|drop-shadow\(/,
    );
  });

  it('keeps every picture inside the scene (no inline style, nothing that needs one)', () => {
    const out = html(
      <Scene name="x" len={2} steps={3}>
        <ScanPhone fields={FIXTURE_FIELDS} />
        <CountryChecklistPanel countries={FIXTURE_COUNTRIES} items={FIXTURE_ITEMS} />
        <JourneyTrack stages={FIXTURE_STAGES} />
        <ShareSheet mode="scroll" />
        <CasesTable rows={FIXTURE_CASES} />
      </Scene>,
    );
    expect(out).not.toMatch(/ style=/);
  });
});
