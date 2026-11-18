// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('rests finished with reduced motion', () => {
    motion(true);
    act(() => root.render(<ShareSheet mode="timed" />));
    act(() => {
      vi.advanceTimersByTime(SHARE_TICK_MS * 4);
    });
    expect(host.querySelector('.kit-sheet')?.getAttribute('data-kit-step')).toBe('4');
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
