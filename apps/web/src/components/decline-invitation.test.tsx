// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderServer } from '../lib/next-mocks.test-support';
import { DeclineInvitation } from './decline-invitation';

const action = async () => ({ ok: false, message: '' });

async function mounted(): Promise<HTMLElement> {
  const html = await renderServer(
    <DeclineInvitation
      token="secret-token"
      action={action}
      labels={{
        decline: 'Decline',
        explain: 'Say no to this invitation?',
        confirm: 'Decline Invitation',
        busy: 'Declining',
      }}
    />,
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('the Decline control (DECL1)', () => {
  it('is a closed disclosure: one press opens the confirm, a second press sends it', async () => {
    const host = await mounted();
    const details = host.querySelector('details');
    expect(details).not.toBeNull();
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toContain('Decline');
    expect(host.querySelector('[role="dialog"], dialog')).toBeNull();
    const form = details?.querySelector('form');
    const submit = form?.querySelector('button[type="submit"]');
    expect(submit?.textContent).toBe('Decline Invitation');
    // The question names the group the button sits in, so it is read out with it.
    expect(submit?.closest('fieldset')?.querySelector('legend')?.textContent).toBe(
      'Say no to this invitation?',
    );
  });

  it('is a form that carries the link token itself, so the post needs no script', async () => {
    const host = await mounted();
    const form = host.querySelector('form');
    const token = form?.querySelector<HTMLInputElement>('input[type="hidden"][name="token"]');
    expect(token?.value).toBe('secret-token');
  });
});
