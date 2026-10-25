import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../../lib/next-mocks.test-support';
import InvitationPage, { metadata } from './page';

const TOKEN = 'a'.repeat(43);
const render = (searchParams: { kind?: string; token?: string }) =>
  renderServer(InvitationPage({ searchParams: Promise.resolve(searchParams) }));

describe('the public invitation page (v1.2 B09: neutral, no bearer access)', () => {
  it.each([
    ['no kind', { token: TOKEN }],
    ['an unknown kind', { kind: 'admin', token: TOKEN }],
    ['no token', { kind: 'client' }],
    ['a malformed token', { kind: 'client', token: 'short' }],
  ])('shows only a neutral message for %s', async (_label, params) => {
    const text = textOf(await render(params));
    expect(text).toContain('Incomplete invitation link');
    expect(text).not.toContain('Create an account');
  });

  it('asks a client to use the invited email and returns them to the invitation after sign-in', async () => {
    const html = await render({ kind: 'client', token: TOKEN });
    expect(textOf(html)).toContain('Use the email address that received this invitation.');
    const next = encodeURIComponent(`/app/client-invitations/accept?token=${TOKEN}`);
    expect(html).toContain(`href="/auth/sign-up?next=${next}"`);
    expect(html).toContain(`href="/auth/sign-in?next=${next}"`);
  });

  it('opens nothing by visiting: it says so, and shows no email address', async () => {
    const text = textOf(await render({ kind: 'client', token: TOKEN }));
    expect(text).toContain('Opening the link does not accept it.');
    expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
  });

  it('never sends the link, token included, to another site as a referrer', () => {
    expect(metadata.referrer).toBe('no-referrer');
  });
});
