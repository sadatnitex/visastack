import { describe, expect, it } from 'vitest';
import {
  READING_SOURCE_LABELS,
  READING_SOURCE_NOTES,
  readingOffer,
  readingStatusCopy,
} from './document-reading';
import { isTitleCase } from './title-case';

/** S6 (ADR 0019): the plain words for how a file is being read. */

const DASH = String.fromCodePoint(0x2014);
const NEVER_SAY =
  /\b(ocr|mrz|token|scope|webhook|model|prompt|provider|pipeline|queue|worker|job)\b/i;

describe('the five reading states', () => {
  it('names each state as ADR 0019 does, in Title Case', () => {
    const names = (
      [
        { stage: 'checking' },
        { stage: 'reading' },
        { stage: 'found' },
        { stage: 'could_not_read' },
        { stage: 'needs_attention' },
      ] as const
    ).map((state) => readingStatusCopy(state)?.title);
    expect(names).toEqual([
      'Checking the File',
      'Reading the File',
      'We Found These Details',
      'We Could Not Read This One',
      'Needs Attention',
    ]);
    for (const name of names) expect(isTitleCase(name ?? ''), name).toBe(true);
  });

  it('says nothing once every suggestion has been decided', () => {
    expect(readingStatusCopy({ stage: 'done' })).toBeNull();
  });

  it('reassures that nothing is saved until the person accepts', () => {
    expect(readingStatusCopy({ stage: 'found' })?.body).toContain(
      'Nothing is saved to your profile until you accept it.',
    );
  });

  it('always leaves a way forward for a file that could not be read', () => {
    const reasons = [
      'NOTHING_FOUND',
      'NOT_TRIED',
      'NO_CONSENT',
      'SWITCHED_OFF',
      'PROTECTED',
      'LIMIT_REACHED',
      'COULD_NOT_READ',
      'NOTHING_TO_READ',
    ] as const;
    for (const reason of reasons) {
      const plain = readingStatusCopy({ stage: 'could_not_read', reason });
      expect(plain?.body, reason).toContain('Add the details yourself.');
      expect(plain?.body, reason).not.toContain('Read Again');
      const retry = readingStatusCopy({ stage: 'could_not_read', reason }, { canReadAgain: true });
      expect(retry?.body, reason).toContain('Add the details yourself, or try Read Again.');
    }
  });

  it('says a file stopped by today’s limit is not read by itself later (S28 round 2)', () => {
    const plain = readingStatusCopy({ stage: 'could_not_read', reason: 'DAILY_LIMIT' });
    expect(plain?.body).toContain(
      'This file was not read because today’s limit for Automatic Reading is used up. Choose Read Again after 6 AM Bangladesh time.',
    );
    expect(plain?.body).not.toContain('starts again');
  });

  it('keeps the page’s own advice for a file that needs attention', () => {
    const advice = 'Try a different copy, such as a clearer scan.';
    expect(readingStatusCopy({ stage: 'needs_attention' }, { problemNextStep: advice })?.body).toBe(
      advice,
    );
    expect(readingStatusCopy({ stage: 'needs_attention' })?.body).toContain('could not be used');
  });

  it('uses plain words only, with no dash and no engineering terms', () => {
    const stages = ['checking', 'reading', 'found', 'could_not_read', 'needs_attention'] as const;
    const text = [
      ...stages.map((stage) =>
        JSON.stringify(readingStatusCopy({ stage }, { canReadAgain: true })),
      ),
      ...Object.values(READING_SOURCE_LABELS),
      ...Object.values(READING_SOURCE_NOTES),
      JSON.stringify(
        readingOffer({
          detailsAvailable: true,
          scansAvailable: true,
          detailsGranted: false,
          scansGranted: false,
        }),
      ),
    ].join(' ');
    expect(text).not.toContain(DASH);
    expect(text).not.toMatch(NEVER_SAY);
  });
});

describe('where a suggestion came from', () => {
  it('names the four sources in Title Case and explains each', () => {
    expect(READING_SOURCE_LABELS).toEqual({
      machine_readable: 'Read from the Machine-Readable Lines',
      document_text: 'Read from the Document',
      ai_image: 'Read with AI',
      // S21: a suggestion the person's own AI app made, not a reading of the file.
      ai_app: 'Suggested by an AI App',
    });
    for (const label of Object.values(READING_SOURCE_LABELS)) {
      expect(isTitleCase(label), label).toBe(true);
    }
    expect(READING_SOURCE_NOTES.machine_readable).toContain('No AI was used.');
    expect(READING_SOURCE_NOTES.document_text).toContain('An AI service picked out the details');
    expect(READING_SOURCE_NOTES.ai_image).toContain('AI service');
    expect(READING_SOURCE_NOTES.ai_app).toContain('not read from the file by VisaStack');
  });
});

describe('the one invitation to switch AI reading on', () => {
  const base = {
    detailsAvailable: true,
    scansAvailable: true,
    detailsGranted: false,
    scansGranted: false,
  };

  it('asks once, in ADR 0019’s words, when reading is off', () => {
    const offer = readingOffer(base);
    expect(offer?.question).toBe('Want VisaStack to read your documents for you?');
    expect(offer?.action).toBe('Turn On Reading with AI');
    expect(isTitleCase(offer?.action ?? '')).toBe(true);
    expect(offer?.detail).toContain('You still accept every detail yourself');
  });

  it('asks only for what is missing', () => {
    const scansOnly = readingOffer({ ...base, detailsGranted: true });
    expect(scansOnly?.question).toBe('Want scans and photos read too?');
    expect(scansOnly?.detail).toContain('shares the picture with an AI service');
    expect(isTitleCase(scansOnly?.action ?? '')).toBe(true);
  });

  it('stays quiet when reading is on, or cannot be used on this platform', () => {
    expect(readingOffer({ ...base, detailsGranted: true, scansGranted: true })).toBeNull();
    expect(readingOffer({ ...base, detailsAvailable: false, scansAvailable: false })).toBeNull();
    // Scans are switched off but not offered here: nothing to ask for.
    expect(readingOffer({ ...base, detailsGranted: true, scansAvailable: false })).toBeNull();
  });
});
