import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_EMAIL_COPY,
  escapeHtml,
  notificationEmail,
  renderEmail,
} from './email-design';

const BASE = 'https://vs.example.test';
const context = { baseUrl: BASE, recipient: 'amina@example.test' };

const taskDue = {
  eventType: 'TASK_DEADLINE',
  subject: 'Task due soon',
  summary: 'A task on "Japan Travel" needs your attention.',
  url: `${BASE}/app/mission/m1`,
};

describe('every email', () => {
  it('says what happened, why, and what to do, in the HTML and in plain text', () => {
    const { text, html } = renderEmail(notificationEmail(taskDue), context);
    for (const words of [
      'A task on your case is coming up',
      'Keeping each step on time keeps the whole case moving.',
      'Open Your Case',
      'Already done? Mark it done on your case and these reminders stop.',
      'This email was sent to amina@example.test.',
    ]) {
      expect(text).toContain(words);
      expect(html).toContain(escapeHtml(words));
    }
    expect(text).toContain(taskDue.summary);
    expect(text).toContain(`Open Your Case: ${BASE}/app/mission/m1`);
    expect(html).toContain(`href="${BASE}/app/mission/m1"`);
  });

  it('words an overdue task differently from one coming up', () => {
    expect(notificationEmail({ ...taskDue, timing: 'overdue' }).heading).toBe(
      'A task on your case is past its date',
    );
    expect(notificationEmail({ ...taskDue, timing: 'today' }).heading).toBe(
      'A task on your case is due today',
    );
  });

  it('never lets typed text become markup', () => {
    const { html } = renderEmail(
      notificationEmail({
        ...taskDue,
        summary: 'A task on "<script>alert(1)</script><img src=x onerror=alert(2)>" needs you.',
      }),
      { ...context, recipient: '"><b>x</b>@example.test' },
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('only ever links to the product itself, and loads nothing from anywhere else', () => {
    const { html, text } = renderEmail(
      notificationEmail({ ...taskDue, url: 'https://evil.example/phish' }),
      context,
    );
    expect(html).not.toContain('evil.example');
    expect(text).not.toContain('evil.example');
    const addresses = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
    expect(addresses.length).toBeGreaterThan(0);
    for (const address of addresses) expect(address?.startsWith(BASE)).toBe(true);
    expect(() =>
      renderEmail(notificationEmail({ ...taskDue, url: 'javascript:alert(1)' }), context),
    ).not.toThrow();
    expect(
      renderEmail(notificationEmail({ ...taskDue, url: 'javascript:alert(1)' }), context).html,
    ).not.toContain('javascript:');
  });

  it('gives a notification without its own words the full design, led by its subject', () => {
    const content = notificationEmail({
      ...taskDue,
      eventType: 'SOMETHING_NEW',
      subject: 'Something new',
    });
    expect(content.heading).toBe('Something new');
    expect(content.action.label).toBe('Open VisaStack');
    expect(renderEmail(content, context).html).toContain('Something new');
  });
});

describe('the words of every email', () => {
  const LONG_DASH = String.fromCharCode(0x2014);
  const entries = Object.entries(NOTIFICATION_EMAIL_COPY) as [
    string,
    (typeof NOTIFICATION_EMAIL_COPY)[keyof typeof NOTIFICATION_EMAIL_COPY],
  ][];

  it('covers every kind of notification the product sends by email', () => {
    expect(Object.keys(NOTIFICATION_EMAIL_COPY).sort()).toEqual(
      [
        'APPOINTMENT_SCHEDULED',
        'CASE_RETENTION_NOTICE',
        'CLIENT_INVITATION_CREATED',
        'CONTRIBUTOR_REQUEST_CREATED',
        'DOCUMENT_EXPIRY',
        'DOWNGRADE_EXECUTED',
        'DOWNGRADE_SCHEDULED',
        'EVIDENCE_REPLACEMENT_REQUESTED',
        'EVIDENCE_REQUEST_CREATED',
        'EVIDENCE_REVIEW_ACCEPTED',
        'INACTIVE_ACCOUNT_NOTICE',
        'LEGAL_HOLD_REVIEW_REMINDER',
        'MISSION_STATUS_CHANGED',
        'PLATFORM_ROLE_GRANTED',
        'PLATFORM_ROLE_REVOKED',
        'SHARING_INVITATION_CREATED',
        'TASK_DEADLINE',
        'TEAM_INVITATION_CREATED',
        'TEAM_MEMBER_ADDED',
        'VERIFICATION_EXPIRY',
        'WHATSAPP_CONNECTED',
      ].sort(),
    );
  });

  it('uses Title Case buttons, plain words and no long dashes', () => {
    for (const [event, copy] of entries) {
      const words = [
        copy.eyebrow,
        copy.action,
        copy.why ?? '',
        copy.after ?? '',
        typeof copy.heading === 'string' ? copy.heading : copy.heading(taskDue),
      ];
      for (const text of words) expect(text, event).not.toContain(LONG_DASH);
      for (const word of copy.action.split(' ')) {
        if (['a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or'].includes(word)) continue;
        expect(word[0], `${event}: ${copy.action}`).toBe(word[0]?.toUpperCase());
      }
      expect(words.join(' '), event).not.toMatch(
        /\b(mission|API|database|guarantee[ds]?|approval odds)\b/i,
      );
    }
  });

  it('never calls an accepted document a visa decision', () => {
    const accepted = notificationEmail({ ...taskDue, eventType: 'EVIDENCE_REVIEW_ACCEPTED' });
    expect(accepted.after).toContain('It is not a decision on your visa.');
  });
});
