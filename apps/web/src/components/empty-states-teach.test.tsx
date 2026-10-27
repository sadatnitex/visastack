import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './ui';

/**
 * The empty states on the main lists teach: what the place is for and the one next step (the
 * body), why doing it helps (the `why` line), and the button that does it (the action).
 */

const root = join(__dirname, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** The text of the `<EmptyState ...>...</EmptyState>` that carries this title. */
function stateWithTitle(source: string, title: string): string {
  const parts = source.split('<EmptyState');
  const found = parts.find((part) => part.slice(0, part.indexOf('</EmptyState>')).includes(title));
  if (!found) throw new Error(`no empty state titled "${title}"`);
  return found.slice(0, found.indexOf('</EmptyState>'));
}

const MAIN_LISTS: readonly (readonly [string, string, string])[] = [
  ['Documents', 'components/document-wallet-browser.tsx', 'No Documents Yet'],
  ['Cases', 'app/app/applicant/[id]/missions/page.tsx', 'No Cases Yet'],
  ['Active case on the person page', 'app/app/applicant/[id]/page.tsx', 'No Active Case Yet'],
  ['Shared with me', 'app/app/shared/page.tsx', 'Nothing Shared with You Yet'],
  ['Notifications', 'app/app/notifications/page.tsx', 'No Alerts Yet'],
  ['Requests (traveller)', 'app/app/applicant/[id]/evidence/page.tsx', 'No Evidence Requests'],
  ['Agency cases tab', 'app/app/agency/[orgId]/cases/page.tsx', 'No Cases Yet'],
  ['Agency dashboard', 'app/app/agency/[orgId]/page.tsx', 'No Cases Yet'],
  ['Agency clients', 'app/app/agency/[orgId]/clients/page.tsx', 'No Clients Invited Yet'],
  ['Agency requests', 'app/app/agency/[orgId]/clients/page.tsx', 'No Evidence Requests Yet'],
  ['Home people', 'app/app/page.tsx', 'No Applicants Yet'],
];

describe('EmptyState', () => {
  it('shows the why line between the body and the button, and nothing when there is none', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        title="No Documents Yet"
        why="You add each paper once."
        action={{ href: '#add', label: 'Add a Document' }}
      >
        This is your vault.
      </EmptyState>,
    );
    expect(html.indexOf('This is your vault.')).toBeLessThan(
      html.indexOf('You add each paper once.'),
    );
    expect(html.indexOf('You add each paper once.')).toBeLessThan(html.indexOf('Add a Document'));
    expect(html).toContain('<p class="empty-state-why">You add each paper once.</p>');
    const bare = renderToStaticMarkup(<EmptyState title="Nothing here">A reason.</EmptyState>);
    expect(bare).not.toContain('empty-state-why');
  });
});

describe.each(MAIN_LISTS)('the %s empty state teaches', (_name, path, title) => {
  const block = stateWithTitle(read(path), title);

  it('says why the next step helps', () => {
    expect(block).toMatch(/why[=:]/);
  });

  it('offers the button that takes the next step', () => {
    expect(block).toMatch(/action[=:]/);
  });

  it('keeps to plain words: no engineering talk and no decision language', () => {
    expect(block).not.toMatch(
      /\b(approved|cleared|accepted|guarantee[ds]?|mission|API|database)\b/i,
    );
  });
});

describe('the buttons point at something on the page that exists', () => {
  it('has each in-page target defined next to the place it leads to', () => {
    for (const [path, target] of [
      ['components/document-wallet-browser.tsx', '#add-document'],
      ['app/app/applicant/[id]/missions/page.tsx', '#start-case'],
      ['app/app/agency/[orgId]/clients/page.tsx', '#invite-client'],
      ['app/app/agency/[orgId]/clients/page.tsx', '#ask-for-evidence'],
    ] as const) {
      expect(read(path), `${path} ${target}`).toContain(target);
    }
    expect(read('app/app/applicant/[id]/documents/page.tsx')).toContain('id="add-document"');
    expect(read('app/app/applicant/[id]/missions/page.tsx')).toContain('id="start-case"');
    const clients = read('app/app/agency/[orgId]/clients/page.tsx');
    expect(clients).toContain('id="invite-client"');
    expect(clients).toContain('id="ask-for-evidence"');
    expect(read('app/app/mission/[id]/page.tsx')).toContain('id="pack"');
  });
});
