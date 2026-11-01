// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { axeViolations } from '../../../../lib/axe.test-support';
import { QueuePaging, queueCount } from './queue-paging';
import { type QueueItem, QueuePanel } from './queue-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** WP-SB6: the staff queue box (filters, fixed box, back to the top on a new load) and its paging. */

const items = (count: number, offset = 0): QueueItem[] =>
  Array.from({ length: count }, (_, n) => ({
    id: `row-${offset + n}`,
    find: `document-${offset + n}.pdf timed out`,
    kind: n % 2 === 0 ? 'ocr_timeout' : 'scan_failed',
    className: 'failed-job-row',
    node: <span className="row-key">{`document-${offset + n}.pdf`}</span>,
  }));

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string): void {
  const proto = element instanceof HTMLInputElement ? HTMLInputElement : HTMLSelectElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(element, value);
  element.dispatchEvent(
    new Event(element instanceof HTMLInputElement ? 'input' : 'change', { bubbles: true }),
  );
}

let host: HTMLDivElement | null = null;
afterEach(() => {
  host?.remove();
  host = null;
  window.location.hash = '';
});

function mount(): { host: HTMLDivElement; root: ReturnType<typeof createRoot> } {
  host = document.createElement('div');
  document.body.append(host);
  return { host, root: createRoot(host) };
}

describe('QueuePanel', () => {
  it('draws every row of the load inside a named, focusable box that scrolls', () => {
    const html = renderToStaticMarkup(
      <QueuePanel id="q" label="Failed Intake Jobs" items={items(50)} pageKey="first" />,
    );
    expect(html).toContain(
      '<section class="activity-log-scroll staff-queue-panel" id="q" aria-label="Failed Intake Jobs" tabindex="0">',
    );
    expect(html.match(/class="row failed-job-row"/g) ?? []).toHaveLength(50);
    expect(html).toContain('Find in This List');
  });

  it('finds rows by their words and by kind, and says how many of this load match', async () => {
    const { host: box, root } = mount();
    await act(async () => {
      root.render(
        <QueuePanel id="q" label="Queue" items={items(10)} pageKey="first" kindLabel="Error" />,
      );
    });
    const search = box.querySelector('input[type="search"]') as HTMLInputElement;
    await act(async () => setValue(search, 'document-3.pdf'));
    expect(box.querySelectorAll('li.row')).toHaveLength(1);
    expect(box.textContent).toContain('1 of the 10 rows in this load match.');
    await act(async () => setValue(search, ''));
    const kind = box.querySelector('select') as HTMLSelectElement;
    expect(box.textContent).toContain('Error');
    await act(async () => setValue(kind, 'scan_failed'));
    expect(box.querySelectorAll('li.row')).toHaveLength(5);
    await act(async () => setValue(search, 'nothing like this'));
    expect(box.textContent).toContain('Nothing in this load matches.');
    await act(async () => root.unmount());
  });

  it('scrolls back to its top and takes focus when the next load arrives at its anchor', async () => {
    const { host: box, root } = mount();
    await act(async () => {
      root.render(<QueuePanel id="q" label="Queue" items={items(50)} pageKey="first" />);
    });
    const panel = box.querySelector('section') as HTMLElement;
    panel.scrollTop = 900;
    window.location.hash = '#q';
    await act(async () => {
      root.render(<QueuePanel id="q" label="Queue" items={items(50, 50)} pageKey="CURSOR_2" />);
    });
    expect(panel.scrollTop).toBe(0);
    expect(document.activeElement).toBe(panel);
    await act(async () => root.unmount());
  });

  it('has no serious accessibility problems', async () => {
    const html = renderToStaticMarkup(
      <div>
        <QueuePanel id="q" label="Queue" items={items(5)} pageKey="first" />
        <QueuePaging
          pathname="/app/admin"
          search={{}}
          param="jobsBefore"
          cursor="NEXT"
          later
          landOn="q"
          shown={5}
          total={20}
          noun={{ one: 'failed job', other: 'failed jobs' }}
        />
      </div>,
    );
    const problems = await axeViolations(html);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

describe('QueuePaging', () => {
  const noun = { one: 'email', other: 'emails' };

  it('says whether a load is the first or a later one, since rows are replaced, not added', () => {
    expect(queueCount({ shown: 50, total: 1000, noun, later: false, direction: 'older' })).toBe(
      'Showing the newest 50 of 1000 emails.',
    );
    expect(queueCount({ shown: 50, total: 1000, noun, later: true, direction: 'older' })).toBe(
      'Showing 50 older emails, of 1000.',
    );
    expect(queueCount({ shown: 50, total: 1000, noun, later: false, direction: 'next' })).toBe(
      'Showing the first 50 of 1000 emails.',
    );
    expect(queueCount({ shown: 50, total: 1000, noun, later: true, direction: 'next' })).toBe(
      'Showing 50 more emails, of 1000.',
    );
    expect(queueCount({ shown: 3, total: 3, noun, later: false, direction: 'older' })).toBe(
      'Showing all 3 emails.',
    );
  });

  it('links to the next load and back to the first, keeping the rest of the address', () => {
    const html = renderToStaticMarkup(
      <QueuePaging
        pathname="/app/admin/email"
        search={{ waitingAfter: 'W2' }}
        param="failedBefore"
        cursor="F3"
        later
        landOn="email-failed-panel"
        shown={50}
        total={120}
        noun={noun}
      />,
    );
    expect(html).toContain(
      'href="/app/admin/email?waitingAfter=W2&amp;failedBefore=F3#email-failed-panel"',
    );
    expect(html).toContain('href="/app/admin/email?waitingAfter=W2#email-failed-panel"');
    expect(html).toContain('Show Older Entries');
    expect(html).toContain('Show Newest Entries');
    expect(html).toContain('<output');
  });
});
