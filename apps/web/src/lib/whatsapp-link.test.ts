import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  type ShareInput,
  type ShareMessage,
  composeShareMessage,
  normalizeWhatsAppNumber,
  whatsAppHref,
} from './whatsapp-link';

const ORIGIN = 'https://vs.obsidianglobal.studio';
const NOW = new Date('2026-11-10T09:00:00Z');
const options = { allowedOrigins: [ORIGIN], now: NOW };
const LINK = `${ORIGIN}/collect/open?token=abcDEF123_-xyzABC456`;

function build(input: ShareInput) {
  return composeShareMessage(input, options);
}
function text(input: ShareInput): string {
  const result = build(input);
  if (!result.ok) throw new Error(`rejected: ${JSON.stringify(result.rejection)}`);
  return result.message.text;
}

describe('what a WhatsApp message may hold', () => {
  it('holds a first name, the agency, document kinds, the case, a due date and one link', () => {
    const message = text({
      template: 'collection-link',
      link: LINK,
      firstName: 'Rahim',
      agencyName: 'Dhaka Visa Desk',
      documentKinds: ['Passport', 'Bank Statement'],
      caseName: 'Canada Visit',
      dueDate: '2026-11-20',
    });
    expect(message).toBe(
      `Hello Rahim, Dhaka Visa Desk has asked you for Passport and Bank Statement for Canada Visit through VisaStack. Please send them by 20 Nov 2026. Open your private link to get started: ${LINK}`,
    );
  });

  it('works with nothing but the link', () => {
    expect(text({ template: 'collection-link', link: LINK })).toBe(
      `Hello, your agency has asked you for documents through VisaStack. Open your private link to get started: ${LINK}`,
    );
  });

  it('has a template for each place a person sends something', () => {
    const invite = `${ORIGIN}/invitation?kind=client&token=abcDEF123_-xyzABC456`;
    expect(text({ template: 'client-invitation', link: invite, firstName: 'Nusrat' })).toContain(
      'Hello Nusrat, your agency has invited you to VisaStack',
    );
    expect(
      text({ template: 'team-invitation', link: invite, agencyName: 'Dhaka Visa Desk' }),
    ).toContain('Dhaka Visa Desk has invited you to join its team');
    expect(text({ template: 'sharing-invitation', link: invite })).toContain(
      'I would like to share some of my visa details with you',
    );
    expect(text({ template: 'summary-link', link: `${ORIGIN}/app/shared` })).toContain(
      `Please sign in to VisaStack to see it: ${ORIGIN}/app/shared`,
    );
    expect(text({ template: 'support-hello' })).toBe('Hello VisaStack, I need some help.');
  });

  it('lets prepared text name a due day, as the follow-up does, and nothing else shaped like a date', () => {
    for (const fine of [
      'Hello Rahim,\n\nDue: 20 Nov 2026',
      'Due: today, 10 Nov 2026',
      'Due: 1 Nov 2026 (this date has passed)',
    ]) {
      expect(text({ template: 'prepared-text', text: fine })).toBe(fine);
    }
  });

  it('passes an already prepared follow-up through unchanged', () => {
    const prepared = 'Hello Rahim,\n\nWe are still waiting for one document we asked you for.';
    expect(text({ template: 'prepared-text', text: prepared })).toBe(prepared);
  });

  it('hands over a message object that holds only the words', () => {
    const result = build({ template: 'support-hello' });
    expect(result.ok && Object.keys(result.message)).toEqual(['text']);
  });
});

describe('identifiers, dates of birth and addresses can never get in (the owner floor)', () => {
  const NAME_FIELDS = ['firstName', 'agencyName', 'caseName'] as const;
  const RISKY = [
    ['a passport number', 'A01234567'],
    ['a passport number with letters in front', 'BX 0123456'],
    ['a national ID number (10 digits)', '1990123456'],
    ['a national ID number (13 digits)', '1990123456789'],
    ['a national ID number in groups', '199 012 345 6789'],
    ['a date of birth as words', '12 April 1990'],
    ['a date of birth with slashes', '12/04/1990'],
    ['a date of birth with dashes', '1990-04-12'],
    ['a month and year of birth', 'April 1990'],
    ['an email address', 'rahim@example.com'],
    ['a web address', 'evil.example.com'],
    ['a phone number', '+880 1711 223344'],
  ] as const;

  for (const field of NAME_FIELDS) {
    for (const [label, value] of RISKY) {
      it(`refuses ${label} in ${field}`, () => {
        const input = { template: 'collection-link', link: LINK, [field]: value } as ShareInput;
        expect(build(input).ok).toBe(false);
      });
    }
  }

  for (const [label, value] of RISKY) {
    it(`refuses ${label} as a document kind`, () => {
      expect(build({ template: 'collection-link', link: LINK, documentKinds: [value] }).ok).toBe(
        false,
      );
    });
  }

  it('flattens a line break in a name to a space, so a name can never add lines', () => {
    const message = text({
      template: 'client-invitation',
      link: `${ORIGIN}/invitation?token=abc`,
      firstName: 'Rahim\n\nAkter',
    });
    expect(message.startsWith('Hello Rahim Akter, ')).toBe(true);
    expect(message).not.toContain('\n');
  });

  it('refuses a date of birth passed as the due date', () => {
    for (const dob of ['1990-04-12', '2001-01-31', '1985-06-15']) {
      expect(build({ template: 'collection-link', link: LINK, dueDate: dob }).ok, String(dob)).toBe(
        false,
      );
    }
  });

  it('refuses a due date that is not a date, or is far past or far away', () => {
    for (const bad of ['next week', '2026-13-45', '20-11-2026', '2020-01-01', '2035-01-01']) {
      expect(build({ template: 'collection-link', link: LINK, dueDate: bad }).ok, bad).toBe(false);
    }
  });

  it('accepts a due date from just past to a few years ahead', () => {
    for (const fine of ['2026-10-25', '2026-11-10', '2027-03-01', '2029-06-01']) {
      expect(build({ template: 'collection-link', link: LINK, dueDate: fine }).ok, fine).toBe(true);
    }
  });

  it('refuses prepared text that holds a number, an address, an email or a link', () => {
    for (const bad of [
      'Case: Canada Visit, born 12 April 1990',
      'Date of birth 12/04/1990',
      'Due: 12 Nov 1990',
      'Hello, your passport A01234567 is due',
      'Call me on 01711223344',
      'Write to rahim@example.com',
      `Open ${LINK}`,
      'Visit www.example.com',
      '',
    ]) {
      expect(build({ template: 'prepared-text', text: bad }).ok, bad).toBe(false);
    }
  });

  it('ignores any field it was not built to take, even if one is forced in', () => {
    const forced = {
      template: 'collection-link',
      link: LINK,
      firstName: 'Rahim',
      passportNumber: 'A01234567',
      dateOfBirth: '1990-04-12',
      address: '12 Road 4, Dhaka',
      storageUrl: 'https://files.example.com/x.pdf',
    } as unknown as ShareInput;
    const message = text(forced);
    expect(message).not.toContain('A01234567');
    expect(message).not.toContain('1990');
    expect(message).not.toContain('Road 4');
    expect(message).not.toContain('files.example.com');
  });

  it('checks the finished text again, so nothing risky can slip in beside the link', () => {
    const result = build({
      template: 'collection-link',
      link: `${ORIGIN}/collect/open?token=abcDEF123_-xyzABC456`,
      firstName: 'Rahim',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const rest = result.message.text.replace(LINK, '');
      expect(rest).not.toMatch(/\d{6,}/);
      expect(rest).not.toContain('://');
    }
  });
});

describe("the link must be VisaStack's own and must not open a file", () => {
  const refuse = (link: string) => build({ template: 'client-invitation', link }).ok === false;

  it('refuses another host, an address look-alike, plain http and credentials', () => {
    expect(refuse('https://evil.example.com/invitation?kind=client&token=abc')).toBe(true);
    expect(refuse('https://vs.obsidianglobal.studio.evil.com/invitation?token=abc')).toBe(true);
    expect(refuse('https://evil.com/?https://vs.obsidianglobal.studio')).toBe(true);
    expect(refuse('http://vs.obsidianglobal.studio/invitation?token=abc')).toBe(true);
    expect(refuse('https://user:pass@vs.obsidianglobal.studio/invitation')).toBe(true);
    expect(refuse('not a link')).toBe(true);
    expect(refuse('javascript:alert(1)')).toBe(true);
    expect(refuse('')).toBe(true);
  });

  it('refuses links that open a file directly', () => {
    for (const path of [
      '/app/documents/9/view',
      '/preview/9',
      '/api/blob/abc',
      '/api/documents/safe-copy?id=1',
      '/app/applicant/1/outputs/download?id=2',
      '/app/agency/1/collection/guest-file?id=2',
      '/app/privacy/large-export/9/download',
      '/api/calendar-feed/me.ics',
      '/files/passport.pdf',
      '/x/photo.jpg',
    ]) {
      expect(refuse(`${ORIGIN}${path}`), path).toBe(true);
    }
  });

  it('refuses query values other than the few the existing links use (no signed file keys)', () => {
    expect(refuse(`${ORIGIN}/invitation?kind=client&token=abc&signature=zzz`)).toBe(true);
    expect(refuse(`${ORIGIN}/invitation?key=files/passport&expires=999`)).toBe(true);
  });

  it('accepts the links VisaStack already makes, each only for its own message', () => {
    const invite = `${ORIGIN}/invitation?kind=client&token=abc_123`;
    expect(build({ template: 'client-invitation', link: invite }).ok).toBe(true);
    expect(build({ template: 'team-invitation', link: invite }).ok).toBe(true);
    expect(build({ template: 'sharing-invitation', link: invite }).ok).toBe(true);
    expect(build({ template: 'summary-link', link: `${ORIGIN}/app/shared` }).ok).toBe(true);
    expect(build({ template: 'collection-link', link: LINK }).ok).toBe(true);
    // A real page of ours, but not the page this message is for.
    expect(build({ template: 'collection-link', link: invite }).ok).toBe(false);
    expect(build({ template: 'summary-link', link: invite }).ok).toBe(false);
    expect(build({ template: 'client-invitation', link: `${ORIGIN}/app/shared` }).ok).toBe(false);
  });

  it('accepts an http link only for localhost, and only when that origin is allowed', () => {
    const local = { allowedOrigins: ['http://localhost:3100'], now: NOW };
    expect(
      composeShareMessage(
        { template: 'summary-link', link: 'http://localhost:3100/app/shared' },
        local,
      ).ok,
    ).toBe(true);
    expect(
      composeShareMessage(
        { template: 'summary-link', link: 'http://localhost:3100/app/shared' },
        options,
      ).ok,
    ).toBe(false);
  });
});

describe('numbers and the link that opens WhatsApp', () => {
  const message = (): ShareMessage => {
    const result = build({ template: 'support-hello' });
    if (!result.ok) throw new Error('rejected');
    return result.message;
  };

  it('opens a known chat with wa.me/<digits>', () => {
    expect(whatsAppHref(message(), '+880 1711-223344')).toBe(
      `https://wa.me/8801711223344?text=${encodeURIComponent('Hello VisaStack, I need some help.')}`,
    );
  });

  it("opens WhatsApp's own contact picker when there is no number", () => {
    const href = whatsAppHref(message());
    expect(href.startsWith('https://wa.me/?text=')).toBe(true);
    expect(whatsAppHref(message(), null)).toBe(href);
    expect(whatsAppHref(message(), 'not a number')).toBe(href);
  });

  it('only accepts international digits, 8 to 15 long', () => {
    expect(normalizeWhatsAppNumber('8801711223344')).toBe('8801711223344');
    expect(normalizeWhatsAppNumber('008801711223344')).toBe('8801711223344');
    expect(normalizeWhatsAppNumber('0171122')).toBeNull();
    expect(normalizeWhatsAppNumber('1234567890123456')).toBeNull();
    expect(normalizeWhatsAppNumber('0123456789')).toBeNull();
    expect(normalizeWhatsAppNumber('12345678?text=evil')).toBeNull();
    expect(normalizeWhatsAppNumber(undefined)).toBeNull();
  });
});

describe('one builder for the whole product', () => {
  const SRC = fileURLToPath(new URL('..', import.meta.url));
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(entry) && !/\.test\.|test-support/.test(entry) ? [full] : [];
    });
  }

  it('is the only place that writes a wa.me address', () => {
    const offenders = files(SRC)
      .filter((file) => readFileSync(file, 'utf8').includes('wa.me'))
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual(['lib/whatsapp-link.ts']);
  });
});
