import { describe, expect, it } from 'vitest';
import { blobResponseHeaders } from './headers';

/**
 * Pure header-construction tests (master directive §7 "PR 3") — no storage,
 * no DB, no token verification involved; those are covered separately
 * (packages/adapters' blob-token/storage tests, and the route's own
 * token/variant/not-found branches, which are simple early returns with no
 * independent logic worth mocking a database for).
 */
describe('blobResponseHeaders — the security-relevant response headers for served bytes', () => {
  it('always sets private/no-store caching, nosniff, and a locked-down CSP', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: 'passport.pdf',
    });
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Content-Security-Policy']).toBe("default-src 'none'; sandbox");
  });

  it('passes the declared content type through unchanged', () => {
    const headers = blobResponseHeaders({
      contentType: 'text/markdown',
      dispositionKind: 'inline',
      filename: 'notes.md',
    });
    expect(headers['Content-Type']).toBe('text/markdown');
  });

  it('renders inline vs attachment disposition correctly', () => {
    const inline = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: 'a.pdf',
    });
    expect(inline['Content-Disposition']).toContain('inline');
    const attachment = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'attachment',
      filename: 'a.pdf',
    });
    expect(attachment['Content-Disposition']).toContain('attachment');
  });

  it('strips control characters and quotes from an untrusted filename (header-injection guard)', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: 'evil"; x=\x00.pdf',
    });
    const disposition = headers['Content-Disposition'] ?? '';
    expect(disposition).not.toContain('\x00');
    // The embedded quote and backslash are stripped, not escaped — so the
    // classic filename="..." segment contains exactly the two quotes that
    // delimit it, never an attacker-supplied one breaking out early.
    expect(disposition).toContain('filename="evil; x=.pdf"');
  });

  it('includes the RFC 5987 filename* form for non-ASCII display names', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'attachment',
      filename: 'pasaporte-jose.pdf',
    });
    expect(headers['Content-Disposition']).toContain("filename*=UTF-8''");
  });

  it('falls back to a bare disposition (no filename params) when no filename is known', () => {
    const headers = blobResponseHeaders({
      contentType: 'application/pdf',
      dispositionKind: 'inline',
      filename: undefined,
    });
    expect(headers['Content-Disposition']).toBe('inline');
  });
});
