import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { navigationState } from '../../lib/next-mocks.test-support';
import type { WorkspaceAccess } from '../../lib/workspace-navigation';
import { WorkspaceShell } from './workspace-shell';

/**
 * The server-rendered first paint of the workspace on a case page. The browser has not run any
 * script yet, so what is asserted here is exactly what a person sees before the page wakes up:
 * the sidebar must already name the case's traveller, not switch to them a moment later.
 */

const CASE = '00000000-0000-4000-8000-0000000000c1';
const FAMILY = '10000000-0000-4000-8000-000000000002';
const STRANGER = '10000000-0000-4000-8000-0000000000ff';
const ACCESS: WorkspaceAccess = {
  travellers: [
    { id: '10000000-0000-4000-8000-000000000001', name: 'Synthetic Self', relationship: 'SELF' },
    { id: FAMILY, name: 'Synthetic Family', relationship: 'SPOUSE' },
  ],
  agencies: [],
  platform: null,
};

function paint(
  pathname: string,
  initialCaseSubject?: { route: string; applicantId: string } | null,
) {
  navigationState.pathname = pathname;
  return renderToStaticMarkup(
    <WorkspaceShell
      access={ACCESS}
      accountName="Synthetic Self"
      signOut={<span />}
      {...(initialCaseSubject === undefined ? {} : { initialCaseSubject })}
    >
      <p>Case page</p>
    </WorkspaceShell>,
  );
}

describe('first paint of a case page', () => {
  it('names the case traveller from the server, with My Trips lit, and no neutral case state', () => {
    const html = paint(`/app/mission/${CASE}/snapshots`, {
      route: `/app/mission/${CASE}`,
      applicantId: FAMILY,
    });
    expect(html).toContain('Managed Traveller');
    expect(html).toContain(`/app/applicant/${FAMILY}/documents`);
    expect(html).toMatch(/aria-current="page"[^>]*>(?:(?!<\/a>).)*My Trips/s);
    expect(html).not.toContain('Visa Case');
    expect(html).not.toContain('Case Workspace');
  });

  it('keeps the neutral case state when no traveller was found', () => {
    for (const initial of [undefined, null]) {
      const html = paint(`/app/mission/${CASE}`, initial);
      expect(html).toContain('Visa Case');
      expect(html).toContain('Case Workspace');
      expect(html).not.toContain('Managed Traveller');
      expect(html).not.toContain(`/app/applicant/${FAMILY}/documents`);
    }
  });

  it('ignores a subject that belongs to another case address', () => {
    const html = paint(`/app/mission/${CASE}`, {
      route: '/app/mission/00000000-0000-4000-8000-0000000000c2',
      applicantId: FAMILY,
    });
    expect(html).toContain('Visa Case');
    expect(html).not.toContain('Managed Traveller');
    expect(html).not.toContain(`/app/applicant/${FAMILY}/documents`);
  });

  it('never names a traveller this account does not hold', () => {
    const html = paint(`/app/mission/${CASE}`, {
      route: `/app/mission/${CASE}`,
      applicantId: STRANGER,
    });
    expect(html).toContain('Visa Case');
    expect(html).not.toContain(STRANGER);
  });

  it('leaves pages that are not cases alone', () => {
    const html = paint('/app', { route: `/app/mission/${CASE}`, applicantId: FAMILY });
    expect(html).toContain('Personal Space');
    expect(html).not.toContain('Visa Case');
  });
});
