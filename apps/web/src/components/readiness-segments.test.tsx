// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import {
  AFTER_STEP_LABEL,
  NOW_LABEL,
  RING_TIP_LABEL,
  RING_TIP_TEXT,
  type ReadinessSegmentItem,
  ReadinessSegmentRing,
  segmentRingCounts,
} from './readiness-segments';
import { NextStepPanel } from './ui-lift';

const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
const block = css.slice(css.indexOf('/* WP-PIC4'), css.indexOf('/* end WP-PIC4 */'));

function render(node: React.ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(node);
  document.body.append(host);
  return host;
}

const items: ReadinessSegmentItem[] = [
  { key: 'passport', label: 'Passport', type: 'passport', ready: true },
  { key: 'photo', label: 'Photo', type: 'photo', ready: true },
  { key: 'bank', label: 'Bank Statement', type: 'bank_statement', ready: false },
  { key: 'letter', label: 'Cover Letter', type: 'cover_letter', ready: false },
];

describe('ReadinessSegmentRing', () => {
  it('draws one segment per required item and fills the ready ones, same counts as the ring', () => {
    const host = render(<ReadinessSegmentRing done={2} total={4} items={items} />);
    expect(host.querySelectorAll('.readiness-seg')).toHaveLength(4);
    expect(host.querySelectorAll('.readiness-seg-on')).toHaveLength(2);
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('2 of 4 items ready');
  });

  it('never draws more filled segments than there are items, and clamps a negative count', () => {
    expect(segmentRingCounts(9, 4)).toEqual({ done: 4, total: 4 });
    expect(segmentRingCounts(-2, 4)).toEqual({ done: 0, total: 4 });
    expect(segmentRingCounts(1, 0)).toEqual({ done: 0, total: 0 });
  });

  it('lists each item with its picture and says ready or still needed in words, not colour alone', () => {
    const host = render(<ReadinessSegmentRing done={2} total={4} items={items} />);
    const rows = [...host.querySelectorAll('.readiness-legend-row')];
    expect(rows).toHaveLength(4);
    expect(rows[0]?.textContent).toContain('Passport');
    expect(rows[0]?.textContent).toContain('Ready');
    expect(rows[2]?.textContent).toContain('Bank Statement');
    expect(rows[2]?.textContent).toContain('Still Needed');
    for (const row of rows) expect(row.querySelector('.pic')).not.toBeNull();
  });

  it('passes only a document type to the pictures, never anything else', () => {
    const html = renderToStaticMarkup(<ReadinessSegmentRing done={1} total={4} items={items} />);
    expect(html).not.toMatch(/data:|blob:/);
  });

  it('explains in one sentence that the ring counts what is ready, not approval', () => {
    const host = render(<ReadinessSegmentRing done={2} total={4} items={items} />);
    expect(RING_TIP_TEXT.split(/\s+/).length).toBeLessThanOrEqual(20);
    expect(RING_TIP_TEXT).toMatch(/not whether a visa will be approved/);
    expect(host.querySelector('.explain-tip')).not.toBeNull();
    expect(host.textContent).toContain(RING_TIP_LABEL);
    expect(host.textContent).not.toMatch(/approved\b(?!\.)/);
  });

  it('teaches what to do first when there is nothing to count, with no invented number', () => {
    const host = render(
      <ReadinessSegmentRing
        done={0}
        total={0}
        emptyAction={{ href: '/app/cases', label: 'Pick a Checklist' }}
      />,
    );
    expect(host.querySelectorAll('.readiness-seg')).toHaveLength(0);
    expect(host.textContent).toContain('Pick a checklist to see what is ready');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('/app/cases');
    expect(host.textContent).not.toMatch(/\d+ of \d+/);
  });

  it('falls back to the plain ring for a very long checklist, so segments never turn to slivers', () => {
    const host = render(<ReadinessSegmentRing done={10} total={40} />);
    expect(host.querySelectorAll('.readiness-seg')).toHaveLength(0);
    expect(host.querySelector('.progress-ring-fill')).not.toBeNull();
  });

  it('has no accessibility violations', async () => {
    const host = render(<ReadinessSegmentRing done={2} total={4} items={items} />);
    expect(await axeViolations(host)).toEqual([]);
  });
});

describe('NextStepPanel before and after ring (opt-in)', () => {
  const base = {
    kicker: 'Next Step',
    kickerId: 'ns-heading',
    title: 'Add your Bank Statement',
    action: { label: 'Add Document', href: '/app/vault' },
  } as const;

  it('renders exactly as before when the option is not asked for', () => {
    const host = render(<NextStepPanel {...base} />);
    expect(host.querySelector('.lift-next-hero')).toBeNull();
    expect(host.querySelector('.progress-ring')).toBeNull();
  });

  it('shows the ring now and after the step, with the step document picture as the hero', () => {
    const host = render(
      <NextStepPanel
        {...base}
        beforeAfter={{ done: 2, total: 4, documentType: 'bank_statement' }}
      />,
    );
    const hero = host.querySelector('.lift-next-hero');
    expect(hero?.className).toContain('pic-depth');
    expect(hero?.querySelector('.pic-glow .pic')).not.toBeNull();
    const labels = [...host.querySelectorAll('.progress-ring svg')].map((s) =>
      s.getAttribute('aria-label'),
    );
    expect(labels).toEqual(['2 of 4 items ready', '3 of 4 items ready']);
    expect(host.textContent).toContain(NOW_LABEL);
    expect(host.textContent).toContain(AFTER_STEP_LABEL);
  });

  it('is the one animated hero and uses only the shared motion class', () => {
    const html = renderToStaticMarkup(
      <NextStepPanel {...base} beforeAfter={{ done: 1, total: 3, documentType: 'passport' }} />,
    );
    expect(html.match(/pic-float/g)).toHaveLength(1);
  });

  it('shows nothing when there is no checklist or nothing left to do (no invented number)', () => {
    for (const ring of [
      { done: 0, total: 0, documentType: 'passport' },
      { done: 4, total: 4, documentType: 'passport' },
    ]) {
      const host = render(<NextStepPanel {...base} beforeAfter={ring} />);
      expect(host.querySelector('.lift-next-hero')).toBeNull();
    }
  });

  it('works inside the dark ink panel and has no accessibility violations', async () => {
    const host = render(
      <NextStepPanel
        {...base}
        variant="ink"
        beforeAfter={{ done: 2, total: 4, documentType: 'bank_statement' }}
      />,
    );
    expect(host.querySelector('.lift-next-ink .lift-next-hero')).not.toBeNull();
    expect(await axeViolations(host)).toEqual([]);
  });
});

describe('WP-PIC4 stylesheet block', () => {
  it('exists, is flat, and keeps depth to the picture classes', () => {
    expect(block.length).toBeGreaterThan(50);
    expect(block).not.toMatch(
      /box-shadow|drop-shadow|text-shadow|gradient|animation|transition|@keyframes/,
    );
    expect(block).not.toContain(String.fromCodePoint(0x2014));
  });
  it('keeps 44 px targets for legend rows', () => {
    expect(block).toMatch(/min-height:\s*2\.75rem/);
  });
});
