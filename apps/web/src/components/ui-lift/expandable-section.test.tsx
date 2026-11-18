// @vitest-environment jsdom
import { act } from 'react';
import { type Root, createRoot, hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axeViolations } from '../../lib/axe.test-support';
import { StatusPicture } from '../pictures/status-picture';
import { ExpandableSection, type ExpandableSectionProps } from './expandable-section';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root | undefined;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container.remove();
  vi.restoreAllMocks();
});

const base: ExpandableSectionProps = {
  title: 'Passport Details',
  summary: '3 of 5 added',
  picture: <svg viewBox="0 0 10 10" />,
  status: <StatusPicture kind="backed" />,
  children: <p>Inside the section.</p>,
};

function details(): HTMLDetailsElement {
  const element = container.querySelector('details');
  if (!element) throw new Error('no details');
  return element;
}

/** What a person does: the browser flips `open` and fires its toggle event. */
function personToggles(open: boolean) {
  act(() => {
    details().open = open;
    details().dispatchEvent(new Event('toggle'));
  });
}

describe('ExpandableSection', () => {
  it('draws the closed row: picture, name as a heading, summary, chevron; content below', () => {
    container.innerHTML = renderToString(<ExpandableSection {...base} />);
    const element = details();
    expect(element.open).toBe(false);
    const summary = element.querySelector(':scope > summary');
    expect(summary?.querySelector('h3')?.textContent).toBe('Passport Details');
    expect(summary?.querySelector('.expandable-section-summary')?.textContent).toBe('3 of 5 added');
    expect(summary?.querySelector('.expandable-section-picture')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(summary?.querySelector('.expandable-section-chevron')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(element.querySelector(':scope > .expandable-section-body')?.textContent).toBe(
      'Inside the section.',
    );
  });

  it('keeps the status picture beside the toggle, never inside it', () => {
    container.innerHTML = renderToString(<ExpandableSection {...base} />);
    const summary = container.querySelector('summary');
    expect(summary?.querySelector('button, a, input, select, textarea')).toBeNull();
    const status = container.querySelector('.expandable-section > .expandable-section-status');
    expect(status?.querySelector('button.explain-tip-trigger')?.textContent).toBe(
      'Backed by a Document',
    );
    expect(details().contains(status ?? null)).toBe(false);
  });

  it('pressing the status picture opens its note and does not toggle the section', () => {
    root = createRoot(container);
    act(() => root?.render(<ExpandableSection {...base} />));
    const onToggle = vi.fn();
    details().addEventListener('toggle', onToggle);
    act(() => container.querySelector<HTMLButtonElement>('.explain-tip-trigger')?.click());
    expect(details().open).toBe(false);
    expect(onToggle).not.toHaveBeenCalled();
    expect(container.querySelector('.explain-tip-popup')?.hasAttribute('hidden')).toBe(false);
  });

  it('takes the heading level the page needs', () => {
    container.innerHTML = renderToString(<ExpandableSection {...base} headingLevel={2} />);
    expect(container.querySelector('summary h2')?.textContent).toBe('Passport Details');
    expect(container.querySelector('summary h3')).toBeNull();
  });

  it('leaves out empty slots', () => {
    container.innerHTML = renderToString(
      <ExpandableSection title="Only a Name">
        <p>x</p>
      </ExpandableSection>,
    );
    expect(container.querySelector('.expandable-section-picture')).toBeNull();
    expect(container.querySelector('.expandable-section-summary')).toBeNull();
    expect(container.querySelector('.expandable-section-status')).toBeNull();
  });

  it('server and browser draw the same first state, open or closed, with no hydration error', () => {
    for (const defaultOpen of [false, true]) {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const props = { ...base, defaultOpen, remember: true };
      container.innerHTML = renderToString(<ExpandableSection {...props} />);
      expect(details().open).toBe(defaultOpen);
      act(() => {
        root = hydrateRoot(container, <ExpandableSection {...props} />);
      });
      expect(details().open).toBe(defaultOpen);
      expect(errors).not.toHaveBeenCalled();
      act(() => root?.unmount());
      root = undefined;
      container.innerHTML = '';
      errors.mockRestore();
    }
  });

  it('remember: keeps the state the person chose before the script arrived', () => {
    container.innerHTML = renderToString(<ExpandableSection {...base} remember />);
    details().open = true; // the person opened it before hydration: no event reached React
    act(() => {
      root = hydrateRoot(container, <ExpandableSection {...base} remember />);
    });
    act(() => root?.render(<ExpandableSection {...base} remember title="Passport Details" />));
    expect(details().open).toBe(true);
  });

  it('remember: a later draw with another first state never overrides the person', () => {
    root = createRoot(container);
    act(() => root?.render(<ExpandableSection {...base} remember defaultOpen />));
    personToggles(false);
    act(() => root?.render(<ExpandableSection {...base} remember defaultOpen={false} />));
    act(() => root?.render(<ExpandableSection {...base} remember defaultOpen />));
    expect(details().open).toBe(false);
  });

  it('without remember the section follows the page', () => {
    root = createRoot(container);
    act(() => root?.render(<ExpandableSection {...base} />));
    expect(details().open).toBe(false);
    act(() => root?.render(<ExpandableSection {...base} defaultOpen />));
    expect(details().open).toBe(true);
  });

  it('passes axe open and closed, with picture and status', async () => {
    for (const defaultOpen of [false, true]) {
      const html = renderToString(
        <section aria-label="Test">
          <ExpandableSection {...base} id="passport" defaultOpen={defaultOpen} />
          <ExpandableSection
            title="How This Was Checked"
            summary="Read from a file, you confirmed it"
          >
            <p>Second section.</p>
          </ExpandableSection>
        </section>,
      );
      expect(await axeViolations(html)).toEqual([]);
    }
  });
});
