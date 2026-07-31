import { describe, expect, it } from 'vitest';
import { issueStepUpAssurance, verifyStepUpAssurance } from './step-up';

const SECRET = 'test-signing-secret';
const REQUEST = { accountId: 'acct-1', action: 'DOWNLOAD_ORIGINAL', resourceId: 'doc-1' };

describe('step-up assurance — server-generated, short-lived, action-bound (never a browser boolean)', () => {
  it('verifies a freshly issued token against the exact request it was issued for', () => {
    const token = issueStepUpAssurance(SECRET, REQUEST);
    expect(verifyStepUpAssurance(SECRET, token, REQUEST)).toBe(true);
  });

  it("rejects a token issued for a different account (never lets one session use another's step-up)", () => {
    const token = issueStepUpAssurance(SECRET, REQUEST);
    expect(verifyStepUpAssurance(SECRET, token, { ...REQUEST, accountId: 'acct-2' })).toBe(false);
  });

  it('rejects a token issued for a different action (never DOWNLOAD_ORIGINAL reused for EXPORT_PROFILE)', () => {
    const token = issueStepUpAssurance(SECRET, REQUEST);
    expect(verifyStepUpAssurance(SECRET, token, { ...REQUEST, action: 'EXPORT_PROFILE' })).toBe(
      false,
    );
  });

  it("rejects a token issued for a different resource (never doc-1's step-up reused for doc-2)", () => {
    const token = issueStepUpAssurance(SECRET, REQUEST);
    expect(verifyStepUpAssurance(SECRET, token, { ...REQUEST, resourceId: 'doc-2' })).toBe(false);
  });

  it('rejects an expired token even with a correct signature', () => {
    const now = Date.now();
    const token = issueStepUpAssurance(SECRET, REQUEST, 60, now - 61_000); // issued 61s ago, 60s TTL
    expect(verifyStepUpAssurance(SECRET, token, REQUEST, now)).toBe(false);
  });

  it('accepts a token right up to (but not past) its expiry', () => {
    const now = Date.now();
    const token = issueStepUpAssurance(SECRET, REQUEST, 60, now);
    expect(verifyStepUpAssurance(SECRET, token, REQUEST, now + 59_000)).toBe(true);
    expect(verifyStepUpAssurance(SECRET, token, REQUEST, now + 61_000)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const token = issueStepUpAssurance(SECRET, REQUEST);
    // Guarantee an actual mutation regardless of the original last hex
    // digit — flipping to a fixed '0' would silently no-op (and pass for
    // the wrong reason) the ~1-in-16 time the digest already ends in '0'.
    const flipped = token.sig.at(-1) === '0' ? '1' : '0';
    const tamperedSig = `${token.sig.slice(0, -1)}${flipped}`;
    expect(verifyStepUpAssurance(SECRET, { ...token, sig: tamperedSig }, REQUEST)).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueStepUpAssurance(SECRET, REQUEST);
    expect(verifyStepUpAssurance('a-different-secret', token, REQUEST)).toBe(false);
  });

  it('rejects a forged token with no real signature at all', () => {
    const forged = {
      ...REQUEST,
      exp: Math.floor(Date.now() / 1000) + 300,
      sig: 'not-a-real-signature',
    };
    expect(verifyStepUpAssurance(SECRET, forged, REQUEST)).toBe(false);
  });
});
