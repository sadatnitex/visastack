import {
  type EvidenceSubmissionList,
  type EvidenceSubmissionView,
  LEGACY_SEND_LABEL,
} from '@visastack/services';
import { describe, expect, it } from 'vitest';
import { sentBackCopyOf } from './sent-back-copy';

const send = (over: Partial<EvidenceSubmissionView>): EvidenceSubmissionView =>
  ({
    id: 's1',
    roundNo: 1,
    documentId: 'doc-1',
    documentVersionId: 'ver-1',
    versionNumber: 1,
    docType: 'BANK_STATEMENT',
    title: 'statement.pdf',
    sizeBytes: 10,
    checksumFingerprint: null,
    sentAt: new Date('2026-11-01T10:00:00Z'),
    state: 'NEEDS_REPLACEMENT',
    decidedAt: new Date('2026-11-02T10:00:00Z'),
    reason: 'Page 2 is cut off.',
    fileAvailable: false,
    safetyStatus: null,
    ...over,
  }) as EvidenceSubmissionView;

const list = (
  submissions: EvidenceSubmissionView[],
  legacy: EvidenceSubmissionList['legacy'] = [],
): EvidenceSubmissionList => ({ available: true, submissions, legacy });

describe('which copy the agency sent back', () => {
  it('says nothing unless the request waits on a corrected answer', () => {
    for (const status of ['OPEN', 'RECEIVED', 'UNDER_REVIEW', 'ACCEPTED', 'CANCELLED']) {
      expect(sentBackCopyOf(status, list([send({})]))).toEqual({ state: 'none' });
    }
  });

  it('names the exact copy, its version and the reason, from the decision history', () => {
    expect(sentBackCopyOf('NEEDS_REPLACEMENT', list([send({})]))).toEqual({
      state: 'copy',
      copy: {
        precision: 'exact',
        documentId: 'doc-1',
        versionId: 'ver-1',
        versionNumber: 1,
        title: 'statement.pdf',
        sentAt: new Date('2026-11-01T10:00:00Z'),
        reason: 'Page 2 is cut off.',
      },
    });
  });

  it('takes the newest sent-back copy after a rejection, a correction and a second rejection', () => {
    const read = sentBackCopyOf(
      'NEEDS_REPLACEMENT',
      list([
        send({ id: 's1', roundNo: 1, documentId: 'doc-1', documentVersionId: 'ver-1' }),
        send({
          id: 's2',
          roundNo: 2,
          documentId: 'doc-2',
          documentVersionId: 'ver-2',
          versionNumber: 1,
          decidedAt: new Date('2026-11-05T10:00:00Z'),
          reason: 'Still unreadable.',
        }),
      ]),
    );
    expect(read).toMatchObject({
      state: 'copy',
      copy: { documentId: 'doc-2', versionId: 'ver-2', reason: 'Still unreadable.' },
    });
  });

  it('skips a copy that was accepted or is still waiting, and says it does not know if none was sent back', () => {
    expect(
      sentBackCopyOf(
        'NEEDS_REPLACEMENT',
        list([send({ state: 'ACCEPTED' }), send({ state: 'AWAITING_DECISION', decidedAt: null })]),
      ),
    ).toEqual({ state: 'unknown' });
  });

  it('counts a contradiction and a proposed correction as sent back too', () => {
    for (const state of ['CONTRADICTION', 'CORRECTION_PROPOSED'] as const) {
      expect(sentBackCopyOf('NEEDS_REPLACEMENT', list([send({ state })])).state).toBe('copy');
    }
  });

  it('falls back to the document only for a send recorded before exact copies were kept', () => {
    const read = sentBackCopyOf(
      'NEEDS_REPLACEMENT',
      list(
        [],
        [
          {
            label: LEGACY_SEND_LABEL,
            documentId: 'doc-old',
            sentAt: null,
            state: 'NEEDS_REPLACEMENT',
            decidedAt: new Date('2026-10-01T00:00:00Z'),
          },
        ],
      ),
    );
    expect(read).toEqual({
      state: 'copy',
      copy: {
        precision: 'document',
        documentId: 'doc-old',
        versionId: null,
        versionNumber: null,
        title: null,
        sentAt: null,
        reason: null,
      },
    });
  });

  it('never invents a copy when the history could not be read or names none', () => {
    expect(sentBackCopyOf('NEEDS_REPLACEMENT', undefined)).toEqual({ state: 'unknown' });
    expect(sentBackCopyOf('NEEDS_REPLACEMENT', list([]))).toEqual({ state: 'unknown' });
    expect(
      sentBackCopyOf(
        'NEEDS_REPLACEMENT',
        list(
          [],
          [
            {
              label: LEGACY_SEND_LABEL,
              documentId: null,
              sentAt: null,
              state: 'NEEDS_REPLACEMENT',
              decidedAt: null,
            },
          ],
        ),
      ),
    ).toEqual({ state: 'unknown' });
  });
});
