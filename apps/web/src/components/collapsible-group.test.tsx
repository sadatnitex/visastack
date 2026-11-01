// @vitest-environment jsdom
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { axeViolations } from '../lib/axe.test-support';
import { CollapsibleGroup, CollapsibleGroups } from './collapsible-group';

function render(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(element);
  return host;
}

const groups = [
  { key: 'travel', title: 'Travel Documents', count: 12, content: <p>Passport</p> },
  { key: 'money', title: 'Money and Work', count: 1, content: <p>Bank statement</p> },
  { key: 'other', title: 'Everything Else', content: <p>Photo</p> },
];

describe('CollapsibleGroup', () => {
  it('puts the count in the title, spoken with its noun', () => {
    const host = render(
      <CollapsibleGroup
        title="Travel Documents"
        count={12}
        noun={{ one: 'document', other: 'documents' }}
      >
        <p>Passport</p>
      </CollapsibleGroup>,
    );
    const summary = host.querySelector('summary');
    expect(summary?.querySelector('.collapsible-group-title')?.textContent).toBe(
      'Travel Documents',
    );
    expect(summary?.querySelector('.collapsible-group-count')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
    expect(summary?.textContent).toBe('Travel Documents12, 12 documents');
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it('opens when asked and counts one item in the singular', () => {
    const host = render(
      <CollapsibleGroup title="Money and Work" count={1} open>
        <p>Bank statement</p>
      </CollapsibleGroup>,
    );
    expect(host.querySelector('details')?.hasAttribute('open')).toBe(true);
    expect(host.querySelector('.sr-only')?.textContent).toBe(', 1 item');
  });
});

describe('CollapsibleGroups', () => {
  const openKeys = (host: HTMLElement) =>
    [...host.querySelectorAll('details')].map((d) => d.hasAttribute('open'));

  it('opens the first group only', () => {
    expect(openKeys(render(<CollapsibleGroups groups={groups} />))).toEqual([true, false, false]);
  });

  it('opens the group a link names instead, and ignores a name that is not there', () => {
    expect(openKeys(render(<CollapsibleGroups groups={groups} openKey="money" />))).toEqual([
      false,
      true,
      false,
    ]);
    expect(openKeys(render(<CollapsibleGroups groups={groups} openKey="gone" />))).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('gives each group an id a link can point at, and leaves the count out when there is none', () => {
    const host = render(<CollapsibleGroups groups={groups} idPrefix="docs" />);
    expect([...host.querySelectorAll('details')].map((d) => d.id)).toEqual([
      'docs-travel',
      'docs-money',
      'docs-other',
    ]);
    expect(host.querySelector('#docs-other .collapsible-group-count')).toBeNull();
  });

  it('passes the automated accessibility rules', async () => {
    expect(
      await axeViolations(renderToStaticMarkup(<CollapsibleGroups groups={groups} />)),
    ).toEqual([]);
  });
});
