import { describe, expect, it } from 'vitest';
import { type ProgressCardModel, progressCardModel } from './card-model';

/** Every word the card draws, in the order it draws them (card-image.tsx). */
function progressCardWords(model: ProgressCardModel): readonly string[] {
  return [
    model.kicker,
    ...(model.place ? [model.place.name] : []),
    `${model.percent}%`,
    model.countLine,
    model.note,
    model.brand,
  ];
}

const EM_DASH = String.fromCodePoint(0x2014);

describe('the progress card words', () => {
  it('says the count, the country by its own name and the brand, and that it is not a decision', () => {
    const model = progressCardModel({
      satisfiedRequired: 8,
      requiredCount: 12,
      destination: 'Japan',
      finished: false,
    });
    expect(model.countLine).toBe('8 of 12 items ready');
    expect(model.percent).toBe(67);
    expect(model.place).toEqual({ name: 'Japan', iso2: 'jp', hasFlag: true });
    expect(progressCardWords(model)).toEqual([
      'Case Progress',
      'Japan',
      '67%',
      '8 of 12 items ready',
      'Counts what is gathered, not a visa decision.',
      'VisaStack',
    ]);
  });

  it('never draws the saved destination text: free text that names no country gives no place at all', () => {
    for (const destination of ['Visit Rahima Akter in Osaka', 'A1234567', 'VS-7Q2K-91', null, '']) {
      const model = progressCardModel({
        satisfiedRequired: 1,
        requiredCount: 2,
        destination,
        finished: false,
      });
      expect(model.place).toBeNull();
      const words = progressCardWords(model).join(' ');
      expect(words).not.toMatch(/Rahima|Akter|Osaka|A1234567|VS-7Q2K/);
    }
  });

  it('carries no approval language, no em dash and Title Case headings', () => {
    const words = progressCardWords(
      progressCardModel({
        satisfiedRequired: 3,
        requiredCount: 3,
        destination: 'GB',
        finished: true,
      }),
    );
    const text = words.join(' ');
    expect(text).not.toMatch(/approv|accept|guarantee|cleared|granted|eligible|success/i);
    expect(text).not.toContain(EM_DASH);
    expect(text.toLowerCase()).not.toContain('mission');
    expect(words[0]).toBe('Finished Case');
  });

  it('keeps counts whole, never negative and never above the total', () => {
    const odd = progressCardModel({
      satisfiedRequired: 15,
      requiredCount: 12.7,
      destination: null,
      finished: false,
    });
    expect([odd.done, odd.total, odd.percent]).toEqual([12, 12, 100]);
    const empty = progressCardModel({
      satisfiedRequired: -2,
      requiredCount: Number.NaN,
      destination: null,
      finished: false,
    });
    expect([empty.done, empty.total, empty.percent]).toEqual([0, 0, 0]);
  });
});
