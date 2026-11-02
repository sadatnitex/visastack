import { describe, expect, it } from 'vitest';
import {
  type DocumentSignals,
  type RelationCandidate,
  parseStatementDate,
  proposeDocumentRelation,
  readAccountEnding,
  readDocumentSignals,
  readStatementPeriod,
  relationLabels,
} from './umpe-document-relations';

// Synthetic TD3 lines (the ICAO specimen, check digits valid), and a second number for the same
// holder built with valid check digits.
const SPECIMEN_1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
const SPECIMEN_2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

const NONE: DocumentSignals = { passport: null, period: null, accountEnding: null };

function passport(number: string, expiry: string, holder = 'ERIKSSON|ANNA MARIA|1974-08-12|UTO') {
  return { passport: { holderKey: holder, number, expiry }, period: null, accountEnding: null };
}

function statement(start: string, end: string, account: string | null = '1234'): DocumentSignals {
  return { passport: null, period: { start, end }, accountEnding: account };
}

function candidate(
  documentId: string,
  docType: string | null,
  signals: DocumentSignals,
  extra: Partial<RelationCandidate> = {},
): RelationCandidate {
  return {
    documentId,
    docType,
    signals,
    versionHashes: [],
    createdAt: new Date('2026-10-01T00:00:00Z'),
    ...extra,
  };
}

describe('reading the period a statement covers', () => {
  it('reads a range in the usual forms, day first when ambiguous', () => {
    expect(readStatementPeriod('Statement Period: 01/03/2026 to 31/03/2026')).toEqual({
      start: '2026-03-01',
      end: '2026-03-31',
    });
    expect(readStatementPeriod('From 1 March 2026 To 31 March 2026')).toEqual({
      start: '2026-03-01',
      end: '2026-03-31',
    });
    expect(readStatementPeriod('Period 2026-04-01 - 2026-04-30')).toEqual({
      start: '2026-04-01',
      end: '2026-04-30',
    });
  });

  it('reads a whole month', () => {
    expect(readStatementPeriod('Pay Slip for the Month of February 2028')).toEqual({
      start: '2028-02-01',
      end: '2028-02-29',
    });
    expect(readStatementPeriod('Statement for March 2026')).toEqual({
      start: '2026-03-01',
      end: '2026-03-31',
    });
  });

  it('refuses an impossible date or an end before the start', () => {
    expect(parseStatementDate('31/02/2026')).toBeNull();
    expect(parseStatementDate('03/31/2026')).toBe('2026-03-31');
    expect(readStatementPeriod('Period: 31/03/2026 to 01/03/2026')).toBeNull();
    expect(readStatementPeriod('No dates here at all')).toBeNull();
  });

  it('reads only the last four digits of an account number', () => {
    expect(readAccountEnding('Account Number: XXXX-XXXX-5678')).toBe('5678');
    expect(readAccountEnding('Account No. 0012345678')).toBe('5678');
    expect(readAccountEnding('Account Number: 12')).toBeNull();
    expect(readAccountEnding('no account here')).toBeNull();
  });
});

describe('the signals one document gives', () => {
  it('reads a passport only from verified machine-readable lines', () => {
    const signals = readDocumentSignals(`PASSPORT\n${SPECIMEN_1}\n${SPECIMEN_2}\n`, 'PASSPORT');
    expect(signals.passport).toEqual({
      holderKey: 'ERIKSSON|ANNA MARIA|1974-08-12|UTO',
      number: 'L898902C3',
      expiry: '2012-04-15',
    });
    const broken = SPECIMEN_2.replace('L898902C36', 'L898902C37');
    expect(readDocumentSignals(`${SPECIMEN_1}\n${broken}`, 'PASSPORT').passport).toBeNull();
  });

  it('reads nothing for a kind it does not compare, or without a kind', () => {
    expect(readDocumentSignals('Statement Period: 01/03/2026 to 31/03/2026', null)).toEqual(NONE);
    expect(readDocumentSignals('Statement Period: 01/03/2026 to 31/03/2026', 'VISA')).toEqual(NONE);
  });
});

describe('the one relation proposed for a new document', () => {
  it('calls the same bytes an exact duplicate, whatever the kind', () => {
    const proposal = proposeDocumentRelation(
      { documentId: 'new', sha256: 'abc', docType: null, signals: NONE },
      [candidate('old', 'VISA', NONE, { versionHashes: ['zzz', 'abc'] })],
    );
    expect(proposal).toEqual({
      relatedDocumentId: 'old',
      relation: 'EXACT_DUPLICATE',
      newIsCurrent: false,
      signals: ['same_file'],
    });
  });

  it('calls a passport with the same holder and number a corrected scan', () => {
    const proposal = proposeDocumentRelation(
      {
        documentId: 'new',
        sha256: 'b',
        docType: 'PASSPORT',
        signals: passport('A1', '2030-01-01'),
      },
      [candidate('old', 'PASSPORT', passport('A1', '2030-01-01'))],
    );
    expect(proposal?.relation).toBe('CORRECTED_SCAN');
    expect(proposal?.newIsCurrent).toBe(true);
  });

  it('calls a new number for the same holder a renewal, current by the later expiry', () => {
    const newer = proposeDocumentRelation(
      {
        documentId: 'new',
        sha256: 'b',
        docType: 'PASSPORT',
        signals: passport('B2', '2036-01-01'),
      },
      [candidate('old', 'PASSPORT', passport('A1', '2026-01-01'))],
    );
    expect(newer).toMatchObject({ relation: 'RENEWED', newIsCurrent: true });
    expect(newer?.signals).toContain('later_expiry');
    const olderArrivingLate = proposeDocumentRelation(
      {
        documentId: 'new',
        sha256: 'b',
        docType: 'PASSPORT',
        signals: passport('A1', '2026-01-01'),
      },
      [candidate('old', 'PASSPORT', passport('B2', '2036-01-01'))],
    );
    expect(olderArrivingLate).toMatchObject({ relation: 'RENEWED', newIsCurrent: false });
  });

  it('never relates two people, two kinds or two accounts', () => {
    const subject = {
      documentId: 'new',
      sha256: 'b',
      docType: 'PASSPORT',
      signals: passport('B2', '2036-01-01'),
    };
    expect(
      proposeDocumentRelation(subject, [
        candidate('other', 'PASSPORT', passport('A1', '2026-01-01', 'SOMEONE|ELSE|1990-01-01|UTO')),
      ]),
    ).toBeNull();
    expect(
      proposeDocumentRelation(subject, [candidate('visa', 'VISA', passport('A1', '2026-01-01'))]),
    ).toBeNull();
    expect(
      proposeDocumentRelation(
        {
          documentId: 'new',
          sha256: 'b',
          docType: 'BANK_STATEMENT',
          signals: statement('2026-04-01', '2026-04-30', '1234'),
        },
        [candidate('old', 'BANK_STATEMENT', statement('2026-03-01', '2026-03-31', '9999'))],
      ),
    ).toBeNull();
  });

  it('tells a new period from a corrected scan of the same period, nearest period first', () => {
    const subject = {
      documentId: 'april',
      sha256: 'b',
      docType: 'BANK_STATEMENT',
      signals: statement('2026-04-01', '2026-04-30'),
    };
    const nearest = proposeDocumentRelation(subject, [
      candidate('jan', 'BANK_STATEMENT', statement('2026-01-01', '2026-01-31')),
      candidate('march', 'BANK_STATEMENT', statement('2026-03-01', '2026-03-31')),
    ]);
    expect(nearest).toMatchObject({
      relatedDocumentId: 'march',
      relation: 'NEW_PERIOD',
      newIsCurrent: true,
    });
    expect(nearest?.signals).toEqual(['same_type', 'different_period', 'same_account']);
    const corrected = proposeDocumentRelation(subject, [
      candidate('march', 'BANK_STATEMENT', statement('2026-03-01', '2026-03-31')),
      candidate('april-first', 'BANK_STATEMENT', statement('2026-04-01', '2026-04-30')),
    ]);
    expect(corrected).toMatchObject({
      relatedDocumentId: 'april-first',
      relation: 'CORRECTED_SCAN',
    });
  });

  it('proposes nothing without a signal that settles it', () => {
    expect(
      proposeDocumentRelation(
        { documentId: 'new', sha256: 'b', docType: 'BANK_STATEMENT', signals: NONE },
        [candidate('old', 'BANK_STATEMENT', NONE)],
      ),
    ).toBeNull();
    expect(
      proposeDocumentRelation({ documentId: 'new', sha256: null, docType: null, signals: NONE }, [
        candidate('old', null, NONE),
      ]),
    ).toBeNull();
  });

  it('gives each side a plain label', () => {
    expect(relationLabels('EXACT_DUPLICATE', false)).toEqual({
      newDocument: 'Same as an Existing Copy',
      relatedDocument: 'Current Copy',
    });
    expect(relationLabels('CORRECTED_SCAN', true)).toEqual({
      newDocument: 'Current Copy',
      relatedDocument: 'Earlier Copy',
    });
    expect(relationLabels('RENEWED', true).newDocument).toBe('Renewed');
    expect(relationLabels('NEW_PERIOD', true).newDocument).toBe('New Period');
  });
});
