import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaseCard, PersonCard, StartCaseTile, initialsOf, ownPhotoFor } from './home-cards';

describe('initialsOf', () => {
  it('takes the first letters of the first and last word', () => {
    expect(initialsOf('Nazmus Sadat')).toBe('NS');
    expect(initialsOf('Salma')).toBe('S');
    expect(initialsOf('  rahim  uddin  khan ')).toBe('RK');
    expect(initialsOf('')).toBe('?');
  });
});

const person = (over: Partial<Parameters<typeof PersonCard>[0]> = {}) =>
  renderToStaticMarkup(
    <ul>
      <PersonCard
        href="/app/applicant/p1"
        name="Nazmus Sadat"
        documents={7}
        cases={2}
        requests={0}
        actionNeeded={false}
        {...over}
      />
    </ul>,
  );

describe('PersonCard', () => {
  it('is one link with the face, the name and two numbers', () => {
    const html = person();
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/app/applicant/p1"');
    expect(html).toContain('>NS</span>');
    expect(html).toContain('<b>7</b> Documents');
    expect(html).toContain('<b>2</b> Cases');
    expect(html).not.toContain('Request');
    expect(html).not.toContain('badge');
  });

  it('says Action Needed when something waits, and takes the singular for one', () => {
    const html = person({ actionNeeded: true, documents: 1, cases: 1, requests: 1 });
    expect(html).toContain('Action Needed');
    expect(html).toContain('<b>1</b> Document<');
    expect(html).toContain('<b>1</b> Case<');
    expect(html).toContain('<b>1</b> Request<');
  });

  it('invites a first document for a person with none, unless something else needs them', () => {
    expect(person({ documents: 0 })).toContain('Add a Document');
    const busy = person({ documents: 0, actionNeeded: true });
    expect(busy).toContain('Action Needed');
    expect(busy).not.toContain('Add a Document');
  });
});

describe('CaseCard and the Start a Case tile', () => {
  it('shows the flag of the case country in place of the plain globe, and keeps the globe otherwise', () => {
    const withFlag = renderToStaticMarkup(
      <ul>
        <CaseCard
          href="/app/mission/c1"
          title="Tokyo"
          person="Nazmus"
          flag={
            <span role="img" aria-label="Japan">
              JP
            </span>
          }
        />
      </ul>,
    );
    expect(withFlag).toContain('aria-label="Japan"');
    expect(withFlag).not.toContain('<svg');
    const without = renderToStaticMarkup(
      <ul>
        <CaseCard href="/app/mission/c1" title="Tokyo" person="Nazmus" />
      </ul>,
    );
    expect(without).toContain('<svg');
    expect(without).toContain('aria-hidden="true"');
  });

  it('is one link with a title, a person, a chip and what is passed in', () => {
    const html = renderToStaticMarkup(
      <ul>
        <CaseCard
          href="/app/mission/c1"
          title="Singapore Visitor"
          person="Nazmus"
          badge={<span>Changed</span>}
        >
          <span>0 of 1 item ready</span>
        </CaseCard>
      </ul>,
    );
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/app/mission/c1"');
    for (const text of ['Singapore Visitor', 'Nazmus', 'Changed', '0 of 1 item ready']) {
      expect(html).toContain(text);
    }
  });

  it('leaves out the chip and the bar when there are none', () => {
    const html = renderToStaticMarkup(
      <ul>
        <CaseCard href="/app/mission/c1" title="T" person="P" />
      </ul>,
    );
    expect(html).not.toContain('home-case-badge');
    expect(html).not.toContain('home-case-progress');
  });

  it('is an open slot that links to the start of a case', () => {
    const html = renderToStaticMarkup(
      <StartCaseTile href="/app/applicant/p1/missions#start-case" />,
    );
    expect(html).toContain('href="/app/applicant/p1/missions#start-case"');
    expect(html).toContain('Start a Case');
  });
});

describe('PersonCard photo (WAL10)', () => {
  const PHOTO = '/api/photos/applicant/p1?v=abc';

  it('shows the account photo as a decorative same-origin picture, and drops the initials', () => {
    const html = person({ photoUrl: PHOTO });
    expect(html).toContain(`src="${PHOTO}"`);
    expect(html).toContain('alt=""');
    expect(html).toContain('data-photo="true"');
    expect(html).not.toContain('>NS</span>');
    expect(html).not.toMatch(/src="(https?:|data:)/);
  });

  it('shows initials when there is no photo', () => {
    const html = person({ photoUrl: null });
    expect(html).toContain('>NS</span>');
    expect(html).not.toContain('<img');
  });
});

describe('PersonCard photo falls back to initials when the picture cannot load (WAL10)', () => {
  it('swaps the broken picture for the initials', async () => {
    const { JSDOM } = await import('jsdom');
    const { act } = await import('react');
    const { createRoot } = await import('react-dom/client');
    const dom = new JSDOM('<div id="r"></div>');
    const g = globalThis as unknown as {
      window?: unknown;
      document?: unknown;
      IS_REACT_ACT_ENVIRONMENT?: unknown;
    };
    const had = {
      window: 'window' in g,
      document: 'document' in g,
      act: 'IS_REACT_ACT_ENVIRONMENT' in g,
    };
    const saved = {
      window: g.window,
      document: g.document,
      act: g.IS_REACT_ACT_ENVIRONMENT,
    };
    g.window = dom.window;
    g.document = dom.window.document;
    g.IS_REACT_ACT_ENVIRONMENT = true;
    try {
      const host = dom.window.document.getElementById('r') as HTMLElement;
      const { PersonAvatar } = await import('../../../components/profile-photo/person-avatar');
      const root = createRoot(host);
      await act(async () => {
        root.render(
          <PersonAvatar
            className="home-avatar"
            initials="NS"
            photoUrl="/api/photos/applicant/p1?v=1"
          />,
        );
      });
      const img = host.querySelector('img');
      expect(img).not.toBeNull();
      await act(async () => {
        img?.dispatchEvent(new dom.window.Event('error'));
      });
      expect(host.querySelector('img')).toBeNull();
      expect(host.textContent).toBe('NS');
      await act(async () => root.unmount());
    } finally {
      if (had.window) g.window = saved.window;
      else Reflect.deleteProperty(g, 'window');
      if (had.document) g.document = saved.document;
      else Reflect.deleteProperty(g, 'document');
      if (had.act) g.IS_REACT_ACT_ENVIRONMENT = saved.act;
      else Reflect.deleteProperty(g, 'IS_REACT_ACT_ENVIRONMENT');
    }
  });
});

describe('ownPhotoFor (WAL10)', () => {
  const own = { id: 'p1', photoUrl: '/api/photos/applicant/p1?v=1' };
  const me = { id: 'p1', relationship: 'SELF', ownerAccountId: 'acct-1' };

  it("gives the account photo to the account's own SELF record only", () => {
    expect(ownPhotoFor(me, 'acct-1', own)).toBe(own.photoUrl);
  });

  it('never gives it to another person on the account', () => {
    expect(
      ownPhotoFor({ ...me, id: 'p2', relationship: 'FAMILY_MEMBER' }, 'acct-1', own),
    ).toBeNull();
    expect(ownPhotoFor({ ...me, relationship: 'FAMILY_MEMBER' }, 'acct-1', own)).toBeNull();
    expect(ownPhotoFor({ ...me, id: 'p2' }, 'acct-1', own)).toBeNull();
  });

  it('never gives it to a record owned by someone else (an agency-managed record)', () => {
    expect(ownPhotoFor({ ...me, ownerAccountId: 'agency-acct' }, 'acct-1', own)).toBeNull();
  });

  it('gives nothing when the account has no photo or no own record', () => {
    expect(ownPhotoFor(me, 'acct-1', { id: 'p1', photoUrl: null })).toBeNull();
    expect(ownPhotoFor(me, 'acct-1', null)).toBeNull();
  });
});
