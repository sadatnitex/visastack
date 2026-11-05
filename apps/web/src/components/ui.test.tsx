import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AttentionList, Checklist, Disclosure, EmptyState, NextStepCard, StatusBadge } from './ui';

describe('StatusBadge', () => {
  it('puts the tone in the class so the stylesheet can add a mark as well as a colour', () => {
    expect(renderToStaticMarkup(<StatusBadge tone="danger">Overdue</StatusBadge>)).toBe(
      '<span class="badge badge-danger">Overdue</span>',
    );
  });
});

describe('NextStepCard', () => {
  it('names the step, says why, and links to where it is done', () => {
    const html = renderToStaticMarkup(
      <NextStepCard
        title="Answer an evidence request"
        why="An agency is waiting for a document."
        href="/app/applicant/a1/evidence"
        action="Open request"
      />,
    );
    expect(html).toContain('Answer an evidence request');
    expect(html).toContain('An agency is waiting for a document.');
    expect(html).toContain('href="/app/applicant/a1/evidence"');
    expect(html).toContain('aria-labelledby="next-step-title"');
  });
});

describe('AttentionList', () => {
  it('renders one link per item with its count, and hides the chevron from screen readers', () => {
    const html = renderToStaticMarkup(
      <AttentionList
        items={[
          { key: 'a', href: '/x', label: 'Two documents', detail: 'Asha Rahman', count: 2 },
          { key: 'b', href: '/y', label: 'One invitation' },
        ]}
      />,
    );
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('badge badge-warning');
    expect(html).toContain('Asha Rahman');
    expect(html).toContain('aria-hidden="true"');
  });
});

describe('EmptyState and Disclosure', () => {
  it('explains an empty area and offers the next action', () => {
    const html = renderToStaticMarkup(
      <EmptyState title="No Documents Yet" action={{ href: '/up', label: 'Add a Document' }}>
        Papers you reuse across applications live here.
      </EmptyState>,
    );
    expect(html).toContain('No Documents Yet');
    expect(html).toContain('href="/up"');
  });

  it('keeps secondary detail inside a native details element', () => {
    const html = renderToStaticMarkup(
      <Disclosure title="Permissions" hint="2 of 6 on">
        body
      </Disclosure>,
    );
    expect(html).toContain('<details class="disclosure">');
    expect(html).toContain('2 of 6 on');
  });
});

describe('Checklist', () => {
  const html = renderToStaticMarkup(
    <Checklist
      title="Set Up Your Account"
      items={[
        { key: 'a', label: 'Allow processing', done: true, href: '#permissions' },
        {
          key: 'b',
          label: 'Add an Applicant',
          hint: 'Start with yourself',
          done: false,
          href: '/app/applicants',
        },
      ]}
    />,
  );

  it('says how far along the person is', () => {
    expect(html).toContain('1 of 2 done');
  });

  it('links only the steps still to do, and marks finished ones as done for screen readers', () => {
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/app/applicants"');
    expect(html).toContain('Start with yourself');
    expect(html).toContain('<span class="sr-only">Done</span>');
  });
});

describe('EmptyState icon', () => {
  it('always shows an icon, a folder when none is given, so an empty list never reads as broken', () => {
    const plain = renderToStaticMarkup(<EmptyState title="Nothing here">A reason.</EmptyState>);
    expect(plain).toContain('icon-tile');
    expect(plain).toContain('<svg');
    const named = renderToStaticMarkup(
      <EmptyState title="No Alerts Yet" icon="bell">
        A reason.
      </EmptyState>,
    );
    expect(named).toContain('icon-tile');
    expect(named).not.toBe(plain);
  });
});

describe('EmptyState fold and the Next Step reason (the 30-word rule, Owner, 5 Nov 2026)', () => {
  it('keeps only the title and the button visible when folded, with the sentences under About This', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No Notifications Yet"
        why="You never have to open every case."
        action={{ href: '/app', label: 'Go to Home' }}
        fold
      >
        This is where VisaStack tells you what needs you.
      </EmptyState>,
    );
    const open = html.indexOf('<details');
    const close = html.indexOf('</details>');
    expect(open).toBeGreaterThan(html.indexOf('empty-state-title'));
    expect(html.slice(open, close)).toContain('This is where VisaStack tells you what needs you.');
    expect(html.slice(open, close)).toContain('You never have to open every case.');
    expect(html.slice(open, close)).toContain('<summary>About This</summary>');
    expect(html.indexOf('Go to Home')).toBeGreaterThan(close);
    // Not folded by default: the sentences are on the page as before.
    expect(
      renderToStaticMarkup(<EmptyState title="No Alerts Yet">A reason.</EmptyState>),
    ).not.toContain('<details');
  });

  it('folds the reason of a Next Step card under "Why This Step"', () => {
    const html = renderToStaticMarkup(
      <NextStepCard
        title="Add Your Essentials"
        why="0 of 12 essentials added."
        href="/x"
        action="Open"
      />,
    );
    expect(html).toContain('<summary>Why This Step</summary>');
    expect(html.indexOf('0 of 12 essentials added.')).toBeGreaterThan(
      html.indexOf('<summary>Why This Step</summary>'),
    );
  });
});
