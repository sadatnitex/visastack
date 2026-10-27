import { describe, expect, it } from 'vitest';
import { SAVING_TEXT, formatMoment, notSavedText, saveResult, savedAtText } from './save-status';

// 27 Oct 2026, 08:32 UTC: 14:32 in Dhaka (UTC+6), 04:32 in New York (UTC-4 on that date).
const AT = '2026-10-27T08:32:00.000Z';

describe('Saved at', () => {
  it("shows the time in the person's own zone and names the zone", () => {
    expect(savedAtText(AT, 'Asia/Dhaka')).toBe('Saved at 14:32 GMT+6');
    expect(savedAtText(AT, 'America/New_York')).toBe('Saved at 04:32 GMT-4');
    expect(savedAtText(new Date(AT), 'UTC')).toBe('Saved at 08:32 UTC');
  });

  it('falls back to the reader zone for a name it does not know, and never throws', () => {
    expect(savedAtText(AT, 'Not/AZone')).toMatch(/^Saved at \d{2}:\d{2} \S+/);
    expect(savedAtText(AT, null)).toMatch(/^Saved at \d{2}:\d{2} \S+/);
    expect(savedAtText(AT)).toMatch(/^Saved at \d{2}:\d{2} \S+/);
  });

  it('gives the day too when a moment is shown on its own', () => {
    expect(formatMoment(AT, 'Asia/Dhaka')).toBe('27 Oct 2026, 14:32 GMT+6');
  });
});

describe('Not saved', () => {
  it('says why and how to go on, without telling the person twice', () => {
    expect(notSavedText('Choose what to submit.')).toBe(
      'Not saved. Choose what to submit. Try again.',
    );
    expect(notSavedText('Choose what to submit')).toBe(
      'Not saved. Choose what to submit. Try again.',
    );
    expect(notSavedText('Something went wrong. Try again.')).toBe(
      'Not saved. Something went wrong. Try again.',
    );
    expect(notSavedText('   ')).toBe('Not saved. Try again.');
    expect(notSavedText('this request is closed')).toBe(
      'Not saved. This request is closed. Try again.',
    );
  });
});

describe('what a form shows for its latest result', () => {
  it('shows nothing before anything was sent', () => {
    expect(saveResult({ ok: true, message: '' }, 'Asia/Dhaka')).toEqual({ ok: true, message: '' });
  });

  it('shows Saved at only for a success the server timestamped', () => {
    expect(
      saveResult({ ok: true, message: 'The agency will review it.', savedAt: AT }, 'Asia/Dhaka'),
    ).toEqual({ ok: true, message: 'Saved at 14:32 GMT+6. The agency will review it.' });
    expect(saveResult({ ok: true, message: '', savedAt: AT }, 'UTC')).toEqual({
      ok: true,
      message: 'Saved at 08:32 UTC.',
    });
    // A success with no confirmed time is passed through, never given a made-up one.
    expect(saveResult({ ok: true, message: 'Done.' })).toEqual({ ok: true, message: 'Done.' });
  });

  it('turns every failure into Not saved, even one that arrives with a time', () => {
    expect(saveResult({ ok: false, message: 'Not authorized.', savedAt: AT })).toEqual({
      ok: false,
      message: 'Not saved. Not authorized. Try again.',
    });
  });

  it('uses one word for the working state', () => {
    expect(SAVING_TEXT).toBe('Saving…');
  });
});
