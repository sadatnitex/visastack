import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CaseCard, PersonCard, StartCaseTile, initialsOf } from './home-cards';

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
