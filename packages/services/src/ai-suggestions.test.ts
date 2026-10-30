import { describe, expect, it } from 'vitest';
import { cleanLine, cleanText, decideSuggestionField, reminderDueDate } from './ai-suggestions';

const RLO = String.fromCodePoint(0x202e);

describe('the text an AI app sends', () => {
  it('loses hidden characters; a line stays one line, a draft keeps its lines', () => {
    expect(cleanLine(`  Dha${RLO}ka\n city  `)).toBe('Dha ka city');
    expect(cleanText(`Dear Sir,\r\n\r\nYours${RLO}\u0000 faithfully`)).toBe(
      'Dear Sir,\n\nYours faithfully',
    );
  });
});

describe('which details an app may suggest', () => {
  const base = { layers: ['identity', 'travel_documents'], revealIdentifiers: false };
  it('allows an everyday detail in its own granted section, by key or by name', () => {
    expect(decideSuggestionField({ ...base, section: 'identity', field: 'phone' })?.key).toBe(
      'phone',
    );
    expect(
      decideSuggestionField({ ...base, section: 'travel_documents', field: 'Passport Expiry' })
        ?.key,
    ).toBe('passport_expiry');
  });

  it('refuses everything else with the same answer', () => {
    for (const [section, field, extra] of [
      ['identity', 'passport_expiry', {}],
      ['money', 'tax_zone', {}],
      ['identity', 'nid_number', { revealIdentifiers: true }],
      ['identity', 'religion', {}],
      ['identity', 'accessibility_needs', {}],
      ['travel_documents', 'passport_number', {}],
      ['identity', 'not_a_field', {}],
      ['identity', '', {}],
      ['identity', 'x'.repeat(65), {}],
    ] as const) {
      expect(decideSuggestionField({ ...base, ...extra, section, field }), field).toBeNull();
    }
    expect(
      decideSuggestionField({
        ...base,
        revealIdentifiers: true,
        section: 'travel_documents',
        field: 'passport_number',
      })?.key,
    ).toBe('passport_number');
  });
});

describe('a reminder’s due date', () => {
  const now = new Date('2026-10-30T20:00:00Z');
  it('is a real day from today, in the traveller’s own calendar, up to five years ahead', () => {
    // 30 Oct 20:00 UTC is already 31 Oct in Dhaka.
    expect(reminderDueDate('2026-10-30', now, 'Asia/Dhaka')).toBeNull();
    expect(reminderDueDate('2026-10-31', now, 'Asia/Dhaka')?.toISOString()).toBe(
      '2026-10-31T00:00:00.000Z',
    );
    expect(reminderDueDate('2026-10-30', now, 'UTC')).not.toBeNull();
    expect(reminderDueDate('2027-02-30', now, 'UTC')).toBeNull();
    expect(reminderDueDate('31-12-2027', now, 'UTC')).toBeNull();
    expect(reminderDueDate('2032-01-01', now, 'UTC')).toBeNull();
    expect(reminderDueDate('2031-10-30', now, 'UTC')).not.toBeNull();
  });
});
