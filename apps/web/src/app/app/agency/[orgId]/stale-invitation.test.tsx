// @vitest-environment jsdom
// Owner's list item 8: after an invitation is revoked, the form that made it no longer says
// "Invitation ready" or offers its private link.
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const answer = {
  ok: true,
  message: 'Invitation ready.',
  invitationUrl: 'https://vs.example.test/invitation?kind=team&token=t',
  invitationId: 'inv1',
};
vi.mock('./actions', () => ({
  addMemberAction: async () => answer,
  inviteClientAction: async () => answer,
}));

const { AddMemberForm } = await import('./member-form');
const { ClientInvitationForm } = await import('./client-invitation-form');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const MEMBERS = [{ accountId: 'm1', email: 'staff@example.com', active: true }];
const forms = {
  'the add-member form': (pending: readonly string[]) => (
    <AddMemberForm organizationId="o1" pendingInvitationIds={pending} />
  ),
  'the client invitation form': (pending: readonly string[]) => (
    <ClientInvitationForm organizationId="o1" members={MEMBERS} pendingInvitationIds={pending} />
  ),
};

describe.each(Object.entries(forms))('%s', (_name, form) => {
  it('drops its message and private link once the invitation is no longer pending', async () => {
    act(() => root.render(form(['inv1'])));
    const formElement = container.querySelector('form');
    // The fields' own checks are covered elsewhere; this test is about what follows an answer.
    if (formElement) formElement.noValidate = true;
    await act(async () => {
      formElement?.requestSubmit();
    });
    expect(container.textContent).toContain('Invitation ready.');
    expect(container.querySelector('input[readonly]')).not.toBeNull();

    // The page refreshes after a revoke and no longer lists the invitation.
    act(() => root.render(form([])));
    expect(container.textContent).not.toContain('Invitation ready.');
    expect(container.textContent).not.toContain('token=t');
    expect(container.querySelector('input[readonly]')).toBeNull();
  });

  it('keeps a new link the page has not listed yet, so the only copy is never hidden', async () => {
    act(() => root.render(form([])));
    const formElement = container.querySelector('form');
    if (formElement) formElement.noValidate = true;
    await act(async () => {
      formElement?.requestSubmit();
    });
    expect(container.textContent).toContain('Invitation ready.');
    expect(container.querySelector('input[readonly]')).not.toBeNull();
    // The message region stays in the page either way, so the next answer is announced.
    act(() => root.render(form(['other'])));
    expect(container.querySelector('output')).not.toBeNull();
  });
});
