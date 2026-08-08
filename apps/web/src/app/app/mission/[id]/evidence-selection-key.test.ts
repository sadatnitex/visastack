import { describe, expect, it } from 'vitest';
import { composeSelectionCandidateKey } from './evidence-selection-key';

/**
 * Finding #33 (post-programme defect register): the evidence-selection
 * lookup used to be keyed by factId/documentId alone, so the same candidate
 * selected for two different requirements collided — one requirement's
 * "remove" action could delete a different requirement's selection. The
 * fix's actual correctness rests on the write site (page.tsx) and the two
 * read sites (collaboration-panels.tsx) composing an IDENTICAL key for the
 * same (requirement, candidate) pair, and a DIFFERENT key whenever either
 * differs — exactly what this asserts directly, without needing to render
 * either component (this codebase's vitest config scopes to route/lib-level
 * tests only; JSX/component behavior is Playwright's job, and no DOM
 * environment is configured here at all).
 */
describe('composeSelectionCandidateKey — disambiguates a candidate shared by two requirements (finding #33)', () => {
  it('produces the identical key for the identical (requirement, candidate) pair', () => {
    const a = composeSelectionCandidateKey('req-1', 'doc-1');
    const b = composeSelectionCandidateKey('req-1', 'doc-1');
    expect(a).toBe(b);
  });

  it('produces DIFFERENT keys for the SAME candidate selected against two DIFFERENT requirements', () => {
    // The exact scenario finding #33 describes: the same document is a
    // candidate for two requirements (e.g. both accept the same docType).
    const forReqA = composeSelectionCandidateKey('req-A', 'doc-shared');
    const forReqB = composeSelectionCandidateKey('req-B', 'doc-shared');
    expect(forReqA).not.toBe(forReqB);
  });

  it('produces different keys for two different candidates on the same requirement', () => {
    const forDocX = composeSelectionCandidateKey('req-1', 'doc-x');
    const forDocY = composeSelectionCandidateKey('req-1', 'doc-y');
    expect(forDocX).not.toBe(forDocY);
  });
});
