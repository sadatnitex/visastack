// @vitest-environment jsdom
// Owner's list item 8: after a revoke, or any later action in the Team or Clients panel, the old
// "invitation ready" line and its private link are gone, and the panel shows one current line.
import { act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionState } from './actions';

type Answer = ActionState | Promise<ActionState>;
const answers = vi.hoisted(() => ({
  invite: [] as Answer[],
  revoke: [] as Answer[],
  toggle: [] as Answer[],
  member: [] as Answer[],
}));
vi.mock('./actions', () => {
  const next = (queue: Answer[]) => async () => await (queue.shift() ?? { ok: true, message: '' });
  return {
    inviteClientAction: next(answers.invite),
    revokeClientInvitationAction: next(answers.revoke),
    revokeInvitationAction: next(answers.revoke),
    toggleMemberAction: next(answers.toggle),
    addMemberAction: next(answers.member),
  };
});

const { InvitationPanel } = await import('./invitation-panel');
const { ClientInvitationForm } = await import('./client-invitation-form');
const { ClientInvitationRevokeButton } = await import('./client-invitation-revoke-button');
const { AddMemberForm } = await import('./member-form');
const { InvitationRevokeButton } = await import('./invitation-revoke-button');
const { MemberToggleButton } = await import('./member-toggle-button');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINK = 'https://vs.example.test/client-invitations/accept?token=synthetic-one';
const SECOND_LINK = 'https://vs.example.test/client-invitations/accept?token=synthetic-two';
const READY: ActionState = {
  ok: true,
  message: 'Invitation ready. Share the link privately.',
  invitationUrl: LINK,
};
const REVOKED: ActionState = { ok: true, message: 'Invitation revoked.' };

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
  for (const queue of Object.values(answers)) queue.length = 0;
});

const MEMBERS = [{ accountId: 'a1', email: 'case.owner@example.test', active: true }];

function ClientsPanel({ rows }: { readonly rows: readonly string[] }) {
  return (
    <InvitationPanel>
      {rows.map((id) => (
        <ClientInvitationRevokeButton key={id} organizationId="o1" invitationId={id} />
      ))}
      <ClientInvitationForm organizationId="o1" members={MEMBERS} />
    </InvitationPanel>
  );
}

async function submit(form: HTMLFormElement | null | undefined) {
  if (!form) throw new Error('form not found');
  await act(async () => {
    form.requestSubmit();
  });
}

const inviteForm = () =>
  container.querySelector<HTMLFormElement>('form:has(input[name="contactDestination"])');
const revokeForm = (id: string) =>
  container.querySelector<HTMLFormElement>(`form:has(input[name="invitationId"][value="${id}"])`);
const fillInvite = () => {
  for (const [name, value] of [
    ['displayName', 'Synthetic Traveller'],
    ['contactDestination', 'traveller@example.test'],
  ] as const) {
    const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (input) input.value = value;
  }
};
const statusText = () =>
  [...container.querySelectorAll('output, [role="alert"]')]
    .map((node) => node.textContent?.trim())
    .filter(Boolean);
const linkValues = () =>
  [...container.querySelectorAll<HTMLInputElement>('input[readonly]')].map((input) => input.value);

describe('the Clients panel', () => {
  it('drops the earlier invitation line and its private link once an invitation is revoked', async () => {
    act(() => root.render(<ClientsPanel rows={['i1']} />));
    answers.invite.push(READY);
    fillInvite();
    await submit(inviteForm());
    expect(statusText()).toEqual([READY.message]);
    expect(linkValues()).toEqual([LINK]);

    answers.revoke.push(REVOKED);
    await submit(revokeForm('i1'));
    expect(statusText()).toEqual(['Invitation revoked.']);
    expect(linkValues()).toEqual([]);
    expect(container.textContent).not.toContain(LINK);
  });

  it('still says the invitation was revoked when its row has already left the page', async () => {
    act(() => root.render(<ClientsPanel rows={['i1']} />));
    let finish: (value: ActionState) => void = () => undefined;
    const slow = new Promise<ActionState>((resolve) => {
      finish = resolve;
    });
    answers.revoke.push(slow);
    await submit(revokeForm('i1'));
    // The real action refreshes the page, which removes the row as the answer arrives.
    act(() => root.render(<ClientsPanel rows={[]} />));
    await act(async () => {
      finish(REVOKED);
      await slow;
    });
    expect(statusText()).toEqual(['Invitation revoked.']);
  });

  it('shows only the newest link when a second invitation follows the first', async () => {
    act(() => root.render(<ClientsPanel rows={[]} />));
    answers.invite.push(READY, { ...READY, invitationUrl: SECOND_LINK });
    fillInvite();
    await submit(inviteForm());
    fillInvite();
    await submit(inviteForm());
    expect(linkValues()).toEqual([SECOND_LINK]);
    expect(statusText()).toHaveLength(1);
  });

  it('shows a failure in the same single place, replacing the earlier success', async () => {
    act(() => root.render(<ClientsPanel rows={['i1']} />));
    answers.invite.push(READY);
    fillInvite();
    await submit(inviteForm());
    answers.revoke.push({ ok: false, message: 'This invitation was already revoked.' });
    await submit(revokeForm('i1'));
    expect(statusText()).toEqual(['This invitation was already revoked.']);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'This invitation was already revoked.',
    );
    expect(linkValues()).toEqual([]);
  });
});

describe('the Team panel', () => {
  it('clears the teammate invitation link after a member is deactivated or an invitation revoked', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    act(() =>
      root.render(
        <InvitationPanel>
          <MemberToggleButton organizationId="o1" membershipId="m1" active />
          <InvitationRevokeButton organizationId="o1" invitationId="t1" />
          <AddMemberForm organizationId="o1" />
        </InvitationPanel>,
      ),
    );
    answers.member.push(READY);
    const email = container.querySelector<HTMLInputElement>('input[name="memberEmail"]');
    if (email) email.value = 'teammate@example.test';
    await submit(container.querySelector<HTMLFormElement>('form:has(input[name="memberEmail"])'));
    expect(linkValues()).toEqual([LINK]);

    answers.toggle.push({ ok: true, message: 'Member deactivated.' });
    await submit(container.querySelector<HTMLFormElement>('form:has(input[name="membershipId"])'));
    expect(statusText()).toEqual(['Member deactivated.']);
    expect(linkValues()).toEqual([]);

    answers.revoke.push(REVOKED);
    await submit(revokeForm('t1'));
    expect(statusText()).toEqual(['Invitation revoked.']);
  });
});

describe('the same forms outside a panel', () => {
  it('still say what happened by themselves', async () => {
    act(() => root.render(<ClientInvitationForm organizationId="o1" members={MEMBERS} />));
    answers.invite.push(READY);
    fillInvite();
    await submit(inviteForm());
    expect(statusText()).toEqual([READY.message]);
    expect(linkValues()).toEqual([LINK]);
  });
});
