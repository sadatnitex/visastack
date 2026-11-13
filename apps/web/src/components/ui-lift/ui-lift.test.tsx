// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import { Icon } from '../icons';
import {
  AboutDisclosure,
  ActionRow,
  AlertBanner,
  ChecklistRow,
  EmptyPanel,
  NextStepPanel,
  ProgressMeter,
  SectionCard,
  StatTile,
  StatusPill,
  StepBar,
  meterPercent,
} from './index';

const here = __dirname;
const css = readFileSync(join(here, '..', '..', 'app', 'globals.css'), 'utf8');

/** The WP-LIFT-A block: from its marker to its end line. */
const block = (() => {
  const start = css.indexOf('/* WP-LIFT-A');
  const end = css.indexOf('/* end WP-LIFT-A */');
  return start < 0 || end < 0 ? '' : css.slice(start, end);
})();

function render(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

describe('StatusPill', () => {
  it('keeps the shared badge, so every tone has its mark, and carries the words', () => {
    for (const tone of ['success', 'warning', 'danger', 'neutral'] as const) {
      const pill = render(<StatusPill tone={tone}>On File</StatusPill>).firstElementChild;
      expect(pill?.className).toContain('badge');
      expect(pill?.className).toContain(`badge-${tone}`);
      expect(pill?.className).toContain('lift-pill');
      expect(pill?.textContent).toBe('On File');
    }
  });

  it('draws info on the neutral badge and recolours it, and md is the larger pill', () => {
    const info = render(
      <StatusPill tone="info" size="md">
        Format Checked
      </StatusPill>,
    ).firstElementChild;
    expect(info?.className).toContain('badge-neutral');
    expect(info?.className).toContain('lift-pill-info');
    expect(info?.className).toContain('lift-pill-md');
    const small = render(<StatusPill tone="success">On File</StatusPill>).firstElementChild;
    expect(small?.className).toContain('lift-pill-sm');
  });
});

describe('ProgressMeter', () => {
  it('is a named picture whose fill width is an attribute, with the numbers as words beside it', () => {
    const host = render(<ProgressMeter value={6} max={12} label="required items on file" />);
    const svg = host.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('6 of 12 required items on file');
    expect(host.querySelector('.lift-meter-fill')?.getAttribute('width')).toBe('50');
    expect(host.querySelector('.lift-meter-track')?.getAttribute('width')).toBe('100');
    expect(svg?.getAttribute('height')).toBe('10');
    expect(host.querySelector('.lift-meter-text')?.textContent).toBe('6 of 12');
    expect(host.querySelector('.lift-meter-text')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.innerHTML).not.toContain('style=');
  });

  it('comes in two thicknesses and can drop or replace the words', () => {
    const thin = render(
      <ProgressMeter value={1} max={4} label="steps" size={6} valueText={null} />,
    );
    expect(thin.querySelector('svg')?.getAttribute('height')).toBe('6');
    expect(thin.querySelector('.lift-meter-text')).toBeNull();
    expect(thin.firstElementChild?.className).toContain('lift-meter-6');
    const own = render(<ProgressMeter value={1} max={4} label="steps" valueText="One so far" />);
    expect(own.querySelector('.lift-meter-text')?.textContent).toBe('One so far');
  });

  it('never draws a fill outside the track', () => {
    expect(meterPercent(15, 12)).toBe(100);
    expect(meterPercent(-3, 12)).toBe(0);
    expect(meterPercent(0, 0)).toBe(0);
    expect(meterPercent(Number.NaN, 5)).toBe(0);
    expect(meterPercent(1, 3)).toBe(33.33);
  });
});

describe('StatTile', () => {
  it('shows the number, its name and an optional note, and is a plain block without a link', () => {
    const host = render(<StatTile value={4} label="Missing" note="Needs you" />);
    expect(host.firstElementChild?.tagName).toBe('DIV');
    expect(host.querySelector('.lift-tile-numeral')?.textContent).toBe('4');
    expect(host.querySelector('.lift-tile-label')?.textContent).toBe('Missing');
    expect(host.querySelector('.lift-tile-note')?.textContent).toBe('Needs you');
  });

  it('lets a zero recede, and marks the selected tile in words for screen readers as well', () => {
    expect(render(<StatTile value={0} label="Missing" />).firstElementChild?.className).toContain(
      'lift-tile-zero',
    );
    expect(
      render(<StatTile value={2} label="Missing" />).firstElementChild?.className,
    ).not.toContain('lift-tile-zero');
    const selected = render(
      <StatTile value={2} label="Missing" href="#missing" selected />,
    ).firstElementChild;
    expect(selected?.tagName).toBe('A');
    expect(selected?.className).toContain('lift-tile-selected');
    expect(selected?.getAttribute('aria-current')).toBe('true');
    const plain = render(<StatTile value={2} label="Missing" href="/app/x" />).firstElementChild;
    expect(plain?.getAttribute('aria-current')).toBeNull();
    expect(plain?.getAttribute('href')).toBe('/app/x');
  });
});

describe('SectionCard', () => {
  it('has a real heading at the given level, named by the section, with a kicker and an action', () => {
    const host = render(
      <SectionCard heading="Case Details" kicker="Case" action={<span>Updated today</span>}>
        <p>Body</p>
      </SectionCard>,
    );
    const heading = host.querySelector('h2');
    expect(heading?.textContent).toBe('Case Details');
    expect(host.querySelector('section')?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(host.querySelector('p.card-kicker')?.textContent).toBe('Case');
    expect(host.querySelector('.lift-card-action')?.textContent).toBe('Updated today');
    expect(host.querySelector('.lift-card-body p')?.textContent).toBe('Body');
    const deeper = render(
      <SectionCard heading="Sources" level={3} tint="brand">
        <p>x</p>
      </SectionCard>,
    );
    expect(deeper.querySelector('h3')?.textContent).toBe('Sources');
    expect(deeper.querySelector('h2')).toBeNull();
    expect(deeper.querySelector('.lift-card-tint')).not.toBeNull();
    expect(deeper.querySelector('.card-kicker')).toBeNull();
    expect(deeper.querySelector('.lift-card-action')).toBeNull();
  });
});

describe('ActionRow', () => {
  it('leads somewhere with a chevron: a client link inside the app, an anchor in the page', () => {
    const inApp = render(
      <ActionRow
        title="Snapshots"
        meta="3 saved"
        icon="clock"
        pill={<span>3</span>}
        href="/app/s"
      />,
    ).firstElementChild;
    expect(inApp?.tagName).toBe('A');
    expect(inApp?.getAttribute('href')).toBe('/app/s');
    expect(inApp?.querySelector('.lift-action-title')?.textContent).toBe('Snapshots');
    expect(inApp?.querySelector('.lift-action-meta')?.textContent).toBe('3 saved');
    expect(inApp?.querySelector('.lift-action-tile svg')).not.toBeNull();
    expect(inApp?.querySelector('.lift-action-pill')?.textContent).toBe('3');
    expect(inApp?.querySelector('.lift-action-chevron')).not.toBeNull();
    const anchor = render(<ActionRow title="Notes" href="#notes" />).firstElementChild;
    expect(anchor?.getAttribute('href')).toBe('#notes');
    expect(anchor?.querySelector('.lift-action-meta')).toBeNull();
    expect(anchor?.querySelector('.lift-action-tile')).toBeNull();
  });

  it('can be the opener of a disclosure, and is plain when it leads nowhere', () => {
    const host = render(
      <details>
        <ActionRow title="Tasks" asSummary />
        <p>Inside</p>
      </details>,
    );
    const summary = host.querySelector('details > summary');
    expect(summary?.className).toContain('lift-action-summary');
    expect(summary?.textContent).toBe('Tasks');
    expect(summary?.querySelector('.lift-action-chevron')).not.toBeNull();
    const plain = render(<ActionRow title="Passport" />).firstElementChild;
    expect(plain?.tagName).toBe('DIV');
    expect(plain?.querySelector('.lift-action-chevron')).toBeNull();
  });
});

describe('ChecklistRow', () => {
  it('shows a tone icon, the name with its tag, one next step, one action and the source line', () => {
    const host = render(
      <ChecklistRow
        name="Income Tax Return"
        tone="danger"
        status="Missing"
        necessity="Mandatory"
        next="Add this to move the case forward."
        action={{ label: 'Provide Evidence', href: '#evidence' }}
        note="Source: Embassy of Japan"
      />,
    );
    const row = host.firstElementChild;
    expect(row?.className).toContain('row');
    expect(row?.className).toContain('lift-check-danger');
    expect(row?.querySelector('.row-key')?.textContent).toBe('Income Tax Return');
    // The dot before the tag is for the eyes of a wide screen only; the word is the tag.
    expect(row?.querySelector('.lift-check-tag')?.textContent).toBe('· Mandatory');
    expect(row?.querySelector('.lift-check-dot')?.getAttribute('aria-hidden')).toBe('true');
    expect(row?.querySelector('.lift-check-next')?.textContent).toBe(
      'Add this to move the case forward.',
    );
    expect(row?.querySelectorAll('a.btn')).toHaveLength(1);
    expect(row?.querySelector('a.btn')?.textContent).toBe('Provide Evidence');
    expect(row?.querySelector('.lift-check-note')?.textContent).toBe('Source: Embassy of Japan');
    expect(row?.querySelector('.badge-danger')?.textContent).toBe('Missing');
    expect(row?.querySelector('.lift-check-icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(row?.querySelector('.lift-row-more')).toBeNull();
  });

  it('folds the rest under a named opener, and a done row is one line', () => {
    const more = render(
      <ChecklistRow
        name="Bank Statement"
        tone="warning"
        status="To Confirm"
        icon="calendar"
        more={<p>Provenance</p>}
        moreLabel="More About This Item"
      />,
    );
    expect(more.querySelector('details.lift-row-more > summary')?.textContent).toBe(
      'More About This Item',
    );
    expect(more.querySelector('.lift-row-more-body p')?.textContent).toBe('Provenance');
    const done = render(<ChecklistRow name="Passport" tone="success" status="On File" />);
    expect(done.querySelector('p')).toBeNull();
    expect(done.querySelector('a')).toBeNull();
    expect(done.querySelector('details')).toBeNull();
    expect(done.querySelector('.lift-check-success')).not.toBeNull();
  });

  it('gives each tone its own picture, so status is never colour alone', () => {
    const icon = (tone: 'success' | 'warning' | 'danger' | 'neutral' | 'info') =>
      render(<ChecklistRow name="X" tone={tone} status="Y" />).querySelector('.lift-check-icon')
        ?.innerHTML;
    expect(icon('success')).toBe(renderToStaticMarkup(<Icon name="check" size={16} />));
    expect(icon('warning')).toBe(renderToStaticMarkup(<Icon name="alert" size={16} />));
    expect(icon('danger')).toBe(renderToStaticMarkup(<Icon name="close" size={16} />));
    expect(icon('neutral')).toBe(renderToStaticMarkup(<Icon name="circle" size={16} />));
  });
});

describe('StepBar', () => {
  const steps = [
    { label: 'Draft' },
    { label: 'In Progress', current: true },
    { label: 'Ready for Review' },
  ];

  it('has one item per stage whose text is exactly its name, with the number left to the stylesheet', () => {
    const host = render(
      <StepBar
        ariaLabel="Actual case workflow state"
        steps={steps}
        apart={[{ label: 'Cancelled' }]}
        position="Stage 2 of 3"
        help={{ summary: 'About Stages', children: <p>Only the current stage is marked.</p> }}
      />,
    );
    expect(host.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Actual case workflow state',
    );
    const items = [...host.querySelectorAll('ol > li')];
    expect(items.map((li) => li.textContent)).toEqual([
      'Draft',
      'In Progress',
      'Ready for Review',
      'Cancelled',
    ]);
    expect(host.querySelector('p.lift-steps-position')?.textContent).toBe('Stage 2 of 3');
    expect(host.querySelectorAll('li[aria-current="step"]')).toHaveLength(1);
    expect(host.querySelector('li[aria-current="step"]')?.textContent).toBe('In Progress');
    expect(items[3]?.className).toContain('lift-step-apart');
    // No earlier stage is marked as done.
    expect(host.querySelector('.lift-step-done')).toBeNull();
    expect(host.querySelector('details.lift-help > summary')?.textContent).toBe('About Stages');
  });

  it('names the current stage in a "Now:" headline, with no date and no outcome', () => {
    const host = render(<StepBar ariaLabel="Stages" steps={steps} position="Stage 2 of 3" />);
    const now = host.querySelector('p.lift-steps-now');
    expect(now?.textContent).toBe('Now: In Progress');
    // The headline comes first, then the position words.
    expect(host.querySelector('section')?.firstElementChild).toBe(now);
    expect(now?.textContent).not.toMatch(/\d{1,2}\s?(?:[A-Z][a-z]{2}|\/)|will|expected|estimated/);
  });

  it('names a stage that is off the path when that is where the case is', () => {
    const host = render(
      <StepBar
        ariaLabel="Stages"
        steps={[{ label: 'Draft' }]}
        apart={[{ label: 'Cancelled', current: true }]}
      />,
    );
    expect(host.querySelector('.lift-steps-now')?.textContent).toBe('Now: Cancelled');
  });

  it('leaves the headline out when no stage is current', () => {
    const host = render(<StepBar ariaLabel="Stages" steps={[{ label: 'Draft' }]} />);
    expect(host.querySelector('.lift-steps-now')).toBeNull();
  });

  it('adds a strip of one hidden segment per stage on the path for a phone', () => {
    const host = render(
      <StepBar ariaLabel="Stages" steps={steps} apart={[{ label: 'Cancelled' }]} />,
    );
    const strip = host.querySelector('.lift-steps-strip');
    expect(strip?.getAttribute('aria-hidden')).toBe('true');
    expect(strip?.querySelectorAll('span')).toHaveLength(3);
    expect(strip?.querySelectorAll('.lift-strip-part-current')).toHaveLength(1);
    expect(host.querySelector('.lift-steps-position')).toBeNull();
    expect(host.querySelector('details')).toBeNull();
  });
});

describe('NextStepPanel', () => {
  it('has the kicker as its real heading, the title and body, and the one filled button', () => {
    const host = render(
      <NextStepPanel
        kicker="Next Step"
        kickerId="case-next-step-heading"
        title="Fix 4 required items for Japan visitor visa"
        body="First to fix: Income Tax Return."
        action={{
          label: 'See What Needs Fixing',
          href: '#readiness',
          openGroup: 'case-checklist-needs-you',
        }}
        edge="danger"
      />,
    );
    const section = host.querySelector('section');
    expect(section?.getAttribute('aria-labelledby')).toBe('case-next-step-heading');
    expect(section?.className).toContain('lift-next-danger');
    expect(host.querySelector('h2#case-next-step-heading')?.textContent).toBe('Next Step');
    expect(host.querySelector('.lift-next-title')?.textContent).toBe(
      'Fix 4 required items for Japan visitor visa',
    );
    expect(host.querySelector('.lift-next-body')?.textContent).toBe(
      'First to fix: Income Tax Return.',
    );
    expect(host.querySelectorAll('.btn-primary')).toHaveLength(1);
    const button = host.querySelector('a.btn-primary');
    expect(button?.getAttribute('href')).toBe('#readiness');
    expect(button?.getAttribute('data-open-group')).toBe('case-checklist-needs-you');
  });

  it('defaults to the brand edge, can be the dark variant, and its level is the caller choice', () => {
    const host = render(
      <NextStepPanel
        kicker="Next Step"
        kickerId="n"
        level={3}
        title="T"
        action={{ label: 'Go', href: '/app/home' }}
        variant="ink"
      />,
    );
    expect(host.querySelector('section')?.className).toContain('lift-next-brand');
    expect(host.querySelector('section')?.className).toContain('lift-next-ink');
    expect(host.querySelector('h3#n')).not.toBeNull();
    expect(host.querySelector('.lift-next-body')).toBeNull();
    expect(host.querySelector('a.btn-primary')?.getAttribute('href')).toBe('/app/home');
  });
});

describe('AlertBanner', () => {
  it('gives each tone its edge and mark, keeps the title a paragraph, and takes body and action', () => {
    for (const tone of ['danger', 'warning', 'info', 'success'] as const) {
      const host = render(
        <AlertBanner tone={tone} title="Something changed after you confirmed this case.">
          <p>Take a new snapshot.</p>
        </AlertBanner>,
      );
      expect(host.firstElementChild?.className).toContain(`lift-alert-${tone}`);
      expect(host.querySelector('.lift-alert-icon svg')).not.toBeNull();
    }
    const host = render(
      <AlertBanner
        tone="danger"
        title="Changed"
        action={<a href="#snapshots">Open Snapshots</a>}
        role="alert"
      >
        <p>Body</p>
      </AlertBanner>,
    );
    expect(host.firstElementChild?.getAttribute('role')).toBe('alert');
    expect(host.querySelector('p.lift-alert-title')?.textContent).toBe('Changed');
    expect(host.querySelector('.lift-alert-body p')?.textContent).toBe('Body');
    expect(host.querySelector('.lift-alert-action a')?.textContent).toBe('Open Snapshots');
    const bare = render(<AlertBanner tone="info" title="Note" />);
    expect(bare.firstElementChild?.getAttribute('role')).toBeNull();
    expect(bare.querySelector('.lift-alert-body')).toBeNull();
  });
});

describe('EmptyPanel', () => {
  it('shows a tile, a title, one line and at most one filled button', () => {
    const host = render(
      <EmptyPanel
        title="No Checklist Yet"
        primary={{ label: 'Pick a Checklist', href: '#list' }}
        secondary={{ label: 'Add Evidence', href: '#evidence' }}
      >
        <p>A checklist lists the papers this visa route asks for.</p>
      </EmptyPanel>,
    );
    expect(host.querySelector('.lift-empty-tile svg')).not.toBeNull();
    expect(host.querySelector('p.lift-empty-title')?.textContent).toBe('No Checklist Yet');
    expect(host.querySelector('.lift-empty-line p')?.textContent).toContain('papers');
    expect(host.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(host.querySelectorAll('.btn-secondary')).toHaveLength(1);
    const quiet = render(
      <EmptyPanel title="Nothing Here" level={3}>
        Nothing yet.
      </EmptyPanel>,
    );
    expect(quiet.querySelector('h3.lift-empty-title')?.textContent).toBe('Nothing Here');
    expect(quiet.querySelector('.lift-empty-actions')).toBeNull();
  });
});

function everything(): ReactElement {
  return (
    <div>
      <h1>Japan visitor visa</h1>
      <NextStepPanel
        kicker="Next Step"
        kickerId="next-heading"
        title="Fix 4 required items"
        body="First to fix: Income Tax Return."
        action={{ label: 'See What Needs Fixing', href: '#list' }}
      />
      <AlertBanner tone="danger" title="Something changed after you confirmed this case.">
        <p>Take a new snapshot and confirm it again.</p>
      </AlertBanner>
      <SectionCard heading="Evidence Progress" kicker="Case">
        <p>
          <StatusPill tone="success" size="md">
            On File
          </StatusPill>
        </p>
        <ProgressMeter value={6} max={12} label="required items on file" />
        <StatTile value={3} label="Missing" href="#list" selected />
        <StatTile value={0} label="Optional" />
        <StepBar
          ariaLabel="Case stages"
          steps={[{ label: 'Draft' }, { label: 'In Progress', current: true }]}
          apart={[{ label: 'Cancelled' }]}
          position="Stage 2 of 2"
          help={{ summary: 'About Stages', children: <p>Only the current stage is marked.</p> }}
        />
      </SectionCard>
      <SectionCard heading="Evidence Checklist" level={2}>
        <div className="rows" id="list">
          <ChecklistRow
            name="Income Tax Return"
            tone="danger"
            status="Missing"
            necessity="Mandatory"
            next="Add this to move the case forward."
            action={{ label: 'Provide Evidence', href: '#list' }}
            more={<p>Source: Embassy</p>}
            moreLabel="More About This Item"
          />
          <ChecklistRow name="Passport" tone="success" status="On File" />
        </div>
      </SectionCard>
      <SectionCard heading="More for This Case">
        <details>
          <ActionRow title="Tasks and Letters" meta="2 open tasks" icon="clipboard" asSummary />
          <p>Inside</p>
        </details>
        <ActionRow title="Snapshots" meta="1 saved" icon="clock" href="/app/mission/x/snapshots" />
      </SectionCard>
      <EmptyPanel
        title="No Checklist Yet"
        level={2}
        icon="plane"
        primary={{ label: 'Pick a Checklist', href: '#list' }}
      >
        <p>A checklist lists the papers this visa route asks for.</p>
      </EmptyPanel>
    </div>
  );
}

describe('the pieces together', () => {
  it('pass the automated accessibility rules', async () => {
    expect(await axeViolations(renderToStaticMarkup(everything()))).toEqual([]);
  });

  it('carry no inline style anywhere, in markup or in source', () => {
    expect(renderToStaticMarkup(everything())).not.toMatch(/\sstyle=/);
    const sources = readdirSync(here).filter(
      (name) => /\.tsx?$/.test(name) && !/\.test\./.test(name),
    );
    expect(sources.length).toBeGreaterThanOrEqual(11);
    for (const name of sources) {
      const text = readFileSync(join(here, name), 'utf8');
      expect(text, name).not.toMatch(/\bstyle\s*=/);
      expect(text, name).not.toMatch(/\buse client\b/);
    }
  });

  it('use only class names whose type of text the title guard already checks, by their props', () => {
    // The title guard (lib/title-case.test.ts) treats a class named badge, pill, btn, tab, chip or
    // ending in -label, -kicker, -metric, -tab, -filter or -chip as holding a Title Case name.
    // These are the only such classes the components use, and each holds text given by a prop.
    const NAME_CLASS =
      /(^|[\s"'`])(badge|pill|btn|tab|chip|[a-z0-9-]*-(label|kicker|metric|tab|filter|chip))(?=[\s"'`]|$)/;
    const allowed = new Set(['badge', 'btn', 'card-kicker', 'lift-tile-label', 'lift-next-kicker']);
    const used = new Set<string>();
    const sources = readdirSync(here).filter(
      (name) => /\.tsx$/.test(name) && !/\.test\./.test(name),
    );
    for (const name of sources) {
      const text = readFileSync(join(here, name), 'utf8');
      for (const literal of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        for (const token of (literal[1] ?? literal[2] ?? '').split(/\s+/)) {
          if (token && NAME_CLASS.test(token) && !token.includes('$')) used.add(token);
        }
      }
    }
    for (const token of used)
      expect(allowed.has(token), `${token} is not an allowed name class`).toBe(true);
    // Sentences use -note, -meta, -body or -line, never a name class.
    expect(block).toContain('.lift-tile-note');
    expect(block).toContain('.lift-action-meta');
    expect(block).toContain('.lift-empty-line');
  });
});

/** Every `lift-` class the components write, in every variant they have. */
function renderedLiftClasses(): Set<string> {
  const elements: ReactElement[] = [everything()];
  for (const tone of ['neutral', 'info', 'success', 'warning', 'danger'] as const) {
    elements.push(
      <StatusPill tone={tone}>X</StatusPill>,
      <StatusPill tone={tone} size="md">
        X
      </StatusPill>,
    );
    elements.push(<ChecklistRow name="n" tone={tone} status="s" next="x" more={<p>m</p>} />);
  }
  for (const size of [6, 10] as const)
    elements.push(<ProgressMeter value={1} max={2} label="l" size={size} />);
  for (const tone of ['danger', 'warning', 'info', 'success'] as const)
    elements.push(
      <AlertBanner tone={tone} title="t" action={<a href="#a">a</a>}>
        b
      </AlertBanner>,
    );
  for (const edge of ['brand', 'danger', 'success'] as const)
    elements.push(
      <NextStepPanel
        kicker="k"
        kickerId={`k-${edge}`}
        title="t"
        body="b"
        edge={edge}
        variant="ink"
        action={{ label: 'a', href: '#a' }}
      />,
    );
  elements.push(
    <StatTile value={0} label="L" note="n" href="#a" selected />,
    <SectionCard heading="H" tint="brand" action={<span>a</span>} kicker="k">
      <p>x</p>
    </SectionCard>,
    <EmptyPanel
      title="T"
      primary={{ label: 'a', href: '#a' }}
      secondary={{ label: 'b', href: '#b' }}
    >
      x
    </EmptyPanel>,
    <StepBar
      ariaLabel="a"
      steps={[{ label: 'A', current: true }]}
      apart={[{ label: 'B', current: true }]}
      position="p"
      help={{ summary: 's', children: <p>x</p> }}
    />,
    <details>
      <ActionRow title="t" meta="m" icon="file" pill={<span>p</span>} asSummary />
    </details>,
    <ActionRow title="t" href="#a" />,
  );
  const found = new Set<string>();
  for (const element of elements) {
    for (const match of renderToStaticMarkup(element).matchAll(/class="([^"]*)"/g)) {
      for (const token of (match[1] as string).split(/\s+/))
        if (token.startsWith('lift-')) found.add(token);
    }
  }
  return found;
}

describe('the lift block in globals.css', () => {
  it('defines every lift- class the components can write, in every variant', () => {
    const found = renderedLiftClasses();
    expect(found.size).toBeGreaterThan(60);
    // The step bar's "Now:" headline is drawn by the WP-F1B block, which overrides the step bar layout.
    const f1b = css.slice(css.indexOf('/* WP-F1B '), css.indexOf('/* end WP-F1B */'));
    const missing = [...found].filter(
      (token) => !new RegExp(`\\.${token}(?![a-z0-9-])`).test(`${block}${f1b}`),
    );
    expect(missing).toEqual([]);
  });

  it('is flat and uses tokens only: no colour of its own, no shadow, gradient or see-through ground', () => {
    const own = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(own).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(own).not.toMatch(/\b(?:rgb|rgba|hsl|hsla)\(/);
    expect(own).not.toMatch(/gradient\(|box-shadow|text-shadow|backdrop-filter|filter:|opacity/);
    expect(own).not.toMatch(/transition|animation/);
    expect(own).not.toMatch(/!important/);
  });

  it('keeps the touch targets: the row and the folds are 44px or more, the action row 56px', () => {
    expect(block).toMatch(/\.lift-action \{[^}]*min-height: 56px;/s);
    expect(block).toMatch(/\.lift-row-more > summary \{[^}]*min-height: 44px;/s);
    expect(block).toMatch(/\.lift-help > summary \{[^}]*min-height: 44px;/s);
    expect(block).toMatch(/\.lift-tile \{[^}]*min-height: 44px;/s);
  });

  it('ends the file with the three package blocks, each with its start and end line, in order', () => {
    const tail = css.slice(css.indexOf('/* WP-LIFT-A'));
    const order = [
      '/* WP-LIFT-A ',
      '/* end WP-LIFT-A */',
      '/* WP-LIFT-B ',
      '/* end WP-LIFT-B */',
      '/* WP-LIFT-C ',
      '/* end WP-LIFT-C */',
    ].map((marker) => tail.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Nothing but a later pass's own whole blocks (WP-PLAIN-..., WP-LP1, WP-TS1, WP-P6, WP-F1A to C, WP-RT1, WP-CI, each closed by its own end line)
    // comes after the last Lift block, so a package never edits another's lines.
    const afterLast = tail.slice(
      tail.indexOf('/* end WP-LIFT-C */') + '/* end WP-LIFT-C */'.length,
    );
    const withoutPlain = afterLast.replace(
      /\/\* WP-(?:PLAIN-[A-Z0-9]+|LP[0-9]+|TS[0-9]+|P[0-9]+|F[0-9]+[A-Z]?|RT[0-9]+|CI) [\s\S]*?\/\* end WP-(?:PLAIN-[A-Z0-9]+|LP[0-9]+|TS[0-9]+|P[0-9]+|F[0-9]+[A-Z]?|RT[0-9]+|CI) \*\//g,
      '',
    );
    expect(withoutPlain.trim()).toBe('');
    expect(css.match(/\/\* WP-LIFT-A /g)).toHaveLength(1);
  });
});

describe('AboutDisclosure (the 30-word rule, Owner, 5 Nov 2026)', () => {
  it('is a closed native fold: its name is the only text shown, the words stay in the markup', () => {
    const host = render(
      <AboutDisclosure summary="About This">
        <p>Preparing a file is not the same as submitting it.</p>
      </AboutDisclosure>,
    );
    const details = host.querySelector('details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.className).toBe('lift-help lift-about');
    expect(details?.querySelector('summary')?.textContent).toBe('About This');
    expect(details?.querySelector('p')?.textContent).toBe(
      'Preparing a file is not the same as submitting it.',
    );
    // Closed by default and no inline style, so nothing is shown or hidden by hand.
    expect(host.innerHTML).not.toContain('style=');
  });

  it('takes an extra class for the page that uses it', () => {
    const host = render(
      <AboutDisclosure summary="About This Case" className="case-journey-reminder">
        <p>Words.</p>
      </AboutDisclosure>,
    );
    expect(host.querySelector('details')?.className).toBe(
      'lift-help lift-about case-journey-reminder',
    );
  });

  it('is axe clean', async () => {
    expect(
      await axeViolations(
        renderToStaticMarkup(
          <AboutDisclosure summary="About This">
            <p>Words.</p>
          </AboutDisclosure>,
        ),
      ),
    ).toEqual([]);
  });
});

describe('NextStepPanel why (the 30-word rule)', () => {
  it('keeps the reason under "Why This Step", after the one button, and shows nothing without one', () => {
    const withWhy = render(
      <NextStepPanel
        kicker="Next Step"
        kickerId="x"
        title="Fix 4 required items"
        body="First to fix: Income Tax Return."
        action={{ label: 'See What Needs Fixing', href: '#readiness' }}
        why={<p>Some required items are missing, out of date or do not match.</p>}
      />,
    );
    const details = withWhy.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('Why This Step');
    expect(details?.textContent).toContain('Some required items are missing');
    const button = withWhy.querySelector('.btn-primary');
    expect(
      (button?.compareDocumentPosition(details as Node) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const without = render(
      <NextStepPanel
        kicker="Next Step"
        kickerId="y"
        title="Do this"
        action={{ label: 'Go', href: '#x' }}
      />,
    );
    expect(without.querySelector('details')).toBeNull();
  });
});
