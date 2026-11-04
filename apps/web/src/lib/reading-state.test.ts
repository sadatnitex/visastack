import { describe, expect, it } from 'vitest';
import { describeReading } from './reading-state';
import { isTitleCase } from './title-case';

const on = { available: true, reason: null } as const;

describe('describeReading', () => {
  it('says on only when reading can run and both kinds are allowed', () => {
    const view = describeReading({ feature: on, extraction: true, ocr: true });
    expect(view).toMatchObject({ status: 'on', reads: true, canChange: true });
  });

  it('says partly on, and which kind is missing, when only one is allowed', () => {
    const text = describeReading({ feature: on, extraction: true, ocr: false });
    expect(text).toMatchObject({ status: 'partly_on', reads: true });
    expect(text.detail).toContain('Scanned pages are not read');
    const scans = describeReading({ feature: on, extraction: false, ocr: true });
    expect(scans).toMatchObject({ status: 'partly_on', reads: true });
    expect(scans.detail).toContain('The text of a file is not read');
  });

  it('says off for the person when reading can run but they have not allowed it', () => {
    expect(describeReading({ feature: on, extraction: false, ocr: false })).toMatchObject({
      status: 'needs_consent',
      reads: false,
      canChange: true,
    });
  });

  it('never says on, and offers no switch, when reading cannot run, whatever the person allowed', () => {
    for (const reason of [
      'platform_off',
      'turned_off',
      'not_in_plan',
      'daily_limit',
      'not_available_yet',
    ] as const) {
      const view = describeReading({
        feature: { available: false, reason },
        extraction: true,
        ocr: true,
      });
      expect(view).toMatchObject({ status: 'off', reads: false, canChange: false });
      expect(view.headline).toBe('Automatic Reading Is Off');
    }
  });

  it('says off, not on, when the state could not be read at all', () => {
    expect(describeReading({ feature: null, extraction: true, ocr: true })).toMatchObject({
      status: 'off',
      reads: false,
      canChange: false,
    });
  });

  it('names the plan and the daily limit plainly', () => {
    expect(
      describeReading({
        feature: { available: false, reason: 'not_in_plan' },
        extraction: false,
        ocr: false,
      }).detail,
    ).toContain('not part of your plan');
    expect(
      describeReading({
        feature: { available: false, reason: 'daily_limit' },
        extraction: false,
        ocr: false,
      }).detail,
    ).toContain("Today's reading limit is used up");
  });

  it('writes every headline in Title Case and keeps engineering words and long dashes out', () => {
    const views = [
      describeReading({ feature: on, extraction: true, ocr: true }),
      describeReading({ feature: on, extraction: true, ocr: false }),
      describeReading({ feature: on, extraction: false, ocr: false }),
      describeReading({ feature: null, extraction: false, ocr: false }),
    ];
    for (const view of views) {
      expect(isTitleCase(view.headline)).toBe(true);
      expect(`${view.headline} ${view.detail}`).not.toMatch(
        /—|consent flag|feature flag|API|token/i,
      );
    }
  });
});
