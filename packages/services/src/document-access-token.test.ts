import { describe, expect, it } from 'vitest';
import {
  type DocumentAccessTokenFields,
  appendDocumentAccessToken,
  readDocumentAccessToken,
  signDocumentAccessToken,
  verifyDocumentAccessToken,
} from './document-access-token';

const SECRET = 'test-document-access-secret';

function baseFields(overrides: Partial<Omit<DocumentAccessTokenFields, 'sig'>> = {}) {
  return {
    documentId: 'doc-1',
    actorKind: 'applicant_owner' as const,
    action: 'PREVIEW' as const,
    purpose: 'owner_preview',
    stepUpSatisfied: false,
    exp: Math.floor(Date.now() / 1000) + 60,
    ...overrides,
  };
}

function signed(
  overrides: Partial<Omit<DocumentAccessTokenFields, 'sig'>> = {},
): DocumentAccessTokenFields {
  const fields = baseFields(overrides);
  return { ...fields, sig: signDocumentAccessToken(SECRET, fields) };
}

describe('document-access-token, sign/verify', () => {
  it('verifies a freshly signed token', () => {
    expect(verifyDocumentAccessToken(SECRET, signed())).toBe(true);
  });

  it('rejects a token signed with a different secret', () => {
    expect(verifyDocumentAccessToken('a-different-secret', signed())).toBe(false);
  });

  it('rejects an expired token even with a correct signature', () => {
    const fields = signed({ exp: Math.floor(Date.now() / 1000) - 10 });
    expect(verifyDocumentAccessToken(SECRET, fields)).toBe(false);
  });

  it('rejects a token whose exp has been tampered with after signing (signature no longer matches)', () => {
    const fields = signed();
    const tampered = { ...fields, exp: fields.exp + 3600 };
    expect(verifyDocumentAccessToken(SECRET, tampered)).toBe(false);
  });

  it('rejects a token whose action has been tampered with (an attacker trying to upgrade PREVIEW to DOWNLOAD_ORIGINAL)', () => {
    const fields = signed({ action: 'PREVIEW' });
    const tampered = { ...fields, action: 'DOWNLOAD_ORIGINAL' as const };
    expect(verifyDocumentAccessToken(SECRET, tampered)).toBe(false);
  });

  it('rejects a token whose documentId has been tampered with (an attacker trying to redirect the token to a different document)', () => {
    const fields = signed({ documentId: 'doc-1' });
    const tampered = { ...fields, documentId: 'doc-2' };
    expect(verifyDocumentAccessToken(SECRET, tampered)).toBe(false);
  });

  it('rejects a token whose purpose has been tampered with', () => {
    const fields = signed({ purpose: 'owner_preview' });
    const tampered = { ...fields, purpose: 'something_else' };
    expect(verifyDocumentAccessToken(SECRET, tampered)).toBe(false);
  });

  it('rejects a token whose stepUpSatisfied has been flipped from false to true', () => {
    const fields = signed({ stepUpSatisfied: false });
    const tampered = { ...fields, stepUpSatisfied: true };
    expect(verifyDocumentAccessToken(SECRET, tampered)).toBe(false);
  });

  it('two tokens for different actorKind/actorAccountId/organizationId combinations never produce the same signature (no cross-actor confusion)', () => {
    const owner = signed({ actorKind: 'applicant_owner' });
    const member = signed({
      actorKind: 'organization_member',
      actorAccountId: 'acc-1',
      organizationId: 'org-1',
    });
    const recipient = signed({ actorKind: 'individual_recipient', actorAccountId: 'acc-1' });
    expect(owner.sig).not.toBe(member.sig);
    expect(member.sig).not.toBe(recipient.sig);
    // Confirms the org variant genuinely didn't sign with a fixed/empty
    // organizationId: swapping just the org id changes the signature too.
    const memberOtherOrg = signed({
      actorKind: 'organization_member',
      actorAccountId: 'acc-1',
      organizationId: 'org-2',
    });
    expect(member.sig).not.toBe(memberOtherOrg.sig);
  });
});

describe('document-access-token, append/read round trip', () => {
  it('round-trips every field through a URL and back', () => {
    const fields = signed({
      actorKind: 'organization_member',
      actorAccountId: 'acc-42',
      organizationId: 'org-7',
      action: 'DOWNLOAD_REDACTED',
      purpose: 'agency_review',
      stepUpSatisfied: true,
    });
    const url = appendDocumentAccessToken(
      'https://example.test/api/blob/key1?d=preview&v=original',
      fields,
    );
    const parsed = new URL(url);
    const read = readDocumentAccessToken(parsed.searchParams);
    expect(read).toEqual(fields);
  });

  it('omits actorAccountId/organizationId params entirely for an applicant_owner token (never present as empty strings)', () => {
    const fields = signed({ actorKind: 'applicant_owner' });
    const url = appendDocumentAccessToken('https://example.test/api/blob/key1', fields);
    const parsed = new URL(url);
    expect(parsed.searchParams.has('aaid')).toBe(false);
    expect(parsed.searchParams.has('aoid')).toBe(false);
    const read = readDocumentAccessToken(parsed.searchParams);
    expect(read).toEqual(fields);
  });

  it('a purpose containing URL-significant characters (&, =, space, unicode) round-trips exactly once, not double-encoded', () => {
    const fields = signed({ purpose: 'q&a=review 漢字' });
    const url = appendDocumentAccessToken('https://example.test/api/blob/key1', fields);
    const parsed = new URL(url);
    const read = readDocumentAccessToken(parsed.searchParams);
    expect(read?.purpose).toBe('q&a=review 漢字');
    // The whole point of this test: a signature computed over the ORIGINAL
    // purpose must still verify against what comes back out.
    expect(read).toBeDefined();
    if (read) expect(verifyDocumentAccessToken(SECRET, read)).toBe(true);
  });

  it('appends after an existing query string with & , and starts fresh with ? on a bare URL', () => {
    const fields = signed();
    const withQuery = appendDocumentAccessToken('https://example.test/x?a=1', fields);
    expect(withQuery).toContain('?a=1&');
    const bare = appendDocumentAccessToken('https://example.test/x', fields);
    expect(bare).toContain('/x?');
  });

  it('readDocumentAccessToken returns undefined when required params are missing', () => {
    expect(readDocumentAccessToken(new URLSearchParams('adid=doc-1'))).toBeUndefined();
  });

  it('readDocumentAccessToken returns undefined for an unrecognized actorKind (fails closed, not a permissive default)', () => {
    const params = new URLSearchParams({
      adid: 'doc-1',
      aak: 'super_admin_backdoor',
      aact: 'PREVIEW',
      apur: 'x',
      aexp: '9999999999',
      asig: 'whatever',
    });
    expect(readDocumentAccessToken(params)).toBeUndefined();
  });

  it('readDocumentAccessToken returns undefined for a non-numeric exp', () => {
    const params = new URLSearchParams({
      adid: 'doc-1',
      aak: 'applicant_owner',
      aact: 'PREVIEW',
      apur: 'x',
      aexp: 'not-a-number',
      asig: 'whatever',
    });
    expect(readDocumentAccessToken(params)).toBeUndefined();
  });
});
