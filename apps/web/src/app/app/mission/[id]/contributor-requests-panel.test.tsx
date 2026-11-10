// @vitest-environment jsdom
import { type ComponentProps, act } from 'react';
import { type Root, createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareOriginsProvider } from '../../../../components/share/share-origins';

const ORIGIN = 'https://vs.example.test';
const LINK = `${ORIGIN}/app/contributor-requests/accept?token=abcDEF123_-xyzABC456`;
const outcome = vi.hoisted(() => ({
  next: {} as {
    ok: boolean;
    message: string;
    acceptUrl?: string;
    askedFor?: string;
    requestId?: string;
  },
}));
vi.mock('./actions', () => ({
  createContributorRequestAction: async () => outcome.next,
  revokeContributorRequestAction: async () => ({ ok: true, message: '' }),
}));
const { ContributorRequestsPanel } = await import('./contributor-requests-panel');
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

type Requests = ComponentProps<typeof ContributorRequestsPanel>['requests'];
async function mount(origin = ORIGIN, requests: Requests = []) {
  await act(async () =>
    root.render(
      <ShareOriginsProvider origin={origin}>
        <ContributorRequestsPanel missionId="case-1" requests={requests} />
      </ShareOriginsProvider>,
    ),
  );
}
const request = (status: string): Requests[number] => ({
  id: 'r1',
  contributorEmail: 'sponsor@example.com',
  docType: 'Sponsor bank statement',
  purpose: 'To support the sponsorship section',
  status,
  expiresAt: '2030-01-01T00:00:00.000Z',
});
async function submit() {
  const form = container.querySelector('form');
  if (!form) throw new Error('Missing form');
  // The form's own fields are required, so they are filled as a person would before sending.
  for (const [name, value] of [
    ['contributorEmail', 'sponsor@example.com'],
    ['docType', 'Sponsor bank statement'],
    ['purpose', 'To support the sponsorship section'],
  ] as const) {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!input) throw new Error(`Missing ${name}`);
    input.value = value;
  }
  await act(async () => form.requestSubmit());
}
const sendLink = () => container.querySelector<HTMLAnchorElement>('a.wa-share-send');

describe('asking a sponsor for one document, then sending the request on WhatsApp', () => {
  it('offers no WhatsApp action before a request has been made', async () => {
    await mount();
    expect(sendLink()).toBeNull();
  });

  it('offers Send on WhatsApp with the document kind and the private link, after the request is made', async () => {
    outcome.next = {
      ok: true,
      message: `Request created. Share this link: ${LINK}`,
      acceptUrl: LINK,
      askedFor: 'Sponsor bank statement',
    };
    await mount();
    await submit();
    const link = sendLink();
    expect(link).not.toBeNull();
    const text = decodeURIComponent(link?.href.split('text=')[1] ?? '');
    expect(text).toContain('Sponsor bank statement');
    expect(text).toContain(LINK);
    expect(link?.target).toBe('_blank');
    // A copy button sits beside it, as everywhere else a person sends something.
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === 'Copy Message'),
    ).toBe(true);
  });

  it('stops offering the link once the request is revoked, and keeps it while the request is open', async () => {
    outcome.next = {
      ok: true,
      message: 'Request created.',
      acceptUrl: LINK,
      askedFor: 'Sponsor bank statement',
      requestId: 'r1',
    };
    await mount();
    await submit();
    expect(sendLink()).not.toBeNull();
    // The list refreshes with the request still waiting: the link is still good to send.
    await mount(ORIGIN, [request('PENDING')]);
    expect(sendLink()).not.toBeNull();
    // The owner revokes it: the link no longer works, so it is no longer offered.
    await mount(ORIGIN, [request('REVOKED')]);
    expect(sendLink()).toBeNull();
    expect(
      [...container.querySelectorAll('button')].some((b) => b.textContent === 'Copy Message'),
    ).toBe(false);
  });

  it('offers none when the builder refuses the words (a number in the document name), so no unsafe message is made', async () => {
    outcome.next = {
      ok: true,
      message: 'Request created.',
      acceptUrl: LINK,
      askedFor: 'Passport A01234567',
    };
    await mount();
    await submit();
    expect(sendLink()).toBeNull();
  });

  it('offers none for a link that is not VisaStack’s own', async () => {
    outcome.next = {
      ok: true,
      message: 'Request created.',
      acceptUrl: 'https://evil.example.com/app/contributor-requests/accept?token=abc',
      askedFor: 'Bank statement',
    };
    await mount();
    await submit();
    expect(sendLink()).toBeNull();
  });
});
