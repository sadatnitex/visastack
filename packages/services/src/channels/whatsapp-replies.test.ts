import { describe, expect, it } from 'vitest';
import type { SelectedOutput } from '../selected-output';
import { LIMITS } from './whatsapp-port';
import {
  MENU_REPLY_IDS,
  MENU_ROWS,
  type PersonSummary,
  TEXT,
  caseStatusText,
  expiryText,
  missingText,
  personText,
  readIntent,
} from './whatsapp-replies';

const say = (text: string) => readIntent({ kind: 'text', text, replyId: null });

describe('readIntent', () => {
  it('reads a link code in the forms people type it', () => {
    expect(say('LINK 48210-93715')).toEqual({ kind: 'link', code: '4821093715' });
    expect(say('link 4821093715')).toEqual({ kind: 'link', code: '4821093715' });
    expect(say('  Link 48210 93715 ')).toEqual({ kind: 'link', code: '4821093715' });
    expect(say('LINK 4821-0937')).toEqual({ kind: 'menu' });
  });

  it('treats only a plain STOP as stop, so a sentence mentioning it is not an opt-out by accident', () => {
    expect(say('STOP')).toEqual({ kind: 'stop' });
    expect(say('Stop.')).toEqual({ kind: 'stop' });
    expect(say('STOP!!')).toEqual({ kind: 'stop' });
    expect(say('Start!')).toEqual({ kind: 'start' });
    expect(say('please stop sending the status')).not.toEqual({ kind: 'stop' });
    expect(say('unsubscribe')).toEqual({ kind: 'stop' });
    expect(say('start')).toEqual({ kind: 'start' });
    expect(readIntent({ kind: 'reply', text: null, replyId: 'stop' })).toEqual({ kind: 'stop' });
  });

  it('maps menu presses and plain questions to fixed views, and anything else to the menu', () => {
    expect(readIntent({ kind: 'reply', text: null, replyId: MENU_REPLY_IDS.expiry })).toEqual({
      kind: 'expiry',
    });
    expect(readIntent({ kind: 'reply', text: null, replyId: 'something-old' })).toEqual({
      kind: 'menu',
    });
    expect(say('what do I still need?')).toEqual({ kind: 'missing' });
    expect(say('when does it expire')).toEqual({ kind: 'expiry' });
    expect(say('case status please')).toEqual({ kind: 'status' });
    expect(say('can I speak to a human')).toEqual({ kind: 'person' });
    expect(say('hello')).toEqual({ kind: 'menu' });
    expect(readIntent({ kind: 'media', text: null, replyId: null })).toEqual({ kind: 'media' });
    // A reaction or a location is left unanswered, so a thumbs-up never sends the menu again.
    expect(readIntent({ kind: 'unsupported', text: null, replyId: null })).toEqual({
      kind: 'ignore',
    });
  });
});

describe('fixed wording', () => {
  it('fits every menu row within WhatsApp limits and never asks for identity or bank details', () => {
    for (const row of MENU_ROWS) {
      expect(row.title.length).toBeLessThanOrEqual(LIMITS.rowTitle);
      expect((row.description ?? '').length).toBeLessThanOrEqual(LIMITS.rowDescription);
    }
    for (const value of Object.values(TEXT)) {
      expect(value.length).toBeLessThanOrEqual(LIMITS.body);
      expect(value).not.toMatch(/send (us )?(your|a) (passport|id|bank)/i);
      expect(value).not.toMatch(/mission/i);
    }
    expect(TEXT.menuBody).toContain('never asks for passport, ID or bank details');
    expect(personText('help@example.test')).toContain('email help@example.test');
  });
});

function person(name: string, overrides: Partial<SelectedOutput> = {}): PersonSummary {
  return {
    displayName: name,
    output: {
      cases: [],
      expiry: [],
      ...overrides,
    } as unknown as SelectedOutput,
  };
}

const requirement = (label: string, optional = false) => ({
  kind: 'document' as const,
  key: label,
  label,
  optional,
  state: 'missing' as const,
});

function caseOf(title: string, missing: string[] = [], optional: string[] = []) {
  return {
    referenceCode: null,
    title,
    destination: 'France',
    purpose: null,
    travelStart: null,
    travelEnd: null,
    targetDeadline: null,
    state: 'In progress',
    checklist: null,
    readiness: {
      requiredCount: 9,
      satisfiedCount: 6,
      satisfied: [],
      needsAttention: [],
      missing: [
        ...missing.map((label) => requirement(label)),
        ...optional.map((label) => requirement(label, true)),
      ],
      withheld: 0,
    },
    nextActions: [{ title: 'Add a bank statement', why: '', dueDate: null, overdue: false }],
  };
}

describe('summaries', () => {
  it('says how far each case is and the next step', () => {
    const text = caseStatusText([
      person('Rahim', { cases: [caseOf('Schengen Visit')] } as Partial<SelectedOutput>),
    ]);
    expect(text).toBe(
      'Your cases\n- Schengen Visit (France): 6 of 9 ready. Next: Add a bank statement.',
    );
  });

  it('names each traveller only when there is more than one', () => {
    const text = caseStatusText([
      person('Rahim', { cases: [caseOf('Trip A')] } as Partial<SelectedOutput>),
      person('Karim', { cases: [caseOf('Trip B')] } as Partial<SelectedOutput>),
    ]);
    expect(text).toContain('Rahim: - Trip A');
    expect(text).toContain('Karim: - Trip B');
  });

  it('lists what is missing by name, leaving optional items out', () => {
    const text = missingText([
      person('Rahim', {
        cases: [caseOf('Trip', ['Passport', 'Bank statement'], ['Hotel booking'])],
      } as Partial<SelectedOutput>),
    ]);
    expect(text).toBe('Still needed\n- Trip (France): Passport, Bank statement.');
  });

  it('lists expiring documents soonest first, within four months', () => {
    const text = expiryText([
      person('Rahim', {
        expiry: [
          { referenceCode: null, kind: 'Visa', expiresOn: '2027-01-30', daysLeft: 95 },
          { referenceCode: null, kind: 'Passport', expiresOn: '2026-11-06', daysLeft: 10 },
          { referenceCode: null, kind: 'Insurance', expiresOn: '2027-09-01', daysLeft: 309 },
        ],
      } as Partial<SelectedOutput>),
    ]);
    expect(text).toBe(
      'Expiring soon\n- Passport: expires on 2026-11-06 (10 days).\n- Visa: expires on 2027-01-30 (95 days).',
    );
  });

  it('stays within the message limit however many cases there are', () => {
    const many = Array.from({ length: 80 }, (_, index) =>
      caseOf(`Case number ${index} with a long name`),
    );
    const text = caseStatusText([person('Rahim', { cases: many } as Partial<SelectedOutput>)]);
    expect(text.length).toBeLessThanOrEqual(LIMITS.body);
    expect(text.endsWith('Open VisaStack to see everything.')).toBe(true);
  });

  it('says plainly when there is nothing to show', () => {
    expect(caseStatusText([person('Rahim')])).toContain('no open cases');
    expect(missingText([person('Rahim')])).toContain('Nothing is missing');
    expect(expiryText([person('Rahim')])).toContain('Nothing expires');
  });
});
