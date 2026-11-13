import { expiryDay, expiryDayCountsAsExpired } from '@visastack/services';
import type { DocumentSummary } from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { formatDateOnly } from '../../../../../lib/format-date';
import {
  buildDocumentChoices,
  chooseLegendId,
  clearerCopyTarget,
  expiryDayIsExpired,
  initialChoice,
  isCurrentCopy,
} from './response-choices';

const doc = (id: string, over: Partial<DocumentSummary> = {}): DocumentSummary =>
  ({
    id,
    originalName: `${id}.pdf`,
    approvedName: null,
    docType: 'BANK_STATEMENT',
    latestVersionId: `v-${id}`,
    safetyStatus: 'CLEAN',
    processingStatus: 'AWAITING_REVIEW',
    createdAt: '2026-10-01T00:00:00Z',
    ...over,
  }) as DocumentSummary;

const build = (
  documents: DocumentSummary[],
  over: Partial<Parameters<typeof buildDocumentChoices>[0]> = {},
) =>
  buildDocumentChoices({
    documents,
    docType: 'BANK_STATEMENT',
    everyday: new Set(documents.map((d) => d.id.toLowerCase())),
    scan: new Map(),
    timeZone: 'Asia/Dhaka',
    sentBackDocumentId: null,
    ...over,
  });

describe('the copies offered for one request', () => {
  it('offers only documents of the kind asked for that are still everyday copies', () => {
    const choices = build(
      [doc('a'), doc('b', { docType: 'PASSPORT' }), doc('c'), doc('d', { latestVersionId: null })],
      { everyday: new Set(['a', 'b', 'd']) },
    );
    expect(choices.map((c) => c.documentId)).toEqual(['a']);
  });

  it('offers nothing for a request that names no kind', () => {
    expect(build([doc('a')], { docType: null })).toEqual([]);
  });

  it('puts the newest first and marks it only when there is a choice to make', () => {
    const two = build([
      doc('old', { createdAt: '2026-10-01T00:00:00Z' }),
      doc('new', { createdAt: '2026-10-09T00:00:00Z' }),
    ]);
    expect(two.map((c) => [c.documentId, c.newest])).toEqual([
      ['new', true],
      ['old', false],
    ]);
    expect(build([doc('only')])[0]?.newest).toBe(false);
  });

  it('names the file by its approved name first, and the exact version it would send', () => {
    const [choice] = build([doc('a', { approvedName: 'March Statement' })]);
    expect(choice).toMatchObject({
      name: 'March Statement',
      versionId: 'v-a',
      kindLabel: 'Bank Statement',
    });
  });

  it('words the time in the traveller own zone, with the zone', () => {
    const [choice] = build([doc('a', { createdAt: '2026-10-27T08:32:00Z' })]);
    expect(choice?.addedLabel).toBe('27 Oct 2026, 14:32 GMT+6');
  });

  it('says a copy cannot be sent until it has passed its checks, and says how it was checked', () => {
    const choices = build([
      doc('a', { safetyStatus: 'SCANNING', createdAt: '2026-10-02T00:00:00Z' }),
      doc('b', { processingStatus: 'FAILED', createdAt: '2026-10-01T00:00:00Z' }),
    ]);
    expect(choices.map((c) => c.usable)).toEqual([false, false]);
    expect(choices[0]?.scanLabel).toBe('Waiting to Be Checked');
  });

  it('marks the copy the agency sent back, whatever the letter case of its id', () => {
    const choices = build([doc('ABC'), doc('def')], { sentBackDocumentId: 'abc' });
    expect(choices.map((c) => c.sentBack).sort()).toEqual([false, true]);
    expect(clearerCopyTarget(choices)?.documentId).toBe('ABC');
    expect(clearerCopyTarget(build([doc('x')]))).toBeNull();
  });
});

describe('what is chosen before the person chooses', () => {
  it('is the only usable copy, unless the agency sent that copy back', () => {
    expect(initialChoice(build([doc('a')]))).toBe('a');
    expect(initialChoice(build([doc('a')], { sentBackDocumentId: 'a' }))).toBe('');
  });

  it('is nothing when several copies can be sent', () => {
    expect(initialChoice(build([doc('a'), doc('b')]))).toBe('');
  });

  it('ignores a copy that cannot be sent when counting', () => {
    const choices = build([doc('a'), doc('b', { safetyStatus: 'QUARANTINED' })]);
    expect(initialChoice(choices)).toBe('a');
  });
});

describe('the heading focus returns to', () => {
  it('is one stable id per request', () => {
    expect(chooseLegendId('r1')).toBe('choose-r1');
  });
});

describe('the expiry note on each copy (new)', () => {
  const NOW = new Date('2026-11-12T09:00:00Z');
  const noted = (expiresAt: string | null) =>
    buildDocumentChoices(
      {
        documents: [doc('a', { expiresAt })],
        docType: 'BANK_STATEMENT',
        everyday: new Set(['a']),
        scan: new Map(),
        timeZone: 'Asia/Dhaka',
        sentBackDocumentId: null,
        words: { expires: (date) => `Expires ${date}`, expired: (date) => `Expired on ${date}` },
      },
      NOW,
    )[0];

  it('says when a copy expires, in the plain tone, when the day is still ahead', () => {
    expect(noted('2031-03-12T00:00:00.000Z')).toMatchObject({
      dateNote: `Expires ${formatDateOnly('2031-03-12')}`,
      expired: false,
    });
  });

  it('says a copy expired, in the warning tone, when the day has passed', () => {
    expect(noted('2025-03-12T00:00:00.000Z')).toMatchObject({
      dateNote: `Expired on ${formatDateOnly('2025-03-12')}`,
      expired: true,
    });
  });

  it('counts the day itself as expired, as the readiness rule does, and tomorrow as not yet', () => {
    expect(noted('2026-11-12T00:00:00.000Z')?.expired).toBe(true);
    expect(noted('2026-11-13T00:00:00.000Z')?.expired).toBe(false);
  });

  it('writes no note without words, but still says whether the copy is expired', () => {
    const [choice] = buildDocumentChoices(
      {
        documents: [doc('a', { expiresAt: '2025-03-12T00:00:00.000Z' })],
        docType: 'BANK_STATEMENT',
        everyday: new Set(['a']),
        scan: new Map(),
        timeZone: null,
        sentBackDocumentId: null,
      },
      NOW,
    );
    expect(choice).toMatchObject({ dateNote: null, expired: true });
  });

  it('keeps no note when no expiry date is saved', () => {
    expect(noted(null)).toMatchObject({ dateNote: null, expired: false });
    expect(build([doc('a')])[0]).toMatchObject({ dateNote: null, expired: false });
  });

  it('words the note from the words it is given, so a catalogue can supply them', () => {
    const [choice] = buildDocumentChoices(
      {
        documents: [doc('a', { expiresAt: '2031-03-12T00:00:00.000Z' })],
        docType: 'BANK_STATEMENT',
        everyday: new Set(['a']),
        scan: new Map(),
        timeZone: null,
        sentBackDocumentId: null,
        words: { expires: (date) => `E:${date}`, expired: (date) => `X:${date}` },
      },
      NOW,
    );
    expect(choice?.dateNote).toBe(`E:${formatDateOnly('2031-03-12')}`);
  });

  it('no longer chooses an expired only-copy in advance (it was chosen before 13 Nov 2026)', () => {
    const only = buildDocumentChoices(
      {
        documents: [doc('a', { expiresAt: '2025-03-12T00:00:00.000Z' })],
        docType: 'BANK_STATEMENT',
        everyday: new Set(['a']),
        scan: new Map(),
        timeZone: null,
        sentBackDocumentId: null,
      },
      NOW,
    );
    expect(only[0]?.expired).toBe(true);
    expect(initialChoice(only)).toBe('');
  });
});

describe('the expired rule matches the services rule', () => {
  const DAY = 24 * 60 * 60 * 1000;
  it.each([
    ['yesterday', -DAY],
    ['today', 0],
    ['tomorrow', DAY],
  ])('for a document expiring %s', (_label, offset) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + offset).toISOString();
    const [choice] = buildDocumentChoices(
      {
        documents: [doc('a', { expiresAt })],
        docType: 'BANK_STATEMENT',
        everyday: new Set(['a']),
        scan: new Map(),
        timeZone: null,
        sentBackDocumentId: null,
      },
      now,
    );
    expect(choice?.expired).toBe(expiryDayCountsAsExpired(expiryDay(new Date(expiresAt)), now));
  });
});

describe('expiryDayIsExpired (new)', () => {
  it('compares calendar days in UTC', () => {
    const now = new Date('2026-11-12T23:30:00Z');
    expect(expiryDayIsExpired('2026-11-11', now)).toBe(true);
    expect(expiryDayIsExpired('2026-11-12', now)).toBe(true);
    expect(expiryDayIsExpired('2026-11-13', now)).toBe(false);
  });
});

describe('the choice made in advance (outdated and rejected copies are never chosen for the person)', () => {
  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString();
  };
  const words = {
    expires: (date: string) => `Expires ${date}`,
    expired: (date: string) => `Expired on ${date}`,
    uncertain: 'The dates do not agree.',
  };

  it('chooses the only copy when it is in date', () => {
    const choices = build([doc('a', { expiresAt: day(400) })], { words });
    expect(initialChoice(choices)).toBe('a');
  });

  it('does not choose the only copy when it has expired, but still offers it to choose on purpose', () => {
    const choices = build([doc('a', { expiresAt: day(-30) })], { words });
    expect(choices).toHaveLength(1);
    expect(choices[0]?.expired).toBe(true);
    expect(choices[0]?.usable).toBe(true);
    expect(initialChoice(choices)).toBe('');
  });

  it('does not choose a copy whose saved dates disagree, and says so', () => {
    const choices = build(
      [
        doc('a', {
          expiresAt: day(400),
          expiry: { origin: 'READ', typedOn: null, mismatch: true, canType: true },
        }),
      ],
      { words },
    );
    expect(choices[0]?.uncertainDate).toBe(true);
    expect(choices[0]?.uncertainNote).toBe('The dates do not agree.');
    expect(initialChoice(choices)).toBe('');
  });

  it('does not choose the copy that was sent back', () => {
    const choices = build([doc('a', { expiresAt: day(400) })], { sentBackDocumentId: 'a' });
    expect(initialChoice(choices)).toBe('');
  });

  it('treats a newer version of the sent-back document as a different copy when the version is pinned', () => {
    const documents = [doc('a', { latestVersionId: 'v2', expiresAt: day(400) })];
    // The agency judged version 1; version 2 is the corrected copy.
    const corrected = build(documents, { sentBackDocumentId: 'a', sentBackVersionId: 'v1' });
    expect(corrected[0]?.sentBack).toBe(false);
    expect(initialChoice(corrected)).toBe('a');
    // The same version is still the rejected one.
    const same = build(documents, { sentBackDocumentId: 'a', sentBackVersionId: 'v2' });
    expect(same[0]?.sentBack).toBe(true);
    expect(initialChoice(same)).toBe('');
  });

  it('marks every version of the document as sent back when only the document is known', () => {
    const documents = [doc('a', { latestVersionId: 'v9', expiresAt: day(400) })];
    expect(build(documents, { sentBackDocumentId: 'a' })[0]?.sentBack).toBe(true);
  });

  it('keeps leaving the choice to the person when two copies fit', () => {
    const choices = build([doc('a', { expiresAt: day(400) }), doc('b', { expiresAt: day(500) })]);
    expect(initialChoice(choices)).toBe('');
  });

  it('chooses the one in-date copy when an expired one sits beside it only if it is the single usable one', () => {
    const choices = build(
      [
        doc('old', { expiresAt: day(-30) }),
        doc('new', { expiresAt: day(400), createdAt: '2026-11-01T00:00:00Z' }),
      ],
      { words },
    );
    // Both are usable, so nothing is chosen in advance: an expired copy is still on the list.
    expect(initialChoice(choices)).toBe('');
    expect(choices.filter(isCurrentCopy).map((c) => c.documentId)).toEqual(['new']);
  });
});
