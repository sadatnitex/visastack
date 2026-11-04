import { describe, expect, it } from 'vitest';
import {
  MAX_BATCH_FILES,
  batchFileLine,
  batchHref,
  canFollowBatch,
  currentFlowStep,
  parseBatch,
  stageIsWorking,
} from './upload-batch';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('parseBatch', () => {
  it('keeps well-formed ids once each, in order', () => {
    expect(parseBatch(`${A},${B},${A}`)).toEqual([A, B]);
  });

  it('drops anything that is not a record id', () => {
    expect(parseBatch(`x,${A},../etc,'; drop,${B}`)).toEqual([A, B]);
  });

  it('reads a repeated parameter and an empty one', () => {
    expect(parseBatch([A, B])).toEqual([A, B]);
    expect(parseBatch(undefined)).toEqual([]);
    expect(parseBatch('')).toEqual([]);
  });

  it('stops at the most files followed at once', () => {
    const many = Array.from(
      { length: 50 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    expect(parseBatch(many.join(','))).toHaveLength(MAX_BATCH_FILES);
  });
});

describe('batchHref', () => {
  it('points at the review page with the ids', () => {
    expect(batchHref('person', [A, B])).toBe(`/app/applicant/person/review?batch=${A},${B}`);
  });
});

describe('a batch that is too long to follow', () => {
  it('goes to the plain page rather than following only some of the files', () => {
    const many = Array.from({ length: MAX_BATCH_FILES + 1 }, () => A);
    expect(batchHref('person', many)).toBe('/app/applicant/person/review');
    expect(batchHref('person', [])).toBe('/app/applicant/person/review');
    expect(canFollowBatch(MAX_BATCH_FILES)).toBe(true);
    expect(canFollowBatch(MAX_BATCH_FILES + 1)).toBe(false);
    expect(canFollowBatch(0)).toBe(false);
  });
});

describe('batchFileLine', () => {
  it('always says the file is saved', () => {
    for (const stage of [
      'checking',
      'reading',
      'found',
      'name',
      'done',
      'not_read',
      'saved',
      'needs_attention',
    ] as const) {
      expect(batchFileLine(stage, 2).startsWith('Saved.')).toBe(true);
    }
  });

  it('counts the details found', () => {
    expect(batchFileLine('found', 1)).toBe('Saved. 1 detail found, waiting for you.');
    expect(batchFileLine('found', 5)).toBe('Saved. 5 details found, waiting for you.');
  });
});

describe('what keeps the page refreshing', () => {
  it('is only a file still being checked or read', () => {
    expect(stageIsWorking('checking')).toBe(true);
    expect(stageIsWorking('reading')).toBe(true);
    expect(stageIsWorking('found')).toBe(false);
    expect(stageIsWorking('not_read')).toBe(false);
    expect(currentFlowStep(true)).toBe('check');
    expect(currentFlowStep(false)).toBe('review');
  });
});
