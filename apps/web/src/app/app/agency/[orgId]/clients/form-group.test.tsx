// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { FormGroup } from './form-group';
import { openRequestAddress } from './open-request-from-link';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('FormGroup (WP-SB5)', () => {
  it('stays open after the form succeeds and the list stops being empty', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <FormGroup id="invite-client" title="Invite a Client" openAtFirst>
          <p>Invitation ready</p>
        </FormGroup>,
      ),
    );
    expect(host.querySelector('details')?.open).toBe(true);
    // The page refreshes after the invitation: the list now holds one, so it would start closed.
    await act(async () =>
      root.render(
        <FormGroup id="invite-client" title="Invite a Client" openAtFirst={false}>
          <p>Invitation ready</p>
        </FormGroup>,
      ),
    );
    expect(host.querySelector('details')?.open).toBe(true);
    await act(async () => root.unmount());
    host.remove();
  });

  it('starts closed when something is already listed', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <FormGroup id="ask-for-evidence" title="Ask for a Field or Document" openAtFirst={false}>
          <p>Form</p>
        </FormGroup>,
      ),
    );
    expect(host.querySelector('details')?.open).toBe(false);
    await act(async () => root.unmount());
  });
});

describe('openRequestAddress (WP-SB5)', () => {
  const ID = '33333333-3333-4333-8333-333333333333';
  const nowhere = () => false;

  it('asks for a linked request that is not on the page', () => {
    expect(
      openRequestAddress('/app/agency/o1/clients', '?status=open', `#request-${ID}`, nowhere),
    ).toBe(`/app/agency/o1/clients?status=open&request=${ID}#request-${ID}`);
  });

  it('leaves the address alone when the request is on the page, already asked for, or not a request link', () => {
    expect(openRequestAddress('/c', '', `#request-${ID}`, () => true)).toBeNull();
    expect(openRequestAddress('/c', `?request=${ID}`, `#request-${ID}`, nowhere)).toBeNull();
    expect(openRequestAddress('/c', '', '#ask-for-evidence', nowhere)).toBeNull();
    expect(openRequestAddress('/c', '', '#request-r1', nowhere)).toBeNull();
  });
});

describe('FormGroup as the pending invitations group (WP-SB11)', () => {
  it('shows its count and stays open when a link back to the newest rows drops the paging', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const group = (openAtFirst: boolean) => (
      <FormGroup
        id="client-invitations"
        title="Pending Invitations"
        count={40}
        noun={{ one: 'pending invitation', other: 'pending invitations' }}
        openAtFirst={openAtFirst}
      >
        <div id="client-invitation-list">rows</div>
      </FormGroup>
    );
    // Opened by paging through invitations.
    await act(async () => root.render(group(true)));
    expect(host.querySelector('.collapsible-group-count')?.textContent).toBe('40');
    expect(host.querySelector('summary')?.textContent).toContain('40 pending invitations');
    // Back to the Newest Invitations: the address no longer pages, the group stays open.
    await act(async () => root.render(group(false)));
    expect(host.querySelector('details')?.open).toBe(true);
    await act(async () => root.unmount());
    host.remove();
  });
});
