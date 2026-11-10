import { describe, expect, it } from 'vitest';
import { requestItemView } from './request-item';
import { requestBucket, requestChip } from './request-model';

const view = (status: 'OPEN' | 'RECEIVED' | 'ACCEPTED' | 'NEEDS_REPLACEMENT' | 'CANCELLED') =>
  requestItemView({ request: { status, kind: 'FIELD' } });

describe('the chip of a request', () => {
  it('keeps Received blue and never green, and only an acceptance green', () => {
    expect(requestChip(view('RECEIVED'))).toEqual({ word: 'Received', tone: 'info' });
    expect(requestChip(view('ACCEPTED'))).toEqual({ word: 'Reviewed', tone: 'success' });
    for (const status of ['OPEN', 'RECEIVED', 'NEEDS_REPLACEMENT', 'CANCELLED'] as const) {
      expect(requestChip(view(status)).tone, status).not.toBe('success');
    }
  });

  it('uses the words the agency summary uses', () => {
    expect(requestChip(view('OPEN')).word).toBe('Missing');
    expect(requestChip(view('NEEDS_REPLACEMENT')).word).toBe('Needs Correction');
    expect(requestChip(view('CANCELLED')).word).toBe('Cancelled');
  });
});

describe('the folder a request sits in', () => {
  it('puts what needs a reply first and what has only arrived last', () => {
    expect(requestBucket({ status: 'OPEN' }, view('OPEN'))).toBe('waiting');
    expect(requestBucket({ status: 'NEEDS_REPLACEMENT' }, view('NEEDS_REPLACEMENT'))).toBe(
      'waiting',
    );
    expect(requestBucket({ status: 'RECEIVED' }, view('RECEIVED'))).toBe('finished');
    expect(requestBucket({ status: 'ACCEPTED' }, view('ACCEPTED'))).toBe('finished');
    expect(requestBucket({ status: 'CANCELLED' }, view('CANCELLED'))).toBe('finished');
  });
});
