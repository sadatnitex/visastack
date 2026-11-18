import { CANONICAL_CASE_STATES, LEGACY_ONLY_MISSION_STATES } from '@visastack/core';
import { describe, expect, it } from 'vitest';
import { caseStagePath, caseStagePosition } from './case-stage-path';

describe('the stage path shared by the stage bar and the compact stage line', () => {
  it('keeps cancelling apart and out of the path, for every stage', () => {
    for (const state of [
      ...CANONICAL_CASE_STATES,
      ...LEGACY_ONLY_MISSION_STATES,
      'CANCELLED',
    ] as const) {
      const { path, apart } = caseStagePath(state);
      expect(path).not.toContain('CANCELLED');
      expect(apart).toEqual(['CANCELLED']);
    }
  });

  it('gives a legacy-only stage the legacy path and a normal stage the canonical one', () => {
    const legacy = LEGACY_ONLY_MISSION_STATES[0];
    expect(legacy).toBeDefined();
    if (legacy) expect(caseStagePath(legacy).path).toContain(legacy);
    expect(caseStagePath('IN_REVIEW').path).toEqual(
      CANONICAL_CASE_STATES.filter((stage) => stage !== 'CANCELLED'),
    );
  });

  it('says where the case is in words, and that a cancelled case was cancelled', () => {
    const { path } = caseStagePath('IN_REVIEW');
    expect(caseStagePosition(path, 'IN_REVIEW')).toBe(
      `Stage ${path.indexOf('IN_REVIEW') + 1} of ${path.length}`,
    );
    expect(caseStagePosition(path, 'CANCELLED')).toBe('This case was cancelled');
  });
});
