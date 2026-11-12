import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_EMAIL_COPY,
  type NotificationEmailInput,
  notificationEmail,
  renderEmail,
} from './email-design';

/**
 * Email golden (i18n plumbing, PR0). Emails stay English by owner decision, so the exact words and
 * markup every kind of email sends are pinned here: the plain text and the html for each kind,
 * plus the variants that change the wording (task and invoice timing, the replace link, a guest
 * code, and a kind with no words of its own). The snapshot was taken on the code before any
 * message catalogue reached services, and every later change must leave it untouched. Update it
 * only for an intended wording change, never to make a conversion pass.
 */

const CONTEXT = { baseUrl: 'https://vs.example.test', recipient: 'person@example.test' } as const;

function input(eventType: string, extra: Partial<NotificationEmailInput> = {}) {
  return {
    eventType,
    subject: 'Subject for the notice',
    summary: 'The one fact this notice carries.',
    url: '/app/example',
    ...extra,
  } satisfies NotificationEmailInput;
}

const kinds = Object.keys(NOTIFICATION_EMAIL_COPY).sort();

describe('email golden', () => {
  it('covers every kind of email the product sends', () => {
    expect(kinds.length).toBeGreaterThan(40);
  });

  it.each(kinds)('%s: text and html', (kind) => {
    const rendered = renderEmail(notificationEmail(input(kind)), CONTEXT);
    expect({ text: rendered.text, html: rendered.html }).toMatchSnapshot();
  });

  it.each(kinds)('%s: wording by timing, replace link and code', (kind) => {
    const variants = {
      upcoming: notificationEmail(input(kind, { timing: 'upcoming' })),
      today: notificationEmail(input(kind, { timing: 'today' })),
      overdue: notificationEmail(input(kind, { timing: 'overdue' })),
      replace: notificationEmail(input(kind, { url: '/app/documents?action=REPLACE' })),
      code: notificationEmail(input(kind, { code: '123456' })),
      heading: notificationEmail(input(kind, { heading: 'A heading this notice asked for' })),
    };
    expect(variants).toMatchSnapshot();
  });

  it('a kind with no words of its own still gets the full design', () => {
    const rendered = renderEmail(notificationEmail(input('SOME_FUTURE_KIND')), CONTEXT);
    expect({ text: rendered.text, html: rendered.html }).toMatchSnapshot();
  });

  it('an agency-branded request email', () => {
    const rendered = renderEmail(notificationEmail(input('EVIDENCE_REQUEST_CREATED')), {
      ...CONTEXT,
      agency: { name: '  Example   Travel  ', accentColor: '#1d4c98' },
    });
    expect({ text: rendered.text, html: rendered.html }).toMatchSnapshot();
  });
});
