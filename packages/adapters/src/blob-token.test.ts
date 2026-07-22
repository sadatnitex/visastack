import { describe, expect, it } from 'vitest';
import { signBlobToken, verifyBlobToken } from './blob-token';

const SECRET = 'test-signing-secret';

function tokenFor(filename?: string) {
  const exp = Math.floor(Date.now() / 1000) + 300;
  const sig = signBlobToken(SECRET, 'obj-1', 'preview', 'original', exp, filename);
  return {
    objectKey: 'obj-1',
    disposition: 'preview',
    variant: 'original',
    exp,
    sig,
    ...(filename !== undefined ? { filename } : {}),
  };
}

describe('blob-token — filename is part of the signed payload (Milestone 2 / §18)', () => {
  it('verifies when no filename was signed and none is presented', () => {
    expect(verifyBlobToken(SECRET, tokenFor())).toBe(true);
  });

  it('verifies when the same filename is signed and presented', () => {
    expect(verifyBlobToken(SECRET, tokenFor('Passport - Approved.pdf'))).toBe(true);
  });

  it('rejects when the filename is swapped after signing (tamper-proof)', () => {
    const fields = tokenFor('Passport - Approved.pdf');
    expect(verifyBlobToken(SECRET, { ...fields, filename: 'Something Else.pdf' })).toBe(false);
  });

  it('rejects when a filename is added to a token signed with none', () => {
    const fields = tokenFor();
    expect(verifyBlobToken(SECRET, { ...fields, filename: 'Injected.pdf' })).toBe(false);
  });

  it('rejects when the presented filename is dropped from a token signed with one', () => {
    const { filename: _filename, ...withoutFilename } = tokenFor('Passport - Approved.pdf');
    expect(verifyBlobToken(SECRET, withoutFilename)).toBe(false);
  });
});
