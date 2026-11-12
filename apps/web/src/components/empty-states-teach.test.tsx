import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { catalogueEnglishByKey } from '../lib/catalogue-en.test-support';
import { EmptyState } from './ui';

/**
 * The empty states on the main lists teach: what the place is for and the one next step (the
 * body), why doing it helps (the `why` line), and the button that does it (the action).
 */

const root = join(__dirname, '..');
// A `t('key')` call stands for its English catalogue text, so a title or line that moved out of a
// page into a message catalogue is still read in the place it appears.
const CATALOGUE_TEXT = catalogueEnglishByKey();
const read = (path: string) =>
  readFileSync(join(root, path), 'utf8').replace(
    /\bt\(\s*'([^']+)'\s*(?:,\s*\{[^}]*\})?\s*\)/g,
    (call, key: string) => CATALOGUE_TEXT.get(key) ?? call,
  );

/** The catalogue keys whose English message is this title (a converted page names its title by key). */
function keysFor(title: string): string[] {
  const dir = join(root, 'i18n');
  const keys: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
    const text = readFileSync(join(dir, file), 'utf8');
    for (const match of text.matchAll(/'([A-Za-z0-9.]+)':\s*'([^']*)'/g)) {
      if (match[2] === title && match[1]) keys.push(match[1]);
    }
  }
  return keys;
}

/** The text of the `<EmptyState ...>...</EmptyState>` that carries this title, or its catalogue key. */
function stateWithTitle(source: string, title: string): string {
  const parts = source.split('<EmptyState');
  const needles = [title, ...keysFor(title).map((key) => `t('${key}'`)];
  const found = parts.find((part) => {
    const head = part.slice(0, part.indexOf('</EmptyState>'));
    // The formatter may wrap a long call onto several lines, so compare without whitespace too.
    const squeezed = head.replace(/\s+/g, '');
    return needles.some((needle) => head.includes(needle) || squeezed.includes(needle));
  });
  if (!found) throw new Error(`no empty state titled "${title}"`);
  return found.slice(0, found.indexOf('</EmptyState>'));
}

const MAIN_LISTS: readonly (readonly [string, string, string])[] = [
  ['Documents', 'components/document-wallet-browser.tsx', 'No Documents Yet'],
  ['Cases', 'app/app/applicant/[id]/missions/page.tsx', 'No Cases Yet'],
  ['Active case on the person page', 'app/app/applicant/[id]/page.tsx', 'No Active Case Yet'],
  ['Shared with me', 'app/app/shared/(list)/page.tsx', 'Nothing Shared with You Yet'],
  ['Notifications', 'app/app/notifications/page.tsx', 'No Notifications Yet'],
  ['Requests (traveller)', 'app/app/applicant/[id]/evidence/page.tsx', 'No Evidence Requests'],
  ['Agency cases tab', 'app/app/agency/[orgId]/cases/page.tsx', 'No Cases Yet'],
  ['Agency dashboard', 'app/app/agency/[orgId]/page.tsx', 'No Cases Yet'],
  ['Agency clients', 'app/app/agency/[orgId]/clients/page.tsx', 'No Clients Invited Yet'],
  ['Agency requests', 'app/app/agency/[orgId]/clients/page.tsx', 'No Evidence Requests Yet'],
  ['Home people', 'app/app/(home)/page.tsx', 'No Travellers Yet'],
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
      ['app/app/applicant/[id]/missions/page.tsx', '#start-case'],
      ['app/app/agency/[orgId]/clients/page.tsx', '#invite-client'],
      ['app/app/agency/[orgId]/clients/page.tsx', '#ask-for-evidence'],
    ] as const) {
      expect(read(path), `${path} ${target}`).toContain(target);
    }
    // The empty document list opens the Add Documents page itself (UX17), not a card on this page.
    expect(read('components/document-wallet-browser.tsx')).toContain('/documents/add');
    expect(read('app/app/applicant/[id]/missions/page.tsx')).toContain('id="start-case"');
    const clients = read('app/app/agency/[orgId]/clients/page.tsx');
    expect(clients).toContain('id="invite-client"');
    expect(clients).toContain('id="ask-for-evidence"');
    expect(read('app/app/mission/[id]/case-rail.tsx')).toContain('id="pack"');
  });
});
